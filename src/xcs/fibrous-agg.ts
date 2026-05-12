import axios, { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import Decimal from "decimal.js";
import {
  bytesToHex,
  encodeFunctionData,
  getAddress,
  Hex,
  toHex,
  zeroAddress,
} from "viem";

import { ChainIDKeyedMap, OmniversalChainID } from "../data";
import { FibrousRouterABI } from "../evmabi";
import { Universe } from "../proto/definition";
import {
  Aggregator,
  Quote,
  QuoteRequestExactInput,
  QuoteRequestExactOutput,
  QuoteType,
} from "./iface";

const ChainNameMapping = new ChainIDKeyedMap<string>([
  // [new OmniversalChainID(Universe.ETHEREUM, 8453), "base"], // Disabled because of few liquidity issues
  [new OmniversalChainID(Universe.ETHEREUM, 999), "hyperevm"],
  [new OmniversalChainID(Universe.ETHEREUM, 143), "monad"],
  [new OmniversalChainID(Universe.ETHEREUM, 4114), "citrea"],
]);

export type FibrousToken = {
  name: string;
  symbol?: string;
  address: Hex;
  decimals: number;
  price: number | string | null;
};

export type FibrousResponse = {
  route: {
    success: boolean;
    routeSwapType: number;
    inputToken: FibrousToken;
    inputAmount: string;
    outputToken: FibrousToken;
    outputAmount: string;
  };
  calldata: {
    route: {
      token_in: Hex;
      token_out: Hex;
      amount_in: string;
      amount_out: string;
      min_received: string;
      destination: Hex;
      swap_type: number;
    };
    swap_parameters: Array<{
      token_in: Hex;
      token_out: Hex;
      rate: string;
      protocol_id: string;
      pool_address: Hex;
      swap_type: number;
      extra_data: Hex;
    }>;
  };
  router_address: Hex;
};

export type FibrousQuote = Quote & {
  originalResponse: FibrousResponse;
};

export type FibrousAggregatorOptions = {
  apiKey?: string;
  slippage?: number;
};

export class FibrousAggregator implements Aggregator {
  private static readonly BASE_URL = "https://api.fibrous.finance";

  private readonly axios: AxiosInstance;
  private readonly slippage: number;

  public constructor(options: FibrousAggregatorOptions = {}) {
    const { apiKey, slippage = 0.5 } = options;

    this.slippage = slippage;
    this.axios = axios.create({
      baseURL: FibrousAggregator.BASE_URL,
      headers: apiKey != null ? { "X-API-Key": apiKey } : undefined,
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
          if (r.type === QuoteType.EXACT_OUT) {
            return null;
          }

          if (r.chain.universe !== Universe.ETHEREUM) {
            return null;
          }

          const chainName = ChainNameMapping.get(r.chain);
          if (chainName == null) {
            return null;
          }

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

          let resp: AxiosResponse<FibrousResponse>;
          try {
            resp = await this.axios({
              method: "GET",
              url: `/${chainName}/v2/routeAndCallData`,
              params: {
                amount: r.inputAmount.toString(),
                tokenInAddress: inputTokenAddr,
                tokenOutAddress: outputTokenAddr,
                slippage: this.slippage,
                destination: receiverAddrHex,
              },
            });
          } catch (e) {
            if (e instanceof AxiosError && e.isAxiosError) {
              return null;
            }
            throw e;
          }

          if (!resp.data.route.success) {
            return null;
          }

          if (resp.data.calldata.swap_parameters.length === 0) {
            return null;
          }

          const inputAmountInDecimal = new Decimal(resp.data.route.inputAmount)
            .div(Decimal.pow(10, resp.data.route.inputToken.decimals))
            .toFixed(resp.data.route.inputToken.decimals);

          const outputAmountInDecimal = new Decimal(
            resp.data.calldata.route.min_received,
          )
            .div(Decimal.pow(10, resp.data.route.outputToken.decimals))
            .toFixed(resp.data.route.outputToken.decimals);

          const routerAddress = getAddress(resp.data.router_address);
          const isNativeInput = resp.data.calldata.route.swap_type === 0;

          const quote: FibrousQuote = {
            originalResponse: resp.data,
            input: {
              amount: inputAmountInDecimal,
              amountRaw: BigInt(resp.data.route.inputAmount),
              contractAddress: inputTokenAddr,
              decimals: resp.data.route.inputToken.decimals,
              value: Decimal.mul(
                inputAmountInDecimal,
                resp.data.route.inputToken.price ?? 0,
              ).toNumber(),
              symbol:
                resp.data.route.inputToken.symbol ??
                resp.data.route.inputToken.name,
            },
            output: {
              amount: outputAmountInDecimal,
              amountRaw: BigInt(resp.data.calldata.route.min_received),
              contractAddress: outputTokenAddr,
              decimals: resp.data.route.outputToken.decimals,
              value: Decimal.mul(
                outputAmountInDecimal,
                resp.data.route.outputToken.price ?? 0,
              ).toNumber(),
              symbol:
                resp.data.route.outputToken.symbol ??
                resp.data.route.outputToken.name,
            },
            txData: {
              approvalAddress: isNativeInput ? zeroAddress : routerAddress,
              tx: {
                to: routerAddress,
                value: isNativeInput
                  ? toHex(BigInt(resp.data.calldata.route.amount_in))
                  : toHex(0),
                data: encodeFunctionData({
                  abi: FibrousRouterABI,
                  functionName: "swap",
                  args: [
                    {
                      token_in: getAddress(resp.data.calldata.route.token_in),
                      token_out: getAddress(resp.data.calldata.route.token_out),
                      amount_in: BigInt(resp.data.calldata.route.amount_in),
                      amount_out: BigInt(resp.data.calldata.route.amount_out),
                      min_received: BigInt(
                        resp.data.calldata.route.min_received,
                      ),
                      destination: getAddress(
                        resp.data.calldata.route.destination,
                      ),
                      swap_type: resp.data.calldata.route.swap_type,
                    },
                    resp.data.calldata.swap_parameters.map((swapParameter) => ({
                      token_in: getAddress(swapParameter.token_in),
                      token_out: getAddress(swapParameter.token_out),
                      rate: Number.parseInt(swapParameter.rate, 10),
                      protocol_id: Number.parseInt(
                        swapParameter.protocol_id,
                        10,
                      ),
                      pool_address: getAddress(swapParameter.pool_address),
                      swap_type: swapParameter.swap_type,
                      extra_data: swapParameter.extra_data,
                    })),
                  ],
                }),
              },
            },
          };

          return quote;
        },
      ),
    );

    return list.map((item) => {
      switch (item.status) {
        case "fulfilled": {
          return item.value;
        }
        case "rejected": {
          console.error(
            "Caught error in fetching Fibrous quotes:",
            item.reason,
          );
          return null;
        }
      }
    });
  }
}
