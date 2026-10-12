import { MockChain } from "../src/chain/mockChain.js";
import { Coordinator, MockEscrowAddresses } from "../src/coordinator/coordinator.js";
import { campaignId, newNonceHex, newSecretHex, refundCommitment } from "../src/core/crypto.js";
import { encodeMemo } from "../src/core/memo.js";
import { SETTLE_DELAY_SEC } from "../src/core/policy.js";
import type { CampaignRecord, Zat } from "../src/core/types.js";
import { SignerNode } from "../src/signer/signerNode.js";
import { MockThresholdSpender } from "../src/threshold/spender.js";

export const ZEC = 100_000_000n;
export const DAY = 86_400;

/** A shielded-looking address for tests. */
export const addr = (tag: string) => "u1" + tag.padEnd(2, "x").repeat(40).slice(0, 60).toLowerCase().replace(/[^a-z0-9]/g, "a");

export function setup(opts: { n?: number; t?: number; reveal?: "live" | "after-deadline"; dataDir?: string } = {}) {
  const n = opts.n ?? 5;
  const t = opts.t ?? 3;
  const chain = new MockChain();
  const signers = Array.from({ length: n }, (_, i) => new SignerNode(i + 1, chain, `key${i}`));
  const spender = new MockThresholdSpender(signers, t, chain);
  const coord = new Coordinator({
    chain,
    signers,
    spender,
    escrow: new MockEscrowAddresses(),
    revealTotals: opts.reveal ?? "live",
    dataDir: opts.dataDir,
  });
  return { chain, signers, spender, coord };
}

export function record(chain: MockChain, over: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    name: "School library",
    description: "Books and shelves.",
    imageURI: "",
    goalZat: 10n * ZEC,
    deadline: chain.time + 7 * DAY,
    creatorAddress: addr("creator"),
    nonce: newNonceHex(),
    ...over,
  };
}

export async function create(s: ReturnType<typeof setup>, over: Partial<CampaignRecord> = {}) {
  const rec = record(s.chain, over);
  const out = await s.coord.createCampaign(rec);
  if (!out.ok) throw new Error(out.error);
  return { rec, id: campaignId(rec) };
}

export interface Donation {
  noteId: string;
  secret: string;
  refundTo: string;
  commitment: string;
}

/** A donor pays `value` to the campaign's escrow with a refund commitment in the memo, then waits for confirmations. */
export function donate(s: ReturnType<typeof setup>, id: string, value: Zat, refundTo = addr("donor"), confirm = true): Donation {
  const secret = newSecretHex();
  const commitment = refundCommitment(id, secret, refundTo);
  const noteId = s.chain.donate(id, value, encodeMemo(commitment));
  if (confirm) s.chain.mine(3);
  return { noteId, secret, refundTo, commitment };
}

export const settle = (s: ReturnType<typeof setup>, rec: CampaignRecord) => s.chain.advanceTo(rec.deadline + SETTLE_DELAY_SEC + 1);
