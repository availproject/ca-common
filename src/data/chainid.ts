import { bytesToBigInt, type Hex, hexToBigInt, toBytes, toHex } from "viem";

import { Universe, universeFromJSON, universeToJSON } from "../proto/definition";
import { Bytes } from "../types";
import { convertToBufferIfNecessary } from "./zeroextn";

export function encodeChainID36 (universe: Universe, chainID: Bytes | bigint | number): Buffer {
  let chainIDB: Uint8Array

  if (Buffer.isBuffer(chainID) || chainID instanceof Uint8Array) {
    chainIDB = chainID
  } else {
    chainIDB = toBytes(chainID)
  }

  const buf = Buffer.alloc(36)
  buf.writeUint32BE(universe)
  buf.set(chainIDB, 4 + (32 - chainIDB.length))
  return buf
}

export class OmniversalChainID {
  public readonly universe: Universe
  public readonly chainID: bigint
  private readonly binaryForm: Buffer

  constructor(universe: Universe, chainID: bigint | number | string | Bytes) {
    this.universe = universe

    if (typeof chainID === 'bigint') {
      this.chainID = chainID
    } else if (typeof chainID === 'number' || typeof chainID === 'string') {
      this.chainID = BigInt(chainID)
    } else if (chainID instanceof Uint8Array) {
      this.chainID = bytesToBigInt(chainID)
    }

    this.binaryForm = encodeChainID36(this.universe, this.chainID)
  }

  public toString () {
    return universeToJSON(this.universe) + '_' + this.chainID.toString(10)
  }

  public toJSON () {
    return {
      universe: universeToJSON(this.universe),
      chainID: toHex(this.chainID)
    }
  }

  static fromJSON(input: { universe: string, chainID: Hex }): OmniversalChainID {
    return new OmniversalChainID(universeFromJSON(input.universe), hexToBigInt(input.chainID))
  }

  static fromChainID36(_input: Bytes): OmniversalChainID {
    const input = convertToBufferIfNecessary(_input)
    const univID = input.readUint32BE(0)
    const rest = input.subarray(4)
    return new OmniversalChainID(univID, rest)
  }

  // Do not modify the returned buffer. Make a copy if necessary.
  public toBytes(): Buffer {
    return this.binaryForm
  }

  equals (rhs: OmniversalChainID): boolean {
    return this.universe === rhs.universe && this.chainID === rhs.chainID
  }

  static equals (lhs: OmniversalChainID, rhs: OmniversalChainID) {
    return lhs.equals(rhs)
  }
}
