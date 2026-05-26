/* eslint-disable @typescript-eslint/no-require-imports, no-undef */

const assert = require("node:assert/strict");
const { BinaryWriter } = require("@bufbuild/protobuf/wire");
const Module = require("node:module");
const test = require("node:test");

const PRIVATE_KEY_ONE =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const BASE_ACCOUNT_TYPE_URL = "/cosmos.auth.v1beta1.BaseAccount";
const REFUND_RESPONSE_TYPE_URL =
  "/xarchain.chainabstraction.MsgRefundReqResponse";
const REFUND_TX_RAW_BASE64 =
  "CmQKXAonL3hhcmNoYWluLmNoYWluYWJzdHJhY3Rpb24uTXNnUmVmdW5kUmVxEjEKLWFyY2FuYTF3NTA4ZDZxZWp4dGRnNHk1cjN6YXJ2YXJ5MGM1eHc3a2hnbHJzNhAMEgRtZW1vElgKUApGCh8vY29zbW9zLmNyeXB0by5zZWNwMjU2azEuUHViS2V5EiMKIQJ5vmZ++dy7rFWgYpXOhwsHApv82y3OKNlZ8oFbFvgXmBIECgIIARgDEgQQwJoMGkA9t8hMvAP7iXzTG4h0GzqoQfKf41/tjl2kBv8lB45El0DE1675RWfAIEpYqALcTjnvaY2AzPQzjXsrPL+RkodE";

test("cosmos helpers load and sign without CosmJS", async () => {
  const originalLoad = Module._load;

  Module._load = function blockedCosmjs(request, ...args) {
    if (request.startsWith("@cosmjs/") || request.startsWith("cosmjs-types")) {
      throw new Error(`Blocked CosmJS import: ${request}`);
    }
    return originalLoad.call(this, request, ...args);
  };

  try {
    const caCommon = require("../dist/cjs/index.js");

    assert.equal(typeof caCommon.createCosmosWallet, "function");
    assert.equal(typeof caCommon.createCosmosClient, "function");
    assert.equal(typeof caCommon.isDeliverTxFailure, "function");
    assert.equal(typeof caCommon.isDeliverTxSuccess, "function");

    const wallet = await caCommon.createCosmosWallet(PRIVATE_KEY_ONE);
    const [account] = await wallet.getAccounts();

    assert.equal(account.algo, "secp256k1");
    assert.equal(
      account.address,
      "arcana1w508d6qejxtdg4y5r3zarvary0c5xw7khglrs6",
    );
    assert.equal(
      Buffer.from(account.pubkey).toString("hex"),
      "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    );

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

    const client = await caCommon.createCosmosClient(wallet, "http://localhost:26657");
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
      { amount: [], gas: "200000" },
      "memo",
      { accountNumber: 7, sequence: 3, chainId: "xarchain-test" },
    );

    assert.equal(
      Buffer.from(tx.bodyBytes).toString("base64"),
      "ClwKJy94YXJjaGFpbi5jaGFpbmFic3RyYWN0aW9uLk1zZ1JlZnVuZFJlcRIxCi1hcmNhbmExdzUwOGQ2cWVqeHRkZzR5NXIzemFydmFyeTBjNXh3N2toZ2xyczYQDBIEbWVtbw==",
    );
    assert.equal(
      Buffer.from(tx.authInfoBytes).toString("base64"),
      "ClAKRgofL2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiECeb5mfvncu6xVoGKVzocLBwKb/NstzijZWfKBWxb4F5gSBAoCCAEYAxIEEMCaDA==",
    );
    assert.equal(
      Buffer.from(tx.signatures[0]).toString("base64"),
      "PbfITLwD+4l80xuIdBs6qEHyn+Nf7Y5dpAb/JQeORJdAxNeu+UVnwCBKWKgC3E4572mNgMz0M417Kzy/kZKHRA==",
    );

    const originalFetch = globalThis.fetch;
    const calls = [];
    let broadcastedTx;
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(init.body);
      calls.push(request.method);

      if (request.method === "status") {
        return rpcResponse({ node_info: { network: "xarchain-test" } });
      }
      if (request.method === "abci_query") {
        return rpcResponse({
          response: { value: queryAccountResponseBase64(7, 3) },
        });
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
                events: [],
                gas_used: "11",
                gas_wanted: "200000",
                log: "",
              },
            },
          ],
        });
      }

      throw new Error(`unexpected RPC method: ${request.method}`);
    };

    try {
      const broadcastClient = await caCommon.createCosmosClient(
        wallet,
        "http://localhost:26657",
        { broadcastPollIntervalMs: 0, broadcastTimeoutMs: 100 },
      );
      const result = await broadcastClient.signAndBroadcast(
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
        { amount: [], gas: "200000" },
        "memo",
      );

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
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    Module._load = originalLoad;
  }
});

function rpcResponse(result) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
  };
}

function queryAccountResponseBase64(accountNumber, sequence) {
  const baseAccount = new BinaryWriter()
    .uint32(24)
    .uint64(accountNumber)
    .uint32(32)
    .uint64(sequence)
    .finish();

  const response = new BinaryWriter();
  encodeAny(BASE_ACCOUNT_TYPE_URL, baseAccount, response.uint32(10).fork()).join();
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
