import { defineConfig, type Options } from "tsup";

const sharedOptions: Options = {
  bundle: true,
  entry: { index: "src/index.ts" },
  external: [
    "@bufbuild/protobuf",
    "@improbable-eng/grpc-web-node-http-transport",
    "@noble/curves",
    "@noble/curves/secp256k1",
    "@noble/hashes",
    "@noble/hashes/legacy",
    "@noble/hashes/sha2",
    "@scure/base",
    "axios",
    "browser-headers",
    "decimal.js",
    "es-toolkit",
    "long",
    "msgpackr",
    "tslib",
    "viem",
  ],
  noExternal: ["@improbable-eng/grpc-web"],
  platform: "neutral",
  sourcemap: false,
  splitting: false,
  target: "es2024",
};

export default defineConfig([
  {
    ...sharedOptions,
    format: ["esm"],
    outDir: "dist/esm",
    outExtension: () => ({ js: ".mjs" }),
  },
  {
    ...sharedOptions,
    format: ["cjs"],
    outDir: "dist/cjs",
  },
  {
    entry: { index: "src/index.ts" },
    dts: { only: true },
    outDir: "dist/types",
  },
]);
