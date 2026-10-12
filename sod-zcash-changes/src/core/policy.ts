import { refundCommitment, sha256Hex } from "./crypto.js";
import { isShieldedAddress } from "./limits.js";
import { parseMemo } from "./memo.js";
import type {
  CampaignRecord,
  ChainNote,
  ChainTip,
  Decision,
  RefundRequest,
  SpendPlan,
  Zat,
} from "./types.js";

/** Donations need this many confirmations before the escrow acts on them (Zashi's default is 3). */
export const MIN_CONFIRMATIONS = 3;

/**
 * After the deadline, wait this long (in block time) before settling. By then every block that could
 * contain an on-time donation is buried under MIN_CONFIRMATIONS, so the frozen total can't still change.
 */
export const SETTLE_DELAY_SEC = 15 * 60;

/** ZIP-317 conventional fee: 5000 zat per logical action, minimum two. */
export function conventionalFee(inputs: number, outputs: number): Zat {
  return 5000n * BigInt(Math.max(2, inputs, outputs));
}

export interface ClassifiedNote {
  note: ChainNote;
  commitment: string | null;
  /** Mined on time (before the deadline) with a valid memo. Only counted notes add to the total. */
  counted: boolean;
}

export type CampaignStatus =
  | "active"
  | "settling"
  | "funded"
  | "failed"
  | "paid_out";

export interface CampaignState {
  status: CampaignStatus;
  /** Sum of counted donations that were not refunded before the deadline. Final once settled. */
  total: Zat;
  goalMet: boolean;
  donationCount: number;
  /** Counted notes still sitting in escrow. */
  heldNotes: number;
}

function confirmed(n: ChainNote, tip: ChainTip): boolean {
  return tip.height - n.minedHeight + 1 >= MIN_CONFIRMATIONS;
}

export function classify(
  rec: CampaignRecord,
  notes: ChainNote[],
  tip: ChainTip,
): ClassifiedNote[] {
  return notes
    .filter((n) => confirmed(n, tip))
    .map((note) => {
      const commitment = parseMemo(note.memo);
      return {
        note,
        commitment,
        counted:
          commitment !== null &&
          note.valueZat > 0n &&
          note.minedTime < rec.deadline,
      };
    })
    .sort((a, b) =>
      a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0,
    );
}

/**
 * The total as of the deadline: counted donations that were still in escrow when it passed.
 * Refunds made before the deadline reduce it. Refunds and the payout made after it do not, so the
 * goal check can never flip once the deadline has passed.
 */
export function frozenTotal(rec: CampaignRecord, cls: ClassifiedNote[]): Zat {
  let t = 0n;
  for (const c of cls) {
    if (!c.counted) continue;
    if (!c.note.spent || c.note.spent.time >= rec.deadline)
      t += c.note.valueZat;
  }
  return t;
}

export function campaignState(
  rec: CampaignRecord,
  notes: ChainNote[],
  tip: ChainTip,
): CampaignState {
  const cls = classify(rec, notes, tip);
  const total = frozenTotal(rec, cls);
  const goalMet = total >= rec.goalZat;
  const counted = cls.filter((c) => c.counted);
  const held = counted.filter((c) => !c.note.spent).length;
  const ended = tip.time >= rec.deadline;
  const settled = tip.time >= rec.deadline + SETTLE_DELAY_SEC;

  let status: CampaignStatus;
  if (!ended) status = "active";
  else if (!settled) status = "settling";
  else if (!goalMet) status = "failed";
  else {
    // Funded; paid out once the payout spend has consumed every counted note.
    const paid =
      counted.length > 0 &&
      held === 0 &&
      counted.some((c) => c.note.spent && c.note.spent.time >= rec.deadline);
    status = paid ? "paid_out" : "funded";
  }
  return {
    status,
    total,
    goalMet,
    donationCount: counted.length,
    heldNotes: held,
  };
}

function planOf(
  p: Omit<SpendPlan, "inputs"> & { inputs: string[] },
): SpendPlan {
  return { ...p, inputs: [...p.inputs].sort() };
}

/** Canonical hash of a plan. Signers compare these to prove they derived the same spend. */
export function planHash(p: SpendPlan): string {
  return sha256Hex(
    JSON.stringify([
      "sod/plan/v1",
      p.kind,
      p.campaignId,
      p.inputs,
      p.outputs.map((o) => [o.address, o.valueZat.toString()]),
      p.feeZat.toString(),
    ]),
  );
}

/**
 * Refund: spend exactly the donor's note back to the address that is bound into its commitment.
 *  - on-time donation, before the deadline: always allowed
 *  - on-time donation, after the deadline: allowed once settled, only if the goal was missed
 *  - late donation (mined at/after the deadline): allowed any time, it was never counted
 * Spending the note on chain is what makes a refund once-only.
 */
export function planRefund(
  rec: CampaignRecord,
  id: string,
  notes: ChainNote[],
  tip: ChainTip,
  req: RefundRequest,
): Decision {
  if (!isShieldedAddress(req.refundTo))
    return { ok: false, reason: "InvalidRefundTarget" };
  if (!/^[0-9a-f]{64}$/.test(req.secret))
    return { ok: false, reason: "UnknownDonation" };

  const commitment = refundCommitment(id, req.secret, req.refundTo);
  const cls = classify(rec, notes, tip);
  const matching = cls.filter((c) => c.commitment === commitment);
  if (matching.length === 0) return { ok: false, reason: "UnknownDonation" };
  const target = matching.find((c) => !c.note.spent);
  if (!target) return { ok: false, reason: "AlreadyRefunded" };

  if (target.counted && tip.time >= rec.deadline) {
    if (tip.time < rec.deadline + SETTLE_DELAY_SEC)
      return { ok: false, reason: "SettlementPending" };
    if (frozenTotal(rec, cls) >= rec.goalZat)
      return { ok: false, reason: "GoalMet" };
  }

  const fee = conventionalFee(1, 1);
  if (target.note.valueZat <= fee) return { ok: false, reason: "DustDonation" };
  return {
    ok: true,
    plan: planOf({
      kind: "refund",
      campaignId: id,
      inputs: [target.note.id],
      outputs: [
        { address: req.refundTo, valueZat: target.note.valueZat - fee },
      ],
      feeZat: fee,
    }),
  };
}

/**
 * Withdraw: after settlement, if the goal was met, sweep every counted note still in escrow to the creator
 * address fixed at creation. Anyone may trigger it; nobody can change where it pays.
 */
export function planWithdraw(
  rec: CampaignRecord,
  id: string,
  notes: ChainNote[],
  tip: ChainTip,
): Decision {
  if (tip.time < rec.deadline) return { ok: false, reason: "CampaignNotEnded" };
  if (tip.time < rec.deadline + SETTLE_DELAY_SEC)
    return { ok: false, reason: "SettlementPending" };
  const cls = classify(rec, notes, tip);
  if (frozenTotal(rec, cls) < rec.goalZat)
    return { ok: false, reason: "GoalNotMet" };

  const held = cls.filter((c) => c.counted && !c.note.spent);
  if (held.length === 0) return { ok: false, reason: "NothingToWithdraw" };

  const sum = held.reduce((a, c) => a + c.note.valueZat, 0n);
  const fee = conventionalFee(held.length, 1);
  if (sum <= fee) return { ok: false, reason: "DustDonation" };
  return {
    ok: true,
    plan: planOf({
      kind: "withdraw",
      campaignId: id,
      inputs: held.map((c) => c.note.id),
      outputs: [{ address: rec.creatorAddress, valueZat: sum - fee }],
      feeZat: fee,
    }),
  };
}

export type DonationStatus =
  | { status: "unknown" }
  | { status: "held" | "late" | "refunded"; valueZat: Zat };

/**
 * What a donor sees about their own donation, looked up by the commitment in its memo.
 * "unknown" means the escrow has not seen it with enough confirmations yet (or the memo was wrong).
 * "late" = mined after the deadline: not counted, refundable at any time.
 */
export function donationStatus(
  rec: CampaignRecord,
  notes: ChainNote[],
  tip: ChainTip,
  commitment: string,
): DonationStatus {
  const hits = classify(rec, notes, tip).filter(
    (c) => c.commitment === commitment,
  );
  if (hits.length === 0) return { status: "unknown" };
  const total = hits.reduce((a, c) => a + c.note.valueZat, 0n);
  const open = hits.find((c) => !c.note.spent);
  if (!open) return { status: "refunded", valueZat: total };
  return {
    status: open.counted ? "held" : "late",
    valueZat: open.note.valueZat,
  };
}
