import { Hex, hexToBytes, toHex } from "viem";

import { encodeChainID36, OmniversalChainID, zeroExtendBufToGivenSize } from "../data";
import { Universe } from "../proto/definition";

export enum Environment {
  DEV,
  TESTNET,
}

const dataSets = new Map<Environment, [Buffer, string][]>([
  [Environment.DEV, [
    [encodeChainID36(Universe.ETHEREUM, 137), '0xc39a170bbffD3f2C306d6fEB43922Dcf9EBeBAf4'],
    [encodeChainID36(Universe.ETHEREUM, 10), '0xd985A5E0F31e61E9105C8d50eb52469984F86143'],
    [encodeChainID36(Universe.ETHEREUM, 42161), '0xDA3fC817d09BE8747e19d441b67483438693Ef65'],
    [encodeChainID36(Universe.ETHEREUM, 534352), '0x38A633171E613705eA605e443eCee69D728E5781'],
    [encodeChainID36(Universe.ETHEREUM, 59144), '0x833d5D20B420ff58086c48c96E4D8d0f9e42De78'],
    [encodeChainID36(Universe.ETHEREUM, 8453), '0xdbDbaD325abB26E0719E54750a5d615376921727'],
    [encodeChainID36(Universe.ETHEREUM, 43114), '0xfd2E3ce74A8dEF95d8A99D4f25E3E375A82486a8'],
    [encodeChainID36(Universe.FUEL, 9889), '0x412727c79e46b051c64cb8bf0050d9e87edf03b9acfb7795847135a8f2fc76c0']
  ]],
  [Environment.TESTNET, [
    [encodeChainID36(Universe.ETHEREUM, 1), '0x701Fe4d7182D542719C70C507C59f08f279e9bB8'],
    [encodeChainID36(Universe.ETHEREUM, 10), '0xbdAE2a44a8b0487ea849e9CC6aD91EE814341a0C'],
    [encodeChainID36(Universe.ETHEREUM, 137), '0x4A06384E65808c6900de07f85cbe553D52C8cD25'],
    [encodeChainID36(Universe.ETHEREUM, 42161), '0xF845Bb346BeEf4fa1C027187c124B407aD26F81F'],
    [encodeChainID36(Universe.ETHEREUM, 534352), '0xaa1C0FeC8695BE1b41D1699AC325743590eee505'],
    [encodeChainID36(Universe.ETHEREUM, 59144), '0xB3a94815e508CB8959d4C7D8375Ed312ED42675e'],
    [encodeChainID36(Universe.ETHEREUM, 8453), '0x3B6b8E4F545980329644a9Eec7B5A25Ee30de2A3'],
    [encodeChainID36(Universe.FUEL, 9889), '0x9a98a7d2feef298bb5ca2dd53c933efee9b180daf7c8bcd5844776c9cbf92a4a']
  ]],
])

export class VaultContractMap {
  map = new Map<string, Buffer>()

  constructor(environment: Environment) {
    const src = dataSets.get(environment)
    if (src == null) {
      throw new Error('Environment not found')
    }
    for (const tuple of src) {
      this.map.set(toHex(tuple[0]), zeroExtendBufToGivenSize(hexToBytes(<Hex>tuple[1]), 32))
    }
  }

  public getFromChainID36 (key: Buffer) {
    return this.map.get(toHex(key))
  }

  public getFromOmniversalChainID(key: OmniversalChainID) {
    return this.getFromChainID36(key.toBytes())
  }
}
