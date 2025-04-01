import { groupBy, minBy, orderBy } from "es-toolkit";
import { bytesToBigInt, bytesToHex } from "viem";
import { inspect as utilInspect } from "util";
import Decimal from "decimal.js";

import { Aggregator, Quote, QuoteRequestExactInput, QuoteRequestExactOutput, QuoteType } from "./iface";
import { ChaindataMap, Currency, OmniversalChainID } from "../data";
import { Bytes } from "../types";
import { FixedFeeTuple, PriceOracleDatum } from "../proto/definition";

function ezInspect (input: unknown) {
  return utilInspect(input, {
    depth: null,
    colors: true
  })
}

type Asset = {
  tokenAddress: Bytes;
  amount: bigint;
}

export type Holding = {
  chainID: OmniversalChainID;
} & Asset;

export class AutoSelectionError extends Error {}

export async function autoSelectSources(
  holdings: Holding[],
  outputRequired: { currency: Currency; amount: bigint },
  aggregators: Aggregator[],
  collectionFees: FixedFeeTuple[],
) {
  console.log('Holdings:', ezInspect(holdings))

  const groupedByChainID = groupBy(holdings, (h) =>
    bytesToHex(h.chainID.toBytes()),
  );

  const quoteRequests: {
    req: QuoteRequestExactInput;
    cfee: bigint;
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
        Buffer.compare(cf.tokenAddress, correspondingCurrency.tokenAddress) === 0
      );
    });
    const cfee = cfeeTuple != null ? bytesToBigInt(cfeeTuple.fee) : 0n;

    for (const holding of holdings) {
      quoteRequests.push({
        req: {
          type: QuoteType.ExactIn,
          chain: chain.ChainID,
          inputToken: holding.tokenAddress,
          inputAmount: holding.amount,
          outputToken: correspondingCurrency.tokenAddress,
        },
        // necessary for various purposes
        cfee,
      });
    }
  }

  console.log('Quote Requests:', ezInspect(quoteRequests))
  // TODO: simplify?
  const _quoteOutputs = await Promise.all(
    aggregators.map(async (agg) => {
      const quotes = await agg.getQuotes(quoteRequests.map((qr) => qr.req));
      const responses: ((typeof quoteRequests)[0] & {
        quote: Quote;
        agg: Aggregator;
      })[] = new Array(quotes.length);
      for (let i = 0; i < quotes.length; i++) {
        responses[i] = {
          ...quoteRequests[i],
          quote: quotes[i]!,
          agg,
        };
      }
      return responses;
    }),
  );
  const quoteOutputs = _quoteOutputs.flat();

  // const groupedByChainID = groupBy(quoteOutputs, h => h.chainIDHex)
  const orderedQuotes = orderBy(
    quoteOutputs,
    [
      (quoteOut: (typeof quoteOutputs)[0]): unknown => quoteOut.cfee,
      (quoteOut: (typeof quoteOutputs)[0]): unknown =>
        quoteOut.quote.outputAmountMinimum, // once optimized for collections, we select the biggest asset we hold
    ],
    ["asc", "desc"],
  );
  console.log('Ordered:', ezInspect(quoteOutputs))

  let remainder = outputRequired.amount;
  const finalQuotes: ((typeof quoteOutputs)[0] & {
    amt: bigint;
  })[] = [];
  for (const quote of orderedQuotes) {
    if (remainder === 0n) {
      break;
    }
    let amt = quote.quote.outputAmountMinimum;
    if (remainder < amt) {
      amt = remainder;
    }
    remainder -= amt;
    finalQuotes.push({
      ...quote,
      amt,
    });
  }
  if (remainder !== 0n) {
    throw new AutoSelectionError("Failed to meet target!");
  }

  // we have to re-create the necessary quotes using QuoteExactOut
  const groupedByAgg = Map.groupBy(finalQuotes, (qt) => qt.agg);
  const response: typeof quoteOutputs = [];
  await Promise.all(
    Array.from(groupedByAgg.entries()).map(async ([agg, quotes]) => {
      const outs = await agg.getQuotes(
        quotes.map((quot) => ({
          type: QuoteType.ExactOut,
          chain: quot.req.chain,
          inputToken: quot.req.inputToken,
          outputToken: quot.req.outputToken,
          outputAmount: quot.amt,
        })),
      );
      for (let i = 0; i < outs.length; i++) {
        const newQuote = outs[i]
        if (newQuote == null) {
          continue
        }
        const oldQuote = quotes[i]!

        response.push({
          agg,
          cfee: oldQuote.cfee,
          quote: newQuote,
          req: oldQuote.req
        })
      }
    }),
  );

  return response;
}

export async function determineDestinationSwaps(chainID: OmniversalChainID, requirements: Asset[], aggregators: Aggregator[], collectionFees: PriceOracleDatum[], whitelistedCurrencies = new Set([1, 2])) {
  const chaindata = ChaindataMap.get(chainID)
  if (chaindata == null) {
    throw new AutoSelectionError('Chain not found')
  }

  const quoteRequests: { price: Decimal, cur: Currency, req: QuoteRequestExactOutput }[] = [];
  for (const cur of chaindata.Currencies) {
    if (!whitelistedCurrencies.has(cur.currencyID)) {
      continue
    }

    const priceTuple = collectionFees.find((cf) => {
      return (
        cf.universe === chaindata.Universe &&
        Buffer.compare(cf.chainID, chaindata.ChainID32) === 0 &&
        // output token is the CA one
        Buffer.compare(cf.tokenAddress, cur.tokenAddress) === 0
      );
    });
    const price = priceTuple != null ? Decimal.div(bytesToHex(priceTuple.price), Decimal.pow(10, priceTuple.decimals)) : new Decimal(0);

    for (const req of requirements) {
      quoteRequests.push({
        price,
        cur,
        req: {
          type: QuoteType.ExactOut,
          chain: chainID,
          // DO NOT COPY THESE, OTHERWISE THE GROUPING WON'T WORK
          inputToken: cur.tokenAddress,
          outputToken: req.tokenAddress,
          outputAmount: req.amount,
        }
      })
    }
  }

  const results = (await Promise.all(aggregators.map(async agg => {
    const quotes = await agg.getQuotes(quoteRequests.map(qr => qr.req))
    return quotes.map(((quote, qtid) => ({
      ...quoteRequests[qtid]!,
      quote,
      agg
    })))
  }))).flat().filter(z => z.quote != null)
  const byReq = Map.groupBy(results, quot => quot.req.outputToken)

  // this is not in the order of the original requirements
  const final: typeof results = []

  for (const quotes of byReq.values()) {
    final.push(minBy(quotes, quote => {
      return quote.cur.convertUnitsToAmountDecimal(quote.quote?.inputAmount ?? 0n).mul(quote.price).toNumber()
    })!) // finds the asset that is the minimum cost of acquiring the output token (which is the requirement)
  }

  return final
}
