import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Coordinator, MockEscrowAddresses } from "../src/coordinator/coordinator.js";
import { buildServer } from "../src/coordinator/server.js";
import { newNonceHex } from "../src/core/crypto.js";
import { MockThresholdSpender } from "../src/threshold/spender.js";
import { SignerNode } from "../src/signer/signerNode.js";
import { ZEC, addr, create, donate, setup } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("persistence", () => {
  it("reloads campaigns after a restart and signers can still settle them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sod-"));
    dirs.push(dir);
    const s1 = setup({ dataDir: dir });
    const { rec, id } = await create(s1);
    const d = donate(s1, id, 3n * ZEC);

    // "Restart": fresh signers and coordinator over the same chain and data dir.
    const signers = Array.from({ length: 5 }, (_, i) => new SignerNode(i + 1, s1.chain, `key${i}`));
    const coord = new Coordinator({
      chain: s1.chain,
      signers,
      spender: new MockThresholdSpender(signers, 3, s1.chain),
      escrow: new MockEscrowAddresses(),
      dataDir: dir,
      revealTotals: "live",
    });
    await coord.init();
    expect((await coord.view(id)).goalZat).toBe(rec.goalZat.toString());
    expect((await coord.refund({ campaignId: id, secret: d.secret, refundTo: d.refundTo })).ok).toBe(true);
  });
});

describe("HTTP API", () => {
  it("creates a campaign, lists it, and refuses a refund for an unknown donation", async () => {
    const s = setup();
    const server = buildServer(s.coord, "mock");
    await new Promise<void>((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const created = await fetch(`${base}/api/campaigns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "API campaign",
          description: "",
          imageURI: "",
          goalZat: (5n * ZEC).toString(),
          deadline: s.chain.time + 86_400,
          creatorAddress: addr("creator"),
          nonce: newNonceHex(),
        }),
      });
      expect(created.status).toBe(201);
      const view = await created.json();
      expect(view.id).toMatch(/^[0-9a-f]{64}$/);

      const list = await (await fetch(`${base}/api/campaigns`)).json();
      expect(list).toHaveLength(1);

      const bad = await fetch(`${base}/api/campaigns/${view.id}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: "00".repeat(32), refundTo: addr("x") }),
      });
      expect(bad.status).toBe(409);
      expect(await bad.json()).toMatchObject({ ok: false, reason: "UnknownDonation" });

      // donor looks up their own donation by commitment
      const id = view.id as string;
      const d = donate(s, id, 2n * ZEC);
      const found = await (await fetch(`${base}/api/campaigns/${id}/donations/${d.commitment}`)).json();
      expect(found).toEqual({ status: "held", valueZat: (2n * ZEC).toString() });
      const none = await (await fetch(`${base}/api/campaigns/${id}/donations/${"ab".repeat(32)}`)).json();
      expect(none).toEqual({ status: "unknown" });
      await s.coord.refund({ campaignId: id, secret: d.secret, refundTo: d.refundTo });
      expect(await (await fetch(`${base}/api/campaigns/${id}/donations/${d.commitment}`)).json()).toMatchObject({ status: "refunded" });

      const rejected = await fetch(`${base}/api/campaigns`, { method: "POST", body: JSON.stringify({ name: "x", goalZat: "0" }) });
      expect(rejected.status).toBe(400);
    } finally {
      server.close();
    }
  });
});
