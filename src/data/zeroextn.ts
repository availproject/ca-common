import { Bytes } from "../types";

export function zeroExtendBufToGivenSize(buf: Bytes, size: number): Buffer {
  if (buf.length > size) {
    buf = buf.subarray(0, size)
  }

  const out = Buffer.alloc(size)
  out.set(buf, size - buf.length)
  return out
}
