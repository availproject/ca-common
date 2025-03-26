import {
  Client,
  getContract,
  Hex,
  Prettify,
  UnionOmit,
  ReadContractParameters as ViemReadContractParameters,
  EstimateContractGasParameters,
  EstimateContractGasReturnType,
  Chain,
  SimulateContractParameters,
  SimulateContractReturnType,
  Account as ViemAccount,
  Address as ViemAddress,
  WriteContractParameters,
  WriteContractReturnType
} from "viem";
import { EVMVaultABI, EVMVaultABIType } from "../data";

// there is a very complicated procedure to re-generate these types

export type EVMRFF = {
  sources: readonly {
    universe: number;
    chainID: bigint;
    tokenAddress: `0x${string}`;
    value: bigint;
  }[];
  destinationUniverse: number;
  destinationChainID: bigint;
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

/*
type VaultViewFunctions = "overhead" | "DEFAULT_ADMIN_ROLE" | "UPGRADE_INTERFACE_VERSION" | "depositNonce" | "fillNonce" | "getRoleAdmin" | "hasRole" | "maxGasPrice" | "proxiableUUID" | "requests" | "settleNonce" | "supportsInterface" | "vaultBalance" | "verifyRequestSignature";
type VaultPureFunctions = "verifyRequestSignature"
type ReadContractParameters<T1 extends VaultViewFunctions | VaultPureFunctions, T2> = Prettify<UnionOmit<ViemReadContractParameters<VaultABIType, T1, T2>, "address" | "abi" | "args" | "functionName">>;
 */

type VRSArgs = readonly [EVMRFF, Hex]
type DepositArgs = readonly [EVMRFF, Hex, bigint]
type FillArgs = readonly [EVMRFF, Hex]

type OptionalChain = Chain | undefined
type OptionalAccount = ViemAccount | undefined
type AccountOverride = ViemAccount | ViemAddress | undefined

export type EVMVaultContractIface = {
  read: {
    verifyRequestSignature: (args: VRSArgs, options?: Prettify<UnionOmit<ViemReadContractParameters<EVMVaultABIType, "verifyRequestSignature", VRSArgs>, "address" | "abi" | "args" | "functionName">> | undefined) => Promise<readonly [boolean, `0x${string}`]>
  },
  estimateGas: {
    deposit: (args: DepositArgs, options: Prettify<UnionOmit<EstimateContractGasParameters<EVMVaultABIType, "deposit", DepositArgs>, "address" | "abi" | "args" | "functionName">>) => Promise<EstimateContractGasReturnType>,
    fill: (args: FillArgs, options: Prettify<UnionOmit<EstimateContractGasParameters<EVMVaultABIType, "fill", FillArgs>, "address" | "abi" | "args" | "functionName">>) => Promise<EstimateContractGasReturnType>,
  },
  simulate: {
    deposit: (args: DepositArgs, options?: Omit<SimulateContractParameters<EVMVaultABIType, "deposit", DepositArgs, OptionalChain, OptionalChain, AccountOverride>, "address" | "abi" | "args" | "functionName"> | undefined) => Promise<SimulateContractReturnType<EVMVaultABIType, "deposit", DepositArgs, OptionalChain, OptionalAccount, OptionalChain, AccountOverride>>
    fill: (args: FillArgs, options?: Omit<SimulateContractParameters<EVMVaultABIType, "fill", FillArgs, OptionalChain, OptionalChain, AccountOverride>, "address" | "abi" | "args" | "functionName"> | undefined) => Promise<SimulateContractReturnType<EVMVaultABIType, "fill", FillArgs, OptionalChain, OptionalAccount, OptionalChain, AccountOverride>>
  },
  write: {
    deposit: (args: DepositArgs, options: UnionOmit<WriteContractParameters<EVMVaultABIType, "deposit", DepositArgs, OptionalChain, OptionalAccount, OptionalChain>, "address" | "abi" | "args" | "functionName">) => Promise<WriteContractReturnType>
    fill: (args: FillArgs, options: UnionOmit<WriteContractParameters<EVMVaultABIType, "fill", FillArgs, OptionalChain, OptionalAccount, OptionalChain>, "address" | "abi" | "args" | "functionName">) => Promise<WriteContractReturnType>
  }
}

export function createEVMVaultContract(address: Hex, client: Client): EVMVaultContractIface {
  return getContract({
    address,
    client,
    abi: EVMVaultABI,
  });
}

// one of the most bizarre type inferences of all time
/* export type EVMRFF = Parameters<
  ReturnType<typeof createEVMVaultContract>["read"]["verifyRequestSignature"]
>[0];*/
