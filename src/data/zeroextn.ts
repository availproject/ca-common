import { Bytes } from "../types";

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
