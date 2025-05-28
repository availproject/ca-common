import { Hex, hexToBytes, toHex } from "viem";

import { encodeChainID36, OmniversalChainID, zeroExtendBufToGivenSize } from "../data";
import { Universe } from "../proto/definition";

export enum Environment {
  FOLLY,  // Dev with test-net tokens
  CERISE, // Dev with main-net tokens
  CORAL,  // Test-net with main-net tokens
  JADE    // Main-net with main-net tokens
}

const dataSets = new Map<Environment, [Buffer, string][]>([
  [Environment.FOLLY, [
    [encodeChainID36(Universe.ETHEREUM, 421614), '0xFBAc1b6174a678ebDdB43e3161a01C4287f009D4'],
    [encodeChainID36(Universe.ETHEREUM, 11155420), '0x59ae1C8D0E9EC40487b1617fa621AF17cf92E933'],
    [encodeChainID36(Universe.ETHEREUM, 80002), '0xfd2E3ce74A8dEF95d8A99D4f25E3E375A82486a8'],
    [encodeChainID36(Universe.ETHEREUM, 84532), '0xfd2E3ce74A8dEF95d8A99D4f25E3E375A82486a8']
  ]],
  [Environment.CERISE, [
    [encodeChainID36(Universe.ETHEREUM, 137), '0x0000002Ed0657b924b4AA83aD76CaB42DF90869D'],
    [encodeChainID36(Universe.ETHEREUM, 10), '0x0000002Ed0657b924b4AA83aD76CaB42DF90869D'],
    [encodeChainID36(Universe.ETHEREUM, 42161), '0x0000002Ed0657b924b4AA83aD76CaB42DF90869D'],
    [encodeChainID36(Universe.ETHEREUM, 8453), '0x0000002Ed0657b924b4AA83aD76CaB42DF90869D'],
    [encodeChainID36(Universe.ETHEREUM, 43114), '0x0000002Ed0657b924b4AA83aD76CaB42DF90869D'],
    [encodeChainID36(Universe.ETHEREUM, 534352), '0x0000002Ed0657b924b4AA83aD76CaB42DF90869D']
  ]],
  [Environment.CORAL, [
    [encodeChainID36(Universe.ETHEREUM, 1), '0x701Fe4d7182D542719C70C507C59f08f279e9bB8'],
    [encodeChainID36(Universe.ETHEREUM, 10), '0xbdAE2a44a8b0487ea849e9CC6aD91EE814341a0C'],
    [encodeChainID36(Universe.ETHEREUM, 137), '0x4A06384E65808c6900de07f85cbe553D52C8cD25'],
    [encodeChainID36(Universe.ETHEREUM, 42161), '0xF845Bb346BeEf4fa1C027187c124B407aD26F81F'],
    [encodeChainID36(Universe.ETHEREUM, 534352), '0xaa1C0FeC8695BE1b41D1699AC325743590eee505'],
    [encodeChainID36(Universe.ETHEREUM, 59144), '0xB3a94815e508CB8959d4C7D8375Ed312ED42675e'],
    [encodeChainID36(Universe.ETHEREUM, 8453), '0x3B6b8E4F545980329644a9Eec7B5A25Ee30de2A3'],
    [encodeChainID36(Universe.ETHEREUM, 43114), '0x2025056a454A3DB5C2985213f82AD16337e41234'],
    [encodeChainID36(Universe.ETHEREUM, 999), '0xd26ea41725DA83A90877F277Fd888980B2888023'],
    [encodeChainID36(Universe.FUEL, 9889), '0x18bf9116890a9ca862b3dd2157314e818b3ba1434b21039592a84ab23740a588']
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

  public *entries(): Generator<[OmniversalChainID, Buffer]> {
    for (const [key, value] of this.map.entries()) {
      yield [OmniversalChainID.fromChainID36(hexToBytes(<Hex>key)), value]
    }
  }
}
