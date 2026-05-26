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

  // Params that don't depend on chain — spread into every quote request.
  // `denyExchanges` is built per-call via `denyExchangesFor(chainId)`.
  private static readonly COMMON_OPTIONS = {
    slippage: "0.01",
    skipSimulation: true,
  } as const;

  // Tools denied on every chain.
  private static readonly GLOBAL_DENY: readonly string[] = ["openocean"];

  // Tools denied only on specific chains. Add an entry here when a tool quotes
  // well on most chains but mis-quotes on a specific one — global-denying it
  // would needlessly disable healthy routes elsewhere.
  //
  // 999 (HyperEVM): fly/hyperflow/liquidswap all share the same on-chain entry
  //   (0x0a0758d937d1059c356d4714e57f5df0239bce1a) and systematically over-quote
  //   native HYPE -> USDC routes by 5-11% (LI.FI /quote toAmountMin vs on-chain
  //   delivery, observed via InsufficientAmountOut(0xe52970aa) failures in
  //   HyperEVM Safe-mode swaps). They quote within ±0.2% of other tools on
  //   Ethereum/Base/Arbitrum/Polygon/Optimism, so the deny is chain-local.
  private static readonly PER_CHAIN_DENY: Readonly<
    Record<number, readonly string[]>
  > = {
    999: ["fly", "hyperflow", "liquidswap"],
  };

  private denyExchangesFor(chainId: number): string {
    const perChain = LiFiAggregator.PER_CHAIN_DENY[chainId] ?? [];
    return [...LiFiAggregator.GLOBAL_DENY, ...perChain].join(",");
  }

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
                  denyExchanges: this.denyExchangesFor(Number(r.chain.chainID)),
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
                  denyExchanges: this.denyExchangesFor(Number(r.chain.chainID)),
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
