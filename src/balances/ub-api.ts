import Decimal from "decimal.js";

import { Universe } from "../proto/definition";
import { Bytes, msgpackableAxios } from "../types";
import { OmniversalChainID } from "../data";
import { bytesToHex } from "viem";
import { AxiosResponse } from "axios";

export type BalanceOnChain = {
  chainID: OmniversalChainID,
  totalValue: Decimal,
  currencywise: {
    tokenAddress: Buffer,
    amount: Decimal,
    value: Decimal
  }[]
}

type MPResp = {
  balances: {
    universe: Universe,
    chain_id: Buffer,
    total_usd: string,
    currencies: {
      token_address: Buffer,
      balance: string,
      value: string
    }[]
  }[]
}

export async function getBalances(vscURL: string, universe: Universe, address: Bytes): Promise<BalanceOnChain[]> {
  const resp: AxiosResponse<MPResp> = await msgpackableAxios({
    baseURL: vscURL,
    url: `/api/v1/get-balance/${Universe[universe]}/${bytesToHex(address)}`,
  })
  const { data } = resp
  return data.balances.map(bal => ({
    chainID: new OmniversalChainID(bal.universe, bal.chain_id),
    totalValue: new Decimal(bal.total_usd),
    currencywise: bal.currencies.map(cur => ({
      tokenAddress: cur.token_address,
      amount: new Decimal(cur.balance),
      value: new Decimal(cur.value)
    }))
  }))
}
