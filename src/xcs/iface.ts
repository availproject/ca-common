import { Bytes } from "../types";
import { OmniversalChainID } from "../data";

export enum QuoteType {
  ExactIn,
  ExactOut,
}

export interface Quote {
  type: QuoteType;
  inputAmount: bigint;
  outputAmountMinimum: bigint;
  outputAmountLikely: bigint;
}

type CommonQuoteParameters = {
  userAddress: Bytes;
  chain: OmniversalChainID;
  inputToken: Bytes;
  outputToken: Bytes;
}

export type QuoteRequestExactInput = CommonQuoteParameters & {
  type: QuoteType.ExactIn;
  inputAmount: bigint;
};

export type QuoteRequestExactOutput = CommonQuoteParameters & {
  type: QuoteType.ExactOut;
  outputAmount: bigint;
};

export interface Aggregator {
  getQuotes(
    requests: (QuoteRequestExactInput | QuoteRequestExactOutput)[],
  ): Promise<(Quote | null)[]>;
  // TODO: exec methods
}
