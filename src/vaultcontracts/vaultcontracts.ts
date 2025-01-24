import { toBytes, toHex } from "viem";

import { encodeChainID36, OmniversalChainID } from "../data";
import { Universe } from "../proto/definition";
import { Bytes } from "../types";

export enum Environment {
  DEV,
  TESTNET,
}

const dataSets = new Map<Environment, [Buffer, string][]>([
  [Environment.DEV, [
    [encodeChainID36(Universe.ETHEREUM, 137), '0xc39a170bbffD3f2C306d6fEB43922Dcf9EBeBAf4'],
    [encodeChainID36(Universe.ETHEREUM, 10), '0xd985A5E0F31e61E9105C8d50eb52469984F86143'],
    [encodeChainID36(Universe.FUEL, 9889), '0x891219cd98af2a2f100e820751118022d7ac73dda7af0449ff7161c9657391ff']
  ]],
  [Environment.TESTNET, [
    [encodeChainID36(Universe.ETHEREUM, 1), '0xBc1770f42575a2f2edab512e7a733Bf0b79f7b82'],
    [encodeChainID36(Universe.ETHEREUM, 10), '0x61E7BfD859AE76AC1C69A0F4BB6c35e3c1ff8a12'],
    [encodeChainID36(Universe.ETHEREUM, 137), '0xd7F1A0B549918077Ab4fE1870f6115EBdF49D8Bf'],
    [encodeChainID36(Universe.ETHEREUM, 42161), '0x160059CE66Bf3e0E3D15A4dB3773a97644c7056c'],
    [encodeChainID36(Universe.ETHEREUM, 534352), '0xB4dA404923F679755F53A8B767179c81b290A657'],
    [encodeChainID36(Universe.ETHEREUM, 59144), '0xE8eAeB1328D95f1B6B6Ba361564B94B09125477e'],
    [encodeChainID36(Universe.ETHEREUM, 8453), '0x9BD26053127D508DCf8CC113Ea44969D3f17ea14'],
  ]],
])

export class VaultContractMap {
  map = new Map<string, string>()

  constructor(environment: Environment) {
    const src = dataSets.get(environment)
    if (src == null) {
      throw new Error('Environment not found')
    }
    for (const tuple of src) {
      this.map.set(toHex(tuple[0]), tuple[1])
    }
  }

  private getActual(k: string): Bytes | undefined {
    const out = this.map.get(k)
    return out != null ? toBytes(out) : out
  }

  public getFromChainID36 (key: Buffer) {
    return this.getActual(toHex(key))
  }

  public getFromOmniversalChainID(key: OmniversalChainID) {
    return this.getFromChainID36(key.toBytes())
  }
}
