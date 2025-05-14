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
  MsgCreateRequestForFunds,
  MsgCreateRequestForFundsResponse,
  MsgCreateSolverData,
  MsgCreateSolverDataResponse,
  MsgRefundReq,
  MsgRefundReqResponse,
  MsgUpdateSolverData,
} from "../proto/definition";
import { Bytes } from "../types";

export const Registry = new CosmosRegistry(defaultRegistryTypes);

{
  Registry.register(
    "/xarchain.chainabstraction.MsgCreateSolverData",
    MsgCreateSolverData,
  );
  Registry.register(
    "/xarchain.chainabstraction.MsgCreateSolverDataResponse",
    MsgCreateSolverDataResponse,
  );
  Registry.register(
    "/xarchain.chainabstraction.MsgUpdateSolverData",
    MsgUpdateSolverData,
  );
  Registry.register(
    "/xarchain.chainabstraction.MsgUpdateSolverDataResponse",
    MsgCreateSolverDataResponse,
  );
  Registry.register(
    "/xarchain.chainabstraction.MsgCreateRequestForFunds",
    MsgCreateRequestForFunds,
  );
  Registry.register(
    "/xarchain.chainabstraction.MsgCreateRequestForFundsResponse",
    MsgCreateRequestForFundsResponse,
  );
  Registry.register("/xarchain.chainabstraction.MsgRefundReq", MsgRefundReq);
  Registry.register(
    "/xarchain.chainabstraction.MsgRefundReqResponse",
    MsgRefundReqResponse,
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
