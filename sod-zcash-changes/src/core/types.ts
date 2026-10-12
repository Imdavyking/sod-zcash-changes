/** Amounts are in zatoshi (1 ZEC = 100_000_000 zat). */
export type Zat = bigint;

export const ZAT_PER_ZEC = 100_000_000n;

/** What the creator submits. Immutable once registered: the id is a hash of it. */
export interface CampaignRecord {
  name: string;
  description: string;
  imageURI: string;
  goalZat: Zat;
  /** Unix seconds. Compared against Zcash block header times, never against a wall clock. */
  deadline: number;
  /** Where a successful campaign pays out. Fixed at creation, so whoever triggers a withdrawal can't redirect it. */
  creatorAddress: string;
  /** 16 random bytes, hex. Lets one creator open identical campaigns. */
  nonce: string;
}

/** A shielded note the escrow group received, as seen through the group's viewing key. */
export interface ChainNote {
  /** `${txid}:${actionIndex}` */
  id: string;
  campaignId: string;
  valueZat: Zat;
  /** Decoded text memo, or null if empty / not text. */
  memo: string | null;
  minedHeight: number;
  /** Block header time of the block that mined the note. */
  minedTime: number;
  spent?: { txid: string; height: number; time: number };
}

export interface ChainTip {
  height: number;
  /** Block header time of the tip, unix seconds. */
  time: number;
}

/** The only thing signers need from the Zcash network. See README for how to back it with a real node. */
export interface ChainView {
  tip(): Promise<ChainTip>;
  /** Every note received at the campaign's escrow address, spent or not. */
  notes(campaignId: string): Promise<ChainNote[]>;
}

export interface SpendOutput {
  address: string;
  valueZat: Zat;
}

/** A fully determined spend. Every signer derives this on its own and signs only its own derivation. */
export interface SpendPlan {
  kind: "refund" | "withdraw";
  campaignId: string;
  /** Note ids, sorted. */
  inputs: string[];
  outputs: SpendOutput[];
  feeZat: Zat;
}

export type RejectReason =
  | "UnknownCampaign"
  | "InvalidRefundTarget"
  | "UnknownDonation"
  | "AlreadyRefunded"
  | "GoalMet"
  | "SettlementPending"
  | "CampaignNotEnded"
  | "GoalNotMet"
  | "NothingToWithdraw"
  | "DustDonation"
  | "StaleView";

export type Decision =
  | { ok: true; plan: SpendPlan }
  | { ok: false; reason: RejectReason };

export interface RefundRequest {
  campaignId: string;
  secret: string; // 32 bytes hex
  refundTo: string;
}

export interface WithdrawRequest {
  campaignId: string;
}
