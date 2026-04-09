export const FibrousRouterABI = [
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "token_in", type: "address" },
          { internalType: "address", name: "token_out", type: "address" },
          { internalType: "uint256", name: "amount_in", type: "uint256" },
          { internalType: "uint256", name: "amount_out", type: "uint256" },
          { internalType: "uint256", name: "min_received", type: "uint256" },
          { internalType: "address", name: "destination", type: "address" },
          { internalType: "uint8", name: "swap_type", type: "uint8" },
        ],
        internalType: "struct IFibrousRouter.RouteParam",
        name: "route",
        type: "tuple",
      },
      {
        components: [
          { internalType: "address", name: "token_in", type: "address" },
          { internalType: "address", name: "token_out", type: "address" },
          { internalType: "uint32", name: "rate", type: "uint32" },
          { internalType: "int24", name: "protocol_id", type: "int24" },
          { internalType: "address", name: "pool_address", type: "address" },
          { internalType: "uint8", name: "swap_type", type: "uint8" },
          { internalType: "bytes", name: "extra_data", type: "bytes" },
        ],
        internalType: "struct IFibrousRouter.SwapParams[]",
        name: "swap_parameters",
        type: "tuple[]",
      },
    ],
    name: "swap",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
] as const;
