import { describe, expect, it } from "vitest";
import { MockChain } from "../src/chain/mockChain.js";
import { Coordinator, MockEscrowAddresses } from "../src/coordinator/coordinator.js";
import { planHash } from "../src/core/policy.js";
import type { SpendPlan } from "../src/core/types.js";
import { SignerNode, type Approval } from "../src/signer/signerNode.js";
import { MockThresholdSpender } from "../src/threshold/spender.js";
import { ZEC, addr, create, donate, record, setup } from "./helpers.js";

describe("FROST escrow quorum", () => {
  it("every signer independently refuses a refund that the commitment does not allow", async () => {
    const s = setup();
    const { id } = await create(s);
    const d = donate(s, id, 2n * ZEC);
    // A lying coordinator asks for a refund to its own address. No signer will derive that spend.
    const approvals = await Promise.all(s.signers.map((x) => x.approveRefund({ campaignId: id, secret: d.secret, refundTo: addr("coordinator") })));
    expect(approvals.every((a) => !a.ok)).toBe(true);
  });

  it("all honest signers derive the identical plan", async () => {
    const s = setup();
    const { id } = await create(s);
    const d = donate(s, id, 2n * ZEC);
    const approvals = await Promise.all(s.signers.map((x) => x.approveRefund({ campaignId: id, secret: d.secret, refundTo: d.refundTo })));
    const hashes = new Set(approvals.map((a) => (a.ok ? a.planHash : "rejected")));
    expect(hashes.size).toBe(1);
    expect(hashes.has("rejected")).toBe(false);
  });

  it("t-1 signers cannot move funds on their own", async () => {
    const s = setup({ n: 5, t: 3 });
    const { id } = await create(s);
    const d = donate(s, id, 2n * ZEC);
    // Only two signers are reachable: below the threshold.
    const two = new MockThresholdSpender(s.signers.slice(0, 2), 3, s.chain);
    expect(await two.spend({ kind: "refund", req: { campaignId: id, secret: d.secret, refundTo: d.refundTo } })).toMatchObject({ ok: false });
    expect((await s.chain.notes(id))[0]!.spent).toBeUndefined();
  });

  it("forged approvals from fewer than t signers can't redirect funds; t of them can (the trust assumption)", async () => {
    const s = setup({ n: 5, t: 3 });
    const { id } = await create(s);
    const d = donate(s, id, 2n * ZEC);
    const note = (await s.chain.notes(id))[0]!;
    const attackerPlan: SpendPlan = {
      kind: "refund",
      campaignId: id,
      inputs: [note.id],
      outputs: [{ address: addr("attacker"), valueZat: note.valueZat - 10_000n }],
      feeZat: 10_000n,
    };
    class Evil extends SignerNode {
      override async approveRefund(): Promise<Approval> {
        return { ok: true, signer: this.index, planHash: planHash(attackerPlan), plan: attackerPlan, share: "forged" };
      }
    }
    const req = { campaignId: id, secret: d.secret, refundTo: d.refundTo };
    const evil = (i: number) => new Evil(i, s.chain, `evil${i}`);

    // 2 evil + 3 honest: the honest three agree on the real plan, the evil two can't reach t.
    const two = new MockThresholdSpender([evil(1), evil(2), ...s.signers.slice(2)], 3, s.chain);
    const ok = await two.spend({ kind: "refund", req });
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) expect(ok.plan.outputs[0]!.address).toBe(d.refundTo);
  });

  it("with t signers compromised the escrow can be drained: this is the trust assumption", async () => {
    const s = setup({ n: 5, t: 3 });
    const { id } = await create(s);
    const d = donate(s, id, 2n * ZEC);
    const note = (await s.chain.notes(id))[0]!;
    const attackerPlan: SpendPlan = {
      kind: "refund",
      campaignId: id,
      inputs: [note.id],
      outputs: [{ address: addr("attacker"), valueZat: note.valueZat - 10_000n }],
      feeZat: 10_000n,
    };
    class Evil extends SignerNode {
      override async approveRefund(): Promise<Approval> {
        return { ok: true, signer: this.index, planHash: planHash(attackerPlan), plan: attackerPlan, share: "forged" };
      }
    }
    const three = new MockThresholdSpender([1, 2, 3].map((i) => new Evil(i, s.chain, "e")).concat(s.signers.slice(3) as never), 3, s.chain);
    const out = await three.spend({ kind: "refund", req: { campaignId: id, secret: d.secret, refundTo: d.refundTo } });
    expect(out.ok && out.plan.outputs[0]!.address).toBe(addr("attacker"));
  });

  it("still works when a minority of signers lag behind the chain", async () => {
    const s = setup({ n: 5, t: 3 });
    const { id } = await create(s);
    const lagging = s.chain.fork();
    const d = donate(s, id, 2n * ZEC); // the main chain sees it; the fork doesn't
    // Replace signers 4 and 5 with ones reading the stale fork.
    const stale = [3, 4].map((i) => new SignerNode(i + 1, lagging, `k${i}`));
    for (const x of stale) await x.registerCampaign((s.coord as any).campaigns.get(id), { replay: true });
    const sp = new MockThresholdSpender([...s.signers.slice(0, 3), ...stale], 3, s.chain);
    expect((await sp.spend({ kind: "refund", req: { campaignId: id, secret: d.secret, refundTo: d.refundTo } })).ok).toBe(true);
  });

  it("fails closed when most signers cannot see the donation", async () => {
    const s = setup({ n: 5, t: 3 });
    const { id } = await create(s);
    const lagging = s.chain.fork();
    const d = donate(s, id, 2n * ZEC);
    const stale = [2, 3, 4].map((i) => new SignerNode(i + 1, lagging, `k${i}`));
    for (const x of stale) await x.registerCampaign((s.coord as any).campaigns.get(id), { replay: true });
    const sp = new MockThresholdSpender([...s.signers.slice(0, 2), ...stale], 3, s.chain);
    expect((await sp.spend({ kind: "refund", req: { campaignId: id, secret: d.secret, refundTo: d.refundTo } })).ok).toBe(false);
  });

  it("a signer will not register a campaign that breaks the rules", async () => {
    const chain = new MockChain();
    const signer = new SignerNode(1, chain, "k");
    expect(await signer.registerCampaign(record(chain, { goalZat: 0n }))).toMatchObject({ ok: false });
    expect(await signer.registerCampaign(record(chain, { creatorAddress: "t1abc" }))).toMatchObject({ ok: false });
  });

  it("the coordinator refuses to open a campaign unless every signer accepts it", async () => {
    const chain = new MockChain();
    class Refuser extends SignerNode {
      override async registerCampaign() {
        return { ok: false as const, error: "no" };
      }
    }
    const signers = [new SignerNode(1, chain, "a"), new Refuser(2, chain, "b")];
    const coord = new Coordinator({ chain, signers, spender: new MockThresholdSpender(signers, 2, chain), escrow: new MockEscrowAddresses() });
    expect(await coord.createCampaign(record(chain))).toMatchObject({ ok: false });
  });
});
