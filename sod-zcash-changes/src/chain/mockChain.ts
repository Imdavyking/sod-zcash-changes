import { sha256Hex } from "../core/crypto.js";
import type { ChainNote, ChainTip, ChainView, SpendPlan, Zat } from "../core/types.js";

const BLOCK_SECONDS = 75;

/**
 * In-memory Zcash stand-in for tests and the demo server. Several signers can share one instance
 * (honest, in sync) or each get their own `fork()` to model a lagging or malicious view.
 */
export class MockChain implements ChainView {
  height = 1000;
  time: number;
  private notesByCampaign = new Map<string, ChainNote[]>();
  private txCount = 0;

  constructor(startTime = 1_800_000_000) {
    this.time = startTime;
  }

  async tip(): Promise<ChainTip> {
    return { height: this.height, time: this.time };
  }

  async notes(campaignId: string): Promise<ChainNote[]> {
    return (this.notesByCampaign.get(campaignId) ?? []).map((n) => ({ ...n, spent: n.spent && { ...n.spent } }));
  }

  /** Mine `n` blocks, each ~75 s apart. */
  mine(n = 1) {
    this.height += n;
    this.time += n * BLOCK_SECONDS;
  }

  /** Jump forward in time (mining the blocks that implies). */
  advance(seconds: number) {
    this.mine(Math.max(1, Math.ceil(seconds / BLOCK_SECONDS)));
  }

  advanceTo(unix: number) {
    if (unix > this.time) this.advance(unix - this.time);
  }

  /** A donor's shielded payment arrives in a new block. Returns the note id. */
  donate(campaignId: string, valueZat: Zat, memo: string | null): string {
    this.mine(1);
    const id = `${sha256Hex(`tx${this.txCount++}`)}:0`;
    const list = this.notesByCampaign.get(campaignId) ?? [];
    list.push({ id, campaignId, valueZat, memo, minedHeight: this.height, minedTime: this.time });
    this.notesByCampaign.set(campaignId, list);
    return id;
  }

  /** Applies a signed spend: marks the input notes spent. Throws on double spend, like the network would. */
  applySpend(plan: SpendPlan): string {
    const list = this.notesByCampaign.get(plan.campaignId) ?? [];
    const txid = sha256Hex(`spend${this.txCount++}${plan.inputs.join(",")}`);
    this.mine(1);
    for (const id of plan.inputs) {
      const n = list.find((x) => x.id === id);
      if (!n) throw new Error(`unknown note ${id}`);
      if (n.spent) throw new Error(`double spend of ${id}`);
    }
    for (const id of plan.inputs) {
      const n = list.find((x) => x.id === id)!;
      n.spent = { txid, height: this.height, time: this.time };
    }
    return txid;
  }

  /** A copy that shares notes at this moment but moves independently afterwards. */
  fork(): MockChain {
    const f = new MockChain(this.time);
    f.height = this.height;
    f.txCount = this.txCount;
    for (const [k, v] of this.notesByCampaign) f.notesByCampaign.set(k, v.map((n) => ({ ...n })));
    return f;
  }
}
