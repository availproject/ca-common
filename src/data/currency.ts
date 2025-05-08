import { bytesToBigInt, Hex, toBytes } from "viem";
import Decimal from "decimal.js";

import { Bytes } from "../types";
import { zeroExtendBufToGivenSize } from "./utils";
import { PermitVariant } from "../permitutils";

export enum CurrencyID {
  USDC = 1,
  USDT = 2,
  ETH = 3,
  POL = 4,
  AVAX = 5,
}

export class Currency {
  // this is always 32 byte long
  public readonly tokenAddress: Buffer

  /* This is the ratio between one unit to the smallest unit used.

     For example, USDC, which has a ‘decimals’ value of 6, is designed so that 1 USDC = 10⁶ μUSDC, which is the smallest indivisible amount representable.
   */
  private readonly oneUnitToAtomicUnitRatio: Decimal

  constructor(
    public readonly currencyID: CurrencyID,
    tokenAddress: string | Bytes | number[],
    public readonly decimals: number,
    public readonly permitVariant: PermitVariant,
    public readonly permitContractVersion = 0,
    public readonly isGasToken: boolean,
    public readonly polygonGasOracleAddress: Hex
  ) {
    if (typeof tokenAddress === 'string') {
      this.tokenAddress = zeroExtendBufToGivenSize(toBytes(tokenAddress), 32)
    } else if (tokenAddress instanceof Uint8Array) {
      this.tokenAddress = zeroExtendBufToGivenSize(tokenAddress, 32)
    } else if (Array.isArray(tokenAddress) && tokenAddress.length >= 1 && typeof tokenAddress[0] === 'number') {
      this.tokenAddress = zeroExtendBufToGivenSize(Buffer.from(tokenAddress), 32)
    }
    this.oneUnitToAtomicUnitRatio = Decimal.pow(10, decimals)
  }

  convertUnitsToAmountDecimal(input: bigint | number | Hex | Bytes): Decimal {
    let rawunits: string
    if (typeof input === 'bigint') {
      rawunits = input.toString(10)
    } else if (typeof input === 'number') {
      rawunits = input.toString()
    } else if (input instanceof Uint8Array) {
      rawunits = bytesToBigInt(input).toString(10)
    } else if (typeof input === 'string') {
      rawunits = input
    } else {
      throw new Error('Invalid input')
    }
    return Decimal.div(rawunits, this.oneUnitToAtomicUnitRatio)
  }

  convertAmountToUnitsInBinary(input: Decimal): Buffer {
    return Buffer.from(toBytes(input.mul(this.oneUnitToAtomicUnitRatio).ceil().toHex()))
  }
}
