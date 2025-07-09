import { groupBy, orderBy } from "es-toolkit";
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
        const best = minByByBigInt(
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

export async function autoSelectSources(
  userAddress: Bytes,
  holdings: Holding[],
  outputRequired: Decimal,
  aggregators: Aggregator[],
  collectionFees: FixedFeeTuple[],
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
      (cur) => cur.currencyID === 1,
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
          receiverAddress: null,
          type: QuoteType.ExactIn,
          chain: chain.ChainID,
          inputToken: holding.tokenAddress,
          inputAmount: holding.amount,
          outputToken: correspondingCurrency.tokenAddress,
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
    const divisor = Decimal.pow(10, q.cur.decimals)
    const oamD = convertBigIntToDecimal(resp.outputAmountMinimum).div(divisor)
    if (oamD.gt(remainder)) {
      const indicativePrice = convertBigIntToDecimal(resp.inputAmount).div(
        convertBigIntToDecimal(resp.outputAmountMinimum),
      );
      const userBal = convertBigIntToDecimal(q.originalHolding.amount).div(divisor);
      // remainder is the output we want, so the input amount is remainder × indicativePrice
      let expectedInput = Decimal.min(
        remainder
          .mul(indicativePrice)
          .mul(safetyMultiplier),
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
        const oam2D = convertBigIntToDecimal(adequateQuote.quote.outputAmountMinimum).div(divisor)
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
      remainder = remainder.minus(convertBigIntToDecimal(resp.outputAmountMinimum).div(divisor));
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
  receiverAddress: Bytes | null,
  chainID: OmniversalChainID,
  requirement: Asset,
  aggregators: Aggregator[],
): Promise<{ quote: Quote | null; aggregator: Aggregator }> {
  const chaindata = ChaindataMap.get(chainID);
  if (chaindata == null) {
    throw new AutoSelectionError("Chain not found");
  }

  const USDC = chaindata.Currencies.find((cur) => cur.currencyID === 1);
  if (USDC == null) {
    throw new AutoSelectionError("What chain doesn't have USDC");
  }
  // what happens if we happen to sell the requirement for USDC, what would the amount be?
  const fullLiquidationQR: QuoteRequestExactInput = {
    type: QuoteType.ExactIn,
    chain: chainID,
    userAddress,
    receiverAddress: null,
    inputToken: requirement.tokenAddress,
    outputToken: USDC.tokenAddress,
    inputAmount: requirement.amount,
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
    USDC,
  });
  while (true) {
    const buyQuoteResult = await aggregateAggregators(
      [
        {
          type: QuoteType.ExactIn,
          userAddress,
          receiverAddress,
          chain: chainID,
          inputToken: USDC.tokenAddress,
          outputToken: requirement.tokenAddress,
          inputAmount: convertDecimalToBigInt(curAmount),
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
      return buyQuote;
    } else {
      curAmount = curAmount.mul(safetyMultiplier); // try again with higher amount
    }
  }
}
