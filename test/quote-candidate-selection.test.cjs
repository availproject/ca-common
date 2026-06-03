/* eslint-disable @typescript-eslint/no-require-imports, no-undef */

const assert = require("node:assert/strict");
const test = require("node:test");

const { firstSuccessfulQuoteCandidate } = require("../dist/cjs/index.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function candidate(label) {
  return {
    label,
    aggregator: {},
    quote: {
      input: {
        amount: label === "source_exact_out" ? "10" : "10.1",
        amountRaw: label === "source_exact_out" ? 10n : 101n,
        contractAddress: "0xinput",
        decimals: 18,
        value: 10,
        symbol: "IN",
      },
      output: {
        amount: "5",
        amountRaw: 5n,
        contractAddress: "0xoutput",
        decimals: 6,
        value: 5,
        symbol: "OUT",
      },
      txData: {
        approvalAddress: "0xapproval",
        tx: {
          to: "0xto",
          value: "0",
          data: "0x",
        },
      },
    },
  };
}

test("prioritizes the preferred quote candidate when it succeeds", async () => {
  const exactOut = delay(20).then(() => candidate("source_exact_out"));
  const convergence = Promise.resolve(candidate("source_convergence"));

  const selected = await firstSuccessfulQuoteCandidate(
    [exactOut, convergence],
    "no quote",
  );

  assert.equal(selected.label, "source_exact_out");
});
