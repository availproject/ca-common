import axios, { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { bytesToHex, getAddress } from "viem";

import {
  Aggregator,
  Quote,
  QuoteRequestExactInput,
  QuoteRequestExactOutput,
  QuoteType,
} from "./iface";
import { Universe } from "../proto/definition";

export type LiFiResponse = {
  type: string;
  id: string;
  estimate: {
    tool: string;
    approvalAddress: string;
    toAmountMin: string;
    toAmount: string;
    fromAmount: string;
    executionDuration: number;
    fromAmountUSD: string;
    toAmountUSD: string;
  };
  integrator: string;
  transactionRequest: {
    value: string;
    to: string;
    data: string;
    chainId: number;
    gasPrice: string;
    gasLimit: string;
    from: string;
  };
};

export type LiFiQuote = Quote & {
  originalResponse: LiFiResponse;
};

export class LiFiAggregator implements Aggregator {
  private static readonly BASE_URL_V1 = "https://li.quest/v1";
  private static readonly COMMON_OPTIONS = {
    denyExchanges: "openocean",
    slippage: "0.01",
  };

  private readonly axios: AxiosInstance;

  public constructor(apiKey: string) {
    this.axios = axios.create({
      baseURL: LiFiAggregator.BASE_URL_V1,
      headers: {
        "x-lifi-api-key": apiKey,
      },
    });
  }

  async getQuotes(
    requests: (QuoteRequestExactInput | QuoteRequestExactOutput)[],
  ): Promise<(LiFiQuote | null)[]> {
    const list = await Promise.allSettled(
      requests.map(
        async (
          r: QuoteRequestExactInput | QuoteRequestExactOutput,
        ): Promise<LiFiQuote | null> => {
          if (r.chain.universe !== Universe.ETHEREUM) {
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
            case QuoteType.ExactIn: {
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
            case QuoteType.ExactOut: {
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

          return {
            type: r.type,
            inputAmount: BigInt(resp.data.estimate.fromAmount),
            outputAmountMinimum: BigInt(resp.data.estimate.toAmountMin),
            outputAmountLikely: BigInt(resp.data.estimate.toAmount),
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
          console.error("Caught error in fetching LiFi quotes:", item.reason);
          return null;
        }
      }
    });
  }
}
