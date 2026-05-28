import { Hex, pad, toHex } from "viem";
import Decimal from "decimal.js";

import { Bytes } from "../types";

export function zeroExtendBufToGivenSize(
  buf: Bytes,
  size: number = 32,
): Uint8Array {
  if (buf.length === size) {
    return buf;
  }

  if (buf.length > size) {
    return buf.subarray(0, size);
  }

  const out = new Uint8Array(size);
  out.set(buf, size - buf.length);
  return out;
}

export function bytesEqual(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function ezPadTo32Hex(input: Hex | Parameters<typeof toHex>[0]): Hex {
  return pad(typeof input !== "string" ? toHex(input) : (input as Hex), {
    dir: "left",
    size: 32,
  });
}

export function convertDecimalToBigInt(dec: Decimal): bigint {
  return BigInt(dec.ceil().toFixed());
}

export function convertBigIntToDecimal(big: bigint): Decimal {
  return new Decimal(big.toString(10));
}

export function maxByBigInt<T>(items: readonly T[], getValue: (element: T) => bigint): T {
  return items.reduce((m, e) => getValue(e) > getValue(m) ? e : m)
}

export function minByBigInt<T>(items: readonly T[], getValue: (element: T) => bigint): T {
  return items.reduce((m, e) => getValue(e) < getValue(m) ? e : m)
}
