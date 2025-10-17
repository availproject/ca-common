import { bytesToHex, Hex, PublicClient } from "viem";
import { clone as _clone, groupBy, last as _last, maxBy } from "es-toolkit";

import { Aggregator, Quote, QuoteRequestExactInput, QuoteRequestExactOutput, QuoteType } from "./iface";
import { encodeChainID36, OmniversalChainID } from "../data";
import { Universe } from "../proto/definition";
import { YakAggregatorABI } from "../evmabi/yakaggregator.abi";

const YakAggregatorAddresses = new Map<Hex, Hex>((<[Buffer, Hex][]>[
  [encodeChainID36(Universe.ETHEREUM, 42161), '0xb32C79a25291265eF240Eb32E9faBbc6DcEE3cE3'],
  [encodeChainID36(Universe.ETHEREUM, 10), '0xCd887F78c77b36B0b541E77AfD6F91C0253182A2'],
  [encodeChainID36(Universe.ETHEREUM, 43114), '0xC4729E56b831d74bBc18797e0e17A295fA77488c'],
]).map(([chainID, addr]: [Buffer, Hex]): [Hex, Hex] => {
  return [bytesToHex(chainID), addr]
}))

type YakOffer = {
  amounts: bigint[],
  adapters: Hex[],
  path: Hex[],
  gasEstimate: bigint
}

export type YakAggregatorQuote = Quote & {
  offer: YakOffer
}

export class YieldYakAggregator implements Aggregator {
  private readonly clients = new Map<Hex, {
    chainID: OmniversalChainID,
    client: PublicClient,
    aggregatorAddress: Hex
  }>();

  public constructor(clients: { chainID: OmniversalChainID, client: PublicClient }[]) {
    for (const client of clients) {
      const chainIDHex = bytesToHex(client.chainID.toBytes())
      const aggAddr = YakAggregatorAddresses.get(chainIDHex)
      if (aggAddr == null) {
        continue
      }
      this.clients.set(chainIDHex, {
        chainID: client.chainID,
        client: client.client,
        aggregatorAddress: aggAddr
      })
    }
  }

  async getQuotes(_requests: (QuoteRequestExactInput | QuoteRequestExactOutput)[]): Promise<(YakAggregatorQuote | null)[]> {
    const requestsWithOriginalIndexes = _requests.map((r, rid) => {
      return {
        req: r,
        idx: rid,
      }
    })
    const responses = new Array(_requests.length).fill(null)

    // it's so sad that JS doesn't have a proper binary data type
    const groupedByChainID = groupBy(requestsWithOriginalIndexes, r => bytesToHex(r.req.chain.toBytes()))

    await Promise.all(Array.from(Object.entries(groupedByChainID)).map(async ([chainIDHex, requests]) => {
      const config = this.clients.get(<Hex>chainIDHex)
      if (config == null) {
        return
      }

      const reverseIndexes: [typeof requests[0], number[]][] = []
      const mc3calls = []

      for (const req of requests) {
        const inputTokenHex = bytesToHex(req.req.inputToken.subarray(12))
        const outputTokenHex = bytesToHex(req.req.outputToken.subarray(12))
        let args: [bigint, Hex, Hex, number, number]

        switch (req.req.type) {
          case QuoteType.EXACT_IN: {
            args = [req.req.inputAmount, inputTokenHex, outputTokenHex, 0, 1]
            break
          }
          case QuoteType.EXACT_OUT: {
            args = [req.req.outputAmount, outputTokenHex, inputTokenHex, 0, 1]
            break
          }
        }

        const indexes = []
        for (let steps = 1; steps !== 5; steps++) {
          const clonedArgs = _clone(args)
          clonedArgs[3] = steps
          const idx = mc3calls.push({
            address: config.aggregatorAddress,
            abi: YakAggregatorABI,
            functionName: 'findBestPathWithGas',
            args: clonedArgs
          })
          indexes.push(idx - 1)
        }
        reverseIndexes.push([req, indexes])
      }

      const _final = await config.client.multicall({
        allowFailure: false,
        contracts: mc3calls,
        multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11'
      })

      for (const [req, indexes] of reverseIndexes) {
        const collected: YakOffer[] = []
        for (const index of indexes) {
          collected.push(_final[index])
        }

        // @ts-expect-error the typing in maxBy is wrong, it can work with anything that is comparable
        const optimalChoice: YakOffer = maxBy(collected, route => _last(route.amounts))

        if (optimalChoice.path.length === 0) {
          responses[req.idx] = null
          return
        }

        // we have to reverse everything
        if (req.req.type === QuoteType.EXACT_OUT) {
          optimalChoice.adapters.reverse()
          optimalChoice.amounts.reverse()
          optimalChoice.path.reverse()
        }

        const output = _last(optimalChoice.amounts)
        responses[req.idx] = <YakAggregatorQuote>{
          type: req.req.type,
          inputAmount: optimalChoice.amounts[0],
          outputAmountLikely: output,
          outputAmountMinimum: output,
          offer: optimalChoice
        }
      }
    }))

    return responses
  }
}
