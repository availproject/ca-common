/* eslint-disable @typescript-eslint/no-require-imports, no-undef */

const assert = require("node:assert/strict");
const test = require("node:test");

test("package exports load from ESM and CJS consumers", async () => {
  const esmCaCommon = await import("@avail-project/ca-common");
  const cjsCaCommon = require("@avail-project/ca-common");

  for (const caCommon of [esmCaCommon, cjsCaCommon]) {
    assert.equal(typeof caCommon.createCosmosWallet, "function");
    assert.equal(typeof caCommon.createCosmosClient, "function");
    assert.equal(typeof caCommon.SigningStargateClient, "function");
  }
});
