import { Hex, hexToBytes, toHex } from "viem";

import {
  ChainIDKeyedMap,
  encodeChainID36,
  OmniversalChainID,
  zeroExtendBufToGivenSize,
} from "../data";
import { Universe } from "../proto/definition";

export enum Environment {
  FOLLY, // Dev with test-net tokens
  CERISE, // Dev with main-net tokens
  CORAL, // Test-net with main-net tokens
  JADE, // Main-net with main-net tokens
}

const dataSets = new Map<Environment, [OmniversalChainID, string][]>([
  [
    Environment.FOLLY,
    [
      [
        new OmniversalChainID(Universe.ETHEREUM, 421614),
        "0xF0111EdE031a4377C34A4AD900f1E633E41055Dc",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 11155420),
        "0xF0111EdE031a4377C34A4AD900f1E633E41055Dc",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 80002),
        "0xF0111EdE031a4377C34A4AD900f1E633E41055Dc",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 84532),
        "0xF0111EdE031a4377C34A4AD900f1E633E41055Dc",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 11155111),
        "0xF0111EdE031a4377C34A4AD900f1E633E41055Dc",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 10143),
        "0xF0111EdE031a4377C34A4AD900f1E633E41055Dc",
      ],
      [
        new OmniversalChainID(Universe.TRON, 2494104990n),
        "0x70f03baa2CD784447A4B133E41386562163209f8",
      ],
    ],
  ],
  [
    Environment.CERISE,
    [
      [
        new OmniversalChainID(Universe.ETHEREUM, 137),
        "0x0000002Ed0657b924b4AA83aD76CaB42DF90869D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 10),
        "0x0000002Ed0657b924b4AA83aD76CaB42DF90869D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 42161),
        "0x0000002Ed0657b924b4AA83aD76CaB42DF90869D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 8453),
        "0x0000002Ed0657b924b4AA83aD76CaB42DF90869D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 43114),
        "0x0000002Ed0657b924b4AA83aD76CaB42DF90869D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 534352),
        "0x0000002Ed0657b924b4AA83aD76CaB42DF90869D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 8217),
        "0x0000002Ed0657b924b4AA83aD76CaB42DF90869D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 50104),
        "0x0A8eb0237524D1A8Fa8cbecF49e54FE627Ed781f",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 56),
        "0x0000002Ed0657b924b4AA83aD76CaB42DF90869D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 999),
        "0x0000002Ed0657b924b4AA83aD76CaB42DF90869D",
      ],
      [
        new OmniversalChainID(Universe.FUEL, 9889),
        "0x6cd9b8d7e13762f4cb98cbd733640138aeb65395c4b38d84a7d46f6f6c6b42e4",
      ],
    ],
  ],
  [
    Environment.CORAL,
    [
      [
        new OmniversalChainID(Universe.ETHEREUM, 1),
        "0xBADA557252D286e45a1AD73f32479062D4E2e86B",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 10),
        "0xBADA557252D286e45a1AD73f32479062D4E2e86B",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 137),
        "0xBADA557252D286e45a1AD73f32479062D4E2e86B",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 42161),
        "0xBADA557252D286e45a1AD73f32479062D4E2e86B",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 534352),
        "0xBADA557252D286e45a1AD73f32479062D4E2e86B",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 8453),
        "0xBADA557252D286e45a1AD73f32479062D4E2e86B",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 43114),
        "0xBADA557252D286e45a1AD73f32479062D4E2e86B",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 999),
        "0xBADA557252D286e45a1AD73f32479062D4E2e86B",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 8217),
        "0xBADA557252D286e45a1AD73f32479062D4E2e86B",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 50104),
        "0xB61fAdeBccCb15823b64bf47829d32eeb4A08930",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 56),
        "0xBADA557252D286e45a1AD73f32479062D4E2e86B",
      ],
      [
        new OmniversalChainID(Universe.FUEL, 9889),
        "0xe2586f908cc885e630cec6d8d578f02e6ade66983baf23f82757be502127dfb1",
      ],
    ],
  ],
]);

export function getVaultContractMap(environment: Environment) {
  const src = dataSets.get(environment);
  if (src == null) {
    throw new Error("Environment not found");
  }
  return new ChainIDKeyedMap<Buffer>(
    src.map((t) => [
      t[0],
      zeroExtendBufToGivenSize(hexToBytes(t[1] as Hex), 32),
    ]),
  );
}
