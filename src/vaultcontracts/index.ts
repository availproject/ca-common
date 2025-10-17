export type EVMRFF = {
  sources: readonly {
    universe: number;
    chainID: bigint;
    contractAddress: `0x${string}`;
    value: bigint;
  }[];
  destinationUniverse: number;
  destinationChainID: bigint;
  recipientAddress: `0x${string}`;
  destinations: readonly {
    contractAddress: `0x${string}`;
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
