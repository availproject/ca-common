import { groupBy } from "es-toolkit";
import { bytesToHex } from "viem";
import Decimal from "decimal.js";

import {
  Aggregator,
  Quote,
  QuoteRequestExactInput,
  QuoteRequestExactOutput,
  QuoteResponse,
  QuoteSeriousness,
  QuoteType,
} from "./iface";
import {
  ChaindataMap,
  convertBigIntToDecimal,
  convertDecimalToBigInt,
  Currency,
  CurrencyID,
  maxByBigInt,
  minByBigInt,
  OmniversalChainID,
} from "../data";
import { Bytes } from "../types";
import { Holding } from "./iface";

export class AutoSelectionError extends Error {}
const safetyMultiplier = new Decimal("1.025");

const enum AggregateAggregatorsMode {
  MaximizeOutput,
  MinimizeInput,
}

export async function aggregateAggregators(
  requests: (QuoteRequestExactInput | QuoteRequestExactOutput)[],
  aggregators: Aggregator[],
  mode: AggregateAggregatorsMode,
): Promise<{ quote: Quote | null; aggregator: Aggregator }[]> {
  const responses = await Promise.all(
    aggregators.map(async (agg) => {
      let quotes: (Quote | null)[];
      try {
        quotes = await agg.getQuotes(requests);
      } catch (e) {
        console.log(
          "XCS | Failed to get quote from",
          agg,
          "in aggregateAggregators.",
          requests,
          "with:",
          e,
        );
        quotes = new Array(requests.length).fill(null);
      }
      return {
        quotes,
        agg,
      };
    }),
  );
  const final: { quote: Quote | null; aggregator: Aggregator }[] = new Array(
    requests.length,
  );
  switch (mode) {
    case AggregateAggregatorsMode.MaximizeOutput: {
      for (let i = 0; i < requests.length; i++) {
        const best = maxByBigInt(
          responses.map((ra) => ({ quote: ra.quotes[i], aggregator: ra.agg })),
          (r) => r.quote?.output.amountRaw ?? 0n,
        );
        if (best != null) {
          final[i] = best;
        } else {
          final[i] = {
            quote: null,
            aggregator: aggregators[0],
          };
        }
      }
      break;
    }
    case AggregateAggregatorsMode.MinimizeInput: {
      for (let i = 0; i < requests.length; i++) {
        const best = minByBigInt(
          responses.map((ra) => ({ quote: ra.quotes[i], aggregator: ra.agg })),
          (r) => r.quote?.input.amountRaw ?? 0n,
        );
        if (best != null) {
          final[i] = best;
        } else {
          final[i] = {
            quote: null,
            aggregator: aggregators[0],
          };
        }
      }
      break;
    }
  }
  return final;
}

/* 
In original autoSelectSources:
Assets = [1 ETH, 1 COT, 1 ETH, 1 USDT, 1 COT] 
Output = 4

First loop that just removes cot:
quoteAssets = [1 ETH, 1 ETH, 1 USDT] 
Output = 4

Outside the function we can just remove all COT's and assume those as being used
but that's incorrect as we want to use assets in exact order as holdings array.
We can't remove only COT's that are going to be used because we don't know which ones are going
to get used.

Proposed solution:
It should actually use assets in exact order, so it cant be done outside the function
1. The function has to keep an order of assets, separate out COT and non-COT assets.
2. Get quote for non-COT assets, then loop over the original order
3. Used either COT or quote depending on original order
4. Send back quotes and COT's used

Alg:
Assets = [1 ETH, 1 COT, 1 ETH, 1 USDT, 1 COT] 
Output = 4

1. separate into two with indexes:
quotes = [(1 ETH, 0), (1 ETH, 2), (1 USDT, 3)]
cots = [(1 COT, 1), (1 COT, 4)]

2. Get quotes using only quotes
3. merge quote cots and sort by order
4. loop assets (original order):
  if a quote:
    output = output - quote_output_amount
  if a cot:
    output = output - cot_amount
  if output <= 0:
    break
5. return quotes and assets used.
*/

export async function autoSelectSourcesV2(
  userAddress: Bytes,
  holdings: Holding[],
  outputRequired: Decimal,
  aggregators: Aggregator[],
  commonCurrencyID: CurrencyID = CurrencyID.USDC,
): Promise<{
  quoteResponses: QuoteResponse[];
  usedCOTs: {
    originalHolding: Holding;
    amountUsed: Decimal;
    idx: number;
    cur: Currency;
  }[];
}> {
  // Assumption: Holding is already sorted in usage priority
  console.debug("XCS | SSV2:", {
    holdings,
    outputRequired: outputRequired.toFixed(),
  });

  const fullLiquidationQuotes: {
    req: QuoteRequestExactInput;
    originalHolding: Holding;
    cur: Currency;
    idx: number;
  }[] = [];

  const cotList: {
    amount: Decimal;
    idx: number; // Original index
    chainID: OmniversalChainID;
    currency: Currency;
    originalHolding: Holding;
  }[] = [];

  for (const [idx, holding] of holdings.entries()) {
    const chain = ChaindataMap.get(holding.chainID);
    if (chain == null) {
      throw new AutoSelectionError("Chain not found");
    }
    const correspondingCurrency = chain.Currencies.find(
      (cur) => cur.currencyID === commonCurrencyID,
    );
    if (correspondingCurrency == null) {
      console.debug(
        "XCS | SS | Skipping because correspondingCurrency is null",
        {
          chain,
          correspondingCurrency,
        },
      );
      continue;
    }

    if (
      Buffer.compare(
        holding.tokenAddress,
        correspondingCurrency.tokenAddress,
      ) === 0
    ) {
      const normalizedAmount = new Decimal(holding.amountRaw).div(
        Decimal.pow(10, correspondingCurrency.decimals),
      );
      cotList.push({
        amount: normalizedAmount,
        idx,
        chainID: holding.chainID,
        currency: correspondingCurrency,
        originalHolding: holding,
      });
    } else {
      fullLiquidationQuotes.push({
        req: {
          userAddress,
          type: QuoteType.EXACT_IN,
          chain: chain.ChainID,
          inputToken: holding.tokenAddress,
          inputAmount: holding.amountRaw,
          outputToken: correspondingCurrency.tokenAddress,
          seriousness: QuoteSeriousness.PRICE_SURVEY,
        },
        originalHolding: holding,
        cur: correspondingCurrency,
        idx,
      });
    }
  }

  // Check if continuous COTs from the start can cover the entire requirement
  // We can skip quoting unused holdings
  if (cotList.length > 0 && cotList[0].idx === 0) {
    let continuousCOTAmount = new Decimal(0);
    let continuousCount = 0;

    for (const cot of cotList) {
      // only consecutive cots allowed, otherwise we need to go to quoting
      if (cot.idx !== continuousCount) break;

      continuousCOTAmount = continuousCOTAmount.add(cot.amount);
      continuousCount++;

      if (continuousCOTAmount.gte(outputRequired)) {
        console.log(
          "XCS | SS | Continuous COTs can satisfy requirement, skipping quotes",
        );

        const usedCOTs: {
          originalHolding: Holding;
          amountUsed: Decimal;
          idx: number;
          cur: Currency;
        }[] = [];

        let remainder = outputRequired;
        for (let i = 0; i < continuousCount; i++) {
          const cot = cotList[i];
          const amountToUse = Decimal.min(remainder, cot.amount);

          usedCOTs.push({
            originalHolding: cot.originalHolding,
            amountUsed: amountToUse,
            idx: cot.idx,
            cur: cot.currency,
          });

          remainder = remainder.minus(amountToUse);
          if (remainder.lte(0)) break;
        }

        console.debug("XCS | SS | Early return with continuous COTs:", {
          cots: usedCOTs,
        });
        return { quoteResponses: [], usedCOTs };
      }
    }
  }

  type ProcessingItem =
    | { idx: number; isCOT: true; cotData: (typeof cotList)[0] }
    | {
        idx: number;

        isCOT: false;
        quoteData: (typeof fullLiquidationQuotes)[0];
        responseIdx: number;
      };
  const processingQueue: ProcessingItem[] = [];

  // Add COT holdings
  for (const cot of cotList) {
    processingQueue.push({
      idx: cot.idx,
      isCOT: true,
      cotData: cot,
    });
  }

  // Add non-COT holdings
  for (let i = 0; i < fullLiquidationQuotes.length; i++) {
    processingQueue.push({
      idx: fullLiquidationQuotes[i].idx,
      isCOT: false,
      quoteData: fullLiquidationQuotes[i],
      responseIdx: i,
    });
  }

  // Sort by original index to maintain priority
  processingQueue.sort((a, b) => a.idx - b.idx);

  const responses = await aggregateAggregators(
    fullLiquidationQuotes.map((fq) => fq.req),
    aggregators,
    AggregateAggregatorsMode.MaximizeOutput,
  );
  console.debug("AutoSelectSources:Quotes", responses);

  const final: QuoteResponse[] = [];

  const usedCOTs: {
    originalHolding: Holding;
    amountUsed: Decimal;
    idx: number;
    cur: Currency;
  }[] = [];

  let remainder = outputRequired;
  for (const item of processingQueue) {
    if (remainder.lte(0)) {
      break;
    }

    if (item.isCOT) {
      // Process COT holding - direct usage, no quote
      const { cotData } = item;
      const amountToUse = Decimal.min(remainder, cotData.amount);

      usedCOTs.push({
        originalHolding: cotData.originalHolding,
        amountUsed: amountToUse,
        idx: cotData.idx,
        cur: cotData.currency,
      });

      remainder = remainder.minus(amountToUse);

      console.debug("selection:cot", {
        idx: cotData.idx,
        amountToUse: amountToUse.toFixed(),
        remainder: remainder.toFixed(),
      });
    } else {
      // Process non-COT holding - use existing quote logic
      const { quoteData, responseIdx } = item;
      const { quote: resp, aggregator } = responses[responseIdx];
      if (resp == null) {
        continue;
      }
      console.debug("selection:quote", {
        remainder: remainder.toFixed(),
        input: resp.input,
        output: resp.output,
      });
      const divisor = Decimal.pow(10, quoteData.cur.decimals);
      const oamD = new Decimal(resp.output.amount);
      if (oamD.gt(remainder)) {
        const indicativePrice = Decimal.div(
          resp.input.amountRaw,
          resp.output.amountRaw,
        );
        const userBal = new Decimal(quoteData.originalHolding.amountRaw);
        // remainder is the output we want, so the input amount is remainder × indicativePrice
        let expectedInput = Decimal.min(
          remainder.mul(divisor).mul(indicativePrice).mul(safetyMultiplier),
          userBal,
        );
        while (true) {
          console.debug("partial_quote_loop", {
            indicativePrice: indicativePrice.toFixed(),
            expectedInput: expectedInput.toFixed(),
            userBal: userBal.toFixed(),
            remainder: remainder.toFixed(),
          });
          const adequateQuoteResult = await aggregateAggregators(
            [
              {
                ...quoteData.req,
                seriousness: QuoteSeriousness.SERIOUS,
                inputAmount: convertDecimalToBigInt(expectedInput),
              },
            ],
            aggregators,
            AggregateAggregatorsMode.MaximizeOutput,
          );
          if (adequateQuoteResult.length !== 1) {
            throw new AutoSelectionError("???");
          }
          const adequateQuote = adequateQuoteResult[0];
          if (adequateQuote.quote == null) {
            throw new AutoSelectionError("Couldn't get buy quote");
          }
          const quote = adequateQuote.quote;
          console.log("partial_quote", {
            quote,
          });
          const oam2D = new Decimal(adequateQuote.quote.output.amount);
          if (oam2D.gte(remainder)) {
            final.push({
              quote,
              aggregator: adequateQuote.aggregator,
              holding: quoteData.originalHolding,
              chainID: Number(quoteData.req.chain.chainID),
            });
            remainder = remainder.minus(oam2D);
            break;
          } else if (expectedInput.eq(userBal)) {
            throw new AutoSelectionError(
              "Holding was supposedly enough to meet the full requirement but ceased to be so subsequently",
            );
          } else {
            expectedInput = Decimal.min(
              expectedInput.mul(safetyMultiplier),
              userBal,
            ); // try again with higher amount
          }
        }
      } else {
        console.debug("full_quote", resp);
        final.push({
          quote: resp,
          holding: quoteData.originalHolding,
          aggregator,
          chainID: Number(quoteData.req.chain.chainID),
        });
        remainder = remainder.minus(resp.output.amount);
      }
    }
  }
  console.debug("quotes_and_remainder", {
    remainder: remainder.toFixed(),
    final,
  });
  if (remainder.gt(0)) {
    throw new AutoSelectionError("NOT_ENOUGH_SWAP_FOR_REQUIREMENT");
  }

  console.log("final_quotes", { quotes: final, cots: usedCOTs });
  return { quoteResponses: final, usedCOTs };
}

export async function determineDestinationSwaps(
  userAddress: Bytes,
  requirement: Holding,
  aggregators: Aggregator[],
  commonCurrencyID: CurrencyID = CurrencyID.USDC,
): Promise<QuoteResponse> {
  const chaindata = ChaindataMap.get(requirement.chainID);
  if (chaindata == null) {
    throw new AutoSelectionError("Chain not found");
  }

  const COT = chaindata.Currencies.find(
    (cur) => cur.currencyID === commonCurrencyID,
  );
  if (COT == null) {
    throw new AutoSelectionError("COT not present on the destination chain");
  }
  // FIXME: Replace with oracle usage - should reduce time.
  // what happens if we happen to sell the requirement for the COT, what would the amount be?
  const fullLiquidationQR: QuoteRequestExactInput = {
    type: QuoteType.EXACT_IN,
    chain: requirement.chainID,
    userAddress,
    inputToken: requirement.tokenAddress,
    outputToken: COT.tokenAddress,
    inputAmount: requirement.amountRaw,
    seriousness: QuoteSeriousness.PRICE_SURVEY,
  };
  const fullLiquidationResult = await aggregateAggregators(
    [fullLiquidationQR],
    aggregators,
    AggregateAggregatorsMode.MaximizeOutput,
  );
  if (fullLiquidationResult.length !== 1) {
    throw new AutoSelectionError("???");
  }
  const fullLiquidationQuote = fullLiquidationResult[0];
  if (fullLiquidationQuote.quote == null) {
    throw new AutoSelectionError("Couldn't get full liquidation quote");
  }

  let curAmount = convertBigIntToDecimal(
    fullLiquidationQuote.quote.output.amountRaw,
  ).mul(safetyMultiplier);

  while (true) {
    const buyQuoteResult = await aggregateAggregators(
      [
        {
          type: QuoteType.EXACT_IN,
          userAddress,
          chain: requirement.chainID,
          inputToken: COT.tokenAddress,
          outputToken: requirement.tokenAddress,
          inputAmount: convertDecimalToBigInt(curAmount),
          seriousness: QuoteSeriousness.SERIOUS,
        },
      ],
      aggregators,
      AggregateAggregatorsMode.MaximizeOutput,
    );
    if (buyQuoteResult.length !== 1) {
      throw new AutoSelectionError("???");
    }
    const buyQuote = buyQuoteResult[0];
    if (buyQuote.quote == null) {
      throw new AutoSelectionError("Couldn't get buy quote");
    }
    console.debug("XCS | DDS | 2⒜ iteration", {
      buyQuote,
      curAmount,
    });
    if (buyQuote.quote.output.amountRaw >= requirement.amountRaw) {
      return {
        chainID: Number(requirement.chainID.chainID),
        quote: buyQuote.quote,
        aggregator: buyQuote.aggregator,
        holding: requirement,
      };
    } else {
      curAmount = curAmount.mul(safetyMultiplier); // try again with higher amount
    }
  }
}

export async function liquidateInputHoldings(
  userAddress: Bytes,
  holdings: Holding[],
  aggregators: Aggregator[],
  commonCurrencyID = CurrencyID.USDC,
): Promise<QuoteResponse[]> {
  console.debug("XCS | LIH | Holdings:", holdings);
  const groupedByChainID = groupBy(holdings, (h) =>
    bytesToHex(h.chainID.toBytes()),
  );

  const fullLiquidationQuotes: {
    req: QuoteRequestExactInput;
    originalHolding: Holding;
    cur: Currency;
  }[] = [];

  for (const holdings of Object.values(groupedByChainID)) {
    const chain = ChaindataMap.get(holdings[0].chainID);
    if (chain == null) {
      throw new AutoSelectionError("Chain not found");
    }
    const correspondingCurrency = chain.Currencies.find(
      (cur) => cur.currencyID === commonCurrencyID,
    );
    if (correspondingCurrency == null) {
      console.debug(
        "XCS | LIH | Skipping because correspondingCurrency is null",
        {
          chain,
          correspondingCurrency,
        },
      );
      continue;
    }

    for (const holding of holdings) {
      if (
        Buffer.compare(
          holding.tokenAddress,
          correspondingCurrency.tokenAddress,
        ) === 0
      ) {
        console.log(
          "XCS | LIH | Disqualifying",
          holding,
          "because holding.tokenAddress = CA asset",
        );
        continue;
      }
      fullLiquidationQuotes.push({
        req: {
          userAddress,
          type: QuoteType.EXACT_IN,
          chain: chain.ChainID,
          inputToken: holding.tokenAddress,
          inputAmount: holding.amountRaw,
          outputToken: correspondingCurrency.tokenAddress,
          seriousness: QuoteSeriousness.SERIOUS,
        },
        // necessary for various purposes
        originalHolding: holding,
        cur: correspondingCurrency,
      });
    }
  }

  const responses = await aggregateAggregators(
    fullLiquidationQuotes.map((fq) => fq.req),
    aggregators,
    AggregateAggregatorsMode.MaximizeOutput,
  );

  console.debug("XCS | LIH | Responses:", responses);

  const quotes: QuoteResponse[] = [];
  for (const [i, response] of responses.entries()) {
    if (response.quote !== null) {
      quotes.push({
        quote: response.quote,
        aggregator: response.aggregator,
        holding: fullLiquidationQuotes[i].originalHolding,
        chainID: Number(fullLiquidationQuotes[i].req.chain.chainID),
      });
    }
  }

  return quotes;
}

export async function destinationSwapWithExactIn(
  userAddress: Bytes,
  omniChainID: OmniversalChainID,
  inputAmount: bigint,
  outputToken: Bytes,
  aggregators: Aggregator[],
  inputCurrency: CurrencyID = CurrencyID.USDC,
): Promise<QuoteResponse> {
  const chaindata = ChaindataMap.get(omniChainID);
  if (chaindata == null) {
    throw new AutoSelectionError("Chain not found");
  }
  const COT = chaindata.Currencies.find(
    (cur) => cur.currencyID === inputCurrency,
  );
  if (COT == null) {
    throw new AutoSelectionError("COT not present on the destination chain");
  }
  const fullLiquidationResult = await aggregateAggregators(
    [
      {
        type: QuoteType.EXACT_IN,
        chain: omniChainID,
        userAddress,
        inputToken: COT.tokenAddress,
        outputToken: outputToken,
        inputAmount: inputAmount,
        seriousness: QuoteSeriousness.SERIOUS,
      },
    ],
    aggregators,
    AggregateAggregatorsMode.MaximizeOutput,
  );
  if (fullLiquidationResult.length !== 1) {
    throw new AutoSelectionError("???");
  }
  const fullLiquidationQuote = fullLiquidationResult[0];
  if (fullLiquidationQuote.quote == null) {
    throw new AutoSelectionError("Couldn't get full liquidation quote");
  }
  return {
    chainID: Number(omniChainID.chainID),
    quote: fullLiquidationQuote.quote,
    aggregator: fullLiquidationQuote.aggregator,
    holding: {
      amountRaw: inputAmount,
      chainID: omniChainID,
      tokenAddress: COT.tokenAddress,
    },
  };
}
