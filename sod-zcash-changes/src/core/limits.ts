import type { CampaignRecord } from "./types.js";

// Limits are in bytes, not characters.
export const MAX_NAME_BYTES = 80;
export const MAX_DESCRIPTION_BYTES = 2000;
export const MAX_IMAGE_URI_BYTES = 300;

const enc = new TextEncoder();
export const byteLength = (s: string) => enc.encode(s).length;

/** Shielded recipients only. Transparent t-addresses would publish the payout publicly. */
const SHIELDED_ADDR =
  /^(u1|utest1|uregtest1|zs1|ztestsapling1|zregtestsapling1)[a-z0-9]{30,}$/;

export function isShieldedAddress(a: string): boolean {
  return SHIELDED_ADDR.test(a);
}

export function isSafeImageURI(uri: string): boolean {
  if (uri.startsWith("ipfs://"))
    return /^[A-Za-z0-9._~\-/%]+$/.test(uri.slice(7));
  try {
    return new URL(uri).protocol === "https:";
  } catch {
    return false;
  }
}

/** Returns an error message, or null if the record is acceptable. `nowSec` is the chain tip time. */
export function validateCampaign(
  c: CampaignRecord,
  nowSec: number,
): string | null {
  const name = c.name.trim();
  if (!name) return "Give the campaign a name.";
  if (byteLength(name) > MAX_NAME_BYTES)
    return `Name is too long (max ${MAX_NAME_BYTES} bytes).`;
  if (byteLength(c.description.trim()) > MAX_DESCRIPTION_BYTES)
    return `Description is too long (max ${MAX_DESCRIPTION_BYTES} bytes).`;
  const img = c.imageURI.trim();
  if (img) {
    if (byteLength(img) > MAX_IMAGE_URI_BYTES)
      return `Image link is too long (max ${MAX_IMAGE_URI_BYTES} bytes).`;
    if (!isSafeImageURI(img))
      return "Image link must start with https:// or ipfs://";
  }
  if (c.goalZat <= 0n) return "Goal must be greater than zero.";
  if (!Number.isInteger(c.deadline) || c.deadline <= nowSec)
    return "Deadline must be in the future.";
  if (!isShieldedAddress(c.creatorAddress))
    return "Creator payout address must be a shielded (unified or Sapling) address.";
  if (!/^[0-9a-f]{32}$/.test(c.nonce)) return "Invalid nonce.";
  return null;
}
