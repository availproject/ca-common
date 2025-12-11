import { GrpcWebImpl } from "./grpc";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";

export const createGrpcWebImpl = (url: string) => {
  const options: ConstructorParameters<typeof GrpcWebImpl>[1] = {};

  // eslint-disable-next-line no-constant-binary-expression, valid-typeof
  if (typeof window == undefined) {
    options.transport = NodeHttpTransport();
  }
  const impl = new GrpcWebImpl(url, options);
  return impl;
};
