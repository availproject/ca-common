import {
  Registry as CosmosRegistry,
  OfflineDirectSigner,
  DirectSecp256k1Wallet,
} from "@cosmjs/proto-signing";
import {
  defaultRegistryTypes,
  HttpEndpoint,
  SigningStargateClient,
  SigningStargateClientOptions,
} from "@cosmjs/stargate";
import { Hex, hexToBytes } from "viem";

import {
  MsgCreatePendingClaim,
  MsgCreatePendingClaimResponse,
  MsgCreateRequestForFunds,
  MsgCreateRequestForFundsResponse,
} from "../proto/cosmos";
import { Bytes } from "../types";

export const Registry = new CosmosRegistry(defaultRegistryTypes);

{
  Registry.register(
    "/xarchain.chainabstraction.v1.MsgCreateRequestForFunds",
    MsgCreateRequestForFunds,
  );
  Registry.register(
    "/xarchain.chainabstraction.v1.MsgCreateRequestForFundsResponse",
    MsgCreateRequestForFundsResponse,
  );
  Registry.register(
    "/xarchain.chainabstraction.v1.MsgCreatePendingClaim",
    MsgCreatePendingClaim,
  );
  Registry.register(
    "/xarchain.chainabstraction.v1.MsgCreatePendingClaimResponse",
    MsgCreatePendingClaimResponse,
  );
}

export function createCosmosWallet(
  privateKey: string | Bytes,
): Promise<DirectSecp256k1Wallet> {
  const pkBytes: Uint8Array =
    typeof privateKey === "string" ? hexToBytes(privateKey as Hex) : privateKey;
  return DirectSecp256k1Wallet.fromKey(pkBytes, "arcana");
}

export function createCosmosClient(
  signer: OfflineDirectSigner,
  endpoint: string | HttpEndpoint,
  options?: SigningStargateClientOptions,
): Promise<SigningStargateClient> {
  return SigningStargateClient.connectWithSigner(endpoint, signer, {
    registry: Registry,
    ...options,
  });
}
