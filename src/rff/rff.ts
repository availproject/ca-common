import { bytesToBigInt } from "viem";

import { ezPadTo32Hex } from "../data";
import { RequestForFunds } from "../proto/definition";
import { type EVMRFF } from "../vaultcontracts";

export class OmniversalRFF {
  private evmRFF: EVMRFF | undefined;

  constructor(public readonly protobufRFF: RequestForFunds) {}

  public asEVMRFF(): EVMRFF {
    if (this.evmRFF == null) {
      this.evmRFF = {
        sources: this.protobufRFF.sources.map((s) => ({
          universe: s.universe,
          chainID: bytesToBigInt(s.chainID),
          contractAddress: ezPadTo32Hex(s.contractAddress),
          value: bytesToBigInt(s.value),
        })),
        destinationUniverse: this.protobufRFF.destinationUniverse,
        destinationChainID: bytesToBigInt(this.protobufRFF.destinationChainID),
        recipientAddress: ezPadTo32Hex(this.protobufRFF.recipientAddress),
        destinations: this.protobufRFF.destinations.map((d) => ({
          contractAddress: ezPadTo32Hex(d.contractAddress),
          value: bytesToBigInt(d.value),
        })),
        nonce: bytesToBigInt(this.protobufRFF.nonce),
        expiry: BigInt(this.protobufRFF.expiry.toString()),
        parties: this.protobufRFF.signatureData.map((sd) => ({
          universe: sd.universe,
          address_: ezPadTo32Hex(sd.address),
        })),
      };
    }
    return this.evmRFF;
  }

  public asProtobufRFF(): RequestForFunds {
    return this.protobufRFF;
  }
}
