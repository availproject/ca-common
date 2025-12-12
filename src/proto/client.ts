import { GrpcWebImpl } from "./cosmos";

export const createGrpcWebImpl = async (url: string) => {
  const options: ConstructorParameters<typeof GrpcWebImpl>[1] = {};

  // eslint-disable-next-line no-constant-binary-expression, valid-typeof
  if (typeof window == undefined) {
    const lib = await import("@improbable-eng/grpc-web-node-http-transport");
    options.transport = lib.NodeHttpTransport();
  }

  const impl = new GrpcWebImpl(url, options);
  return impl;
};
