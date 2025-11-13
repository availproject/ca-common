import * as bufferModule from "buffer";

type BufferCtor = typeof import("buffer").Buffer;
type BufferInstance = InstanceType<BufferCtor>;

function resolveBuffer(): BufferCtor | undefined {
  const mod = bufferModule as unknown as {
    Buffer?: BufferCtor;
    default?: BufferCtor | { Buffer?: BufferCtor };
  };
  if (mod?.Buffer) return mod.Buffer;

  const defaultExport = mod?.default;
  if (typeof defaultExport === "function") {
    return defaultExport as BufferCtor;
  }

  if (
    defaultExport &&
    typeof defaultExport === "object" &&
    "Buffer" in defaultExport &&
    typeof defaultExport.Buffer === "function"
  ) {
    return defaultExport.Buffer as BufferCtor;
  }

  if (typeof globalThis.Buffer === "function") {
    return globalThis.Buffer as BufferCtor;
  }

  return undefined;
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
  this[o] = (normalized >>> 24) & 0xff;
  this[o + 1] = (normalized >>> 16) & 0xff;
  this[o + 2] = (normalized >>> 8) & 0xff;
  this[o + 3] = normalized & 0xff;
  return o + 4;
}

function fallbackWriteUint32LE(
  this: BufferInstance,
  value: unknown,
  offset: unknown = 0,
) {
  const o = assertOffset(this, offset);
  const normalized = Number(value) >>> 0;
  this[o] = normalized & 0xff;
  this[o + 1] = (normalized >>> 8) & 0xff;
  this[o + 2] = (normalized >>> 16) & 0xff;
  this[o + 3] = (normalized >>> 24) & 0xff;
  return o + 4;
}

function fallbackReadUint32BE(this: BufferInstance, offset: unknown = 0) {
  const o = assertOffset(this, offset);
  return (
    (this[o] * 0x1000000 +
      ((this[o + 1] << 16) | (this[o + 2] << 8) | this[o + 3])) >>>
    0
  );
}

function fallbackReadUint32LE(this: BufferInstance, offset: unknown = 0) {
  const o = assertOffset(this, offset);
  return (
    (this[o] |
      (this[o + 1] << 8) |
      (this[o + 2] << 16) |
      (this[o + 3] * 0x1000000)) >>>
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

const BufferImpl = resolveBuffer();
const globalScope = globalThis as Record<string, unknown>;

if (BufferImpl) {
  const proto = BufferImpl.prototype as BufferInstance | undefined;
  if (proto) {
    aliasOrDefine(
      proto,
      "writeUint32BE",
      "writeUInt32BE",
      fallbackWriteUint32BE,
    );
    aliasOrDefine(
      proto,
      "writeUint32LE",
      "writeUInt32LE",
      fallbackWriteUint32LE,
    );
    aliasOrDefine(proto, "readUint32BE", "readUInt32BE", fallbackReadUint32BE);
    aliasOrDefine(proto, "readUint32LE", "readUInt32LE", fallbackReadUint32LE);
  }

  const needsAssignment =
    typeof globalScope.Buffer === "undefined" ||
    typeof (globalScope.Buffer as BufferCtor | undefined)?.prototype
      ?.writeUint32BE !== "function";

  if (needsAssignment) {
    globalScope.Buffer = BufferImpl;
  }
}

if (!globalScope.process) {
  globalScope.process = { env: { NODE_ENV: "production" } };
} else {
  const env =
    typeof globalScope.process === "object" &&
    globalScope.process &&
    typeof (globalScope.process as { env?: Record<string, string> }).env ===
      "object"
      ? (globalScope.process as { env?: Record<string, string> }).env
      : undefined;

  if (env) {
    if (typeof env.NODE_ENV === "undefined") {
      env.NODE_ENV = "production";
    }
  } else {
    (globalScope.process as { env?: Record<string, string> }).env = {
      NODE_ENV: "production",
    };
  }
}
