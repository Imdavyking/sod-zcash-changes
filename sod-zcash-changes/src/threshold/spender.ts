import type { RefundRequest, RejectReason, SpendPlan, WithdrawRequest } from "../core/types.js";
import type { Approval, SignerNode } from "../signer/signerNode.js";
import type { MockChain } from "../chain/mockChain.js";

export type SpendRequest =
  | { kind: "refund"; req: RefundRequest }
  | { kind: "withdraw"; req: WithdrawRequest };

export type SpendResult =
  | { ok: true; txid: string; plan: SpendPlan }
  | { ok: false; reason: RejectReason | "NoQuorum" };

/**
 * Turns an authorised spend into a Zcash transaction.
 * The real implementation drives a FROST (RedPallas, rerandomized) signing session over Orchard spends,
 * builds the transaction with librustzcash and broadcasts it. See README, "Going live".
 */
export interface ThresholdSpender {
  spend(r: SpendRequest): Promise<SpendResult>;
}

/**
 * Reference implementation of the quorum logic against MockChain. A spend goes through only when at least
 * `threshold` signers return the SAME plan hash, i.e. derived the same spend independently.
 */
export class MockThresholdSpender implements ThresholdSpender {
  constructor(
    private readonly signers: SignerNode[],
    private readonly threshold: number,
    private readonly network: MockChain,
  ) {}

  async spend(r: SpendRequest): Promise<SpendResult> {
    const approvals: Approval[] = await Promise.all(
      this.signers.map((s) => (r.kind === "refund" ? s.approveRefund(r.req) : s.approveWithdraw(r.req))),
    );

    const groups = new Map<string, Extract<Approval, { ok: true }>[]>();
    for (const a of approvals) {
      if (!a.ok) continue;
      groups.set(a.planHash, [...(groups.get(a.planHash) ?? []), a]);
    }
    const quorum = [...groups.values()].find((g) => g.length >= this.threshold);
    if (!quorum) {
      // Report the most common refusal so the caller gets a useful reason.
      const counts = new Map<RejectReason, number>();
      for (const a of approvals) if (!a.ok) counts.set(a.reason, (counts.get(a.reason) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return { ok: false, reason: top && top[1] >= approvals.length - this.threshold + 1 ? top[0] : "NoQuorum" };
    }

    const plan = quorum[0]!.plan;
    try {
      // Network consensus is the final once-only guard: a note can be spent a single time.
      const txid = this.network.applySpend(plan);
      return { ok: true, txid, plan };
    } catch {
      return { ok: false, reason: plan.kind === "refund" ? "AlreadyRefunded" : "NothingToWithdraw" };
    }
  }
}
