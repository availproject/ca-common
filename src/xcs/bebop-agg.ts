import axios, { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { Hex, bytesToHex, getAddress } from "viem";

import {
  Aggregator,
  Quote,
  QuoteRequestExactInput,
  QuoteRequestExactOutput,
  QuoteType,
} from "./iface";
import { Universe } from "../proto/definition";
import { encodeChainID36 } from "../data";

// https://api.bebop.xyz/{jam|pmm}/chains
const ChainNameMapping = new Map(
  Object.entries({
    ethereum: 1,
    arbitrum: 42161,
    optimism: 10,
    base: 8453,
    taiko: 167000,
    bsc: 56,
    monadtestnet: 10143,
    megaethtestnet: 6342,
    berachain: 80094,
    polygon: 137,
    zksync: 324,
    blast: 81457,
    mode: 34443,
    scroll: 534352,
    superseed: 5330,
  }).map(([k, v]) => [bytesToHex(encodeChainID36(Universe.ETHEREUM, v)), k]),
);
// const erc7528Addr = Buffer.from('000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'hex')

export type BebopCommonQuote = {
  type: string;
  status: string;
  quoteId: string;
  chainId: number;
  approvalType: string;
  nativeToken: string;
  taker: string;
  receiver: string;
  expiry: number;
  slippage: number;
  gasFee: {
    native: string;
    usd: number;
  };
  buyTokens: Record<
    Hex,
    {
      amount: string;
      decimals: number;
      priceUsd: number;
      symbol: string;
      minimumAmount: string;
      price: number;
      priceBeforeFee: number;
      amountBeforeFee: string;
      deltaFromExpected: number;
    }
  >;
  sellTokens: Record<
    Hex,
    {
      amount: string;
      decimals: number;
      priceUsd: number;
      symbol: string;
      price: number;
      priceBeforeFee: number;
    }
  >;
  settlementAddress: string;
  approvalTarget: string;
  requiredSignatures: Array<never>;
  priceImpact: number;
  warnings: Array<never>;
  tx: {
    from: Hex;
    to: Hex;
    value: Hex;
    data: Hex;
    gas: number;
  };
};

export type BebopPMMv3Quote = {
  type: "PMMv3";
  quote: BebopCommonQuote & {
    makers: Array<string>;
    toSign: {
      partner_id: number;
      expiry: number;
      taker_address: string;
      maker_address: string;
      maker_nonce: string;
      taker_token: string;
      maker_token: string;
      taker_amount: string;
      maker_amount: string;
      receiver: string;
      packed_commands: string;
    };
    onchainOrderType: string;
    tx: BebopCommonQuote["tx"] & {
      gasPrice: number;
      chainId: number;
    };
  };
};

export type BebopJAMv2Quote = {
  type: "JAMv2";
  quote: BebopCommonQuote & {
    hooksHash: string;
    toSign: {
      taker: string;
      receiver: string;
      expiry: number;
      exclusivityDeadline: number;
      nonce: string;
      executor: string;
      partnerInfo: string;
      sellTokens: Array<string>;
      buyTokens: Array<string>;
      sellAmounts: Array<string>;
      buyAmounts: Array<string>;
      hooksHash: string;
    };
    solver: string;
  };
};

type BebopResponse = {
  routes: (BebopPMMv3Quote | BebopJAMv2Quote)[];
  errors: Record<string, never>;
  link: string;
};

export type BebopQuote = Quote & {
  originalResponse: BebopPMMv3Quote | BebopJAMv2Quote;
};

export class BebopAggregator implements Aggregator {
  private static readonly BASE_URL = "https://api.bebop.xyz/router";
  private static readonly COMMON_OPTIONS = {
    approval_type: "Standard",
    skip_validation: "true",
    gasless: false,
  };
  private readonly axios: AxiosInstance;

  public constructor(apiKey: string) {
    this.axios = axios.create({
      baseURL: BebopAggregator.BASE_URL,
      headers: {
        "Source-Auth": apiKey,
      },
      params: {
        source: "arcana",
      },
    });
  }

  async getQuotes(
    requests: (QuoteRequestExactInput | QuoteRequestExactOutput)[],
  ): Promise<(BebopQuote | null)[]> {
    const list = await Promise.allSettled(
      requests.map(
        async (
          r: QuoteRequestExactInput | QuoteRequestExactOutput,
        ): Promise<BebopQuote | null> => {
          const chainName = ChainNameMapping.get(bytesToHex(r.chain.toBytes()));
          if (chainName == null) {
            return null;
          }

          let respPromise: Promise<AxiosResponse<BebopResponse>>;
          const inputTokenAddr = getAddress(
            bytesToHex(r.inputToken.subarray(12)),
          );
          const outputTokenAddr = getAddress(
            bytesToHex(r.outputToken.subarray(12)),
          );
          const userAddrHex = getAddress(
            bytesToHex(r.userAddress.subarray(12)),
          );
          const receiverAddrHex =
            r.receiverAddress != null
              ? getAddress(bytesToHex(r.receiverAddress.subarray(12)))
              : userAddrHex;

          switch (r.type) {
            case QuoteType.EXACT_IN: {
              respPromise = this.axios({
                method: "GET",
                url: `/${chainName}/v1/quote`,
                params: {
                  sell_tokens: inputTokenAddr,
                  buy_tokens: outputTokenAddr,
                  taker_address: userAddrHex,
                  receiver_address: receiverAddrHex,
                  sell_amounts: r.inputAmount.toString(),
                  ...BebopAggregator.COMMON_OPTIONS,
                },
              });
              break;
            }
            case QuoteType.EXACT_OUT: {
              respPromise = this.axios({
                method: "GET",
                url: `/${chainName}/v1/quote`,
                params: {
                  sell_tokens: inputTokenAddr,
                  buy_tokens: outputTokenAddr,
                  taker_address: userAddrHex,
                  receiver_address: receiverAddrHex,
                  buy_amounts: r.outputAmount.toString(),
                  ...BebopAggregator.COMMON_OPTIONS,
                },
              });
              break;
            }
          }

          let resp: AxiosResponse<BebopResponse>;
          try {
            resp = await respPromise;
          } catch (e) {
            if (e instanceof AxiosError && e.isAxiosError) {
              if (
                e.response?.status === 404 &&
                e.response.data.code === 1002 &&
                e.response.data.message ===
                  "No available quotes for the requested transfer"
              ) {
                return null;
              }
            }
            throw e;
          }
          const bestRoute = resp.data.routes?.at(0);
          if (bestRoute == null) {
            return null;
          }
          const buyT = bestRoute.quote.buyTokens[outputTokenAddr];
          return {
            type: r.type,
            inputAmount: BigInt(
              bestRoute.quote.sellTokens[inputTokenAddr].amount,
            ),
            outputAmountMinimum: BigInt(buyT.minimumAmount),
            outputAmountLikely: BigInt(buyT.amount),
            originalResponse: bestRoute,
          };
        },
      ),
    );

    return list.map((item) => {
      switch (item.status) {
        case "fulfilled": {
          return item.value;
        }
        case "rejected": {
          console.error("Caught error in fetching Bebop quotes:", item.reason);
          return null;
        }
      }
    });
  }
}
