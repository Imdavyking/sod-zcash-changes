import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

// Keep in sync with sod-zcash/src/core/crypto.ts and memo.ts. The signers recompute this hash; if the two
// ever disagree, refunds are rejected, so check/commitment.mjs in this repo guards the match.

const u16 = (n: number) => new Uint8Array([(n >> 8) & 0xff, n & 0xff]);

export function newSecret(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function newNonce(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

/** SHA-256("sod/refund/v1" || campaignId || secret || len(refundTo) || refundTo). */
export function computeCommitment(campaignId: string, secret: string, refundTo: string): string {
  const to = utf8ToBytes(refundTo);
  return bytesToHex(
    sha256(concatBytes(utf8ToBytes("sod/refund/v1"), hexToBytes(campaignId), hexToBytes(secret), u16(to.length), to)),
  );
}

/** The text memo the donor's wallet must attach to the payment. */
export const encodeMemo = (commitment: string) => `sod1:${commitment}`;
