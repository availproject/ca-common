import {
  Account,
  Address,
  bytesToHex,
  encodeFunctionData,
  getContract,
  GetContractReturnType,
  Hex,
  hexToBigInt,
  pad,
  WalletClient,
} from "viem";

import { Currency, ERC20ABI } from "../data";

export enum PermitVariant {
  Unsupported,
  EIP2612Canonical,
  DAI,
  Polygon2612,
  PolygonEMT,
}

export class PermitCreationError extends Error {}

const EIP712Domain = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

const PolygonDomain = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "verifyingContract", type: "address" },
  { name: "salt", type: "bytes32" },
] as const;

export async function signPermitForAddressAndValue(
  cur: Currency,
  client: WalletClient,
  account: Account,
  spender: Address,
  value: bigint,
  contract?: GetContractReturnType<typeof ERC20ABI, WalletClient, Hex>,
  deadline?: bigint,
) {
  if (contract == null) {
    contract = getContract({
      address: bytesToHex(cur.tokenAddress.subarray(12)),
      abi: ERC20ABI,
      client,
    });
  }

  const walletAddress = account.address;
  deadline = deadline ?? 2n ** 256n - 1n;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestsToBeMade: Promise<any>[] = [
    contract.read.name(),
    client.request({ method: "eth_chainId" }, { dedupe: true }),
  ];
  switch (cur.permitVariant) {
    case PermitVariant.Unsupported:
    default: {
      throw new PermitCreationError("Permits are unsupported on this currency");
    }
    case PermitVariant.EIP2612Canonical:
    case PermitVariant.DAI:
    case PermitVariant.Polygon2612: {
      requestsToBeMade[2] = contract.read.nonces([walletAddress]);
      break;
    }
    case PermitVariant.PolygonEMT: {
      requestsToBeMade[2] = contract.read.getNonce([walletAddress]);
    }
  }

  const [name, chainID, nonce] = await Promise.all(
    requestsToBeMade as [Promise<string>, Promise<Hex>, Promise<bigint>],
  );

  switch (cur.permitVariant) {
    case PermitVariant.EIP2612Canonical: {
      return client.signTypedData({
        types: {
          EIP712Domain,
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        domain: {
          name,
          version: cur.permitContractVersion.toString(10),
          chainId: hexToBigInt(chainID),
          verifyingContract: contract.address,
        },
        message: {
          owner: walletAddress,
          spender,
          value,
          nonce,
          deadline,
        },
        account,
      });
    }
    case PermitVariant.DAI: {
      return client.signTypedData({
        types: {
          EIP712Domain,
          Permit: [
            { name: "holder", type: "address" },
            { name: "spender", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "expiry", type: "uint256" },
            { name: "allowed", type: "bool" },
          ],
        },
        primaryType: "Permit",
        domain: {
          name,
          version: cur.permitContractVersion.toString(10),
          chainId: hexToBigInt(chainID),
          verifyingContract: contract.address,
        },
        message: {
          holder: walletAddress,
          spender: spender,
          nonce,
          expiry: deadline,
          allowed: true,
        },
        account,
      });
    }
    case PermitVariant.Polygon2612: {
      return client.signTypedData({
        types: {
          EIP712Domain: PolygonDomain,
          Permit: [
            { name: "holder", type: "address" },
            { name: "spender", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "expiry", type: "uint256" },
            { name: "allowed", type: "bool" },
          ],
        },
        primaryType: "Permit",
        domain: {
          name,
          version: cur.permitContractVersion.toString(10),
          verifyingContract: contract.address,
          salt: pad(chainID, {
            dir: "left",
            size: 32,
          }),
        },
        message: {
          holder: walletAddress,
          spender: spender,
          nonce,
          expiry: deadline,
          allowed: true,
        },
        account,
      });
    }
    case PermitVariant.PolygonEMT: {
      const funcSig = encodeFunctionData({
        abi: ERC20ABI,
        functionName: "approve",
        args: [spender, value],
      });
      return client.signTypedData({
        types: {
          EIP712Domain: PolygonDomain,
          MetaTransaction: [
            { name: "nonce", type: "uint256" },
            { name: "from", type: "address" },
            { name: "functionSignature", type: "bytes" },
          ],
        },
        primaryType: "MetaTransaction",
        domain: {
          name,
          version: cur.permitContractVersion.toString(10),
          verifyingContract: contract.address,
          salt: pad(chainID, {
            dir: "left",
            size: 32,
          }),
        },
        message: {
          nonce,
          from: walletAddress,
          functionSignature: funcSig,
        },
        account,
      });
    }
  }
}
