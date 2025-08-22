import axios, { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { bytesToHex, getAddress, Hex } from "viem";

import {
  Aggregator,
  Quote,
  QuoteRequestExactInput,
  QuoteRequestExactOutput,
  QuoteSeriousness,
  QuoteType,
} from "./iface";
import { Universe } from "../proto/definition";

export type ZeroExResponse = {
  allowanceTarget: Hex;
  blockNumber: string;
  buyAmount: string;
  buyToken: Hex;
  fees: {
    integratorFee: never;
    zeroExFee: never;
    gasFee: never;
  };
  issues: {
    allowance: {
      actual: string;
      spender: string;
    };
    balance: {
      token: string;
      actual: string;
      expected: string;
    };
    simulationIncomplete: boolean;
    invalidSourcesPassed: Array<never>;
  };
  liquidityAvailable: boolean;
  minBuyAmount: string;
  route: {
    fills: Array<{
      from: Hex;
      to: Hex;
      source: string;
      proportionBps: string;
    }>;
    tokens: Array<{
      address: Hex;
      symbol: string;
    }>;
  };
  sellAmount: string;
  sellToken: Hex;
  tokenMetadata: {
    buyToken: {
      buyTaxBps: string;
      sellTaxBps: string;
    };
    sellToken: {
      buyTaxBps: string;
      sellTaxBps: string;
    };
  };
  totalNetworkFee: string;
  transaction: {
    to: Hex;
    data: Hex;
    gas: string;
    gasPrice: string;
    value: string;
  };
  zid: string;
};

export type ZeroExQuote = Quote & {
  originalResponse: ZeroExResponse;
};

export class ZeroExAggregator implements Aggregator {
  private static readonly BASE_URL = "https://api.0x.org/";
  private static readonly COMMON_OPTIONS = {
    slippageBps: 100, // 0.01 pp = 100 bp
  };

  private readonly axios: AxiosInstance;

  public constructor(apiKey: string) {
    this.axios = axios.create({
      baseURL: ZeroExAggregator.BASE_URL,
      validateStatus: (status) => status === 200,
      headers: {
        "0x-api-key": apiKey,
        "0x-version": "v2",
      },
    });
  }

  async getQuotes(
    requests: (QuoteRequestExactInput | QuoteRequestExactOutput)[],
  ): Promise<(ZeroExQuote | null)[]> {
    const list = await Promise.allSettled(
      requests.map(
        async (
          r: QuoteRequestExactInput | QuoteRequestExactOutput,
        ): Promise<ZeroExQuote | null> => {
          if (r.chain.universe !== Universe.ETHEREUM) {
            return null;
          }

          let respPromise: Promise<AxiosResponse<ZeroExResponse>>;
          const chIDStr = r.chain.chainID.toString();
          const inputTokenAddr = getAddress(
            bytesToHex(r.inputToken.subarray(12)),
          );
          const outputTokenAddr = getAddress(
            bytesToHex(r.outputToken.subarray(12)),
          );
          const userAddrHex = getAddress(
            bytesToHex(r.userAddress.subarray(12)),
          );

          switch (r.type) {
            case QuoteType.EXACT_IN: {
              respPromise = this.axios({
                method: "GET",
                url:
                  r.serious === QuoteSeriousness.SERIOUS
                    ? "/swap/allowance-holder/quote"
                    : "/swap/allowance-holder/price",
                params: {
                  chainId: chIDStr,
                  sellToken: inputTokenAddr,
                  buyToken: outputTokenAddr,
                  taker: userAddrHex,
                  fromAmount: r.inputAmount.toString(),
                  ...ZeroExAggregator.COMMON_OPTIONS,
                },
              });
              break;
            }
            case QuoteType.EXACT_OUT: {
              return null;
            }
          }

          let resp: AxiosResponse<ZeroExResponse>;
          try {
            resp = await respPromise;
          } catch (e) {
            if (e instanceof AxiosError && e.isAxiosError) {
              return null;
            }
            throw e;
          }

          return {
            type: r.type,
            inputAmount: BigInt(resp.data.sellAmount),
            outputAmountMinimum: BigInt(resp.data.minBuyAmount),
            outputAmountLikely: BigInt(resp.data.buyAmount),
            originalResponse: resp.data,
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
          console.error("Caught error in fetching 0x quotes:", item.reason);
          return null;
        }
      }
    });
  }
}
