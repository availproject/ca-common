import { Hex, hexToBytes } from "viem";

import {
  ChainIDKeyedMap,
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
        "0xEFF0C81eC6D7c2a3B924e98B65303DDaa3030a81",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 11155420),
        "0xEFF0C81eC6D7c2a3B924e98B65303DDaa3030a81",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 80002),
        "0xEFF0C81eC6D7c2a3B924e98B65303DDaa3030a81",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 84532),
        "0xEFF0C81eC6D7c2a3B924e98B65303DDaa3030a81",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 11155111),
        "0xEFF0C81eC6D7c2a3B924e98B65303DDaa3030a81",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 10143),
        "0xEFF0C81eC6D7c2a3B924e98B65303DDaa3030a81",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 567),
        "0xEFF0C81eC6D7c2a3B924e98B65303DDaa3030a81",
      ],
    ],
  ],
  [
    Environment.CERISE,
    [
      [
        new OmniversalChainID(Universe.ETHEREUM, 137),
        "0xB0BB1Ea8Eefb51BDA49631b09A350266e0F76EF3",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 10),
        "0xB0BB1Ea8Eefb51BDA49631b09A350266e0F76EF3",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 42161),
        "0xB0BB1Ea8Eefb51BDA49631b09A350266e0F76EF3",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 8453),
        "0xB0BB1Ea8Eefb51BDA49631b09A350266e0F76EF3",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 534352),
        "0xB0BB1Ea8Eefb51BDA49631b09A350266e0F76EF3",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 56),
        "0xB0BB1Ea8Eefb51BDA49631b09A350266e0F76EF3",
      ],
      [
        new OmniversalChainID(Universe.TRON, 728126428),
        "0x4ddDbe8D0D399B65E5898b6d2bC97Ae0683E8CB7",
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
