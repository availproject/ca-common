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

export async function aggregateAggregators(
  requests: (QuoteRequestExactInput | QuoteRequestExactOutput)[],
  aggregators: Aggregator[],
): Promise<{ quote: Quote | null; aggregator: Aggregator }[]> {
  const responses = await Promise.all(
    aggregators.map(async (agg) => {
      let quotes;
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
  for (let i = 0; i < requests.length; i++) {
    const best = maxByBigInt(
      responses.map((ra) => ({ quote: ra.quotes[i], aggregator: ra.agg })),
      (r) => r.quote?.outputAmountMinimum ?? 0n,
    );
    if (best != null) {
      final[i] = best;
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
  console.log("XCS | Holdings:", holdings);

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
      console.log("XCS | Skipping because correspondingCurrency is null", {
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
  );
  console.log("XCS | Responses:", responses);
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
    console.log("XCS | 1", {
      i,
      remainder,
      q,
      resp,
      agg,
    });
    if (resp.outputAmountMinimum > remainder) {
      console.log("XCS | 2(a)(i)", resp);
      // input units per output units
      const indicativePrice = convertBigIntToDecimal(resp.inputAmount).div(
        convertBigIntToDecimal(resp.outputAmountMinimum),
      );
      // remainder is the output we want, so the input amount is remainder × indicativePrice
      const expectedInput = convertDecimalToBigInt(
        convertBigIntToDecimal(remainder).mul(indicativePrice),
      );
      const ends = await aggregateAggregators(
        [
          {
            ...q.req,
            inputAmount: expectedInput,
          },
          {
            ...q.req,
            type: QuoteType.ExactOut,
            outputAmount: remainder,
          },
        ],
        aggregators,
      );
      let resp2, resp2agg;
      if (ends[1] != null) {
        resp2 = ends[1].quote;
        resp2agg = ends[1].aggregator
      } else {
        resp2 = ends[0].quote;
        resp2agg = ends[0].aggregator
      }
      if (resp2 == null) {
        console.log("XCS | 2(a)(ii)", {
          resp2agg,
          expectedInput,
        });
        continue;
      }

      console.log("XCS | 2(a)(iii)");
      final.push({
        ...q,
        quote: resp2,
        agg: resp2agg,
      });
      remainder -= resp2.outputAmountMinimum;
    } else {
      console.log("XCS | 2(b)", resp);
      final.push({
        ...q,
        quote: resp,
        agg,
      });
      remainder -= resp.outputAmountMinimum;
    }
  }
  console.log("XCS | 3(a)", {
    remainder,
    final,
  });
  if (remainder > 0) {
    throw new AutoSelectionError(
      "Failed to accumulate enough swaps to meet requirement",
    );
  }
  console.log("XCS | Final:", final);
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
  return final;
}
