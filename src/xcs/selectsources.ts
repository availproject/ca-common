import Decimal from "decimal.js";

import {
  Aggregator,
  Holding,
  Quote,
  QuoteRequestExactInput,
  QuoteResponse,
  QuoteSeriousness,
  QuoteType,
} from "./iface";
import {
  AggregateAggregatorsMode,
  aggregateAggregators,
  AutoSelectionError,
} from "./autochoice";
import {
  bytesEqual,
  ChaindataMap,
  convertDecimalToBigInt,
  Currency,
  CurrencyID,
  OmniversalChainID,
} from "../data";
import { Bytes } from "../types";

// USD-valued source for `selectSources`. `value` lets the function size an initial
// survey prefix instead of quoting every non-COT source upfront — only the priority-
// ordered prefix whose cumulative value covers `outputRequired × prefixHeadroom` is
// quoted on the fast path; the batch is extended if the prefix under-delivers.
export type SourceWithValue = {
  chainID: OmniversalChainID;
  tokenAddress: Bytes;
  amountRaw: bigint;
  takerAddress: Bytes;
  receiverAddress: Bytes;
  value: number;
};

const safetyMultiplier = new Decimal("1.025");

export async function selectSources(args: {
  sources: SourceWithValue[];
  outputRequired: Decimal;
  aggregators: Aggregator[];
  commonCurrencyID?: CurrencyID;
  prefixHeadroom?: Decimal;
}): Promise<{
  quoteResponses: QuoteResponse[];
  usedCOTs: {
    originalHolding: Holding;
    amountUsed: Decimal;
    idx: number;
    cur: Currency;
  }[];
}> {
  const {
    sources,
    outputRequired,
    aggregators,
    commonCurrencyID = CurrencyID.USDC,
    prefixHeadroom = new Decimal("1.25"),
  } = args;

  console.debug("XCS | SS:", {
    sources,
    outputRequired: outputRequired.toFixed(),
    prefixHeadroom: prefixHeadroom.toFixed(),
  });

  type COTEntry = {
    amount: Decimal;
    idx: number;
    chainID: OmniversalChainID;
    currency: Currency;
    originalHolding: Holding;
  };
  type NonCOTEntry = {
    req: QuoteRequestExactInput;
    originalHolding: Holding;
    cur: Currency;
    idx: number;
    value: number;
  };

  const cotList: COTEntry[] = [];
  const nonCOTQuotes: NonCOTEntry[] = [];

  for (const [idx, src] of sources.entries()) {
    const chain = ChaindataMap.get(src.chainID);
    if (chain == null) {
      throw new AutoSelectionError("Chain not found");
    }
    const cot = chain.Currencies.find(
      (c) => c.currencyID === commonCurrencyID,
    );
    if (cot == null) {
      console.debug("XCS | SS | Skipping source — no COT on chain", { chain });
      continue;
    }

    const originalHolding: Holding = {
      chainID: src.chainID,
      tokenAddress: src.tokenAddress,
      amountRaw: src.amountRaw,
    };

    if (bytesEqual(src.tokenAddress, cot.tokenAddress)) {
      const normalizedAmount = new Decimal(src.amountRaw.toString()).div(
        Decimal.pow(10, cot.decimals),
      );
      cotList.push({
        amount: normalizedAmount,
        idx,
        chainID: src.chainID,
        currency: cot,
        originalHolding,
      });
    } else {
      nonCOTQuotes.push({
        req: {
          userAddress: src.takerAddress,
          receiverAddress: src.receiverAddress,
          type: QuoteType.EXACT_IN,
          chain: chain.ChainID,
          inputToken: src.tokenAddress,
          inputAmount: src.amountRaw,
          outputToken: cot.tokenAddress,
          seriousness: QuoteSeriousness.PRICE_SURVEY,
        },
        originalHolding,
        cur: cot,
        idx,
        value: src.value,
      });
    }
  }

  // Continuous-COT fast path — covers outputRequired without touching any aggregator.
  if (cotList.length > 0 && cotList[0].idx === 0) {
    let continuousAmount = new Decimal(0);
    let continuousCount = 0;

    for (const cot of cotList) {
      if (cot.idx !== continuousCount) break;
      continuousAmount = continuousAmount.add(cot.amount);
      continuousCount++;
      if (continuousAmount.gte(outputRequired)) {
        console.log(
          "XCS | SS | Continuous COTs cover requirement, no quotes needed",
        );
        const usedCOTs: {
          originalHolding: Holding;
          amountUsed: Decimal;
          idx: number;
          cur: Currency;
        }[] = [];
        let r = outputRequired;
        for (let i = 0; i < continuousCount; i++) {
          const c = cotList[i];
          const amountToUse = Decimal.min(r, c.amount);
          usedCOTs.push({
            originalHolding: c.originalHolding,
            amountUsed: amountToUse,
            idx: c.idx,
            cur: c.currency,
          });
          r = r.minus(amountToUse);
          if (r.lte(0)) break;
        }
        return { quoteResponses: [], usedCOTs };
      }
    }
  }

  type ProcessingItem =
    | { idx: number; isCOT: true; cotData: COTEntry }
    | { idx: number; isCOT: false; quoteData: NonCOTEntry };

  const queue: ProcessingItem[] = [];
  for (const c of cotList) {
    queue.push({ idx: c.idx, isCOT: true, cotData: c });
  }
  for (const q of nonCOTQuotes) {
    queue.push({ idx: q.idx, isCOT: false, quoteData: q });
  }
  queue.sort((a, b) => a.idx - b.idx);

  // Smallest priority-ordered prefix whose cumulative value covers
  // `outputRequired × prefixHeadroom`. Quote only that prefix initially; the batch
  // is extended below if realised aggregator output under-delivers.
  const target = outputRequired.mul(prefixHeadroom);
  let cumulative = new Decimal(0);
  let prefixCutoffIdx: number | null = null;
  for (const item of queue) {
    if (item.isCOT) {
      cumulative = cumulative.add(item.cotData.amount);
    } else {
      cumulative = cumulative.add(item.quoteData.value);
    }
    if (cumulative.gte(target)) {
      prefixCutoffIdx = item.idx;
      break;
    }
  }
  console.debug("XCS | SS | Prefix selected", {
    prefixCutoffIdx,
    cumulative: cumulative.toFixed(),
    target: target.toFixed(),
  });

  const responseByIdx = new Map<
    number,
    { quote: Quote | null; aggregator: Aggregator }
  >();
  const quoteAndStore = async (batch: NonCOTEntry[]): Promise<void> => {
    if (batch.length === 0) return;
    const r = await aggregateAggregators(
      batch.map((b) => b.req),
      aggregators,
      AggregateAggregatorsMode.MaximizeOutput,
    );
    for (let i = 0; i < batch.length; i++) {
      responseByIdx.set(batch[i].idx, r[i]);
    }
  };

  const initialBatch =
    prefixCutoffIdx == null
      ? nonCOTQuotes
      : nonCOTQuotes.filter((q) => q.idx <= prefixCutoffIdx!);
  console.debug("XCS | SS | Initial quote batch", {
    initialCount: initialBatch.length,
    totalNonCOT: nonCOTQuotes.length,
  });
  await quoteAndStore(initialBatch);

  const final: QuoteResponse[] = [];
  const usedCOTs: {
    originalHolding: Holding;
    amountUsed: Decimal;
    idx: number;
    cur: Currency;
  }[] = [];
  let remainder = outputRequired;

  for (const item of queue) {
    if (remainder.lte(0)) break;

    if (item.isCOT) {
      const { cotData } = item;
      const amountToUse = Decimal.min(remainder, cotData.amount);
      usedCOTs.push({
        originalHolding: cotData.originalHolding,
        amountUsed: amountToUse,
        idx: cotData.idx,
        cur: cotData.currency,
      });
      remainder = remainder.minus(amountToUse);
      console.debug("XCS | SS | cot", {
        idx: cotData.idx,
        amountToUse: amountToUse.toFixed(),
        remainder: remainder.toFixed(),
      });
      continue;
    }

    const { quoteData } = item;
    let lookup = responseByIdx.get(quoteData.idx);
    if (lookup == null) {
      // Prefix under-delivered: quote every non-COT we haven't yet and continue.
      const unquoted = nonCOTQuotes.filter(
        (q) => !responseByIdx.has(q.idx),
      );
      console.log("XCS | SS | Prefix under-delivered, extending batch", {
        remaining: unquoted.length,
      });
      await quoteAndStore(unquoted);
      lookup = responseByIdx.get(quoteData.idx);
    }
    if (lookup == null) continue;
    const { quote: resp, aggregator } = lookup;
    if (resp == null) continue;

    console.debug("XCS | SS | quote-eval", {
      idx: quoteData.idx,
      remainder: remainder.toFixed(),
      input: resp.input,
      output: resp.output,
    });

    const divisor = Decimal.pow(10, quoteData.cur.decimals);
    const oamD = new Decimal(resp.output.amount);
    if (oamD.gt(remainder)) {
      const indicativePrice = Decimal.div(
        resp.input.amountRaw.toString(),
        resp.output.amountRaw.toString(),
      );
      const userBal = new Decimal(
        quoteData.originalHolding.amountRaw.toString(),
      );
      let expectedInput = Decimal.min(
        remainder.mul(divisor).mul(indicativePrice).mul(safetyMultiplier),
        userBal,
      );
      let attempts = 0;
      while (true) {
        if (++attempts > 10) {
          throw new AutoSelectionError("Partial quote did not converge");
        }
        console.debug("XCS | SS | partial_quote_loop", {
          indicativePrice: indicativePrice.toFixed(),
          expectedInput: expectedInput.toFixed(),
          userBal: userBal.toFixed(),
          remainder: remainder.toFixed(),
        });
        const adequate = await aggregateAggregators(
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
        if (adequate.length !== 1) {
          throw new AutoSelectionError(
            "Unexpected response length from aggregateAggregators",
          );
        }
        const aq = adequate[0];
        if (aq.quote == null) {
          throw new AutoSelectionError("Couldn't get buy quote");
        }
        const oam2D = new Decimal(aq.quote.output.amount);
        if (oam2D.gte(remainder)) {
          final.push({
            quote: aq.quote,
            aggregator: aq.aggregator,
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
          );
        }
      }
    } else {
      final.push({
        quote: resp,
        holding: quoteData.originalHolding,
        aggregator,
        chainID: Number(quoteData.req.chain.chainID),
      });
      remainder = remainder.minus(resp.output.amount);
      console.debug("XCS | SS | full_quote", {
        idx: quoteData.idx,
        remainder: remainder.toFixed(),
      });
    }
  }

  if (remainder.gt(0)) {
    throw new AutoSelectionError("NOT_ENOUGH_SWAP_FOR_REQUIREMENT");
  }

  console.log("XCS | SS | final_quotes", { quotes: final, cots: usedCOTs });
  return { quoteResponses: final, usedCOTs };
}
