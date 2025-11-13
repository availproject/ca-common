import * as bufferModule from "buffer";
import { Buffer as DefaultBuffer } from "buffer";

type BufferCtor = typeof DefaultBuffer;
type BufferInstance = InstanceType<BufferCtor>;

const globalScope = globalThis as Record<string, unknown>;
let patched = false;

function collectBufferCtors(): BufferCtor[] {
  const candidates = new Set<BufferCtor>();

  if (typeof DefaultBuffer === "function") {
    candidates.add(DefaultBuffer);
  }

  const mod = bufferModule as unknown as {
    Buffer?: BufferCtor;
    default?: BufferCtor | { Buffer?: BufferCtor };
  };
  if (typeof mod?.Buffer === "function") {
    candidates.add(mod.Buffer);
  }
  const defaultExport = mod?.default;
  if (typeof defaultExport === "function") {
    candidates.add(defaultExport);
  } else if (
    defaultExport &&
    typeof defaultExport === "object" &&
    typeof (defaultExport as { Buffer?: BufferCtor }).Buffer === "function"
  ) {
    candidates.add(
      (defaultExport as { Buffer?: BufferCtor }).Buffer as BufferCtor,
    );
  }

  if (typeof globalScope.Buffer === "function") {
    candidates.add(globalScope.Buffer as BufferCtor);
  }

  return Array.from(candidates);
}

function assertOffset(buffer: BufferInstance, offset: unknown): number {
  const numericOffset = Number(offset);
  if (!Number.isFinite(numericOffset)) {
    throw new TypeError("Offset must be a finite number");
  }
  const normalized = numericOffset >>> 0;
  if (normalized !== numericOffset) {
    throw new RangeError("Offset must be a non-negative integer");
  }
  if (normalized + 4 > buffer.length) {
    throw new RangeError("Offset out of bounds");
  }
  return normalized;
}

function fallbackWriteUint32BE(
  this: BufferInstance,
  value: unknown,
  offset: unknown = 0,
) {
  const o = assertOffset(this, offset);
  const normalized = Number(value) >>> 0;
  (this as unknown as Record<number, number>)[o] = (normalized >>> 24) & 0xff;
  (this as unknown as Record<number, number>)[o + 1] =
    (normalized >>> 16) & 0xff;
  (this as unknown as Record<number, number>)[o + 2] =
    (normalized >>> 8) & 0xff;
  (this as unknown as Record<number, number>)[o + 3] = normalized & 0xff;
  return o + 4;
}

function fallbackWriteUint32LE(
  this: BufferInstance,
  value: unknown,
  offset: unknown = 0,
) {
  const o = assertOffset(this, offset);
  const normalized = Number(value) >>> 0;
  (this as unknown as Record<number, number>)[o] = normalized & 0xff;
  (this as unknown as Record<number, number>)[o + 1] =
    (normalized >>> 8) & 0xff;
  (this as unknown as Record<number, number>)[o + 2] =
    (normalized >>> 16) & 0xff;
  (this as unknown as Record<number, number>)[o + 3] =
    (normalized >>> 24) & 0xff;
  return o + 4;
}

function fallbackReadUint32BE(this: BufferInstance, offset: unknown = 0) {
  const o = assertOffset(this, offset);
  const store = this as unknown as Record<number, number>;
  return (
    (store[o] * 0x1000000 +
      ((store[o + 1] << 16) | (store[o + 2] << 8) | store[o + 3])) >>>
    0
  );
}

function fallbackReadUint32LE(this: BufferInstance, offset: unknown = 0) {
  const o = assertOffset(this, offset);
  const store = this as unknown as Record<number, number>;
  return (
    (store[o] |
      (store[o + 1] << 8) |
      (store[o + 2] << 16) |
      (store[o + 3] * 0x1000000)) >>>
    0
  );
}

function aliasOrDefine(
  proto: BufferInstance,
  alias: keyof BufferInstance,
  canonical: keyof BufferInstance,
  fallback: (this: BufferInstance, ...args: unknown[]) => unknown,
) {
  const aliasKey = alias as unknown as string;
  const canonicalKey = canonical as unknown as string;

  const existingAlias = (proto as unknown as Record<string, unknown>)[aliasKey];
  if (typeof existingAlias === "function") {
    return;
  }

  const canonicalFn = (proto as unknown as Record<string, unknown>)[
    canonicalKey
  ];
  if (typeof canonicalFn === "function") {
    Object.defineProperty(proto, aliasKey, {
      value: canonicalFn,
      writable: true,
      configurable: true,
    });
    return;
  }

  Object.defineProperty(proto, aliasKey, {
    value: fallback,
    writable: true,
    configurable: true,
  });
}

function patchPrototype(bufferCtor: BufferCtor) {
  const proto = bufferCtor.prototype as BufferInstance | undefined;
  if (!proto) {
    return;
  }
  aliasOrDefine(proto, "writeUint32BE", "writeUInt32BE", fallbackWriteUint32BE);
  aliasOrDefine(proto, "writeUint32LE", "writeUInt32LE", fallbackWriteUint32LE);
  aliasOrDefine(proto, "readUint32BE", "readUInt32BE", fallbackReadUint32BE);
  aliasOrDefine(proto, "readUint32LE", "readUInt32LE", fallbackReadUint32LE);
}

function ensureProcessEnv() {
  if (!globalScope.process) {
    globalScope.process = { env: { NODE_ENV: "production" } };
    return;
  }

  const processValue = globalScope.process as { env?: Record<string, string> };
  if (!processValue.env) {
    processValue.env = { NODE_ENV: "production" };
    return;
  }

  if (typeof processValue.env.NODE_ENV === "undefined") {
    processValue.env.NODE_ENV = "production";
  }
}

export function ensureBufferPolyfill(): void {
  if (patched) {
    return;
  }

  const candidates = collectBufferCtors();
  candidates.forEach(patchPrototype);

  const preferred = candidates[0];
  if (
    preferred &&
    (typeof globalScope.Buffer !== "function" ||
      typeof (globalScope.Buffer as BufferCtor).prototype?.writeUint32BE !==
        "function")
  ) {
    globalScope.Buffer = preferred;
  }

  ensureProcessEnv();
  patched = true;
}

ensureBufferPolyfill();
