import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from "@noble/hashes/utils";
import type { CampaignRecord } from "./types.js";

export { bytesToHex, hexToBytes };

const u16 = (n: number) => new Uint8Array([(n >> 8) & 0xff, n & 0xff]);

/** Canonical, order-fixed encoding so every signer derives the same id from the same record. */
export function canonicalCampaign(c: CampaignRecord): string {
  return JSON.stringify([
    "sod/campaign/v1",
    c.name.trim(),
    c.description.trim(),
    c.imageURI.trim(),
    c.goalZat.toString(),
    c.deadline,
    c.creatorAddress,
    c.nonce,
  ]);
}

/** 32-byte hex id. */
export function campaignId(c: CampaignRecord): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalCampaign(c))));
}

/** The escrow address for a campaign is a diversified address of the group key: 11-byte diversifier index. */
export function diversifierIndex(id: string): string {
  return id.slice(0, 22);
}

/**
 * commitment = SHA-256("sod/refund/v1" || campaignId || secret || len(refundTo) || refundTo)
 *
 * Binds the secret to a destination: someone who learns the secret still cannot redirect the refund,
 * because the signers only pay the address that is inside the hash. Mirrors the old
 * keccak256(abi.encode(campaignId, secret, refundTo)).
 */
export function refundCommitment(id: string, secretHex: string, refundTo: string): string {
  const to = utf8ToBytes(refundTo);
  return bytesToHex(
    sha256(concatBytes(utf8ToBytes("sod/refund/v1"), hexToBytes(id), hexToBytes(secretHex), u16(to.length), to)),
  );
}

export function newSecretHex(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function newNonceHex(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

export function sha256Hex(s: string): string {
  return bytesToHex(sha256(utf8ToBytes(s)));
}
