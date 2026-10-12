import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { campaignId, diversifierIndex, sha256Hex } from "../core/crypto.js";
import { validateCampaign } from "../core/limits.js";
import { campaignState, donationStatus, type CampaignStatus, type DonationStatus } from "../core/policy.js";
import type { CampaignRecord, ChainView, RefundRequest, RejectReason, WithdrawRequest } from "../core/types.js";
import type { SignerNode } from "../signer/signerNode.js";
import type { ThresholdSpender } from "../threshold/spender.js";

/** Gives each campaign its own escrow receiving address (a diversified address of the escrow key). */
export interface EscrowAddresses {
  addressFor(campaignId: string): string | Promise<string>;
}

export class MockEscrowAddresses implements EscrowAddresses {
  addressFor(id: string) {
    const div = diversifierIndex(id);
    return "utest1" + sha256Hex(`mock-escrow:${div}`).slice(0, 40) + sha256Hex(div).slice(0, 20);
  }
}

export interface CampaignView {
  id: string;
  name: string;
  description: string;
  imageURI: string;
  goalZat: string;
  deadline: number;
  creatorAddress: string;
  escrowAddress: string;
  status: CampaignStatus;
  donationCount: number;
  /** null while hidden (see `revealTotals`). */
  totalZat: string | null;
}

export type Outcome = { ok: true; txid: string; payoutZat: string } | { ok: false; reason: RejectReason | "NoQuorum" };

export interface CoordinatorOptions {
  chain: ChainView;
  signers: SignerNode[];
  spender: ThresholdSpender;
  escrow: EscrowAddresses;
  /** "after-deadline" (default) keeps the running total private while a campaign is active. */
  revealTotals?: "live" | "after-deadline";
  dataDir?: string;
}

interface StoredCampaign extends Omit<CampaignRecord, "goalZat"> {
  goalZat: string;
}

/**
 * Untrusted-by-design front desk: registers campaigns, serves views, relays refund and withdraw requests.
 * It holds no key material. Every rule is re-checked by the signers.
 */
export class Coordinator {
  private campaigns = new Map<string, CampaignRecord>();
  private readonly revealTotals: "live" | "after-deadline";

  constructor(private readonly o: CoordinatorOptions) {
    this.revealTotals = o.revealTotals ?? "after-deadline";
  }

  /** Reload persisted campaigns and re-register them with every signer. */
  async init() {
    const f = this.file();
    if (!f || !existsSync(f)) return;
    const rows = JSON.parse(readFileSync(f, "utf8")) as StoredCampaign[];
    for (const r of rows) {
      const rec: CampaignRecord = { ...r, goalZat: BigInt(r.goalZat) };
      this.campaigns.set(campaignId(rec), rec);
      await Promise.all(this.o.signers.map((s) => s.registerCampaign(rec, { replay: true })));
    }
  }

  async createCampaign(rec: CampaignRecord): Promise<{ ok: true; view: CampaignView } | { ok: false; error: string }> {
    const tip = await this.o.chain.tip();
    const err = validateCampaign(rec, tip.time);
    if (err) return { ok: false, error: err };

    const id = campaignId(rec);
    if (!this.campaigns.has(id)) {
      // Every signer must independently accept the record before the escrow address is handed out.
      const results = await Promise.all(this.o.signers.map((s) => s.registerCampaign(rec)));
      const good = results.filter((r) => r.ok && r.id === id).length;
      if (good < this.o.signers.length) return { ok: false, error: "Signers did not all accept the campaign." };
      this.campaigns.set(id, rec);
      this.persist();
    }
    return { ok: true, view: await this.view(id) };
  }

  async list(): Promise<CampaignView[]> {
    const ids = [...this.campaigns.keys()];
    const views = await Promise.all(ids.map((id) => this.view(id)));
    return views.sort((a, b) => b.deadline - a.deadline);
  }

  async view(id: string): Promise<CampaignView> {
    const rec = this.campaigns.get(id);
    if (!rec) throw new Error("UnknownCampaign");
    const [tip, notes] = await Promise.all([this.o.chain.tip(), this.o.chain.notes(id)]);
    const st = campaignState(rec, notes, tip);
    const reveal = this.revealTotals === "live" || st.status !== "active";
    return {
      id,
      name: rec.name.trim(),
      description: rec.description.trim(),
      imageURI: rec.imageURI.trim(),
      goalZat: rec.goalZat.toString(),
      deadline: rec.deadline,
      creatorAddress: rec.creatorAddress,
      escrowAddress: await this.o.escrow.addressFor(id),
      status: st.status,
      donationCount: st.donationCount,
      totalZat: reveal ? st.total.toString() : null,
    };
  }

  /** A donor checks their own donation by its commitment. Reveals nothing a donor didn't already put in the memo. */
  async donation(id: string, commitment: string): Promise<DonationStatus | null> {
    const rec = this.campaigns.get(id);
    if (!rec || !/^[0-9a-f]{64}$/.test(commitment)) return null;
    const [tip, notes] = await Promise.all([this.o.chain.tip(), this.o.chain.notes(id)]);
    return donationStatus(rec, notes, tip, commitment);
  }

  has(id: string) {
    return this.campaigns.has(id);
  }

  async refund(req: RefundRequest): Promise<Outcome> {
    if (!this.campaigns.has(req.campaignId)) return { ok: false, reason: "UnknownCampaign" };
    const r = await this.o.spender.spend({ kind: "refund", req });
    return r.ok ? { ok: true, txid: r.txid, payoutZat: r.plan.outputs[0]!.valueZat.toString() } : r;
  }

  async withdraw(req: WithdrawRequest): Promise<Outcome> {
    if (!this.campaigns.has(req.campaignId)) return { ok: false, reason: "UnknownCampaign" };
    const r = await this.o.spender.spend({ kind: "withdraw", req });
    return r.ok ? { ok: true, txid: r.txid, payoutZat: r.plan.outputs[0]!.valueZat.toString() } : r;
  }

  private file() {
    return this.o.dataDir ? join(this.o.dataDir, "campaigns.json") : null;
  }

  private persist() {
    const f = this.file();
    if (!f) return;
    mkdirSync(this.o.dataDir!, { recursive: true });
    const rows: StoredCampaign[] = [...this.campaigns.values()].map((c) => ({ ...c, goalZat: c.goalZat.toString() }));
    writeFileSync(f, JSON.stringify(rows, null, 2));
  }
}
