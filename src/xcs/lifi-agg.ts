import axios, { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { bytesToHex, getAddress, Hex } from "viem";

import {
  Aggregator,
  Quote,
  QuoteRequestExactInput,
  QuoteRequestExactOutput,
  QuoteType,
} from "./iface";
import { Universe } from "../proto/definition";
import Decimal from "decimal.js";

export type LiFiResponse = {
  type: string;
  id: string;
  estimate: {
    tool: string;
    approvalAddress: Hex;
    toAmountMin: string;
    toAmount: string;
    fromAmount: string;
    executionDuration: number;
  };
  action: {
    fromToken: {
      symbol: string;
      decimals: number;
      priceUSD: string;
    };
    toToken: {
      symbol: string;
      decimals: number;
      priceUSD: string;
    };
  };
  integrator: string;
  transactionRequest: {
    value: Hex;
    to: Hex;
    data: Hex;
  };
};

const ALLOWED_CHAINS = new Set([
  1, // Ethereum
  10, // Optimism
  56, // BSC
  137, // Polygon
  143, // Monad
  999, // HyperEVM
  4326, // MegaETH
  8453, // Base
  42161, // Arbitrum
  43114, // Avalanche
  8217, // Kaia
  534352, // Scroll
]);

export class LiFiAggregator implements Aggregator {
  private static readonly BASE_URL_V1 = "https://li.quest/v1";
  private static readonly COMMON_OPTIONS = {
    denyExchanges: "openocean",
    slippage: "0.01",
    skipSimulation: true,
  };

  private readonly axios: AxiosInstance;

  public constructor(apiKey: string) {
    this.axios = axios.create({
      baseURL: LiFiAggregator.BASE_URL_V1,
      headers: {
        "x-lifi-api-key": apiKey,
      },
      timeout: 10_000,
    });
  }

  async getQuotes(
    requests: (QuoteRequestExactInput | QuoteRequestExactOutput)[],
  ): Promise<(Quote | null)[]> {
    const list = await Promise.allSettled(
      requests.map(
        async (
          r: QuoteRequestExactInput | QuoteRequestExactOutput,
        ): Promise<Quote | null> => {
          if (r.chain.universe !== Universe.ETHEREUM) {
            return null;
          }

          if (!ALLOWED_CHAINS.has(Number(r.chain.chainID))) {
            return null;
          }

          let respPromise: Promise<AxiosResponse<LiFiResponse>>;
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
          const receiverAddrHex =
            r.receiverAddress != null
              ? getAddress(bytesToHex(r.receiverAddress.subarray(12)))
              : userAddrHex;

          switch (r.type) {
            case QuoteType.EXACT_IN: {
              respPromise = this.axios({
                method: "GET",
                url: "/quote",
                params: {
                  fromChain: chIDStr,
                  toChain: chIDStr,
                  fromToken: inputTokenAddr,
                  toToken: outputTokenAddr,
                  fromAddress: userAddrHex,
                  toAddress: receiverAddrHex,
                  fromAmount: r.inputAmount.toString(),
                  ...LiFiAggregator.COMMON_OPTIONS,
                },
              });
              break;
            }
            case QuoteType.EXACT_OUT: {
              respPromise = this.axios({
                method: "GET",
                url: "/quote/toAmount",
                params: {
                  fromChain: chIDStr,
                  toChain: chIDStr,
                  fromToken: inputTokenAddr,
                  toToken: outputTokenAddr,
                  fromAddress: userAddrHex,
                  toAddress: receiverAddrHex,
                  toAmount: r.outputAmount.toString(),
                  ...LiFiAggregator.COMMON_OPTIONS,
                },
              });
              break;
            }
          }

          let resp: AxiosResponse<LiFiResponse>;
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

          const {
            estimate,
            transactionRequest: { to, value, data },
            action: { fromToken, toToken },
          } = resp.data;

          const inputAmountInDecimal = new Decimal(estimate.fromAmount)
            .div(Decimal.pow(10, fromToken.decimals))
            .toFixed(fromToken.decimals);

          const outputAmountInDecimal = new Decimal(estimate.toAmountMin)
            .div(Decimal.pow(10, toToken.decimals))
            .toFixed(toToken.decimals);

          return {
            input: {
              amount: inputAmountInDecimal,
              amountRaw: BigInt(estimate.fromAmount),
              contractAddress: inputTokenAddr,
              decimals: fromToken.decimals,
              value: Decimal.mul(
                inputAmountInDecimal,
                fromToken.priceUSD,
              ).toNumber(),
              symbol: fromToken.symbol,
            },
            output: {
              amount: outputAmountInDecimal,
              amountRaw: BigInt(estimate.toAmountMin),
              contractAddress: outputTokenAddr,
              decimals: toToken.decimals,
              value: Decimal.mul(
                outputAmountInDecimal,
                toToken.priceUSD,
              ).toNumber(),
              symbol: toToken.symbol,
            },
            txData: {
              approvalAddress: estimate.approvalAddress,
              tx: {
                to,
                value,
                data,
              },
            },
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
          console.error("Caught error in fetching LiFi quotes:", item.reason);
          return null;
        }
      }
    });
  }
}
