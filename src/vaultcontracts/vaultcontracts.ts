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
        new OmniversalChainID(Universe.ETHEREUM, 11155111),
        "0xd579B76e3f51884c50eB8e8efdef5C593666B8fb",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 421614),
        "0x10B69f0E3c21C1187526940A615959E9ee6012F9",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 11155420),
        "0x10B69f0E3c21C1187526940A615959E9ee6012F9",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 84532),
        "0xA7458040272226378397C3036eda862D60C3b307",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 5115),
        "0x10B69f0E3c21C1187526940A615959E9ee6012F9",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 80002),
        "0xEFF0C81eC6D7c2a3B924e98B65303DDaa3030a81",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 10143),
        "0xEFF0C81eC6D7c2a3B924e98B65303DDaa3030a81",
      ],
    ],
  ],
  [
    Environment.CERISE,
    [
      [
        new OmniversalChainID(Universe.ETHEREUM, 137),
        "0x111111eA4f8BdfB5AE22c37ebC3eE17b82072F57",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 10),
        "0x111111eA4f8BdfB5AE22c37ebC3eE17b82072F57",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 42161),
        "0x111111eA4f8BdfB5AE22c37ebC3eE17b82072F57",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 8453),
        "0x111111eA4f8BdfB5AE22c37ebC3eE17b82072F57",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 4326),
        "0x10B69f0E3c21C1187526940A615959E9ee6012F9",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 4114),
        "0x10B69f0E3c21C1187526940A615959E9ee6012F9",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 534352),
        "0x111111eA4f8BdfB5AE22c37ebC3eE17b82072F57",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 56),
        "0x111111eA4f8BdfB5AE22c37ebC3eE17b82072F57",
      ],
      [
        new OmniversalChainID(Universe.TRON, 728126428),
        "0x46de8c7e6f1da4dd851b62c20b78971f230fca5b",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 1),
        "0xAc73E77b4FE9BBAAA35C7147DC3Fd5286929A746",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 143),
        "0xAc73E77b4FE9BBAAA35C7147DC3Fd5286929A746",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 999),
        "0xAc73E77b4FE9BBAAA35C7147DC3Fd5286929A746",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 43114),
        "0xAc73E77b4FE9BBAAA35C7147DC3Fd5286929A746",
      ],
    ],
  ],
  [
    Environment.CORAL,
    [
      [
        new OmniversalChainID(Universe.ETHEREUM, 1),
        "0xC0DED5d7F424276c821AF21F68E1e663bC671C3D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 10),
        "0xC0DED5d7F424276c821AF21F68E1e663bC671C3D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 137),
        "0xC0DED5d7F424276c821AF21F68E1e663bC671C3D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 42161),
        "0xC0DED5d7F424276c821AF21F68E1e663bC671C3D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 534352),
        "0xC0DED5d7F424276c821AF21F68E1e663bC671C3D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 8453),
        "0xC0DED5d7F424276c821AF21F68E1e663bC671C3D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 43114),
        "0xC0DED5d7F424276c821AF21F68E1e663bC671C3D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 999),
        "0xC0DED5d7F424276c821AF21F68E1e663bC671C3D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 8217),
        "0xC0DED5d7F424276c821AF21F68E1e663bC671C3D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 50104),
        "0xB61fAdeBccCb15823b64bf47829d32eeb4A08930",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 56),
        "0xC0DED5d7F424276c821AF21F68E1e663bC671C3D",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 143),
        "0xC0DED5d7F424276c821AF21F68E1e663bC671C3D",
      ],
    ],
  ],
  [
    Environment.JADE,
    [
      [
        new OmniversalChainID(Universe.ETHEREUM, 1),
        "0x00000000ac0ac9d69424fA5Adc291D75Ec4a0F11",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 10),
        "0x00000000ac0ac9d69424fA5Adc291D75Ec4a0F11",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 137),
        "0x00000000ac0ac9d69424fA5Adc291D75Ec4a0F11",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 42161),
        "0x00000000ac0ac9d69424fA5Adc291D75Ec4a0F11",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 534352),
        "0x00000000ac0ac9d69424fA5Adc291D75Ec4a0F11",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 8453),
        "0x00000000ac0ac9d69424fA5Adc291D75Ec4a0F11",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 43114),
        "0x00000000ac0ac9d69424fA5Adc291D75Ec4a0F11",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 999),
        "0x00000000ac0ac9d69424fA5Adc291D75Ec4a0F11",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 8217),
        "0x00000000ac0ac9d69424fA5Adc291D75Ec4a0F11",
      ],
      [
        new OmniversalChainID(Universe.ETHEREUM, 56),
        "0x00000000ac0ac9d69424fA5Adc291D75Ec4a0F11",
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
