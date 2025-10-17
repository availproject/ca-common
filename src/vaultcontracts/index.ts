export type EVMRFF = {
  sources: readonly {
    universe: number;
    chainID: bigint;
    tokenAddress: `0x${string}`;
    value: bigint;
  }[];
  destinationUniverse: number;
  destinationChainID: bigint;
  recipientAddress: `0x${string}`;
  destinations: readonly {
    tokenAddress: `0x${string}`;
    value: bigint;
  }[];
  nonce: bigint;
  expiry: bigint;
  parties: readonly {
    universe: number;
    address_: `0x${string}`;
  }[];
}
export * from './vaultcontracts'
