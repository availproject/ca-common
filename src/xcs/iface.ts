import { Bytes } from "../types";
import { OmniversalChainID } from "../data";

export enum QuoteType {
  EXACT_IN,
  EXACT_OUT,
}

export enum QuoteSeriousness {
  PRICE_SURVEY,
  SERIOUS,
}

export interface Quote {
  originalResponse: unknown;
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
  seriousness: QuoteSeriousness;
}

export type QuoteRequestExactInput = CommonQuoteParameters & {
  type: QuoteType.EXACT_IN;
  inputAmount: bigint;
};

export type QuoteRequestExactOutput = CommonQuoteParameters & {
  type: QuoteType.EXACT_OUT;
  outputAmount: bigint;
};

export interface Aggregator {
  getQuotes(
    requests: (QuoteRequestExactInput | QuoteRequestExactOutput)[],
  ): Promise<(Quote | null)[]>;
  // TODO: exec methods
}
