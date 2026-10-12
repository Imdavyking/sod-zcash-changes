const BASE = ((import.meta.env.VITE_SOD_API as string | undefined) || "").replace(/\/$/, "");

export type CampaignStatus = "active" | "settling" | "funded" | "failed" | "paid_out";

export interface Campaign {
  id: string;
  name: string;
  description: string;
  imageURI: string;
  goalZat: string;
  deadline: number; // unix seconds
  creatorAddress: string;
  escrowAddress: string;
  status: CampaignStatus;
  donationCount: number;
  /** null while the coordinator keeps the running total private. */
  totalZat: string | null;
}

export type DonationStatus =
  | { status: "unknown" }
  | { status: "held" | "late" | "refunded"; valueZat: string };

export interface Config {
  network: string;
  minConfirmations: number;
  settleDelaySec: number;
}

export type Outcome = { ok: true; txid: string; payoutZat: string } | { ok: false; reason: string };

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  return { status: res.status, body: body as T };
}

export const getConfig = () => call<Config>("/api/config").then((r) => r.body);

export const listCampaigns = () => call<Campaign[]>("/api/campaigns").then((r) => r.body);

export async function createCampaign(input: {
  name: string;
  description: string;
  imageURI: string;
  goalZat: string;
  deadline: number;
  creatorAddress: string;
  nonce: string;
}): Promise<Campaign> {
  const r = await call<Campaign & { error?: string }>("/api/campaigns", { method: "POST", body: JSON.stringify(input) });
  if (r.status !== 201) throw new Error(r.body?.error || "Could not create the campaign");
  return r.body;
}

export const getDonation = (id: string, commitment: string) =>
  call<DonationStatus>(`/api/campaigns/${id}/donations/${commitment}`).then((r) => r.body);

export const refund = (id: string, secret: string, refundTo: string) =>
  call<Outcome>(`/api/campaigns/${id}/refund`, { method: "POST", body: JSON.stringify({ secret, refundTo }) }).then((r) => r.body);

export const withdraw = (id: string) =>
  call<Outcome>(`/api/campaigns/${id}/withdraw`, { method: "POST" }).then((r) => r.body);

/** Plain-language versions of the signers' refusal reasons. */
export const REASONS: Record<string, string> = {
  UnknownCampaign: "Campaign not found.",
  InvalidRefundTarget: "The refund address must be a shielded Zcash address.",
  UnknownDonation: "No donation matches that secret and refund address yet. It may still need confirmations.",
  AlreadyRefunded: "This donation was already refunded.",
  GoalMet: "The goal was met, so donations can no longer be refunded.",
  SettlementPending: "The deadline just passed. Settlement opens in a few minutes, once every block is final.",
  CampaignNotEnded: "The campaign hasn't ended yet.",
  GoalNotMet: "The goal wasn't met, so there is nothing to pay out.",
  NothingToWithdraw: "The payout has already been released.",
  DustDonation: "This donation is too small to cover the network fee.",
  NoQuorum: "The escrow signers could not agree right now. Try again shortly.",
  StaleView: "The escrow signers are catching up with the network. Try again shortly.",
};
export const reasonText = (r: string) => REASONS[r] ?? r;

/** Demo-only helpers served by sod-zcash's `npm run dev` (fake Zcash network). */
export const dev = {
  donate: (campaignId: string, valueZat: string, commitment: string) =>
    call("/dev/donate", { method: "POST", body: JSON.stringify({ campaignId, valueZat, commitment }) }),
  advanceTo: (unix: number) => call("/dev/advance-to", { method: "POST", body: JSON.stringify({ unix }) }),
};
