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
    aggregators.map(async (agg) => ({
      quotes: await agg.getQuotes(requests),
      agg,
    })),
  );
  const final: { quote: Quote | null; aggregator: Aggregator }[] = new Array(
    responses.length,
  );
  for (let i = 0; i < requests.length; i++) {
    final[i] = maxByBigInt(
      responses.map((ra) => ({ quote: ra.quotes[i], aggregator: ra.agg })),
      (r) => r.quote?.outputAmountMinimum ?? 0n,
    );
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
    console.log("XCS | 133", {
      i,
      remainder,
      q,
      resp,
      agg,
    });
    if (resp.outputAmountMinimum > remainder) {
      console.log("XCS | 141", resp);
      // input units per output units
      const indicativePrice = convertBigIntToDecimal(resp.inputAmount).div(
        convertBigIntToDecimal(resp.outputAmountMinimum),
      );
      // remainder is the output we want, so the input amount is remainder × indicativePrice
      const expectedInput = convertDecimalToBigInt(
        convertBigIntToDecimal(remainder).mul(indicativePrice),
      );
      const { quote: resp2, aggregator: resp2agg } = (
        await aggregateAggregators(
          [
            {
              ...q.req,
              inputAmount: expectedInput,
            },
          ],
          aggregators,
        )
      )[0];
      if (resp2 == null) {
        continue;
      }

      console.log("XCS | 162");
      final.push({
        ...q,
        quote: resp2,
        agg: resp2agg,
      });
      remainder -= resp2.outputAmountMinimum;
    } else {
      console.log("XCS | 170", resp);
      final.push({
        ...q,
        quote: resp,
        agg,
      });
      remainder -= resp.outputAmountMinimum;
    }
  }
  console.log("XCS | 176", {
    remainder,
    final,
  });
  if (remainder > 0) {
    throw new AutoSelectionError(
      "Failed to accumulate enough swaps to meet requirement",
    );
  }
  console.log("Final Sources:", final);
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
