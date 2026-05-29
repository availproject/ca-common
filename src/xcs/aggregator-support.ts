import { bytesToHex } from "viem";

import { ChainIDKeyedMap, encodeChainID36, OmniversalChainID } from "../data";
import { Universe } from "../proto/definition";

// https://api.bebop.xyz/{jam|pmm}/chains
export const BebopChainNameMapping = new Map(
  Object.entries({
    ethereum: 1,
    arbitrum: 42161,
    optimism: 10,
    base: 8453,
    bsc: 56,
    avalanche: 43114,
    polygon: 137,
    scroll: 534352,
    hyperevm: 999,
  }).map(([k, v]) => [bytesToHex(encodeChainID36(Universe.ETHEREUM, v)), k]),
);

export const LiFiAllowedChains = new Set([
  1, // Ethereum
  10, // Optimism
  56, // BSC
  137, // Polygon
  143, // Monad
  999, // HyperEVM
  4326, // MegaETH
  8453, // Base
  42161, // Arbitrum
  43114, // Avalanche
  8217, // Kaia
  534352, // Scroll
]);

export const FibrousChainNameMapping = new ChainIDKeyedMap<string>([
  // [new OmniversalChainID(Universe.ETHEREUM, 8453), "base"], // Disabled because of few liquidity issues
  [new OmniversalChainID(Universe.ETHEREUM, 999), "hyperevm"],
  [new OmniversalChainID(Universe.ETHEREUM, 143), "monad"],
  [new OmniversalChainID(Universe.ETHEREUM, 4114), "citrea"],
]);

export function isBebopChainSupported(chain: OmniversalChainID): boolean {
  return (
    chain.universe === Universe.ETHEREUM &&
    BebopChainNameMapping.has(bytesToHex(chain.toBytes()))
  );
}

export function isLiFiChainSupported(chain: OmniversalChainID): boolean {
  return (
    chain.universe === Universe.ETHEREUM &&
    LiFiAllowedChains.has(Number(chain.chainID))
  );
}

export function isFibrousChainSupported(chain: OmniversalChainID): boolean {
  return (
    chain.universe === Universe.ETHEREUM &&
    FibrousChainNameMapping.get(chain) != null
  );
}

export function isFibrousOnlyChain(chain: OmniversalChainID): boolean {
  return (
    isFibrousChainSupported(chain) &&
    !isBebopChainSupported(chain) &&
    !isLiFiChainSupported(chain)
  );
}
