import { Hex, hexToBytes, pad, toHex } from "viem";

import { Universe } from "../proto/definition";
import { encodeChainID36, OmniversalChainID } from "./chainid";
import { Currency } from "./currency";

const RawData = [
  {
    "Universe": 0,
    "ChainID32": "0x0000000000000000000000000000000000000000000000000000000000000089",
    "Currencies": [
      {
        "CurrencyID": 1,
        "TokenContractAddress": "0x0000000000000000000000003c499c542cef5e3811e1192ce70d8cc03d5c3359",
        "TokenDecimals": 6,
        "USDPriceOracleAddress": "0xfe4a8cc5b5b2366c1b58bea3858e81843581b2f7",
        "IsGasToken": false
      },
      {
        "CurrencyID": 2,
        "TokenContractAddress": "0x000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f",
        "TokenDecimals": 6,
        "USDPriceOracleAddress": "0x0a6513e40db6eb1b165753ad52e80663aea50545",
        "IsGasToken": false
      },
      {
        "CurrencyID": 4,
        "TokenContractAddress": "0x0000000000000000000000000000000000000000000000000000000000000000",
        "TokenDecimals": 18,
        "USDPriceOracleAddress": "0xab594600376ec9fd91f8e885dadf0ce036862de0",
        "IsGasToken": true
      }
    ]
  },
  {
    "Universe": 0,
    "ChainID32": "0x000000000000000000000000000000000000000000000000000000000000a4b1",
    "Currencies": [
      {
        "CurrencyID": 1,
        "TokenContractAddress": "0x000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831",
        "TokenDecimals": 6,
        "USDPriceOracleAddress": "0xfe4a8cc5b5b2366c1b58bea3858e81843581b2f7",
        "IsGasToken": false
      },
      {
        "CurrencyID": 2,
        "TokenContractAddress": "0x000000000000000000000000fd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
        "TokenDecimals": 6,
        "USDPriceOracleAddress": "0x0a6513e40db6eb1b165753ad52e80663aea50545",
        "IsGasToken": false
      },
      {
        "CurrencyID": 3,
        "TokenContractAddress": "0x0000000000000000000000000000000000000000000000000000000000000000",
        "TokenDecimals": 18,
        "USDPriceOracleAddress": "0xf9680d99d6c9589e2a93a78a04a279e509205945",
        "IsGasToken": true
      }
    ]
  },
  {
    "Universe": 0,
    "ChainID32": "0x000000000000000000000000000000000000000000000000000000000000000a",
    "Currencies": [
      {
        "CurrencyID": 1,
        "TokenContractAddress": "0x0000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff85",
        "TokenDecimals": 6,
        "USDPriceOracleAddress": "0xfe4a8cc5b5b2366c1b58bea3858e81843581b2f7",
        "IsGasToken": false
      },
      {
        "CurrencyID": 2,
        "TokenContractAddress": "0x00000000000000000000000094b008aa00579c1307b0ef2c499ad98a8ce58e58",
        "TokenDecimals": 6,
        "USDPriceOracleAddress": "0x0a6513e40db6eb1b165753ad52e80663aea50545",
        "IsGasToken": false
      },
      {
        "CurrencyID": 3,
        "TokenContractAddress": "0x0000000000000000000000000000000000000000000000000000000000000000",
        "TokenDecimals": 18,
        "USDPriceOracleAddress": "0xf9680d99d6c9589e2a93a78a04a279e509205945",
        "IsGasToken": true
      }
    ]
  },
  {
    "Universe": 1,
    "ChainID32": "0x00000000000000000000000000000000000000000000000000000000000026a1",
    "Currencies": [
      {
        "CurrencyID": 1,
        "TokenContractAddress": "0x286c479da40dc953bddc3bb4c453b608bba2e0ac483b077bd475174115395e6b",
        "TokenDecimals": 6,
        "USDPriceOracleAddress": "0xfe4a8cc5b5b2366c1b58bea3858e81843581b2f7",
        "IsGasToken": false
      },
      {
        "CurrencyID": 2,
        "TokenContractAddress": "0xa0265fb5c32f6e8db3197af3c7eb05c48ae373605b8165b6f4a51c5b0ba4812e",
        "TokenDecimals": 6,
        "USDPriceOracleAddress": "0x0a6513e40db6eb1b165753ad52e80663aea50545",
        "IsGasToken": false
      },
      {
        "CurrencyID": 3,
        "TokenContractAddress": "0xf8f8b6283d7fa5b672b530cbb84fcccb4ff8dc40f8176ef4544ddb1f1952ad07",
        "TokenDecimals": 9,
        "USDPriceOracleAddress": "0xf9680d99d6c9589e2a93a78a04a279e509205945",
        "IsGasToken": true
      }
    ]
  }
]


class _RPCURLMap {
  private readonly dataset: [Buffer, string][] = [
    [encodeChainID36(Universe.ETHEREUM, 137), 'https://polygon-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
    [encodeChainID36(Universe.ETHEREUM, 42161), 'https://arb-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
    [encodeChainID36(Universe.ETHEREUM, 10), 'https://opt-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
    [encodeChainID36(Universe.ETHEREUM, 8453), 'https://base-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
    [encodeChainID36(Universe.ETHEREUM, 1), 'https://eth-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
    [encodeChainID36(Universe.ETHEREUM, 534352), 'https://scroll-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
    [encodeChainID36(Universe.ETHEREUM, 59144), 'https://linea-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
    [encodeChainID36(Universe.FUEL, 9889), 'https://omniscient-fittest-pallet.fuel-mainnet.quiknode.pro/3193ae52f2522af1a4357a482e475e019857f02b/v1/graphql']
  ]
  private readonly map = new Map<string, string>(this.dataset.map(z => [toHex(z[0]), z[1]]))

  public get (key: OmniversalChainID) {
    return this.map.get(toHex(key.toBytes()))
  }
}
export const RPCURLMap = new _RPCURLMap()

class CurrencyMap {
  private readonly map = new Map<string, Currency>()

  constructor(currencies: Currency[]) {
    for (const cur of currencies) {
      this.map.set(toHex(cur.tokenAddress), cur)
    }
  }

  get(input: Parameters<typeof toHex>[0]) {
    return this.map.get(pad(toHex(input), {
      dir: 'left',
      size: 32
    }))
  }
}

export type ChainDatum = {
  ChainID: OmniversalChainID
  Universe: Universe
  ChainID32: Buffer
  Currencies: Currency[]
  CurrencyMap: CurrencyMap,
}

// Certain data fields are auto-generated while others are not.
export const Chaindata: ChainDatum[] = RawData.map(ch => {
  const ch32 = Buffer.from(hexToBytes(<`0x${string}`>ch.ChainID32))
  const currencies = ch.Currencies.map(cur => {
    return new Currency(cur.CurrencyID, hexToBytes(<`0x${string}`>cur.TokenContractAddress), cur.TokenDecimals, cur.IsGasToken, cur.USDPriceOracleAddress as Hex)
  })
  return {
    Universe: ch.Universe,
    ChainID: new OmniversalChainID(ch.Universe, ch32),
    ChainID32: ch32,
    Currencies: currencies,
    CurrencyMap: new CurrencyMap(currencies),
  }
})

class _ChaindataMap {
  private readonly map = new Map<string, ChainDatum>()

  constructor() {
    for (const datum of Chaindata) {
      this.map.set(toHex(datum.ChainID.toBytes()), datum)
    }
  }

  get (key: OmniversalChainID) {
    return this.map.get(toHex(key.toBytes()))
  }
}

export const ChaindataMap = new _ChaindataMap()
