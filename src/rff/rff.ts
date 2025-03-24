import { bytesToBigInt } from "viem";
import { BN } from "fuels";

import { ezPadTo32Hex } from "../data";
import { RequestForFunds } from "../proto/definition";
import { type EVMRFF } from "../vaultcontracts";
import { RequestInput as FuelRFF } from "../fuelcontracts/ArcanaVault";
import { protobufUniverseToFuelUniverse } from "./fuel";

export class OmniversalRFF {
  private evmRFF: EVMRFF | undefined
  private fuelRFF: FuelRFF | undefined

  constructor(public readonly protobufRFF: RequestForFunds) {
  }

  public asEVMRFF(): EVMRFF {
    if (this.evmRFF == null) {
      this.evmRFF = {
        sources: this.protobufRFF.sources.map(s => ({
          universe: s.universe,
          chainID: bytesToBigInt(s.chainID),
          tokenAddress: ezPadTo32Hex(s.tokenAddress),
          value: bytesToBigInt(s.value),
        })),
        destinationUniverse: this.protobufRFF.destinationUniverse,
        destinationChainID: bytesToBigInt(this.protobufRFF.destinationChainID),
        destinations: this.protobufRFF.destinations.map(d => ({
          tokenAddress: ezPadTo32Hex(d.tokenAddress),
          value: bytesToBigInt(d.value),
        })),
        nonce: bytesToBigInt(this.protobufRFF.nonce),
        expiry: BigInt(this.protobufRFF.expiry.toString()),
        parties: this.protobufRFF.signatureData.map(sd => ({
          universe: sd.universe,
          address_: ezPadTo32Hex(sd.address),
        }))
      }
    }
    return this.evmRFF
  }

  public asFuelRFF(): FuelRFF {
    if (this.fuelRFF == null) {
      this.fuelRFF = {
        sources: this.protobufRFF.sources.map(s => ({
          universe: protobufUniverseToFuelUniverse(s.universe),
          chain_id: new BN(s.chainID),
          asset_id: {
            bits: ezPadTo32Hex(s.tokenAddress),
          },
          value: new BN(s.value),
        })),
        destination_chain_id: new BN(this.protobufRFF.destinationChainID),
        destination_universe: protobufUniverseToFuelUniverse(this.protobufRFF.destinationUniverse),
        destinations: this.protobufRFF.destinations.map(d => ({
          asset_id: {
            bits: ezPadTo32Hex(d.tokenAddress)
          },
          value: new BN(d.value)
        })),
        expiry: new BN(this.protobufRFF.expiry.toBytesBE()),
        nonce: new BN(this.protobufRFF.nonce),
        parties: this.protobufRFF.signatureData.map(sd => ({
          universe: protobufUniverseToFuelUniverse(sd.universe),
          address: {
            bits: ezPadTo32Hex(sd.address),
          }
        })),
      }
    }
    return this.fuelRFF
  }

  public asProtobufRFF(): RequestForFunds {
    return this.protobufRFF
  }
}
