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
  bytesEqual,
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

// Legacy per-holding shape used by the deprecated `*ByRecipient` positional fns. `recipient`
// historically doubled as both swap executor (taker) and output destination (receiver) — that
// conflation is the root of GS013-class bugs. New code should pass `HoldingWithSwapAddresses`
// to the new wrappers below; this type stays for backwards compat. The optional
// `receiverAddress` lets the new wrappers thread per-holding receiver through legacy code.
export type HoldingWithRecipient = Holding & {
  recipient: Bytes;
  receiverAddress?: Bytes;
};

// Per-holding shape for the new wrappers. Both `takerAddress` and `receiverAddress` are
// required — even when source-side has them equal today, keeping both explicit forces every
// call site to acknowledge each role.
export type HoldingWithSwapAddresses = Holding & {
  takerAddress: Bytes;
  receiverAddress: Bytes;
};

export class AutoSelectionError extends Error {}
const safetyMultiplier = new Decimal("1.01");
const maxConvergenceExtraValue = new Decimal("0.5");

export enum AggregateAggregatorsMode {
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
        const candidates = responses
          .map((ra) => ({ quote: ra.quotes[i], aggregator: ra.agg }))
          .filter(
            (r): r is { quote: Quote; aggregator: Aggregator } =>
              r.quote != null,
          );
        const best =
          candidates.length > 0
            ? minByBigInt(candidates, (r) => r.quote.input.amountRaw)
            : null;

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

export type QuoteCandidate = {
  quote: Quote;
  aggregator: Aggregator;
};

export function rawAmountForCurrencyValue(
  currency: Currency,
  value: Decimal = maxConvergenceExtraValue,
): Decimal {
  return value.mul(Decimal.pow(10, currency.decimals));
}

export function inputRawForOutputRaw(
  quote: Quote,
  outputAmountRaw: Decimal,
): Decimal {
  if (quote.output.amountRaw === 0n) {
    throw new AutoSelectionError("Cannot estimate input for zero output quote");
  }
  return outputAmountRaw
    .mul(quote.input.amountRaw.toString())
    .div(quote.output.amountRaw.toString());
}

export function applyCappedSafetyMargin(args: {
  baseInputAmountRaw: Decimal;
  inputAmountRaw: Decimal;
  maxExtraInputAmountRaw: Decimal;
  maxInputAmountRaw?: Decimal;
}): Decimal {
  const maxInputWithExtra = args.baseInputAmountRaw.add(
    args.maxExtraInputAmountRaw,
  );
  const maxAllowedInput =
    args.maxInputAmountRaw == null
      ? maxInputWithExtra
      : Decimal.min(maxInputWithExtra, args.maxInputAmountRaw);
  return Decimal.min(args.inputAmountRaw.mul(safetyMultiplier), maxAllowedInput);
}

export async function firstSuccessfulQuoteCandidate(
  candidates: Promise<QuoteCandidate | null>[],
  noQuoteMessage: string,
): Promise<QuoteCandidate> {
  let pending = candidates.map((promise, idx) => ({
    idx,
    promise: promise.then((candidate) => ({ idx, candidate })),
  }));

  while (pending.length > 0) {
    const settled = await Promise.race(pending.map((p) => p.promise));
    if (settled.candidate != null) {
      return settled.candidate;
    }
    pending = pending.filter((p) => p.idx !== settled.idx);
  }

  throw new AutoSelectionError(noQuoteMessage);
}

export async function quoteCandidateOrNull(
  label: string,
  quotePromise: Promise<QuoteCandidate>,
): Promise<QuoteCandidate | null> {
  try {
    return await quotePromise;
  } catch (e) {
    console.debug("XCS | quote_candidate_failed", {
      label,
      error: e instanceof Error ? e.message : e,
    });
    return null;
  }
}

export async function getExactOutQuoteCandidate(args: {
  request: QuoteRequestExactOutput;
  aggregators: Aggregator[];
  maxInputAmountRaw?: bigint;
  requiredOutputAmountRaw?: bigint;
}): Promise<QuoteCandidate> {
  const exactOutResult = await aggregateAggregators(
    [args.request],
    args.aggregators,
    AggregateAggregatorsMode.MinimizeInput,
  );
  if (exactOutResult.length !== 1) {
    throw new AutoSelectionError(
      "Unexpected response length from aggregateAggregators",
    );
  }
  const exactOutQuote = exactOutResult[0];
  if (exactOutQuote.quote == null) {
    throw new AutoSelectionError("Couldn't get EXACT_OUT quote");
  }
  if (
    exactOutQuote.quote.output.amountRaw <
    (args.requiredOutputAmountRaw ?? args.request.outputAmount)
  ) {
    throw new AutoSelectionError("EXACT_OUT quote output is below requirement");
  }
  if (
    args.maxInputAmountRaw != null &&
    exactOutQuote.quote.input.amountRaw > args.maxInputAmountRaw
  ) {
    throw new AutoSelectionError("EXACT_OUT quote input exceeds holding");
  }
  return {
    quote: exactOutQuote.quote,
    aggregator: exactOutQuote.aggregator,
  };
}

export async function convergeExactInQuote(args: {
  makeRequest: (inputAmountRaw: bigint) => QuoteRequestExactInput;
  initialInputAmountRaw: Decimal;
  maxExtraInputAmountRaw: Decimal;
  requiredOutputAmountRaw: bigint;
  aggregators: Aggregator[];
  maxInputAmountRaw?: Decimal;
  maxAttempts?: number;
  didNotConvergeMessage: string;
  maxInputReachedMessage: string;
}): Promise<QuoteCandidate> {
  const baseInputAmountRaw = args.initialInputAmountRaw;
  let inputAmountRaw = applyCappedSafetyMargin({
    baseInputAmountRaw,
    inputAmountRaw: baseInputAmountRaw,
    maxExtraInputAmountRaw: args.maxExtraInputAmountRaw,
    maxInputAmountRaw: args.maxInputAmountRaw,
  });
  const maxAttempts = args.maxAttempts ?? 10;

  for (let attempts = 1; attempts <= maxAttempts; attempts++) {
    const requestInputAmountRaw = convertDecimalToBigInt(inputAmountRaw);
    console.debug("XCS | convergence_quote_loop", {
      attempts,
      inputAmountRaw: requestInputAmountRaw.toString(),
      maxExtraInputAmountRaw: convertDecimalToBigInt(
        args.maxExtraInputAmountRaw,
      ).toString(),
      maxInputAmountRaw:
        args.maxInputAmountRaw == null
          ? undefined
          : convertDecimalToBigInt(args.maxInputAmountRaw).toString(),
      requiredOutputAmountRaw: args.requiredOutputAmountRaw.toString(),
    });
    const quoteResult = await aggregateAggregators(
      [args.makeRequest(requestInputAmountRaw)],
      args.aggregators,
      AggregateAggregatorsMode.MaximizeOutput,
    );
    if (quoteResult.length !== 1) {
      throw new AutoSelectionError(
        "Unexpected response length from aggregateAggregators",
      );
    }

    const quoteCandidate = quoteResult[0];
    if (quoteCandidate.quote == null) {
      throw new AutoSelectionError("Couldn't get buy quote");
    }
    if (quoteCandidate.quote.output.amountRaw >= args.requiredOutputAmountRaw) {
      return {
        quote: quoteCandidate.quote,
        aggregator: quoteCandidate.aggregator,
      };
    }

    const nextInputAmountRaw = applyCappedSafetyMargin({
      baseInputAmountRaw,
      inputAmountRaw,
      maxExtraInputAmountRaw: args.maxExtraInputAmountRaw,
      maxInputAmountRaw: args.maxInputAmountRaw,
    });
    if (nextInputAmountRaw.eq(inputAmountRaw)) {
      throw new AutoSelectionError(args.maxInputReachedMessage);
    }
    inputAmountRaw = nextInputAmountRaw;
  }

  throw new AutoSelectionError(args.didNotConvergeMessage);
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

/**
 * @deprecated Use {@link autoSelectSources} (object args; per-holding `takerAddress` and
 * `receiverAddress` on each `HoldingWithSwapAddresses`).
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
  return autoSelectSourcesV2ByRecipient(
    holdings.map((holding) => ({ ...holding, recipient: userAddress })),
    outputRequired,
    aggregators,
    commonCurrencyID,
  );
}

/**
 * @deprecated Use {@link autoSelectSources} (object args; per-holding `takerAddress` and
 * `receiverAddress` on each `HoldingWithSwapAddresses`).
 */
export async function autoSelectSourcesV2ByRecipient(
  holdings: HoldingWithRecipient[],
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

    if (bytesEqual(holding.tokenAddress, correspondingCurrency.tokenAddress)) {
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
          userAddress: holding.recipient,
          // New wrappers thread per-holding receiver via this field. Falls back to taker
          // (`recipient`) when absent — preserves legacy positional-call behavior.
          receiverAddress: holding.receiverAddress,
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
        let attempts = 0;
        while (true) {
          if (++attempts > 10) {
            throw new AutoSelectionError("Partial quote did not converge");
          }
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
            throw new AutoSelectionError(
              "Unexpected response length from aggregateAggregators",
            );
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

/**
 * @deprecated Use {@link getDestinationExactOutSwap} (object args; explicit `takerAddress` and
 * `receiverAddress`, both required).
 */
export async function determineDestinationSwaps(
  userAddress: Bytes,
  requirement: Holding,
  aggregators: Aggregator[],
  commonCurrencyID: CurrencyID = CurrencyID.USDC,
  receiverAddress?: Bytes,
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

  const exactOutCandidate = quoteCandidateOrNull(
    "destination_exact_out",
    getExactOutQuoteCandidate({
      request: {
        type: QuoteType.EXACT_OUT,
        chain: requirement.chainID,
        userAddress,
        receiverAddress,
        inputToken: COT.tokenAddress,
        outputToken: requirement.tokenAddress,
        outputAmount: requirement.amountRaw,
        seriousness: QuoteSeriousness.SERIOUS,
      },
      aggregators,
      requiredOutputAmountRaw: requirement.amountRaw,
    }),
  );

  const convergedCandidate = quoteCandidateOrNull(
    "destination_convergence",
    (async () => {
      // FIXME: Replace with oracle usage - should reduce time.
      // what happens if we happen to sell the requirement for the COT, what would the amount be?
      const fullLiquidationQR: QuoteRequestExactInput = {
        type: QuoteType.EXACT_IN,
        chain: requirement.chainID,
        userAddress,
        receiverAddress,
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
        throw new AutoSelectionError(
          "Unexpected response length from aggregateAggregators",
        );
      }

      const fullLiquidationQuote = fullLiquidationResult[0];
      if (fullLiquidationQuote.quote == null) {
        throw new AutoSelectionError("Couldn't get full liquidation quote");
      }

      return convergeExactInQuote({
        initialInputAmountRaw: convertBigIntToDecimal(
          fullLiquidationQuote.quote.output.amountRaw,
        ),
        maxExtraInputAmountRaw: rawAmountForCurrencyValue(COT),
        requiredOutputAmountRaw: requirement.amountRaw,
        aggregators,
        didNotConvergeMessage: "Destination swap quote did not converge",
        maxInputReachedMessage: "Destination swap quote did not converge",
        makeRequest: (inputAmount) => ({
          type: QuoteType.EXACT_IN,
          userAddress,
          receiverAddress,
          chain: requirement.chainID,
          inputToken: COT.tokenAddress,
          outputToken: requirement.tokenAddress,
          inputAmount,
          seriousness: QuoteSeriousness.SERIOUS,
        }),
      });
    })(),
  );

  const bestQuote = await firstSuccessfulQuoteCandidate(
    [exactOutCandidate, convergedCandidate],
    "Couldn't get destination quote",
  );

  return {
    chainID: Number(requirement.chainID.chainID),
    quote: bestQuote.quote,
    aggregator: bestQuote.aggregator,
    holding: requirement,
  };
}

/**
 * @deprecated Use {@link liquidateSourceHoldings} (object args; per-holding `takerAddress`
 * and `receiverAddress` on each `HoldingWithSwapAddresses`).
 */
export async function liquidateInputHoldings(
  userAddress: Bytes,
  holdings: Holding[],
  aggregators: Aggregator[],
  commonCurrencyID = CurrencyID.USDC,
  receiverAddress?: Bytes,
): Promise<QuoteResponse[]> {
  return liquidateInputHoldingsByRecipient(
    holdings.map((holding) => ({ ...holding, recipient: userAddress })),
    aggregators,
    commonCurrencyID,
    receiverAddress,
  );
}

/**
 * @deprecated Use {@link liquidateSourceHoldings} (object args; per-holding `takerAddress`
 * and `receiverAddress` on each `HoldingWithSwapAddresses`).
 */
export async function liquidateInputHoldingsByRecipient(
  holdings: HoldingWithRecipient[],
  aggregators: Aggregator[],
  commonCurrencyID = CurrencyID.USDC,
  receiverAddress?: Bytes,
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
        bytesEqual(holding.tokenAddress, correspondingCurrency.tokenAddress)
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
          userAddress: holding.recipient,
          // Per-holding receiver wins (set by the new wrappers); shared param is the legacy
          // positional-call fallback.
          receiverAddress: holding.receiverAddress ?? receiverAddress,
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

/**
 * @deprecated Use {@link getDestinationExactInSwap} (object args; explicit `takerAddress`
 * and `receiverAddress`, both required).
 */
export async function destinationSwapWithExactIn(
  userAddress: Bytes,
  omniChainID: OmniversalChainID,
  inputAmount: bigint,
  outputToken: Bytes,
  aggregators: Aggregator[],
  inputCurrency: CurrencyID = CurrencyID.USDC,
  receiverAddress?: Bytes,
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
        receiverAddress,
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
    throw new AutoSelectionError(
      "Unexpected response length from aggregateAggregators",
    );
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

// =====================================================================================
// Object-arg wrappers around the legacy positional functions above.
//
// Aggregator vocabulary:
//   takerAddress    — on-chain executor of the swap (drives aggregator simulation /
//                     permit / approval routing). On 7702 chains this is the ephemeral; on
//                     non-Pectra chains it's the deployed Safe. Maps to the underlying
//                     QuoteRequest's `userAddress`.
//   receiverAddress — recipient of the swap output. Maps to the underlying QuoteRequest's
//                     `receiverAddress`. Required on all 4 wrappers — the GS013-class bug we
//                     fixed came from forgetting this and silently defaulting to the wrong
//                     address. Even on source side (where it equals the taker today), require
//                     it explicitly so the type system forces every call site to acknowledge
//                     both roles.
//
// Wrap-only: each wrapper delegates to the deprecated positional fn. No business logic added.
// =====================================================================================

export async function getDestinationExactOutSwap(args: {
  takerAddress: Bytes;
  receiverAddress: Bytes;
  requirement: Holding;
  aggregators: Aggregator[];
  commonCurrencyID?: CurrencyID;
}): Promise<QuoteResponse> {
  return determineDestinationSwaps(
    args.takerAddress,
    args.requirement,
    args.aggregators,
    args.commonCurrencyID,
    args.receiverAddress,
  );
}

export async function getDestinationExactInSwap(args: {
  takerAddress: Bytes;
  receiverAddress: Bytes;
  chain: OmniversalChainID;
  inputAmount: bigint;
  outputToken: Bytes;
  aggregators: Aggregator[];
  inputCurrency?: CurrencyID;
}): Promise<QuoteResponse> {
  return destinationSwapWithExactIn(
    args.takerAddress,
    args.chain,
    args.inputAmount,
    args.outputToken,
    args.aggregators,
    args.inputCurrency,
    args.receiverAddress,
  );
}

export async function liquidateSourceHoldings(args: {
  holdings: HoldingWithSwapAddresses[];
  aggregators: Aggregator[];
  commonCurrencyID?: CurrencyID;
}): Promise<QuoteResponse[]> {
  return liquidateInputHoldingsByRecipient(
    args.holdings.map((h) => ({
      ...h,
      recipient: h.takerAddress,
      receiverAddress: h.receiverAddress,
    })),
    args.aggregators,
    args.commonCurrencyID,
  );
}

export async function autoSelectSources(args: {
  holdings: HoldingWithSwapAddresses[];
  outputRequired: Decimal;
  aggregators: Aggregator[];
  commonCurrencyID?: CurrencyID;
}): Promise<{
  quoteResponses: QuoteResponse[];
  usedCOTs: {
    originalHolding: Holding;
    amountUsed: Decimal;
    idx: number;
    cur: Currency;
  }[];
}> {
  return autoSelectSourcesV2ByRecipient(
    args.holdings.map((h) => ({
      ...h,
      recipient: h.takerAddress,
      receiverAddress: h.receiverAddress,
    })),
    args.outputRequired,
    args.aggregators,
    args.commonCurrencyID,
  );
}
