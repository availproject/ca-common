import {
  bytesToBigInt,
  bytesToHex,
  type Hex,
  hexToBigInt,
  hexToBytes,
  toBytes,
  toHex,
} from "viem";

import {
  Universe,
  universeFromJSON,
  universeToJSON,
} from "../proto/definition";
import { Bytes } from "../types";

export function encodeChainID36(
  universe: Universe,
  chainID: Bytes | bigint | number,
): Uint8Array {
  const chainIDB: Uint8Array =
    chainID instanceof Uint8Array ? chainID : toBytes(chainID);

  const buf = new Uint8Array(36);
  new DataView(buf.buffer).setUint32(0, universe, false);
  buf.set(chainIDB, 4 + (32 - chainIDB.length));
  return buf;
}

export class OmniversalChainID {
  public readonly universe: Universe;
  public readonly chainID: bigint;
  private readonly binaryForm: Uint8Array;

  constructor(universe: Universe, chainID: bigint | number | string | Bytes) {
    this.universe = universe;

    if (typeof chainID === "bigint") {
      this.chainID = chainID;
    } else if (typeof chainID === "number" || typeof chainID === "string") {
      this.chainID = BigInt(chainID);
    } else if (chainID instanceof Uint8Array) {
      this.chainID = bytesToBigInt(chainID);
    }

    this.binaryForm = encodeChainID36(this.universe, this.chainID);
  }

  public toString() {
    return universeToJSON(this.universe) + "_" + this.chainID.toString(10);
  }

  public toJSON() {
    return {
      universe: universeToJSON(this.universe),
      chainID: toHex(this.chainID),
    };
  }

  static fromJSON(input: {
    universe: string;
    chainID: Hex;
  }): OmniversalChainID {
    return new OmniversalChainID(
      universeFromJSON(input.universe),
      hexToBigInt(input.chainID),
    );
  }

  static fromChainID36(input: Bytes): OmniversalChainID {
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const univID = view.getUint32(0, false);
    const rest = input.subarray(4);
    return new OmniversalChainID(univID, rest);
  }

  // Do not modify the returned buffer. Make a copy if necessary.
  public toBytes(): Uint8Array {
    return this.binaryForm;
  }

  equals(rhs: OmniversalChainID): boolean {
    return this.universe === rhs.universe && this.chainID === rhs.chainID;
  }

  static equals(lhs: OmniversalChainID, rhs: OmniversalChainID) {
    return lhs.equals(rhs);
  }
}

export class ChainIDKeyedMap<V> {
  private readonly map: Map<Hex, V>;

  public constructor(entries: readonly [OmniversalChainID, V][] | null = null) {
    this.map = new Map<Hex, V>(
      entries != null
        ? entries.map((e) => [bytesToHex(e[0].toBytes()), e[1]])
        : null,
    );
  }

  public get(key: OmniversalChainID) {
    return this.map.get(bytesToHex(key.toBytes()));
  }

  public set(key: OmniversalChainID, value: V) {
    this.map.set(bytesToHex(key.toBytes()), value);
    return this;
  }

  public getFromChainID36(key: Bytes) {
    return this.map.get(bytesToHex(key));
  }

  public *entries(): Generator<[OmniversalChainID, V]> {
    for (const [key, value] of this.map.entries()) {
      yield [OmniversalChainID.fromChainID36(hexToBytes(<Hex>key)), value];
    }
  }
}
