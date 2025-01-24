import { ArcanaVault } from "../fuelcontracts";
import { Bytes } from "../types";
import { Account, hexlify, Provider } from "fuels";

export function createFuelVaultContract(address: Bytes, upstream: Account | Provider): ArcanaVault {
  return new ArcanaVault(hexlify(address), upstream)
}
