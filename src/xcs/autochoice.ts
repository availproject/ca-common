import { groupBy, minBy, orderBy } from "es-toolkit";
import { bytesToBigInt, bytesToHex } from "viem";
import Decimal from "decimal.js";

import {
  Aggregator,
  Quote,
  QuoteRequestExactInput,
  QuoteRequestExactOutput,
  QuoteType,
} from "./iface";
import {
  ChaindataMap,
  convertBigIntToDecimal,
  convertDecimalToBigInt,
  Currency,
  maxByBigInt,
  minByByBigInt,
  OmniversalChainID,
} from "../data";
import { Bytes } from "../types";
import { FixedFeeTuple, PriceOracleDatum } from "../proto/definition";

type Asset = {
  tokenAddress: Bytes;
  amount: bigint;
};

export type Holding = {
  chainID: OmniversalChainID;
  value: number;
} & Asset;

export class AutoSelectionError extends Error {}
const safetyMultiplier = new Decimal("1.02");

const enum AggregateAggregatorsMode {
  MaximizeOutput,
  MinimizeInput,
}

async function aggregateAggregators(
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
    responses.length,
  ).fill(null);
  switch (mode) {
    case AggregateAggregatorsMode.MaximizeOutput: {
      for (let i = 0; i < requests.length; i++) {
        const best = maxByBigInt(
          responses.map((ra) => ({ quote: ra.quotes[i], aggregator: ra.agg })),
          (r) => r.quote?.outputAmountMinimum ?? 0n,
        );
        if (best != null) {
          final[i] = best;
        }
      }
      break;
    }
    case AggregateAggregatorsMode.MinimizeInput: {
      for (let i = 0; i < requests.length; i++) {
        const best = minByByBigInt(
          responses.map((ra) => ({ quote: ra.quotes[i], aggregator: ra.agg })),
          (r) => r.quote?.inputAmount ?? 0n,
        );
        if (best != null) {
          final[i] = best;
        }
      }
      break;
    }
  }
  return final;
}

export async function autoSelectSources(
  userAddress: Bytes,
  holdings: Holding[],
  outputRequired: { currency: Currency; amount: bigint },
  aggregators: Aggregator[],
  collectionFees: FixedFeeTuple[],
) {
  console.log("XCS | SS | Holdings:", holdings);

  const groupedByChainID = groupBy(holdings, (h) =>
    bytesToHex(h.chainID.toBytes()),
  );

  const firstQuotes: {
    req: QuoteRequestExactInput;
    cfee: bigint;
    value: number; // rough valuation
  }[] = [];
  for (const holdings of Object.values(groupedByChainID)) {
    const chain = ChaindataMap.get(holdings[0].chainID);
    if (chain == null) {
      throw new AutoSelectionError("Chain not found");
    }
    const correspondingCurrency = chain.Currencies.find(
      (cur) => cur.currencyID === outputRequired.currency.currencyID,
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
        continue;
      }

      firstQuotes.push({
        req: {
          userAddress,
          type: QuoteType.ExactIn,
          chain: chain.ChainID,
          inputToken: holding.tokenAddress,
          inputAmount: holding.amount,
          outputToken: correspondingCurrency.tokenAddress,
        },
        // necessary for various purposes
        cfee,
        value: holding.value,
      });
    }
  }
  // const groupedByChainID = groupBy(quoteOutputs, h => h.chainIDHex)
  const quotesByValue = orderBy(
    firstQuotes,
    [
      (quoteOut: (typeof firstQuotes)[0]): unknown => quoteOut.cfee,
      (quoteOut: (typeof firstQuotes)[0]): unknown => quoteOut.value, // once optimized for collections, we select the biggest asset we hold
    ],
    ["asc", "desc"],
  );
  const responses = await aggregateAggregators(
    quotesByValue.map((fq) => fq.req),
    aggregators,
    AggregateAggregatorsMode.MaximizeOutput,
  );
  console.log("XCS | SS |  Responses:", responses);
  const final: ((typeof firstQuotes)[0] & {
    quote: Quote;
    agg: Aggregator;
  })[] = [];
  let remainder = outputRequired.amount; // assuming all that chains have the same amount of fixed point places
  for (let i = 0; i < quotesByValue.length; i++) {
    if (remainder <= 0) {
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
    if (resp.outputAmountMinimum > remainder) {
      console.log("XCS | 2⒜⑴", resp);
      // input units per output units
      const indicativePrice = convertBigIntToDecimal(resp.inputAmount).div(
        convertBigIntToDecimal(resp.outputAmountMinimum),
      );
      // remainder is the output we want, so the input amount is remainder × indicativePrice
      const expectedInput = convertDecimalToBigInt(
        convertBigIntToDecimal(remainder)
          .mul(indicativePrice)
          .mul(safetyMultiplier),
      );
      const ends = await Promise.all([
        aggregateAggregators(
          [
            {
              ...q.req,
              inputAmount: expectedInput,
            },
          ],
          aggregators,
          AggregateAggregatorsMode.MaximizeOutput,
        ),
        aggregateAggregators(
          [
            {
              ...q.req,
              type: QuoteType.ExactOut,
              outputAmount: remainder,
            },
          ],
          aggregators,
          AggregateAggregatorsMode.MinimizeInput,
        ),
      ]);
      let resp2, resp2agg;
      if (ends[1][0] != null) {
        resp2 = ends[1][0].quote;
        resp2agg = ends[1][0].aggregator;
      } else {
        resp2 = ends[0][0].quote;
        resp2agg = ends[0][0].aggregator;
      }
      if (resp2 == null) {
        console.log("XCS | SS | 2⒜⑵", {
          resp2agg,
          expectedInput,
        });
        continue;
      }

      console.log("XCS | SS | 2⒜⑶");
      final.push({
        ...q,
        quote: resp2,
        agg: resp2agg,
      });
      remainder -= resp2.outputAmountMinimum;
    } else {
      console.log("XCS | SS | 2⒝", resp);
      final.push({
        ...q,
        quote: resp,
        agg,
      });
      remainder -= resp.outputAmountMinimum;
    }
  }
  console.log("XCS | SS | 3⒜", {
    remainder,
    final,
  });
  if (remainder > 0) {
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
  requirements: Asset[],
  aggregators: Aggregator[],
  collectionFees: PriceOracleDatum[],
  whitelistedCurrencies = new Set([1, 2]),
) {
  const chaindata = ChaindataMap.get(chainID);
  if (chaindata == null) {
    throw new AutoSelectionError("Chain not found");
  }

  const quoteRequests: {
    price: Decimal;
    cur: Currency;
    req: QuoteRequestExactOutput;
  }[] = [];
  for (const cur of chaindata.Currencies) {
    if (!whitelistedCurrencies.has(cur.currencyID)) {
      continue;
    }

    const priceTuple = collectionFees.find((cf) => {
      return (
        cf.universe === chaindata.Universe &&
        Buffer.compare(cf.chainID, chaindata.ChainID32) === 0 &&
        // output token is the CA one
        Buffer.compare(cf.tokenAddress, cur.tokenAddress) === 0
      );
    });
    const price =
      priceTuple != null
        ? Decimal.div(
            bytesToHex(priceTuple.price),
            Decimal.pow(10, priceTuple.decimals),
          )
        : new Decimal(0);

    for (const req of requirements) {
      if (Buffer.compare(req.tokenAddress, cur.tokenAddress) === 0) {
        continue;
      }

      quoteRequests.push({
        price,
        cur,
        req: {
          userAddress,
          type: QuoteType.ExactOut,
          chain: chainID,
          // DO NOT COPY THESE, OTHERWISE THE GROUPING WON'T WORK
          inputToken: cur.tokenAddress,
          outputToken: req.tokenAddress,
          outputAmount: req.amount,
        },
      });
    }
  }

  const results = (
    await Promise.all(
      aggregators.map(async (agg) => {
        const quotes = await agg.getQuotes(quoteRequests.map((qr) => qr.req));
        return quotes.map((quote, qtid) => ({
          ...quoteRequests[qtid]!,
          quote,
          agg,
        }));
      }),
    )
  )
    .flat()
    .filter((z) => z.quote != null);
  console.log("XCS | DDS | 1⒜", {
    results,
    quoteRequests,
  });
  const byCur = Map.groupBy(results, (quot) => quot.cur);

  // this is not in the order of the original requirements
  const final: typeof results = minBy(Array.from(byCur.values()), (quotes) => {
    let total = new Decimal(0);
    for (const quote of quotes) {
      total = total.add(
        quote.cur
          .convertUnitsToAmountDecimal(quote.quote?.inputAmount ?? 0n)
          .mul(quote.price),
      );
    }
    return total.toNumber();
  })!;
  console.log("XCS | DDS | 1⒝", {
    byCur,
    final,
  });

  if (final.length === 0) {
    // last ditch: create synthetic output quotes
    const step1Reqs: QuoteRequestExactInput[] = [];
    for (const q of quoteRequests) {
      step1Reqs.push({
        type: QuoteType.ExactIn,
        userAddress,
        chain: chainID,
        inputToken: q.req.outputToken,
        outputToken: q.req.inputToken,
        inputAmount: q.req.outputAmount,
      });
    }
    const step1Best = await aggregateAggregators(
      step1Reqs,
      aggregators,
      AggregateAggregatorsMode.MaximizeOutput,
    );
    const step2Reqs: QuoteRequestExactInput[] = [];
    for (let i = 0; i < step1Best.length; i++) {
      const sellQuote = step1Best[i];
      // assume that buy and sell side are within 2% of each other
      if (sellQuote.quote === null) {
        console.error("XCS | DDS | Fallback state:", {
          step1Reqs,
          step1Best,
        });
        throw new AutoSelectionError("XCS | DDS | Fallback sell quote is null");
      }
      const req = step1Reqs[i];
      step2Reqs.push({
        type: QuoteType.ExactIn,
        userAddress,
        chain: chainID,
        inputToken: req.outputToken,
        outputToken: req.inputToken,
        inputAmount: convertDecimalToBigInt(
          convertBigIntToDecimal(sellQuote.quote.outputAmountLikely).mul(
            safetyMultiplier,
          ),
        ),
      });
    }
    const step2Quotes = await aggregateAggregators(
      step2Reqs,
      aggregators,
      AggregateAggregatorsMode.MaximizeOutput,
    );
    let step2WithMetadata: {
      quote: Quote | null;
      agg: Aggregator;
      price: Decimal;
      cur: Currency;
      req: QuoteRequestExactInput;
    }[] = new Array(step2Quotes.length);
    for (let j = 0; j < step2Quotes.length; j++) {
      const q = step2Quotes[j];
      const qreq = quoteRequests[j];
      step2WithMetadata[j] = {
        quote: q.quote,
        agg: q.aggregator,
        cur: qreq.cur,
        price: qreq.price,
        req: step2Reqs[j],
      };
    }
    console.log("XCS | DDS | 2⒜", {
      step1Reqs,
      step1Best,
      step2Reqs,
      step2Quotes,
      step2WithMetadata,
    });
    step2WithMetadata = step2WithMetadata.filter((s) => s.quote !== null);

    const byCur = Map.groupBy(step2WithMetadata, (quot) => quot.cur);

    // this is not in the order of the original requirements
    const actualFinal: typeof step2WithMetadata = minBy(
      Array.from(byCur.values()),
      (quotes) => {
        let total = new Decimal(0);
        for (const quote of quotes) {
          total = total.add(
            quote.cur
              .convertUnitsToAmountDecimal(quote.quote?.inputAmount ?? 0n)
              .mul(quote.price),
          );
        }
        return total.toNumber();
      },
    )!;

    console.log("XCS | DDS | 2⒝", {
      byCur,
      actualFinal,
    });

    return actualFinal;
  }

  return final;
}
