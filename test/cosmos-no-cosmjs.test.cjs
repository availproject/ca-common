/* eslint-disable @typescript-eslint/no-require-imports, no-undef */

const assert = require("node:assert/strict");
const { BinaryWriter } = require("@bufbuild/protobuf/wire");
const Long = require("long");
const Module = require("node:module");
const test = require("node:test");
const COSMJS_FIXTURE_VECTORS = require("./fixtures/cosmjs-signing-vectors.json");

const PRIVATE_KEY_ONE =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const ACCOUNT_ADDRESS = "arcana1w508d6qejxtdg4y5r3zarvary0c5xw7khglrs6";
const ACCOUNT_PUBKEY_HEX =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const AUTH_INFO_BASE64 =
  "ClAKRgofL2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiECeb5mfvncu6xVoGKVzocLBwKb/NstzijZWfKBWxb4F5gSBAoCCAEYAxIEEMCaDA==";
const BASE_ACCOUNT_TYPE_URL = "/cosmos.auth.v1beta1.BaseAccount";
const REFUND_RESPONSE_TYPE_URL =
  "/xarchain.chainabstraction.MsgRefundReqResponse";
const REFUND_TX_RAW_BASE64 =
  "CmQKXAonL3hhcmNoYWluLmNoYWluYWJzdHJhY3Rpb24uTXNnUmVmdW5kUmVxEjEKLWFyY2FuYTF3NTA4ZDZxZWp4dGRnNHk1cjN6YXJ2YXJ5MGM1eHc3a2hnbHJzNhAMEgRtZW1vElgKUApGCh8vY29zbW9zLmNyeXB0by5zZWNwMjU2azEuUHViS2V5EiMKIQJ5vmZ++dy7rFWgYpXOhwsHApv82y3OKNlZ8oFbFvgXmBIECgIIARgDEgQQwJoMGkA9t8hMvAP7iXzTG4h0GzqoQfKf41/tjl2kBv8lB45El0DE1675RWfAIEpYqALcTjnvaY2AzPQzjXsrPL+RkodE";
const REFUND_BODY_BASE64 =
  "ClwKJy94YXJjaGFpbi5jaGFpbmFic3RyYWN0aW9uLk1zZ1JlZnVuZFJlcRIxCi1hcmNhbmExdzUwOGQ2cWVqeHRkZzR5NXIzemFydmFyeTBjNXh3N2toZ2xyczYQDBIEbWVtbw==";
const REFUND_SIGNATURE_BASE64 =
  "PbfITLwD+4l80xuIdBs6qEHyn+Nf7Y5dpAb/JQeORJdAxNeu+UVnwCBKWKgC3E4572mNgMz0M417Kzy/kZKHRA==";
const RFF_BODY_BASE64 =
  "CrMCCjMveGFyY2hhaW4uY2hhaW5hYnN0cmFjdGlvbi5Nc2dDcmVhdGVSZXF1ZXN0Rm9yRnVuZHMS+wEKJhIEAAAAARoUEREREREREREREREREREREREREREiCAAAAAAAAAPoGgQAAACJShQiIiIiIiIiIiIiIiIiIiIiIiIiIiIWChQzMzMzMzMzMzMzMzMzMzMzMzMzMyoEAQIDBDDAxAc6LWFyY2FuYTF3NTA4ZDZxZWp4dGRnNHk1cjN6YXJ2YXJ5MGM1eHc3a2hnbHJzNkJkEiAAAAAAAAAAAAAAAABERERERERERERERERERERERERERBpAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVRIEbWVtbw==";
const RFF_SIGNATURE_BASE64 =
  "4GOwK8FrlSqOwxtOn/8IlmEvDxrdVlJGlxcYsLssY5QjcqQjcdcisK/191RbdHvYPknW+i92e4MbeaR31cziEA==";
const DOUBLE_CHECK_BODY_BASE64 =
  "CmgKKy94YXJjaGFpbi5jaGFpbmFic3RyYWN0aW9uLk1zZ0RvdWJsZUNoZWNrVHgSOQotYXJjYW5hMXc1MDhkNnFlanh0ZGc0eTVyM3phcnZhcnkwYzV4dzdraGdscnM2GgQAAACJKgIIYxIEbWVtbw==";
const DOUBLE_CHECK_SIGNATURE_BASE64 =
  "/g7zDtOyTOt1cyh5jHBGtp5SMrEKSbXmkTp+EGbyTPkGbLBxFCbtJt0zCT/LQeZAkUsQsYp0+Nd0SN7HqLBzgg==";
const DOUBLE_CHECK_FILL_BODY_BASE64 =
  "CqABCisveGFyY2hhaW4uY2hhaW5hYnN0cmFjdGlvbi5Nc2dEb3VibGVDaGVja1R4EnEKLWFyY2FuYTF3NTA4ZDZxZWp4dGRnNHk1cjN6YXJ2YXJ5MGM1eHc3a2hnbHJzNhoEAAAAiTI6CGQSFGZmZmZmZmZmZmZmZmZmZmZmZmZmGiB3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3dxIEbWVtbw==";
const DOUBLE_CHECK_FILL_SIGNATURE_BASE64 =
  "596JXLzaGwhci05b3amoHS52VkFGwmBU5uJ6IOl7FfVww1L9cZWZiUVI1wXWSF1V8QQzKZJkvNewOlOtzmmeGw==";
const FEE_TIMEOUT_BODY_BASE64 =
  "ClwKJy94YXJjaGFpbi5jaGFpbmFic3RyYWN0aW9uLk1zZ1JlZnVuZFJlcRIxCi1hcmNhbmExdzUwOGQ2cWVqeHRkZzR5NXIzemFydmFyeTBjNXh3N2toZ2xyczYQDBIEbWVtbxgq";
const FEE_TIMEOUT_AUTH_INFO_BASE64 =
  "ClAKRgofL2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiECeb5mfvncu6xVoGKVzocLBwKb/NstzijZWfKBWxb4F5gSBAoCCAEYAxJxCg0KBXV4YXJjEgQxMjM0EMCaDBotYXJjYW5hMXc1MDhkNnFlanh0ZGc0eTVyM3phcnZhcnkwYzV4dzdraGdscnM2Ii1hcmNhbmExcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXEweGxkOTM=";
const FEE_TIMEOUT_SIGNATURE_BASE64 =
  "i2IKvUsPJHAe7gCg/ejWtpaleKLL23BbCC/8pjpoDFQBJoEm2VN+9yHd5LOOpDzzjTgBPdrcHLeAPHNkgWtc8g==";

let cachedCaCommon;

test("cosmos helpers load and wallet signs without CosmJS", async () => {
  const caCommon = loadCaCommonWithoutCosmjs();

  assert.equal(typeof caCommon.createCosmosWallet, "function");
  assert.equal(typeof caCommon.createCosmosClient, "function");
  assert.equal(typeof caCommon.isDeliverTxFailure, "function");
  assert.equal(typeof caCommon.isDeliverTxSuccess, "function");

  const wallet = await caCommon.createCosmosWallet(PRIVATE_KEY_ONE);
  const [account] = await wallet.getAccounts();

  assert.equal(account.algo, "secp256k1");
  assert.equal(account.address, ACCOUNT_ADDRESS);
  assert.equal(Buffer.from(account.pubkey).toString("hex"), ACCOUNT_PUBKEY_HEX);

  const signed = await wallet.signDirect(account.address, {
    bodyBytes: Uint8Array.from([1, 2, 3]),
    authInfoBytes: Uint8Array.from([4, 5, 6]),
    chainId: "xarchain-test",
    accountNumber: 7n,
  });

  assert.deepEqual(signed.signed, {
    bodyBytes: Uint8Array.from([1, 2, 3]),
    authInfoBytes: Uint8Array.from([4, 5, 6]),
    chainId: "xarchain-test",
    accountNumber: 7n,
  });
  assert.deepEqual(signed.signature.pub_key, {
    type: "tendermint/PubKeySecp256k1",
    value: "Anm+Zn753LusVaBilc6HCwcCm/zbLc4o2VnygVsW+BeY",
  });
  assert.equal(
    signed.signature.signature,
    "1hQ6UiCzw2Xe0C+ir2a6x6acC5jxNZwWe2P31VI7cOUa6BMs67YwdN0PGaecAMKl7mzXesnPaS82L2e1p/ILlw==",
  );
});

test("sign creates golden vectors for supported xarchain messages", async () => {
  const { caCommon, client, account } = await setup();
  const signerData = { accountNumber: 7, sequence: 3, chainId: "xarchain-test" };

  await assertSignVector({
    client,
    address: account.address,
    message: {
      typeUrl: "/xarchain.chainabstraction.MsgRefundReq",
      value: caCommon.MsgRefundReq.create({
        creator: account.address,
        rffID: 12,
      }),
    },
    signerData,
    body: REFUND_BODY_BASE64,
    signature: REFUND_SIGNATURE_BASE64,
  });

  await assertSignVector({
    client,
    address: account.address,
    message: {
      typeUrl: "/xarchain.chainabstraction.MsgCreateRequestForFunds",
      value: createRffMessage(caCommon, account.address),
    },
    signerData,
    body: RFF_BODY_BASE64,
    signature: RFF_SIGNATURE_BASE64,
  });

  await assertSignVector({
    client,
    address: account.address,
    message: {
      typeUrl: "/xarchain.chainabstraction.MsgDoubleCheckTx",
      value: createDoubleCheckMessage(caCommon, account.address),
    },
    signerData,
    body: DOUBLE_CHECK_BODY_BASE64,
    signature: DOUBLE_CHECK_SIGNATURE_BASE64,
  });

  await assertSignVector({
    client,
    address: account.address,
    message: {
      typeUrl: "/xarchain.chainabstraction.MsgDoubleCheckTx",
      value: createDoubleCheckFillMessage(caCommon, account.address),
    },
    signerData,
    body: DOUBLE_CHECK_FILL_BODY_BASE64,
    signature: DOUBLE_CHECK_FILL_SIGNATURE_BASE64,
  });
});

test("sign encodes fee payer, fee granter, and timeout height", async () => {
  const { caCommon, client, account } = await setup();
  const tx = await client.sign(
    account.address,
    [
      {
        typeUrl: "/xarchain.chainabstraction.MsgRefundReq",
        value: caCommon.MsgRefundReq.create({
          creator: account.address,
          rffID: 12,
        }),
      },
    ],
    {
      amount: [{ denom: "uxarc", amount: "1234" }],
      gas: "200000",
      payer: account.address,
      granter: "arcana1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq0xld93",
    },
    "memo",
    { accountNumber: 7, sequence: 3, chainId: "xarchain-test" },
    42n,
  );

  assert.equal(Buffer.from(tx.bodyBytes).toString("base64"), FEE_TIMEOUT_BODY_BASE64);
  assert.equal(
    Buffer.from(tx.authInfoBytes).toString("base64"),
    FEE_TIMEOUT_AUTH_INFO_BASE64,
  );
  assert.equal(
    Buffer.from(tx.signatures[0]).toString("base64"),
    FEE_TIMEOUT_SIGNATURE_BASE64,
  );
});

test("sign matches independently generated CosmJS vectors", async () => {
  const { caCommon, client, account } = await setup();

  assert.equal(COSMJS_FIXTURE_VECTORS.generatedBy, "@cosmjs/proto-signing@0.34.1");
  assert.deepEqual(COSMJS_FIXTURE_VECTORS.account, {
    address: account.address,
    pubkeyHex: ACCOUNT_PUBKEY_HEX,
  });

  const baseFee = { amount: [], gas: "200000" };
  const signerData = COSMJS_FIXTURE_VECTORS.signerData;
  const cases = [
    {
      name: "refund",
      message: {
        typeUrl: "/xarchain.chainabstraction.MsgRefundReq",
        value: caCommon.MsgRefundReq.create({
          creator: account.address,
          rffID: 12,
        }),
      },
      fee: baseFee,
      memo: "memo",
    },
    {
      name: "createRequestForFunds",
      message: {
        typeUrl: "/xarchain.chainabstraction.MsgCreateRequestForFunds",
        value: createRffMessage(caCommon, account.address),
      },
      fee: baseFee,
      memo: "memo",
    },
    {
      name: "doubleCheckDeposit",
      message: {
        typeUrl: "/xarchain.chainabstraction.MsgDoubleCheckTx",
        value: createDoubleCheckMessage(caCommon, account.address),
      },
      fee: baseFee,
      memo: "memo",
    },
    {
      name: "doubleCheckFill",
      message: {
        typeUrl: "/xarchain.chainabstraction.MsgDoubleCheckTx",
        value: createDoubleCheckFillMessage(caCommon, account.address),
      },
      fee: baseFee,
      memo: "memo",
    },
    {
      name: "refundWithFeeAndTimeout",
      message: {
        typeUrl: "/xarchain.chainabstraction.MsgRefundReq",
        value: caCommon.MsgRefundReq.create({
          creator: account.address,
          rffID: 12,
        }),
      },
      fee: {
        amount: [{ denom: "uxarc", amount: "1234" }],
        gas: "200000",
        payer: account.address,
        granter: "arcana1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq0xld93",
      },
      memo: "memo",
      timeoutHeight: 42,
    },
  ];

  for (const currentCase of cases) {
    const tx = await client.sign(
      account.address,
      [currentCase.message],
      currentCase.fee,
      currentCase.memo,
      signerData,
      currentCase.timeoutHeight,
    );

    assert.deepEqual(
      signVector(tx),
      COSMJS_FIXTURE_VECTORS.vectors[currentCase.name],
      currentCase.name,
    );
  }
});

test("signAndBroadcast decodes successful tx responses", async () => {
  const { caCommon, wallet, account } = await setup();
  const calls = [];
  let broadcastedTx;

  await withMockedFetch((request) => {
    calls.push(request.method);
    if (request.method === "status") {
      return rpcResponse({ node_info: { network: "xarchain-test" } });
    }
    if (request.method === "abci_query") {
      return rpcResponse({ response: { value: queryAccountResponseBase64(7, 3) } });
    }
    if (request.method === "broadcast_tx_sync") {
      broadcastedTx = request.params.tx;
      return rpcResponse({ code: 0, hash: "ABCD" });
    }
    if (request.method === "tx_search") {
      return rpcResponse({
        txs: [
          {
            hash: "ABCD",
            height: "123",
            index: 0,
            tx: broadcastedTx,
            tx_result: {
              code: 0,
              data: txMsgDataBase64(),
              events: [
                {
                  type: "message",
                  attributes: [
                    {
                      key: Buffer.from("action").toString("base64"),
                      value: Buffer.from("refund").toString("base64"),
                    },
                    {
                      key: Buffer.from("empty").toString("base64"),
                    },
                  ],
                },
              ],
              gas_used: "11",
              gas_wanted: "200000",
              log: "",
            },
          },
        ],
      });
    }

    throw new Error(`unexpected RPC method: ${request.method}`);
  }, async () => {
    const broadcastClient = await caCommon.createCosmosClient(
      wallet,
      "http://localhost:26657",
      { broadcastPollIntervalMs: 0, broadcastTimeoutMs: 100 },
    );
    const result = await signRefund(broadcastClient, caCommon, account.address);

    assert.deepEqual(calls, [
      "abci_query",
      "status",
      "broadcast_tx_sync",
      "tx_search",
    ]);
    assert.equal(broadcastedTx, REFUND_TX_RAW_BASE64);
    assert.equal(result.transactionHash, "ABCD");
    assert.equal(result.height, 123);
    assert.equal(result.gasUsed, 11n);
    assert.equal(result.gasWanted, 200000n);
    assert.deepEqual(result.msgResponses, [
      { typeUrl: REFUND_RESPONSE_TYPE_URL, value: new Uint8Array() },
    ]);
    assert.deepEqual(result.events, [
      {
        type: "message",
        attributes: [
          { key: "action", value: "refund" },
          { key: "empty", value: "" },
        ],
      },
    ]);
    assert.deepEqual(caCommon.Registry.decode(result.msgResponses[0]), {});
  });
});

test("signAndBroadcast rejects CheckTx failures", async () => {
  const { caCommon, wallet, account } = await setup();
  const calls = [];

  await withMockedFetch((request) => {
    calls.push(request.method);
    if (request.method === "abci_query") {
      return rpcResponse({ response: { value: queryAccountResponseBase64(7, 3) } });
    }
    if (request.method === "status") {
      return rpcResponse({ node_info: { network: "xarchain-test" } });
    }
    if (request.method === "broadcast_tx_sync") {
      return rpcResponse({ code: 5, codespace: "sdk", log: "bad sequence" });
    }
    throw new Error(`unexpected RPC method: ${request.method}`);
  }, async () => {
    const client = await caCommon.createCosmosClient(wallet, "http://localhost:26657");

    await assert.rejects(
      () => signRefund(client, caCommon, account.address),
      (error) => {
        assert.ok(error instanceof caCommon.BroadcastTxError);
        assert.equal(error.code, 5);
        assert.equal(error.codespace, "sdk");
        assert.equal(error.log, "bad sequence");
        return true;
      },
    );
    assert.deepEqual(calls, ["abci_query", "status", "broadcast_tx_sync"]);
  });
});

test("signAndBroadcast returns DeliverTx failures for caller classification", async () => {
  const { caCommon, wallet, account } = await setup();

  await withMockedFetch((request) => {
    if (request.method === "abci_query") {
      return rpcResponse({ response: { value: queryAccountResponseBase64(7, 3) } });
    }
    if (request.method === "status") {
      return rpcResponse({ node_info: { network: "xarchain-test" } });
    }
    if (request.method === "broadcast_tx_sync") {
      return rpcResponse({ code: 0, hash: "DCBA" });
    }
    if (request.method === "tx_search") {
      return rpcResponse({
        txs: [
          {
            hash: "DCBA",
            height: "456",
            index: 2,
            tx: REFUND_TX_RAW_BASE64,
            tx_result: {
              code: 18,
              data: txMsgDataBase64(),
              events: [],
              gas_used: "99",
              gas_wanted: "200000",
              log: "RFF is not expired yet",
            },
          },
        ],
      });
    }
    throw new Error(`unexpected RPC method: ${request.method}`);
  }, async () => {
    const client = await caCommon.createCosmosClient(
      wallet,
      "http://localhost:26657",
      { broadcastPollIntervalMs: 0, broadcastTimeoutMs: 100 },
    );
    const result = await signRefund(client, caCommon, account.address);

    assert.equal(result.transactionHash, "DCBA");
    assert.equal(result.code, 18);
    assert.equal(result.rawLog, "RFF is not expired yet");
    assert.equal(result.gasUsed, 99n);
    assert.equal(caCommon.isDeliverTxFailure(result), true);
    assert.equal(caCommon.isDeliverTxSuccess(result), false);
    assert.throws(
      () => caCommon.assertIsDeliverTxSuccess(result),
      /Error when broadcasting tx DCBA/,
    );
    assert.doesNotThrow(() => caCommon.assertIsDeliverTxFailure(result));
  });
});

test("signAndBroadcast times out when a broadcast tx is not indexed", async () => {
  const { caCommon, wallet, account } = await setup();
  let pollCount = 0;

  await withMockedFetch((request) => {
    if (request.method === "abci_query") {
      return rpcResponse({ response: { value: queryAccountResponseBase64(7, 3) } });
    }
    if (request.method === "status") {
      return rpcResponse({ node_info: { network: "xarchain-test" } });
    }
    if (request.method === "broadcast_tx_sync") {
      return rpcResponse({ code: 0, hash: "F00D" });
    }
    if (request.method === "tx_search") {
      pollCount += 1;
      return rpcResponse({ txs: [] });
    }
    throw new Error(`unexpected RPC method: ${request.method}`);
  }, async () => {
    const client = await caCommon.createCosmosClient(
      wallet,
      "http://localhost:26657",
      { broadcastPollIntervalMs: 0, broadcastTimeoutMs: 1 },
    );

    await assert.rejects(
      () => signRefund(client, caCommon, account.address),
      (error) => {
        assert.ok(error instanceof caCommon.TimeoutError);
        assert.equal(error.txId, "F00D");
        return true;
      },
    );
    assert.ok(pollCount > 0);
  });
});

test("getSequence surfaces account query failure modes", async () => {
  const { caCommon, wallet, account } = await setup();

  await assertSequenceRejects({
    caCommon,
    wallet,
    result: { response: { code: 4, log: "account query failed" } },
    match: /account query failed/,
  });
  await assertSequenceRejects({
    caCommon,
    wallet,
    result: { response: {} },
    match: /does not exist on chain/,
  });
  await assertSequenceRejects({
    caCommon,
    wallet,
    result: {
      response: {
        value: queryAccountResponseBase64(7, 3, "/custom.auth.v1.Account"),
      },
    },
    match: /Unsupported account type: '\/custom\.auth\.v1\.Account'/,
  });
  await assertSequenceRejects({
    caCommon,
    wallet,
    result: { response: { value: queryAccountResponseBase64("9007199254740992", 3) } },
    match: /accountNumber exceeds Number\.MAX_SAFE_INTEGER/,
  });

  await withMockedFetch((request) => {
    assert.equal(request.method, "abci_query");
    return rpcResponse({ response: { value: queryAccountResponseBase64(7, 3) } });
  }, async () => {
    const client = await caCommon.createCosmosClient(wallet, "http://localhost:26657");
    assert.deepEqual(await client.getSequence(account.address), {
      accountNumber: 7,
      sequence: 3,
    });
  });
});

test("unsupported replacement boundaries fail explicitly", async () => {
  const { caCommon, wallet, client, account } = await setup();

  await assert.rejects(
    () => caCommon.createCosmosClient(wallet, "ws://localhost:26657"),
    /Only HTTP\(S\) Cosmos RPC endpoints are supported/,
  );
  await assert.rejects(
    () =>
      client.sign(
        "arcana1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq0xld93",
        [
          {
            typeUrl: "/xarchain.chainabstraction.MsgRefundReq",
            value: caCommon.MsgRefundReq.create({
              creator: account.address,
              rffID: 12,
            }),
          },
        ],
        { amount: [], gas: "200000" },
        "memo",
        { accountNumber: 7, sequence: 3, chainId: "xarchain-test" },
      ),
    /Failed to retrieve account from signer/,
  );
  assert.throws(
    () =>
      caCommon.Registry.encode({
        typeUrl: "/xarchain.chainabstraction.Unknown",
        value: {},
      }),
    /Unregistered type url: \/xarchain\.chainabstraction\.Unknown/,
  );
});

function loadCaCommonWithoutCosmjs() {
  const originalLoad = Module._load;

  Module._load = function blockedCosmjs(request, ...args) {
    if (request.startsWith("@cosmjs/") || request.startsWith("cosmjs-types")) {
      throw new Error(`Blocked CosmJS import: ${request}`);
    }
    return originalLoad.call(this, request, ...args);
  };

  try {
    cachedCaCommon ??= require("../dist/cjs/index.js");
    return cachedCaCommon;
  } finally {
    Module._load = originalLoad;
  }
}

async function setup() {
  const caCommon = loadCaCommonWithoutCosmjs();
  const wallet = await caCommon.createCosmosWallet(PRIVATE_KEY_ONE);
  const [account] = await wallet.getAccounts();
  const client = await caCommon.createCosmosClient(wallet, "http://localhost:26657");
  return { caCommon, wallet, account, client };
}

async function assertSignVector({ client, address, message, signerData, body, signature }) {
  const tx = await client.sign(
    address,
    [message],
    { amount: [], gas: "200000" },
    "memo",
    signerData,
  );

  assert.equal(Buffer.from(tx.bodyBytes).toString("base64"), body);
  assert.equal(Buffer.from(tx.authInfoBytes).toString("base64"), AUTH_INFO_BASE64);
  assert.equal(Buffer.from(tx.signatures[0]).toString("base64"), signature);
}

function signVector(tx) {
  return {
    bodyBytesBase64: Buffer.from(tx.bodyBytes).toString("base64"),
    authInfoBytesBase64: Buffer.from(tx.authInfoBytes).toString("base64"),
    signatureBase64: Buffer.from(tx.signatures[0]).toString("base64"),
    txRawBase64: txRawBase64(tx),
  };
}

function txRawBase64(tx) {
  const writer = new BinaryWriter();
  if (tx.bodyBytes.length !== 0) {
    writer.uint32(10).bytes(tx.bodyBytes);
  }
  if (tx.authInfoBytes.length !== 0) {
    writer.uint32(18).bytes(tx.authInfoBytes);
  }
  for (const signature of tx.signatures) {
    writer.uint32(26).bytes(signature);
  }
  return Buffer.from(writer.finish()).toString("base64");
}

function rpcResponse(result) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
  };
}

function queryAccountResponseBase64(
  accountNumber,
  sequence,
  typeUrl = BASE_ACCOUNT_TYPE_URL,
) {
  const baseAccount = new BinaryWriter()
    .uint32(24)
    .uint64(accountNumber)
    .uint32(32)
    .uint64(sequence)
    .finish();

  const response = new BinaryWriter();
  encodeAny(typeUrl, baseAccount, response.uint32(10).fork()).join();
  return Buffer.from(response.finish()).toString("base64");
}

function txMsgDataBase64() {
  const txMsgData = new BinaryWriter();
  encodeAny(REFUND_RESPONSE_TYPE_URL, new Uint8Array(), txMsgData.uint32(18).fork()).join();
  return Buffer.from(txMsgData.finish()).toString("base64");
}

function encodeAny(typeUrl, value, writer = new BinaryWriter()) {
  writer.uint32(10).string(typeUrl);
  if (value.length !== 0) {
    writer.uint32(18).bytes(value);
  }
  return writer;
}

function signRefund(client, caCommon, address) {
  return client.signAndBroadcast(
    address,
    [
      {
        typeUrl: "/xarchain.chainabstraction.MsgRefundReq",
        value: caCommon.MsgRefundReq.create({
          creator: address,
          rffID: 12,
        }),
      },
    ],
    { amount: [], gas: "200000" },
    "memo",
  );
}

async function withMockedFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => handler(JSON.parse(init.body));
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function createRffMessage(caCommon, address) {
  return caCommon.MsgCreateRequestForFunds.create({
    sources: [
      {
        universe: caCommon.Universe.ETHEREUM,
        chainID: hexToBytes("00000001"),
        contractAddress: hexToBytes("1111111111111111111111111111111111111111"),
        value: hexToBytes("00000000000003e8"),
        status: caCommon.RFFSourceState.WAITING,
      },
    ],
    destinationUniverse: caCommon.Universe.ETHEREUM,
    destinationChainID: hexToBytes("00000089"),
    recipientAddress: hexToBytes("2222222222222222222222222222222222222222"),
    destinations: [
      {
        contractAddress: hexToBytes("3333333333333333333333333333333333333333"),
        perChainFeeBP: [
          {
            universe: caCommon.Universe.ETHEREUM,
            chainID: hexToBytes("00000089"),
            feeBP: Long.fromNumber(25, true),
          },
        ],
      },
    ],
    nonce: hexToBytes("01020304"),
    expiry: Long.fromNumber(123456, true),
    user: address,
    signatureData: [
      {
        universe: caCommon.Universe.ETHEREUM,
        address: hexToBytes(
          "0000000000000000000000004444444444444444444444444444444444444444",
        ),
        signature: hexToBytes(
          "55555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555",
        ),
      },
    ],
  });
}

function createDoubleCheckMessage(caCommon, address) {
  return caCommon.MsgDoubleCheckTx.create({
    creator: address,
    txUniverse: caCommon.Universe.ETHEREUM,
    txChainID: hexToBytes("00000089"),
    packet: {
      $case: "depositPacket",
      value: caCommon.DepositVEPacket.create({
        id: Long.fromNumber(99, true),
        gasRefunded: false,
      }),
    },
  });
}

function createDoubleCheckFillMessage(caCommon, address) {
  return caCommon.MsgDoubleCheckTx.create({
    creator: address,
    txUniverse: caCommon.Universe.ETHEREUM,
    txChainID: hexToBytes("00000089"),
    packet: {
      $case: "fillPacket",
      value: caCommon.FillVEPacket.create({
        id: Long.fromNumber(100, true),
        fillerAddress: hexToBytes("6666666666666666666666666666666666666666"),
        transactionHash: hexToBytes(
          "7777777777777777777777777777777777777777777777777777777777777777",
        ),
      }),
    },
  });
}

async function assertSequenceRejects({ caCommon, wallet, result, match }) {
  await withMockedFetch((request) => {
    assert.equal(request.method, "abci_query");
    return rpcResponse(result);
  }, async () => {
    const client = await caCommon.createCosmosClient(wallet, "http://localhost:26657");
    await assert.rejects(() => client.getSequence(ACCOUNT_ADDRESS), match);
  });
}

function hexToBytes(hex) {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}
