import { campaignId, sha256Hex } from "../core/crypto.js";
import { validateCampaign } from "../core/limits.js";
import { planHash, planRefund, planWithdraw } from "../core/policy.js";
import type {
  CampaignRecord,
  ChainView,
  Decision,
  RefundRequest,
  RejectReason,
  SpendPlan,
  WithdrawRequest,
} from "../core/types.js";

export type Approval =
  | { ok: true; signer: number; planHash: string; plan: SpendPlan; share: string }
  | { ok: false; signer: number; reason: RejectReason };

/**
 * One member of the FROST escrow group.
 *
 * The rule that makes the escrow trust-minimised: a signer never signs what the coordinator hands it.
 * It reads the chain through its OWN node, re-derives the spend from the campaign rules, and releases
 * a signature share only over that derivation. A coordinator (or t-1 colluding signers) therefore
 * cannot redirect a refund, pay out a failed campaign, or refund after a payout.
 *
 * `share` here is a placeholder MAC. In production it is the signer's FROST round-2 share over the
 * rerandomized Orchard spend-authorization sighash of `plan` (see README, "Going live").
 */
export class SignerNode {
  private campaigns = new Map<string, CampaignRecord>();

  constructor(
    readonly index: number,
    private readonly chain: ChainView,
    private readonly shareKey: string,
  ) {}

  /** Idempotent. The id is recomputed here, so a coordinator can't register a record under a different id. */
  async registerCampaign(rec: CampaignRecord, opts: { replay?: boolean } = {}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const now = opts.replay ? 0 : (await this.chain.tip()).time;
    const err = validateCampaign(rec, now);
    if (err) return { ok: false, error: err };
    const id = campaignId(rec);
    if (!this.campaigns.has(id)) this.campaigns.set(id, rec);
    return { ok: true, id };
  }

  async approveRefund(req: RefundRequest): Promise<Approval> {
    const rec = this.campaigns.get(req.campaignId);
    if (!rec) return { ok: false, signer: this.index, reason: "UnknownCampaign" };
    const [tip, notes] = await Promise.all([this.chain.tip(), this.chain.notes(req.campaignId)]);
    return this.finish(planRefund(rec, req.campaignId, notes, tip, req));
  }

  async approveWithdraw(req: WithdrawRequest): Promise<Approval> {
    const rec = this.campaigns.get(req.campaignId);
    if (!rec) return { ok: false, signer: this.index, reason: "UnknownCampaign" };
    const [tip, notes] = await Promise.all([this.chain.tip(), this.chain.notes(req.campaignId)]);
    return this.finish(planWithdraw(rec, req.campaignId, notes, tip));
  }

  private finish(d: Decision): Approval {
    if (!d.ok) return { ok: false, signer: this.index, reason: d.reason };
    const hash = planHash(d.plan);
    return { ok: true, signer: this.index, planHash: hash, plan: d.plan, share: sha256Hex(`${this.shareKey}:${hash}`) };
  }
}
