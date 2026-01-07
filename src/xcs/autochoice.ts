import { groupBy, orderBy } from "es-toolkit";
import { bytesToBigInt, bytesToHex } from "viem";
import Decimal from "decimal.js";

import {
  Aggregator,
  Quote,
  QuoteRequestExactInput,
  QuoteRequestExactOutput,
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
import { FixedFeeTuple } from "../proto/definition";

type Asset = {
  tokenAddress: Bytes;
  amount: bigint;
};

export type Holding = {
  chainID: OmniversalChainID;
  value: number;
} & Asset;

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
          (r) => r.quote?.outputAmountMinimum ?? 0n,
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
          (r) => r.quote?.inputAmount ?? 0n,
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
) {
  // Assumption: Holding is already sorted in usage priority
  console.log("XCS | SSV2:", {
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
      console.log("XCS | SS | Skipping because correspondingCurrency is null", {
        chain,
        correspondingCurrency,
      });
      continue;
    }

    if (
      Buffer.compare(
        holding.tokenAddress,
        correspondingCurrency.tokenAddress,
      ) === 0
    ) {
      const normalizedAmount = new Decimal(holding.amount).div(
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
          inputAmount: holding.amount,
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

        console.log("XCS | SS | Early return with continuous COTs:", {
          cots: usedCOTs,
        });
        return { quotes: [], usedCOTs };
      }
    }
  }

  type ProcessingItem = {
    idx: number;
    isCOT: boolean;
  } & (
    | { isCOT: true; cotData: (typeof cotList)[0] }
    | {
        isCOT: false;
        quoteData: (typeof fullLiquidationQuotes)[0];
        responseIdx: number;
      }
  );
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
  console.log("XCS | SS | Responses:", responses);

  const final: ((typeof fullLiquidationQuotes)[0] & {
    quote: Quote;
    agg: Aggregator;
  })[] = [];

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

      console.log("XCS | SS | Used COT", {
        idx: cotData.idx,
        amountToUse: amountToUse.toFixed(),
        remainder: remainder.toFixed(),
      });
    } else {
      // Process non-COT holding - use existing quote logic
      const { quoteData, responseIdx } = item;
      const { quote: resp, aggregator: agg } = responses[responseIdx];
      if (resp == null) {
        continue;
      }
      console.log("XCS | SS | 1", {
        i: responseIdx,
        idx: quoteData.idx,
        remainder,
        q: quoteData,
        resp,
        agg,
      });
      const divisor = Decimal.pow(10, quoteData.cur.decimals);
      const oamD = Decimal.div(resp.outputAmountMinimum, divisor);
      if (oamD.gt(remainder)) {
        const indicativePrice = Decimal.div(
          resp.inputAmount,
          resp.outputAmountMinimum,
        );
        const userBal = new Decimal(quoteData.originalHolding.amount);
        // remainder is the output we want, so the input amount is remainder × indicativePrice
        let expectedInput = Decimal.min(
          remainder.mul(divisor).mul(indicativePrice).mul(safetyMultiplier),
          userBal,
        );
        while (true) {
          console.log("XCS | SS | 2⒜", {
            indicativePrice,
            expectedInput,
            userBal,
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
          console.log("XCS | SS | 2⒜⑴", {
            adequateQuote,
          });
          const oam2D = Decimal.div(
            adequateQuote.quote.outputAmountMinimum,
            divisor,
          );
          if (oam2D.gte(remainder)) {
            final.push({
              ...quoteData,
              quote: adequateQuote.quote,
              agg: adequateQuote.aggregator,
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
        console.log("XCS | SS | 2⒝", resp);
        final.push({
          ...quoteData,
          quote: resp,
          agg,
        });
        remainder = remainder.minus(
          convertBigIntToDecimal(resp.outputAmountMinimum).div(divisor),
        );
      }
    }
  }
  console.log("XCS | SS | 3⒜", {
    remainder,
    final,
  });
  if (remainder.gt(0)) {
    throw new AutoSelectionError(
      "Failed to accumulate enough swaps to meet requirement",
    );
  }
  console.log("XCS | SS | Final:", { quotes: final, cots: usedCOTs });
  return { quotes: final, usedCOTs };
}

export async function autoSelectSources(
  userAddress: Bytes,
  holdings: Holding[],
  outputRequired: Decimal,
  aggregators: Aggregator[],
  collectionFees: FixedFeeTuple[],
  commonCurrencyID: CurrencyID = CurrencyID.USDC,
) {
  console.log("XCS | SS | Holdings:", holdings);

  const groupedByChainID = groupBy(holdings, (h) =>
    bytesToHex(h.chainID.toBytes()),
  );

  const fullLiquidationQuotes: {
    req: QuoteRequestExactInput;
    cfee: bigint;
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
      console.log("XCS | SS | Skipping because correspondingCurrency is null", {
        chain,
        correspondingCurrency,
      });
      continue;
    }
    const cfeeTuple = collectionFees.find((cf) => {
      return (
        cf.universe === chain.Universe &&
        Buffer.compare(cf.chainID, chain.ChainID32) === 0 &&
        // output token is the CA one
        Buffer.compare(cf.tokenAddress, correspondingCurrency.tokenAddress) ===
          0
      );
    });
    const cfee = cfeeTuple != null ? bytesToBigInt(cfeeTuple.fee) : 0n;

    for (const holding of holdings) {
      if (
        Buffer.compare(
          holding.tokenAddress,
          correspondingCurrency.tokenAddress,
        ) === 0
      ) {
        console.log(
          "XCS | SS | Disqualifying",
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
          inputAmount: holding.amount,
          outputToken: correspondingCurrency.tokenAddress,
          seriousness: QuoteSeriousness.PRICE_SURVEY,
        },
        // necessary for various purposes
        cfee,
        originalHolding: holding,
        cur: correspondingCurrency,
      });
    }
  }

  // const groupedByChainID = groupBy(quoteOutputs, h => h.chainIDHex)
  const quotesByValue = orderBy(
    fullLiquidationQuotes,
    [
      (quoteOut: (typeof fullLiquidationQuotes)[0]): unknown => quoteOut.cfee,
      (quoteOut: (typeof fullLiquidationQuotes)[0]): unknown =>
        quoteOut.originalHolding.value, // once optimized for collections, we select the biggest asset we hold
    ],
    ["asc", "desc"],
  );
  const responses = await aggregateAggregators(
    quotesByValue.map((fq) => fq.req),
    aggregators,
    AggregateAggregatorsMode.MaximizeOutput,
  );
  console.log("XCS | SS | Responses:", responses);
  const final: ((typeof fullLiquidationQuotes)[0] & {
    quote: Quote;
    agg: Aggregator;
  })[] = [];

  let remainder = outputRequired; // assuming all that chains have the same amount of fixed point places
  for (let i = 0; i < quotesByValue.length; i++) {
    if (remainder.lte(0)) {
      break;
    }
    const q = quotesByValue[i];
    const { quote: resp, aggregator: agg } = responses[i];
    if (resp == null) {
      continue;
    }
    console.log("XCS | SS | 1", {
      i,
      remainder,
      q,
      resp,
      agg,
    });
    const divisor = Decimal.pow(10, q.cur.decimals);
    const oamD = convertBigIntToDecimal(resp.outputAmountMinimum).div(divisor);
    if (oamD.gt(remainder)) {
      const indicativePrice = convertBigIntToDecimal(resp.inputAmount).div(
        convertBigIntToDecimal(resp.outputAmountMinimum),
      );
      const userBal = convertBigIntToDecimal(q.originalHolding.amount);
      // remainder is the output we want, so the input amount is remainder × indicativePrice
      let expectedInput = Decimal.min(
        remainder.mul(divisor).mul(indicativePrice).mul(safetyMultiplier),
        userBal,
      );
      while (true) {
        console.log("XCS | SS | 2⒜", {
          indicativePrice,
          expectedInput,
          userBal,
        });
        const adequateQuoteResult = await aggregateAggregators(
          [
            {
              ...q.req,
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
        console.log("XCS | SS | 2⒜⑴", {
          adequateQuote,
        });
        const oam2D = convertBigIntToDecimal(
          adequateQuote.quote.outputAmountMinimum,
        ).div(divisor);
        if (oam2D.gte(remainder)) {
          final.push({
            ...q,
            quote: adequateQuote.quote,
            agg: adequateQuote.aggregator,
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
      console.log("XCS | SS | 2⒝", resp);
      final.push({
        ...q,
        quote: resp,
        agg,
      });
      remainder = remainder.minus(
        convertBigIntToDecimal(resp.outputAmountMinimum).div(divisor),
      );
    }
  }
  console.log("XCS | SS | 3⒜", {
    remainder,
    final,
  });
  if (remainder.gt(0)) {
    throw new AutoSelectionError(
      "Failed to accumulate enough swaps to meet requirement",
    );
  }
  console.log("XCS | SS | Final:", final);
  return final;
}

export async function determineDestinationSwaps(
  userAddress: Bytes,
  chainID: OmniversalChainID,
  requirement: Asset,
  aggregators: Aggregator[],
  commonCurrencyID: CurrencyID = CurrencyID.USDC,
): Promise<{
  quote: Quote | null;
  aggregator: Aggregator;
  inputAmount: Decimal;
  outputAmount: bigint;
}> {
  const chaindata = ChaindataMap.get(chainID);
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
    chain: chainID,
    userAddress,
    inputToken: requirement.tokenAddress,
    outputToken: COT.tokenAddress,
    inputAmount: requirement.amount,
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
    fullLiquidationQuote.quote.outputAmountLikely,
  ).mul(safetyMultiplier);
  console.log("XCS | DDS | 1⒜", {
    fullLiquidationQR,
    fullLiquidationResult,
    COT,
  });
  while (true) {
    const buyQuoteResult = await aggregateAggregators(
      [
        {
          type: QuoteType.EXACT_IN,
          userAddress,
          chain: chainID,
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
    console.log("XCS | DDS | 2⒜ iteration", {
      buyQuote,
      curAmount,
    });
    if (buyQuote.quote.outputAmountMinimum >= requirement.amount) {
      return {
        ...buyQuote,
        inputAmount: convertBigIntToDecimal(buyQuote.quote.inputAmount).div(
          Decimal.pow(10, COT.decimals),
        ),
        outputAmount: requirement.amount,
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
  collectionFees: FixedFeeTuple[],
  commonCurrencyID = CurrencyID.USDC,
) {
  console.log("XCS | LIH | Holdings:", holdings);
  const groupedByChainID = groupBy(holdings, (h) =>
    bytesToHex(h.chainID.toBytes()),
  );

  const fullLiquidationQuotes: {
    req: QuoteRequestExactInput;
    cfee: bigint;
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
      console.log(
        "XCS | LIH | Skipping because correspondingCurrency is null",
        {
          chain,
          correspondingCurrency,
        },
      );
      continue;
    }
    const cfeeTuple = collectionFees.find((cf) => {
      return (
        cf.universe === chain.Universe &&
        Buffer.compare(cf.chainID, chain.ChainID32) === 0 &&
        // output token is the CA one
        Buffer.compare(cf.tokenAddress, correspondingCurrency.tokenAddress) ===
          0
      );
    });

    const cfee = cfeeTuple != null ? bytesToBigInt(cfeeTuple.fee) : 0n;

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
          inputAmount: holding.amount,
          outputToken: correspondingCurrency.tokenAddress,
          seriousness: QuoteSeriousness.SERIOUS,
        },
        // necessary for various purposes
        cfee,
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

  console.log("XCS | LIH | Responses:", responses);

  const validResponses = responses
    .filter((r) => r.quote !== null)
    .map((r, i) => ({
      ...r,
      ...fullLiquidationQuotes[i],
      agg: r.aggregator,
      quote: r.quote,
    })) as {
    agg: Aggregator;
    quote: Quote;
    req: QuoteRequestExactInput;
    cfee: bigint;
    originalHolding: Holding;
    cur: Currency;
    aggregator: Aggregator;
  }[];

  const total = validResponses.reduce((acc, r) => {
    return acc.add(
      new Decimal(r.quote!.outputAmountMinimum ?? 0n).div(
        Decimal.pow(10, r.cur.decimals),
      ),
    );
  }, new Decimal(0));

  return {
    quotes: validResponses,
    total,
  };
}

export async function destinationSwapWithExactIn(
  userAddress: Bytes,
  chainID: OmniversalChainID,
  inputAmount: bigint,
  outputToken: Bytes,
  aggregators: Aggregator[],
  commonCurrencyID: CurrencyID = CurrencyID.USDC,
) {
  const chaindata = ChaindataMap.get(chainID);
  if (chaindata == null) {
    throw new AutoSelectionError("Chain not found");
  }
  const COT = chaindata.Currencies.find(
    (cur) => cur.currencyID === commonCurrencyID,
  );
  if (COT == null) {
    throw new AutoSelectionError("COT not present on the destination chain");
  }
  const fullLiquidationResult = await aggregateAggregators(
    [
      {
        type: QuoteType.EXACT_IN,
        chain: chainID,
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
    ...fullLiquidationQuote,
    inputAmount: convertBigIntToDecimal(inputAmount).div(
      Decimal.pow(10, COT.decimals),
    ),
    outputAmount: fullLiquidationQuote.quote.outputAmountMinimum,
  };
}
