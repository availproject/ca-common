import { Bytes } from "../types";
import { OmniversalChainID } from "../data";
import { Hex } from "viem";

export enum QuoteType {
  EXACT_IN,
  EXACT_OUT,
}

export enum QuoteSeriousness {
  PRICE_SURVEY,
  SERIOUS,
}

export type QuoteResponse = {
  chainID: number;
  quote: Quote;
  holding: Holding;
  aggregator: Aggregator;
};

export type Holding = {
  chainID: OmniversalChainID;
  tokenAddress: Bytes;
  amountRaw: bigint;
};

export interface Quote {
  // New output
  expiry?: number;
  input: {
    contractAddress: Hex;
    amount: string;
    amountRaw: bigint;
    decimals: number;
    value: number;
    symbol: string;
  };
  output: {
    contractAddress: Hex;
    amount: string;
    amountRaw: bigint;
    decimals: number;
    value: number;
    symbol: string;
  };
  txData: {
    approvalAddress: Hex;
    tx: {
      to: Hex;
      data: Hex;
      value: Hex;
    };
  };
}

type CommonQuoteParameters = {
  userAddress: Bytes;
  chain: OmniversalChainID;
  inputToken: Bytes;
  outputToken: Bytes;
  seriousness: QuoteSeriousness;
};

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
