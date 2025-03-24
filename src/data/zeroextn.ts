import { Bytes } from "../types";
import { Hex, pad, toHex } from "viem";

export function convertToBufferIfNecessary(buf: Bytes) {
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
}

export function zeroExtendBufToGivenSize(buf: Bytes, size: number = 32): Buffer {
  if (buf.length === size) {
    return convertToBufferIfNecessary(buf)
  }

  if (buf.length > size) {
    return convertToBufferIfNecessary(buf.subarray(0, size))
  }

  const out = Buffer.alloc(size)
  out.set(buf, size - buf.length)
  return out
}

export function ezPadTo32Hex(input: Hex | Parameters<typeof toHex>[0]): Hex {
  return pad(typeof input !== 'string' ? toHex(input) : input as Hex, {
    dir: 'left',
    size: 32
  })
}
