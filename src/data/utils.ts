import { Hex, pad, toHex } from "viem";
import Decimal from "decimal.js";

import { Bytes } from "../types";

export function convertToBufferIfNecessary(buf: Bytes) {
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

export function zeroExtendBufToGivenSize(
  buf: Bytes,
  size: number = 32,
): Buffer {
  if (buf.length === size) {
    return convertToBufferIfNecessary(buf);
  }

  if (buf.length > size) {
    return convertToBufferIfNecessary(buf.subarray(0, size));
  }

  const out = Buffer.alloc(size);
  out.set(buf, size - buf.length);
  return out;
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

export function minByByBigInt<T>(items: readonly T[], getValue: (element: T) => bigint): T {
  return items.reduce((m, e) => getValue(e) < getValue(m) ? e : m)
}
