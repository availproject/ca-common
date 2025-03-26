import { Aggregator } from "./iface";
import { Currency, OmniversalChainID } from "../data";
import { Bytes } from "../types";

export type Holding = {
  chainID: OmniversalChainID
  tokenAddress: Bytes
  amount: bigint
}

export async function autoSelectSources(holdings: Holding[], outputRequired: { currency: Currency, amount: bigint }, aggregators: Aggregator[]) {
}
