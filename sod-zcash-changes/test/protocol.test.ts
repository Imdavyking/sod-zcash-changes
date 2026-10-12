import { describe, expect, it } from "vitest";
import { campaignId, refundCommitment } from "../src/core/crypto.js";
import { encodeMemo, parseMemo } from "../src/core/memo.js";
import { SETTLE_DELAY_SEC, conventionalFee } from "../src/core/policy.js";
import {
  DAY,
  ZEC,
  addr,
  create,
  donate,
  record,
  settle,
  setup,
} from "./helpers.js";

describe("Sod on Zcash: protocol", () => {
  describe("createCampaign", () => {
    it("registers the campaign and gives it its own escrow address", async () => {
      const s = setup();
      const a = await create(s);
      const b = await create(s);
      const va = await s.coord.view(a.id);
      const vb = await s.coord.view(b.id);
      expect(va).toMatchObject({
        name: "School library",
        status: "active",
        donationCount: 0,
        goalZat: (10n * ZEC).toString(),
      });
      expect(va.id).not.toBe(vb.id);
      expect(va.escrowAddress).not.toBe(vb.escrowAddress);
      expect((await s.coord.list()).length).toBe(2);
    });

    it("derives the id from the record, so it can't be swapped", () => {
      const s = setup();
      const r = record(s.chain);
      expect(campaignId(r)).toBe(campaignId({ ...r }));
      expect(campaignId(r)).not.toBe(
        campaignId({ ...r, goalZat: r.goalZat + 1n }),
      );
      expect(campaignId(r)).not.toBe(
        campaignId({ ...r, creatorAddress: addr("thief") }),
      );
    });

    it("rejects a zero goal, a past deadline and a transparent payout address", async () => {
      const s = setup();
      expect(
        (await s.coord.createCampaign(record(s.chain, { goalZat: 0n }))).ok,
      ).toBe(false);
      expect(
        (
          await s.coord.createCampaign(
            record(s.chain, { deadline: s.chain.time - 1 }),
          )
        ).ok,
      ).toBe(false);
      const t = await s.coord.createCampaign(
        record(s.chain, {
          creatorAddress: "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs",
        }),
      );
      expect(t).toMatchObject({ ok: false });
    });

    it("enforces the name, description and image limits in bytes", async () => {
      const s = setup();
      const ok = (o: object) =>
        s.coord.createCampaign(record(s.chain, o)).then((r) => r.ok);
      expect(await ok({ name: "" })).toBe(false);
      expect(await ok({ name: "a".repeat(80) })).toBe(true);
      expect(await ok({ name: "a".repeat(81) })).toBe(false);
      expect(await ok({ name: "é".repeat(41) })).toBe(false); // 82 bytes
      expect(await ok({ description: "d".repeat(2000) })).toBe(true);
      expect(await ok({ description: "d".repeat(2001) })).toBe(false);
      expect(await ok({ imageURI: "ipfs://bafy123" })).toBe(true);
      expect(await ok({ imageURI: "https://example.com/a.png" })).toBe(true);
      expect(await ok({ imageURI: "javascript:alert(1)" })).toBe(false);
      expect(await ok({ imageURI: "http://example.com/a.png" })).toBe(false);
    });
  });

  describe("memo and commitment", () => {
    it("round-trips the memo and ignores anything else", () => {
      const c = "ab".repeat(32);
      expect(parseMemo(encodeMemo(c))).toBe(c);
      expect(parseMemo("hello")).toBeNull();
      expect(parseMemo(null)).toBeNull();
      expect(parseMemo("sod1:xyz")).toBeNull();
    });

    it("binds secret, campaign and destination", () => {
      const id = "11".repeat(32);
      const secret = "22".repeat(32);
      const base = refundCommitment(id, secret, addr("a"));
      expect(base).toBe(refundCommitment(id, secret, addr("a")));
      expect(base).not.toBe(refundCommitment(id, secret, addr("b")));
      expect(base).not.toBe(refundCommitment(id, "33".repeat(32), addr("a")));
      expect(base).not.toBe(
        refundCommitment("44".repeat(32), secret, addr("a")),
      );
    });
  });

  describe("successful campaign", () => {
    it("pays the creator the full total (minus the network fee) after settlement", async () => {
      const s = setup();
      const { rec, id } = await create(s);
      donate(s, id, 6n * ZEC, addr("d1"));
      donate(s, id, 5n * ZEC, addr("d2"));
      settle(s, rec);

      const out = await s.coord.withdraw({ campaignId: id });
      expect(out).toMatchObject({
        ok: true,
        payoutZat: (11n * ZEC - conventionalFee(2, 1)).toString(),
      });
      expect((await s.coord.view(id)).status).toBe("paid_out");
    });

    it("blocks refunds after the deadline once the goal is met", async () => {
      const s = setup();
      const { rec, id } = await create(s);
      const d = donate(s, id, 11n * ZEC);
      settle(s, rec);
      expect(
        await s.coord.refund({
          campaignId: id,
          secret: d.secret,
          refundTo: d.refundTo,
        }),
      ).toMatchObject({ ok: false, reason: "GoalMet" });
    });

    it("blocks a second withdrawal", async () => {
      const s = setup();
      const { rec, id } = await create(s);
      donate(s, id, 11n * ZEC);
      settle(s, rec);
      expect((await s.coord.withdraw({ campaignId: id })).ok).toBe(true);
      expect(await s.coord.withdraw({ campaignId: id })).toMatchObject({
        ok: false,
        reason: "NothingToWithdraw",
      });
    });

    it("pays out to the address fixed at creation, whoever asks", async () => {
      const s = setup();
      const { rec, id } = await create(s);
      donate(s, id, 11n * ZEC);
      settle(s, rec);
      const out = await s.coord.withdraw({ campaignId: id });
      expect(out.ok).toBe(true);
      const notes = await s.chain.notes(id);
      expect(notes[0]!.spent).toBeDefined();
    });
  });

  describe("failed campaign", () => {
    it("lets every donor refund after settlement, and not before it", async () => {
      const s = setup();
      const { rec, id } = await create(s);
      const d1 = donate(s, id, 3n * ZEC, addr("d1"));
      const d2 = donate(s, id, 2n * ZEC, addr("d2"));

      s.chain.advanceTo(rec.deadline + 1);
      expect(
        await s.coord.refund({
          campaignId: id,
          secret: d1.secret,
          refundTo: d1.refundTo,
        }),
      ).toMatchObject({ ok: false, reason: "SettlementPending" });

      settle(s, rec);
      expect((await s.coord.view(id)).status).toBe("failed");
      expect(
        await s.coord.refund({
          campaignId: id,
          secret: d1.secret,
          refundTo: d1.refundTo,
        }),
      ).toMatchObject({ ok: true, payoutZat: (3n * ZEC - 10_000n).toString() });
      expect(
        (
          await s.coord.refund({
            campaignId: id,
            secret: d2.secret,
            refundTo: d2.refundTo,
          })
        ).ok,
      ).toBe(true);
    });

    it("blocks creator withdrawal when the goal is not met", async () => {
      const s = setup();
      const { rec, id } = await create(s);
      donate(s, id, 3n * ZEC);
      settle(s, rec);
      expect(await s.coord.withdraw({ campaignId: id })).toMatchObject({
        ok: false,
        reason: "GoalNotMet",
      });
    });
  });

  describe("refund before the deadline", () => {
    it("returns the funds and reduces the total", async () => {
      const s = setup();
      const { id } = await create(s);
      const d = donate(s, id, 4n * ZEC);
      expect((await s.coord.view(id)).totalZat).toBe((4n * ZEC).toString());
      expect(
        (
          await s.coord.refund({
            campaignId: id,
            secret: d.secret,
            refundTo: d.refundTo,
          })
        ).ok,
      ).toBe(true);
      expect((await s.coord.view(id)).totalZat).toBe("0");
    });

    it("can refund to a fresh address chosen at donation time", async () => {
      const s = setup();
      const { id } = await create(s);
      const d = donate(s, id, 4n * ZEC, addr("fresh"));
      expect(
        await s.coord.refund({
          campaignId: id,
          secret: d.secret,
          refundTo: d.refundTo,
        }),
      ).toMatchObject({ ok: true });
    });

    it("a refunded donation cannot keep a campaign looking funded", async () => {
      const s = setup();
      const { rec, id } = await create(s);
      donate(s, id, 6n * ZEC);
      const d = donate(s, id, 5n * ZEC);
      expect(
        (
          await s.coord.refund({
            campaignId: id,
            secret: d.secret,
            refundTo: d.refundTo,
          })
        ).ok,
      ).toBe(true);
      settle(s, rec);
      expect(await s.coord.withdraw({ campaignId: id })).toMatchObject({
        ok: false,
        reason: "GoalNotMet",
      });
    });

    it("a refund after the deadline of a pre-deadline-refunded note does not unfreeze the total", async () => {
      // goal met by 11, one 5 refunded early -> failed. Another donor can then refund.
      const s = setup();
      const { rec, id } = await create(s);
      const a = donate(s, id, 6n * ZEC, addr("a"));
      const b = donate(s, id, 5n * ZEC, addr("b"));
      await s.coord.refund({
        campaignId: id,
        secret: b.secret,
        refundTo: b.refundTo,
      });
      settle(s, rec);
      expect(
        (
          await s.coord.refund({
            campaignId: id,
            secret: a.secret,
            refundTo: a.refundTo,
          })
        ).ok,
      ).toBe(true);
    });
  });

  describe("refund protection", () => {
    it("rejects a wrong secret", async () => {
      const s = setup();
      const { id } = await create(s);
      const d = donate(s, id, 2n * ZEC);
      expect(
        await s.coord.refund({
          campaignId: id,
          secret: "ee".repeat(32),
          refundTo: d.refundTo,
        }),
      ).toMatchObject({ ok: false, reason: "UnknownDonation" });
    });

    it("rejects a wrong refundTo (front-run protection)", async () => {
      const s = setup();
      const { id } = await create(s);
      const d = donate(s, id, 2n * ZEC);
      // Someone who saw the secret still can't redirect the refund.
      expect(
        await s.coord.refund({
          campaignId: id,
          secret: d.secret,
          refundTo: addr("attacker"),
        }),
      ).toMatchObject({ ok: false, reason: "UnknownDonation" });
      expect(
        (
          await s.coord.refund({
            campaignId: id,
            secret: d.secret,
            refundTo: d.refundTo,
          })
        ).ok,
      ).toBe(true);
    });

    it("blocks a double refund", async () => {
      const s = setup();
      const { id } = await create(s);
      const d = donate(s, id, 2n * ZEC);
      expect(
        (
          await s.coord.refund({
            campaignId: id,
            secret: d.secret,
            refundTo: d.refundTo,
          })
        ).ok,
      ).toBe(true);
      expect(
        await s.coord.refund({
          campaignId: id,
          secret: d.secret,
          refundTo: d.refundTo,
        }),
      ).toMatchObject({ ok: false, reason: "AlreadyRefunded" });
    });

    it("blocks two simultaneous refunds of one note (the network only spends it once)", async () => {
      const s = setup();
      const { id } = await create(s);
      const d = donate(s, id, 2n * ZEC);
      const req = { campaignId: id, secret: d.secret, refundTo: d.refundTo };
      const [x, y] = await Promise.all([
        s.coord.refund(req),
        s.coord.refund(req),
      ]);
      expect([x.ok, y.ok].filter(Boolean).length).toBe(1);
    });

    it("rejects a transparent refund target, an unknown campaign and a malformed secret", async () => {
      const s = setup();
      const { id } = await create(s);
      const d = donate(s, id, 2n * ZEC);
      expect(
        await s.coord.refund({
          campaignId: id,
          secret: d.secret,
          refundTo: "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs",
        }),
      ).toMatchObject({ ok: false, reason: "InvalidRefundTarget" });
      expect(
        await s.coord.refund({
          campaignId: "00".repeat(32),
          secret: d.secret,
          refundTo: d.refundTo,
        }),
      ).toMatchObject({ ok: false, reason: "UnknownCampaign" });
      expect(
        await s.coord.refund({
          campaignId: id,
          secret: "nope",
          refundTo: d.refundTo,
        }),
      ).toMatchObject({ ok: false, reason: "UnknownDonation" });
    });

    it("refuses a donation too small to cover the network fee", async () => {
      const s = setup();
      const { id } = await create(s);
      const d = donate(s, id, 9_000n);
      expect(
        await s.coord.refund({
          campaignId: id,
          secret: d.secret,
          refundTo: d.refundTo,
        }),
      ).toMatchObject({ ok: false, reason: "DustDonation" });
    });
  });

  describe("withdraw protection", () => {
    it("blocks early withdrawal and withdrawal during the settlement window", async () => {
      const s = setup();
      const { rec, id } = await create(s);
      donate(s, id, 11n * ZEC);
      expect(await s.coord.withdraw({ campaignId: id })).toMatchObject({
        ok: false,
        reason: "CampaignNotEnded",
      });
      s.chain.advanceTo(rec.deadline + SETTLE_DELAY_SEC - 200);
      expect(await s.coord.withdraw({ campaignId: id })).toMatchObject({
        ok: false,
        reason: "SettlementPending",
      });
    });
  });

  describe("donations that arrive outside the rules", () => {
    it("a donation mined after the deadline is never counted and can always be refunded", async () => {
      const s = setup();
      const { rec, id } = await create(s);
      donate(s, id, 11n * ZEC, addr("early"));
      s.chain.advanceTo(rec.deadline + 10);
      const late = donate(s, id, 4n * ZEC, addr("late"));
      settle(s, rec);

      const v = await s.coord.view(id);
      expect(v.totalZat).toBe((11n * ZEC).toString());
      expect(v.donationCount).toBe(1);

      // Even though the campaign succeeded, the late donor gets their money back.
      expect(
        (
          await s.coord.refund({
            campaignId: id,
            secret: late.secret,
            refundTo: late.refundTo,
          })
        ).ok,
      ).toBe(true);
      // And the payout sweeps only the on-time donation.
      expect(await s.coord.withdraw({ campaignId: id })).toMatchObject({
        ok: true,
        payoutZat: (11n * ZEC - conventionalFee(1, 1)).toString(),
      });
    });

    it("a payment with no valid memo is not counted", async () => {
      const s = setup();
      const { id } = await create(s);
      s.chain.donate(id, 50n * ZEC, null);
      s.chain.mine(3);
      expect((await s.coord.view(id)).totalZat).toBe("0");
    });

    it("a payment is ignored until it has enough confirmations", async () => {
      const s = setup();
      const { id } = await create(s);
      donate(s, id, 2n * ZEC, addr("d"), false);
      expect((await s.coord.view(id)).donationCount).toBe(0);
      s.chain.mine(3);
      expect((await s.coord.view(id)).donationCount).toBe(1);
    });
  });

  describe("privacy of the running total", () => {
    it("hides the total until the deadline by default, then reveals it", async () => {
      const s = setup({ reveal: "after-deadline" });
      const { rec, id } = await create(s);
      donate(s, id, 3n * ZEC);
      expect((await s.coord.view(id)).totalZat).toBeNull();
      settle(s, rec);
      expect((await s.coord.view(id)).totalZat).toBe((3n * ZEC).toString());
    });
  });
});
