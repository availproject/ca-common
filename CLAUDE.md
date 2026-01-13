# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build        # Clean + build ESM + CJS
npm run build:esm    # Build ES modules only (dist/esm/)
npm run build:cjs    # Build CommonJS only (dist/cjs/)
npm run lint         # Run ESLint
npm run clean        # Remove dist/ directory
npm run release      # Create a release with release-it
```

Note: No test framework is currently configured.

## Architecture Overview

This is `@avail-project/ca-common`, a TypeScript library providing common utilities for Chain Abstraction (CA) across multiple blockchain ecosystems.

### Multi-Universe Model

The library uses a **Universe** abstraction to support multiple blockchain ecosystems:
- `Universe.ETHEREUM` (0): Ethereum and EVM-compatible chains
- `Universe.FUEL` (1): Fuel blockchain
- `Universe.SOLANA` (2): Solana blockchain
- `Universe.TRON` (3): TRON blockchain

Chain identification uses `OmniversalChainID` (in `src/data/chainid.ts`) which combines universe + chainID into a 36-byte binary format.

### Core Modules

| Module | Purpose |
|--------|---------|
| `src/data/` | Chain metadata, currencies, RPC URLs. Uses `ChainIDKeyedMap` for chain-keyed lookups |
| `src/proto/` | Protobuf definitions and gRPC-Web client. Generated from `.proto` files via ts-proto |
| `src/xcs/` | Cross-chain swap aggregators (0x, LiFi, Bebop, YieldYak) implementing `Aggregator` interface |
| `src/cosmos/` | Cosmos SDK integration - wallet creation, signing client, custom message registry |
| `src/permitutils/` | EIP-2612 permit signing with multi-variant support (DAI, Polygon, standard) |
| `src/rff/` | Request For Funds abstraction - bridges Protobuf and EVM representations via `OmniversalRFF` |
| `src/balances/` | Balance querying via MessagePack-based backend API |
| `src/vaultcontracts/` | EVM vault contract type definitions |
| `src/evmabi/` | Smart contract ABIs (ERC20, Vault, YieldYak aggregator) |

### Key Design Patterns

1. **Adapter Pattern**: `OmniversalRFF` converts between Protobuf (`RequestForFunds`) and EVM (`EVMRFF`) representations
2. **Interface-based Aggregators**: All swap aggregators implement the `Aggregator` interface with `getQuotes()` method
3. **Permit Variants**: Token permits use strategy pattern - `EIP2612Canonical`, `DAI`, `Polygon2612`, `PolygonEMT`, `Unsupported`
4. **Factory Functions**: `createGrpcWebImpl()`, `createCosmosWallet()`, `createCosmosClient()`
5. **Binary Protocols**: MessagePack for efficient serialization (`msgpackableAxios` in `src/types/`)

### Build Output

Dual-format library with type declarations:
- `dist/esm/` - ES modules (ES2024)
- `dist/cjs/` - CommonJS modules
- `dist/types/` - TypeScript declarations

### Peer Dependencies

Users must install: `@cosmjs/proto-signing`, `@cosmjs/stargate`, `axios`, `decimal.js`, `long`, `msgpackr`, `viem`

## Adding New Chains

1. Add chain metadata to `src/data/chaindata.ts` - includes currencies, permit variants, decimals, gas tokens
2. Add any new currencies to `src/data/currency.ts`
3. Update the `UniverseRPCURLMap` if RPC URLs are needed

## Adding New Swap Aggregators

1. Create new file in `src/xcs/` implementing the `Aggregator` interface from `iface.ts`
2. Implement `getQuotes()` returning normalized `Quote` objects
3. Export from `src/index.ts`
