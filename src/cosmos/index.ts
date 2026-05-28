import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { secp256k1 } from "@noble/curves/secp256k1";
import { ripemd160 } from "@noble/hashes/legacy";
import { sha256 } from "@noble/hashes/sha2";
import { bech32 } from "@scure/base";

import {
  MsgCreateRequestForFunds,
  MsgCreateRequestForFundsResponse,
  MsgCreateSolverData,
  MsgCreateSolverDataResponse,
  MsgDoubleCheckTx,
  MsgRefundReq,
  MsgRefundReqResponse,
  MsgUpdateSolverData,
  MsgUpdateSolverDataResponse,
} from "../proto/definition";
import { Bytes } from "../types";

type MessageCodec = {
  encode(message: unknown, writer?: BinaryWriter): BinaryWriter;
  decode?(input: BinaryReader | Uint8Array, length?: number): unknown;
  create?(base?: unknown): unknown;
  fromPartial?(object: unknown): unknown;
};

export type AccountData = {
  readonly address: string;
  readonly algo: "secp256k1";
  readonly pubkey: Uint8Array;
};

export type Coin = {
  readonly denom: string;
  readonly amount: string;
};

export type StdFee = {
  readonly amount: readonly Coin[];
  readonly gas: string;
  readonly granter?: string;
  readonly payer?: string;
};

export type EncodeObject<T = unknown> = {
  readonly typeUrl: string;
  readonly value: T;
};

export type DirectSignDoc = {
  readonly bodyBytes: Uint8Array;
  readonly authInfoBytes: Uint8Array;
  readonly chainId: string;
  readonly accountNumber: bigint;
};

export type StdSignature = {
  readonly pub_key: {
    readonly type: "tendermint/PubKeySecp256k1";
    readonly value: string;
  };
  readonly signature: string;
};

export type DirectSignResponse = {
  readonly signed: DirectSignDoc;
  readonly signature: StdSignature;
};

export type OfflineDirectSigner = {
  getAccounts(): Promise<readonly AccountData[]>;
  signDirect(address: string, signDoc: DirectSignDoc): Promise<DirectSignResponse>;
};

export type HttpEndpoint = {
  readonly url: string;
  readonly headers?: Record<string, string>;
};

export type SigningStargateClientOptions = {
  readonly registry?: CosmosRegistry;
  readonly broadcastTimeoutMs?: number;
  readonly broadcastPollIntervalMs?: number;
};

export type Any = {
  readonly typeUrl: string;
  readonly value: Uint8Array;
};

export type DeliverTxResponse = {
  readonly code: number;
  readonly height: number;
  readonly txIndex: number;
  readonly events: readonly TendermintEvent[];
  readonly rawLog: string;
  readonly transactionHash: string;
  readonly msgResponses: readonly Any[];
  readonly gasUsed: bigint;
  readonly gasWanted: bigint;
};

export type IndexedTx = Omit<DeliverTxResponse, "transactionHash"> & {
  readonly hash: string;
  readonly tx: Uint8Array;
};

export type TendermintEvent = {
  readonly type: string;
  readonly attributes: readonly {
    readonly key: string;
    readonly value: string;
  }[];
};

type TxBodyValue = {
  readonly messages: readonly EncodeObject[];
  readonly memo?: string;
  readonly timeoutHeight?: bigint | number | string;
};

type AuthInfoValue = {
  readonly signerInfos: readonly SignerInfoValue[];
  readonly fee?: FeeValue;
};

type SignerInfoValue = {
  readonly publicKey?: Any;
  readonly modeInfo?: ModeInfoValue;
  readonly sequence: bigint | number | string;
};

type ModeInfoValue = {
  readonly single?: {
    readonly mode: number;
  };
};

type FeeValue = {
  readonly amount: readonly Coin[];
  readonly gasLimit: bigint | number | string;
  readonly payer?: string;
  readonly granter?: string;
};

type TxRawValue = {
  readonly bodyBytes: Uint8Array;
  readonly authInfoBytes: Uint8Array;
  readonly signatures: readonly Uint8Array[];
};

type Account = {
  readonly accountNumber: number;
  readonly sequence: number;
};

type RpcEndpoint = {
  readonly url: string;
  readonly headers?: Record<string, string>;
};

const SIGN_MODE_DIRECT = 1;
const SECP256K1_PUBKEY_TYPE_URL = "/cosmos.crypto.secp256k1.PubKey";
const TX_BODY_TYPE_URL = "/cosmos.tx.v1beta1.TxBody";
const BASE_ACCOUNT_TYPE_URL = "/cosmos.auth.v1beta1.BaseAccount";
const ACCOUNT_QUERY_PATH = "/cosmos.auth.v1beta1.Query/Account";

export class TimeoutError extends Error {
  constructor(message: string, readonly txId: string) {
    super(message);
  }
}

export class BroadcastTxError extends Error {
  constructor(
    readonly code: number,
    readonly codespace: string,
    readonly log: string,
  ) {
    super(
      `Broadcasting transaction failed with code ${code} (codespace: ${codespace}). Log: ${log}`,
    );
  }
}

export function isDeliverTxFailure(result: Pick<DeliverTxResponse, "code">): boolean {
  return !!result.code;
}

export function isDeliverTxSuccess(result: Pick<DeliverTxResponse, "code">): boolean {
  return !isDeliverTxFailure(result);
}

export function assertIsDeliverTxSuccess(result: DeliverTxResponse): void {
  if (isDeliverTxFailure(result)) {
    throw new Error(
      `Error when broadcasting tx ${result.transactionHash} at height ${result.height}. Code: ${result.code}; Raw log: ${result.rawLog}`,
    );
  }
}

export function assertIsDeliverTxFailure(result: DeliverTxResponse): void {
  if (isDeliverTxSuccess(result)) {
    throw new Error(
      `Transaction ${result.transactionHash} did not fail at height ${result.height}. Code: ${result.code}; Raw log: ${result.rawLog}`,
    );
  }
}

class CosmosAny {
  static encode(message: Any, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.typeUrl !== "") {
      writer.uint32(10).string(message.typeUrl);
    }
    if (message.value.length !== 0) {
      writer.uint32(18).bytes(message.value);
    }
    return writer;
  }

  static decode(input: BinaryReader | Uint8Array, length?: number): Any {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    let typeUrl = "";
    let value: Uint8Array = new Uint8Array();

    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          typeUrl = reader.string();
          break;
        case 2:
          value = reader.bytes();
          break;
        default:
          reader.skip(tag & 7);
          break;
      }
    }

    return { typeUrl, value };
  }
}

class PubKey {
  static encode(
    message: { readonly key: Uint8Array },
    writer: BinaryWriter = new BinaryWriter(),
  ): BinaryWriter {
    if (message.key.length !== 0) {
      writer.uint32(10).bytes(message.key);
    }
    return writer;
  }
}

class TxBody {
  static encode(
    message: TxBodyValue,
    registry: CosmosRegistry,
    writer: BinaryWriter = new BinaryWriter(),
  ): BinaryWriter {
    for (const msg of message.messages) {
      CosmosAny.encode(registry.encodeAsAny(msg), writer.uint32(10).fork()).join();
    }
    if (message.memo) {
      writer.uint32(18).string(message.memo);
    }
    if (message.timeoutHeight !== undefined && BigInt(message.timeoutHeight) !== 0n) {
      writer.uint32(24).uint64(message.timeoutHeight);
    }
    return writer;
  }
}

class CoinMessage {
  static encode(message: Coin, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.denom !== "") {
      writer.uint32(10).string(message.denom);
    }
    if (message.amount !== "") {
      writer.uint32(18).string(message.amount);
    }
    return writer;
  }
}

class ModeInfo {
  static encode(message: ModeInfoValue, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.single) {
      ModeInfoSingle.encode(message.single, writer.uint32(10).fork()).join();
    }
    return writer;
  }
}

class ModeInfoSingle {
  static encode(
    message: { readonly mode: number },
    writer: BinaryWriter = new BinaryWriter(),
  ): BinaryWriter {
    if (message.mode !== 0) {
      writer.uint32(8).int32(message.mode);
    }
    return writer;
  }
}

class SignerInfo {
  static encode(
    message: SignerInfoValue,
    writer: BinaryWriter = new BinaryWriter(),
  ): BinaryWriter {
    if (message.publicKey) {
      CosmosAny.encode(message.publicKey, writer.uint32(10).fork()).join();
    }
    if (message.modeInfo) {
      ModeInfo.encode(message.modeInfo, writer.uint32(18).fork()).join();
    }
    if (BigInt(message.sequence) !== 0n) {
      writer.uint32(24).uint64(message.sequence);
    }
    return writer;
  }
}

class Fee {
  static encode(message: FeeValue, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    for (const amount of message.amount) {
      CoinMessage.encode(amount, writer.uint32(10).fork()).join();
    }
    if (BigInt(message.gasLimit) !== 0n) {
      writer.uint32(16).uint64(message.gasLimit);
    }
    if (message.payer) {
      writer.uint32(26).string(message.payer);
    }
    if (message.granter) {
      writer.uint32(34).string(message.granter);
    }
    return writer;
  }
}

class AuthInfo {
  static encode(message: AuthInfoValue, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    for (const signerInfo of message.signerInfos) {
      SignerInfo.encode(signerInfo, writer.uint32(10).fork()).join();
    }
    if (message.fee) {
      Fee.encode(message.fee, writer.uint32(18).fork()).join();
    }
    return writer;
  }
}

class SignDoc {
  static encode(message: DirectSignDoc, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.bodyBytes.length !== 0) {
      writer.uint32(10).bytes(message.bodyBytes);
    }
    if (message.authInfoBytes.length !== 0) {
      writer.uint32(18).bytes(message.authInfoBytes);
    }
    if (message.chainId !== "") {
      writer.uint32(26).string(message.chainId);
    }
    if (message.accountNumber !== 0n) {
      writer.uint32(32).uint64(message.accountNumber);
    }
    return writer;
  }
}

class TxRaw {
  static encode(message: TxRawValue, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.bodyBytes.length !== 0) {
      writer.uint32(10).bytes(message.bodyBytes);
    }
    if (message.authInfoBytes.length !== 0) {
      writer.uint32(18).bytes(message.authInfoBytes);
    }
    for (const signature of message.signatures) {
      writer.uint32(26).bytes(signature);
    }
    return writer;
  }
}

class QueryAccountRequest {
  static encode(
    message: { readonly address: string },
    writer: BinaryWriter = new BinaryWriter(),
  ): BinaryWriter {
    if (message.address !== "") {
      writer.uint32(10).string(message.address);
    }
    return writer;
  }
}

class QueryAccountResponse {
  static decode(input: BinaryReader | Uint8Array, length?: number): { account?: Any } {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    let account: Any | undefined;

    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          account = CosmosAny.decode(reader, reader.uint32());
          break;
        default:
          reader.skip(tag & 7);
          break;
      }
    }

    return { account };
  }
}

class BaseAccount {
  static decode(input: BinaryReader | Uint8Array, length?: number): Account {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    let accountNumber = 0;
    let sequence = 0;

    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 3:
          accountNumber = uint64ToNumber(reader.uint64(), "accountNumber");
          break;
        case 4:
          sequence = uint64ToNumber(reader.uint64(), "sequence");
          break;
        default:
          reader.skip(tag & 7);
          break;
      }
    }

    return { accountNumber, sequence };
  }
}

class TxMsgData {
  static decode(input: BinaryReader | Uint8Array, length?: number): { msgResponses: Any[] } {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const msgResponses: Any[] = [];

    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 2:
          msgResponses.push(CosmosAny.decode(reader, reader.uint32()));
          break;
        default:
          reader.skip(tag & 7);
          break;
      }
    }

    return { msgResponses };
  }
}

export class CosmosRegistry {
  readonly #types = new Map<string, MessageCodec>();

  constructor(customTypes: readonly (readonly [string, MessageCodec])[] = []) {
    for (const [typeUrl, type] of customTypes) {
      this.register(typeUrl, type);
    }
  }

  register(typeUrl: string, type: MessageCodec): void {
    this.#types.set(typeUrl, type);
  }

  lookupType(typeUrl: string): MessageCodec | undefined {
    return this.#types.get(typeUrl);
  }

  encode(encodeObject: EncodeObject): Uint8Array {
    if (encodeObject.typeUrl === TX_BODY_TYPE_URL) {
      return TxBody.encode(encodeObject.value as TxBodyValue, this).finish();
    }

    const type = this.lookupType(encodeObject.typeUrl);
    if (!type) {
      throw new Error(`Unregistered type url: ${encodeObject.typeUrl}`);
    }

    const value = type.fromPartial
      ? type.fromPartial(encodeObject.value)
      : type.create
        ? type.create(encodeObject.value)
        : encodeObject.value;

    return type.encode(value).finish();
  }

  encodeAsAny(encodeObject: EncodeObject): Any {
    return {
      typeUrl: encodeObject.typeUrl,
      value: this.encode(encodeObject),
    };
  }

  decode({ typeUrl, value }: Any): unknown {
    const type = this.lookupType(typeUrl);
    if (!type?.decode) {
      throw new Error(`Unregistered type url: ${typeUrl}`);
    }
    return type.decode(value);
  }
}

export const Registry = new CosmosRegistry([
  ["/xarchain.chainabstraction.MsgCreateSolverData", MsgCreateSolverData],
  ["/xarchain.chainabstraction.MsgCreateSolverDataResponse", MsgCreateSolverDataResponse],
  ["/xarchain.chainabstraction.MsgUpdateSolverData", MsgUpdateSolverData],
  ["/xarchain.chainabstraction.MsgUpdateSolverDataResponse", MsgUpdateSolverDataResponse],
  ["/xarchain.chainabstraction.MsgCreateRequestForFunds", MsgCreateRequestForFunds],
  [
    "/xarchain.chainabstraction.MsgCreateRequestForFundsResponse",
    MsgCreateRequestForFundsResponse,
  ],
  ["/xarchain.chainabstraction.MsgRefundReq", MsgRefundReq],
  ["/xarchain.chainabstraction.MsgRefundReqResponse", MsgRefundReqResponse],
  ["/xarchain.chainabstraction.MsgDoubleCheckTx", MsgDoubleCheckTx],
]);

export class DirectSecp256k1Wallet implements OfflineDirectSigner {
  static async fromKey(
    privkey: Uint8Array,
    prefix = "cosmos",
  ): Promise<DirectSecp256k1Wallet> {
    return new DirectSecp256k1Wallet(privkey, secp256k1.getPublicKey(privkey, true), prefix);
  }

  private constructor(
    private readonly privkey: Uint8Array,
    private readonly pubkey: Uint8Array,
    private readonly prefix: string,
  ) {}

  get address(): string {
    const rawAddress = ripemd160(sha256(this.pubkey));
    return bech32.encode(this.prefix, bech32.toWords(rawAddress));
  }

  async getAccounts(): Promise<readonly AccountData[]> {
    return [
      {
        algo: "secp256k1",
        address: this.address,
        pubkey: this.pubkey,
      },
    ];
  }

  async signDirect(address: string, signDoc: DirectSignDoc): Promise<DirectSignResponse> {
    if (address !== this.address) {
      throw new Error(`Address ${address} not found in wallet`);
    }

    const hashedMessage = sha256(SignDoc.encode(signDoc).finish());
    const signature = secp256k1.sign(hashedMessage, this.privkey, { lowS: true });

    return {
      signed: signDoc,
      signature: {
        pub_key: {
          type: "tendermint/PubKeySecp256k1",
          value: bytesToBase64(this.pubkey),
        },
        signature: bytesToBase64(
          concatBytes(bigintToBytes(signature.r, 32), bigintToBytes(signature.s, 32)),
        ),
      },
    };
  }
}

export class SigningStargateClient {
  readonly #endpoint: RpcEndpoint;
  readonly #registry: CosmosRegistry;
  readonly #signer: OfflineDirectSigner;
  readonly #broadcastTimeoutMs?: number;
  readonly #broadcastPollIntervalMs?: number;
  #chainId?: string;

  static async connectWithSigner(
    endpoint: string | HttpEndpoint,
    signer: OfflineDirectSigner,
    options: SigningStargateClientOptions = {},
  ): Promise<SigningStargateClient> {
    return new SigningStargateClient(endpoint, signer, options);
  }

  private constructor(
    endpoint: string | HttpEndpoint,
    signer: OfflineDirectSigner,
    options: SigningStargateClientOptions,
  ) {
    this.#endpoint = normalizeEndpoint(endpoint);
    this.#signer = signer;
    this.#registry = options.registry ?? Registry;
    this.#broadcastTimeoutMs = options.broadcastTimeoutMs;
    this.#broadcastPollIntervalMs = options.broadcastPollIntervalMs;
  }

  disconnect(): void {
    // HTTP JSON-RPC has no persistent connection to close.
  }

  async getChainId(): Promise<string> {
    if (this.#chainId) {
      return this.#chainId;
    }

    const status = await this.#rpc<{ node_info?: { network?: string }; nodeInfo?: { network?: string } }>(
      "status",
    );
    const chainId = status.node_info?.network ?? status.nodeInfo?.network;
    if (!chainId) {
      throw new Error("Chain ID must not be empty");
    }
    this.#chainId = chainId;
    return chainId;
  }

  async getSequence(address: string): Promise<Account> {
    const account = await this.#getAccount(address);
    if (!account) {
      throw new Error(
        `Account '${address}' does not exist on chain. Send some tokens there before trying to query sequence.`,
      );
    }
    return account;
  }

  async signAndBroadcast(
    signerAddress: string,
    messages: readonly EncodeObject[],
    fee: StdFee,
    memo = "",
    timeoutHeight?: bigint | number | string,
  ): Promise<DeliverTxResponse> {
    const txRaw = await this.sign(signerAddress, messages, fee, memo, undefined, timeoutHeight);
    const txBytes = TxRaw.encode(txRaw).finish();
    return this.broadcastTx(txBytes, this.#broadcastTimeoutMs, this.#broadcastPollIntervalMs);
  }

  async sign(
    signerAddress: string,
    messages: readonly EncodeObject[],
    fee: StdFee,
    memo: string,
    explicitSignerData?: { readonly accountNumber: number; readonly sequence: number; readonly chainId: string },
    timeoutHeight?: bigint | number | string,
  ): Promise<TxRawValue> {
    const signerData =
      explicitSignerData ??
      ({
        ...(await this.getSequence(signerAddress)),
        chainId: await this.getChainId(),
      } as const);

    return this.#signDirect(signerAddress, messages, fee, memo, signerData, timeoutHeight);
  }

  async broadcastTx(
    tx: Uint8Array,
    timeoutMs = 60_000,
    pollIntervalMs = 3_000,
  ): Promise<DeliverTxResponse> {
    const transactionHash = await this.broadcastTxSync(tx);
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      await sleep(pollIntervalMs);
      const result = await this.getTx(transactionHash);
      if (result) {
        return {
          code: result.code,
          height: result.height,
          txIndex: result.txIndex,
          events: result.events,
          rawLog: result.rawLog,
          transactionHash,
          msgResponses: result.msgResponses,
          gasUsed: result.gasUsed,
          gasWanted: result.gasWanted,
        };
      }
    }

    throw new TimeoutError(
      `Transaction with ID ${transactionHash} was submitted but was not yet found on the chain. You might want to check later. There was a wait of ${
        timeoutMs / 1000
      } seconds.`,
      transactionHash,
    );
  }

  async broadcastTxSync(tx: Uint8Array): Promise<string> {
    const result = await this.#rpc<{
      code?: number;
      codespace?: string;
      log?: string;
      hash: string;
    }>("broadcast_tx_sync", { tx: bytesToBase64(tx) });

    if (result.code) {
      throw new BroadcastTxError(result.code, result.codespace ?? "", result.log ?? "");
    }

    return result.hash.toUpperCase();
  }

  async getTx(id: string): Promise<IndexedTx | null> {
    const result = await this.#rpc<{ txs?: readonly RpcTx[] }>("tx_search", {
      query: `tx.hash='${id}'`,
      prove: false,
      page: "1",
      per_page: "100",
    });
    const tx = result.txs?.[0];
    return tx ? decodeRpcTx(tx) : null;
  }

  async #signDirect(
    signerAddress: string,
    messages: readonly EncodeObject[],
    fee: StdFee,
    memo: string,
    signerData: { readonly accountNumber: number; readonly sequence: number; readonly chainId: string },
    timeoutHeight?: bigint | number | string,
  ): Promise<TxRawValue> {
    const account = (await this.#signer.getAccounts()).find(({ address }) => address === signerAddress);
    if (!account) {
      throw new Error("Failed to retrieve account from signer");
    }

    const bodyBytes = TxBody.encode(
      {
        messages,
        memo,
        timeoutHeight,
      },
      this.#registry,
    ).finish();
    const authInfoBytes = AuthInfo.encode({
      signerInfos: [
        {
          publicKey: encodePubkey(account.pubkey),
          modeInfo: { single: { mode: SIGN_MODE_DIRECT } },
          sequence: signerData.sequence,
        },
      ],
      fee: {
        amount: fee.amount,
        gasLimit: fee.gas,
        granter: fee.granter,
        payer: fee.payer,
      },
    }).finish();
    const { signature, signed } = await this.#signer.signDirect(signerAddress, {
      bodyBytes,
      authInfoBytes,
      chainId: signerData.chainId,
      accountNumber: BigInt(signerData.accountNumber),
    });

    return {
      bodyBytes: signed.bodyBytes,
      authInfoBytes: signed.authInfoBytes,
      signatures: [base64ToBytes(signature.signature)],
    };
  }

  async #getAccount(address: string): Promise<Account | null> {
    const query = QueryAccountRequest.encode({ address }).finish();
    const result = await this.#rpc<{
      response?: {
        code?: number;
        log?: string;
        value?: string;
      };
    }>("abci_query", {
      path: ACCOUNT_QUERY_PATH,
      data: bytesToHex(query),
      prove: false,
    });
    const response = result.response;

    if (!response) {
      return null;
    }
    if (response.code) {
      throw new Error(response.log ?? `Account query failed with code ${response.code}`);
    }
    if (!response.value) {
      return null;
    }

    const account = QueryAccountResponse.decode(base64ToBytes(response.value)).account;
    if (!account) {
      return null;
    }
    if (account.typeUrl !== BASE_ACCOUNT_TYPE_URL) {
      throw new Error(`Unsupported account type: '${account.typeUrl}'`);
    }

    return BaseAccount.decode(account.value);
  }

  async #rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.#endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.#endpoint.headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`Cosmos RPC ${method} failed with HTTP ${response.status}`);
    }

    const json = (await response.json()) as {
      result?: T;
      error?: unknown;
    };
    if (json.error) {
      throw new Error(JSON.stringify(json.error));
    }
    if (json.result === undefined) {
      throw new Error(`Cosmos RPC ${method} returned no result`);
    }

    return json.result;
  }
}

export function createCosmosWallet(
  privateKey: string | Bytes,
): Promise<DirectSecp256k1Wallet> {
  const pkBytes: Uint8Array = typeof privateKey === "string" ? hexToBytes(privateKey) : privateKey;
  return DirectSecp256k1Wallet.fromKey(pkBytes, "arcana");
}

export function createCosmosClient(
  signer: OfflineDirectSigner,
  endpoint: string | HttpEndpoint,
  options?: SigningStargateClientOptions,
): Promise<SigningStargateClient> {
  return SigningStargateClient.connectWithSigner(endpoint, signer, options);
}

function encodePubkey(pubkey: Uint8Array): Any {
  return {
    typeUrl: SECP256K1_PUBKEY_TYPE_URL,
    value: PubKey.encode({ key: pubkey }).finish(),
  };
}

function normalizeEndpoint(endpoint: string | HttpEndpoint): RpcEndpoint {
  const normalized = typeof endpoint === "string" ? { url: endpoint } : endpoint;
  if (!normalized.url.startsWith("http://") && !normalized.url.startsWith("https://")) {
    throw new Error("Only HTTP(S) Cosmos RPC endpoints are supported");
  }
  return normalized;
}

function decodeRpcTx(tx: RpcTx): IndexedTx {
  const result = tx.tx_result;
  const txMsgData = result.data ? TxMsgData.decode(base64ToBytes(result.data)) : { msgResponses: [] };

  return {
    code: Number(result.code ?? 0),
    height: Number(tx.height),
    txIndex: Number(tx.index),
    events: decodeEvents(result.events ?? []),
    rawLog: result.log ?? "",
    hash: tx.hash.toUpperCase(),
    tx: base64ToBytes(tx.tx),
    msgResponses: txMsgData.msgResponses,
    gasUsed: BigInt(result.gas_used ?? "0"),
    gasWanted: BigInt(result.gas_wanted ?? "0"),
  };
}

type RpcTx = {
  readonly hash: string;
  readonly height: string | number;
  readonly index: string | number;
  readonly tx: string;
  readonly tx_result: {
    readonly code?: string | number;
    readonly data?: string;
    readonly events?: readonly {
      readonly type: string;
      readonly attributes?: readonly {
        readonly key: string;
        readonly value?: string;
      }[];
    }[];
    readonly log?: string;
    readonly gas_used?: string | number;
    readonly gas_wanted?: string | number;
  };
};

function decodeEvents(events: RpcTx["tx_result"]["events"]): readonly TendermintEvent[] {
  return (events ?? []).map((event) => ({
    type: event.type,
    attributes: (event.attributes ?? []).map((attribute) => ({
      key: base64ToUtf8(attribute.key),
      value: attribute.value ? base64ToUtf8(attribute.value) : "",
    })),
  }));
}

function uint64ToNumber(value: bigint | string, field: string): number {
  const bigintValue = BigInt(value.toString());
  if (bigintValue > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${field} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(bigintValue);
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) {
    throw new Error("Hex string must have an even length");
  }
  if (!/^[\da-f]*$/i.test(normalized)) {
    throw new Error("Invalid hex string");
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bigintToBytes(value: bigint, length: number): Uint8Array {
  return hexToBytes(value.toString(16).padStart(length * 2, "0"));
}

function concatBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64ToUtf8(base64: string): string {
  try {
    return new TextDecoder().decode(base64ToBytes(base64));
  } catch {
    return base64;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
