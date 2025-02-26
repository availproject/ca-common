import { Registry as CosmosRegistry, OfflineDirectSigner } from "@cosmjs/proto-signing";
import {
  defaultRegistryTypes,
  HttpEndpoint,
  SigningStargateClient,
  SigningStargateClientOptions
} from "@cosmjs/stargate";

import {
  MsgCreateRequestForFunds, MsgCreateRequestForFundsResponse,
  MsgCreateSolverData,
  MsgCreateSolverDataResponse, MsgRefundReq, MsgRefundReqResponse,
  MsgUpdateSolverData
} from "../proto/definition";

export const Registry = new CosmosRegistry(defaultRegistryTypes)

{
  Registry.register('/xarchain.chainabstraction.v1.MsgCreateSolverData', MsgCreateSolverData)
  Registry.register('/xarchain.chainabstraction.v1.MsgCreateSolverDataResponse', MsgCreateSolverDataResponse)
  Registry.register('/xarchain.chainabstraction.v1.MsgUpdateSolverData', MsgUpdateSolverData)
  Registry.register('/xarchain.chainabstraction.v1.MsgUpdateSolverDataResponse', MsgCreateSolverDataResponse)
  Registry.register('/xarchain.chainabstraction.v1.MsgCreateRequestForFunds', MsgCreateRequestForFunds)
  Registry.register('/xarchain.chainabstraction.v1.MsgCreateRequestForFundsResponse', MsgCreateRequestForFundsResponse)
  Registry.register('/xarchain.chainabstraction.v1.MsgRefundReq', MsgRefundReq)
  Registry.register('/xarchain.chainabstraction.v1.MsgRefundReqResponse', MsgRefundReqResponse)
}

export function createCosmosClient (signer: OfflineDirectSigner, endpoint: string | HttpEndpoint, options?: SigningStargateClientOptions): Promise<SigningStargateClient> {
  return SigningStargateClient.connectWithSigner(endpoint, signer, {
    registry: Registry,
    ...options,
  })
}
