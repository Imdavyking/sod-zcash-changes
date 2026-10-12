import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MIN_CONFIRMATIONS } from "../core/policy.js";
import type { ChainNote, ChainTip, ChainView, SpendPlan } from "../core/types.js";
import type { EscrowAddresses } from "../coordinator/coordinator.js";
import { collectQuorum, type SpendRequest, type SpendResult, type ThresholdSpender } from "../threshold/spender.js";
import type { SignerNode } from "../signer/signerNode.js";

/**
 * Testnet "single-key" mode: a Zebra node for chain data plus a Zallet (or zcashd-compatible) wallet that
 * holds the escrow key. Method names and result shapes follow the zcashd RPC docs
 * (https://zcash.github.io/rpc/). Zallet is still porting zcashd methods, so if a call is missing on your
 * build, the error names the method. NOT TRUSTLESS: whoever runs this wallet holds the funds. No FROST here.
 */

export class JsonRpc {
  private n = 0;
  constructor(
    private readonly url: string,
    private readonly auth?: { user: string; password: string },
  ) {}

  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.auth) headers.authorization = "Basic " + Buffer.from(`${this.auth.user}:${this.auth.password}`).toString("base64");
    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "1.0", id: ++this.n, method, params }),
    });
    let body: { result?: T; error?: { code?: number; message?: string } | null } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new Error(`${method}: HTTP ${res.status}, response was not JSON`);
    }
    if (body.error) throw new Error(`${method}: ${body.error.message ?? "RPC error"} (code ${body.error.code})`);
    return body.result as T;
  }
}

interface Spent {
  txid: string;
  height: number;
  time: number;
}

interface LedgerFile {
  spent: Record<string, Spent>;
  addresses: Record<string, string>;
  nextIndex: number;
}

/**
 * Local record of which donation notes the escrow has paid out, and which address each campaign uses.
 * The wallet picks its own notes when it sends, so "which note was spent" is tracked logically here.
 * Notes within one campaign address are interchangeable, so the funds still balance. A note is marked
 * BEFORE the send is queued so a crash or a retry can never pay it twice.
 */
export class Ledger {
  private data: LedgerFile = { spent: {}, addresses: {}, nextIndex: 0 };
  constructor(private readonly path?: string) {
    if (path && existsSync(path)) this.data = JSON.parse(readFileSync(path, "utf8")) as LedgerFile;
  }
  spentOf = (noteId: string): Spent | undefined => this.data.spent[noteId];
  markSpent(ids: string[], s: Spent) {
    for (const id of ids) this.data.spent[id] = s;
    this.save();
  }
  unmark(ids: string[]) {
    for (const id of ids) delete this.data.spent[id];
    this.save();
  }
  addressOf = (campaignId: string): string | undefined => this.data.addresses[campaignId];
  assignIndex(campaignId: string, address: string) {
    this.data.addresses[campaignId] = address;
    this.data.nextIndex++;
    this.save();
  }
  get nextIndex() {
    return this.data.nextIndex;
  }
  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
}

/** One Orchard-only unified address per campaign, from `z_getaddressforaccount`. */
export class RpcEscrowAddresses implements EscrowAddresses {
  constructor(
    private readonly wallet: JsonRpc,
    private readonly ledger: Ledger,
    private readonly account: number,
  ) {}

  async addressFor(campaignId: string): Promise<string> {
    const known = this.ledger.addressOf(campaignId);
    if (known) return known;
    const r = await this.wallet.call<{ address: string }>("z_getaddressforaccount", [
      this.account,
      ["orchard"],
      this.ledger.nextIndex,
    ]);
    this.ledger.assignIndex(campaignId, r.address);
    return r.address;
  }
}

interface Received {
  txid: string;
  pool: string;
  amountZat: number;
  memoStr?: string;
  blockheight: number;
  blocktime: number;
  outindex?: number;
  change?: boolean;
}

export class ZcashRpcChain implements ChainView {
  constructor(
    private readonly node: JsonRpc,
    private readonly wallet: JsonRpc,
    readonly ledger: Ledger,
  ) {}

  async tip(): Promise<ChainTip> {
    const info = await this.node.call<{ blocks: number; bestblockhash: string }>("getblockchaininfo");
    const block = await this.node.call<{ time: number }>("getblock", [info.bestblockhash, 1]);
    return { height: info.blocks, time: block.time };
  }

  async notes(campaignId: string): Promise<ChainNote[]> {
    const address = this.ledger.addressOf(campaignId);
    if (!address) return [];
    const rows = await this.wallet.call<Received[]>("z_listreceivedbyaddress", [address, 1]);
    return rows
      .filter((r) => r.pool === "orchard" && !r.change)
      .map((r) => {
        const id = `${r.txid}:${r.outindex ?? 0}`;
        return {
          id,
          campaignId,
          valueZat: BigInt(r.amountZat),
          // Text memos are zero-padded to 512 bytes; keep only the text.
          memo: r.memoStr ? r.memoStr.replace(/\0+$/, "") || null : null,
          minedHeight: r.blockheight,
          minedTime: r.blocktime,
          spent: this.ledger.spentOf(id),
        };
      });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pays approved plans from the escrow wallet with `z_sendmany`. Signers still re-derive every plan
 * (threshold 1 here), so the rules are enforced, but there is one key and one operator.
 */
export class WalletRpcSpender implements ThresholdSpender {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly signers: SignerNode[],
    private readonly threshold: number,
    private readonly chain: ZcashRpcChain,
    private readonly wallet: JsonRpc,
    private readonly opts: { privacyPolicy?: string; pollMs?: number; timeoutMs?: number } = {},
  ) {}

  /** Spends run one at a time, so two requests can't both be approved against the same notes. */
  spend(r: SpendRequest): Promise<SpendResult> {
    const run = this.queue.then(() => this.doSpend(r));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async doSpend(r: SpendRequest): Promise<SpendResult> {
    const q = await collectQuorum(this.signers, this.threshold, r);
    if (!q.ok) return q;
    const plan = q.plan;
    const from = this.chain.ledger.addressOf(plan.campaignId);
    if (!from) return { ok: false, reason: "UnknownCampaign" };
    const out = plan.outputs[0]!;

    const tip = await this.chain.tip();
    this.chain.ledger.markSpent(plan.inputs, { txid: "pending", height: tip.height, time: tip.time });

    let opid: string;
    try {
      opid = await this.wallet.call<string>("z_sendmany", [
        from,
        [{ address: out.address, amount: zatToNumber(out.valueZat) }],
        MIN_CONFIRMATIONS,
        null, // let the wallet apply the ZIP-317 conventional fee
        this.opts.privacyPolicy ?? "AllowRevealedAmounts",
      ]);
    } catch (e) {
      this.chain.ledger.unmark(plan.inputs);
      throw e;
    }

    const txid = await this.waitForOperation(opid, plan);
    return { ok: true, txid, plan };
  }

  private async waitForOperation(opid: string, plan: SpendPlan): Promise<string> {
    const deadline = Date.now() + (this.opts.timeoutMs ?? 180_000);
    while (Date.now() < deadline) {
      const [op] = await this.wallet.call<
        { status: string; result?: { txid: string }; error?: { message: string } }[]
      >("z_getoperationstatus", [[opid]]);
      if (op?.status === "success" && op.result?.txid) {
        const tip = await this.chain.tip();
        this.chain.ledger.markSpent(plan.inputs, { txid: op.result.txid, height: tip.height, time: tip.time });
        await this.wallet.call("z_getoperationresult", [[opid]]).catch(() => undefined);
        return op.result.txid;
      }
      if (op?.status === "failed") {
        this.chain.ledger.unmark(plan.inputs);
        await this.wallet.call("z_getoperationresult", [[opid]]).catch(() => undefined);
        throw new Error(`Wallet could not send: ${op.error?.message ?? "unknown error"}`);
      }
      await sleep(this.opts.pollMs ?? 2000);
    }
    // Unknown outcome: leave the notes marked so nothing is paid twice, and tell the operator.
    throw new Error(`Spend ${opid} is still pending. Inputs stay reserved; check the wallet before retrying.`);
  }
}

/** zat -> ZEC as a JSON number (8 decimals is exactly representable after rounding). */
function zatToNumber(zat: bigint): number {
  return Number(zat) / 1e8;
}
