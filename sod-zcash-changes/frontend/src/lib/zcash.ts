const ZAT_PER_ZEC = 100_000_000n;

/** 150000000n -> "1.5" */
export function zatToZec(zat: bigint | string): string {
  const z = BigInt(zat);
  const whole = z / ZAT_PER_ZEC;
  const frac = (z % ZAT_PER_ZEC).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export const fmtZec = (zat: bigint | string) =>
  Number(zatToZec(zat)).toLocaleString(undefined, { maximumFractionDigits: 4 });

/** "1.5" -> 150000000n. Returns null for anything that is not a positive amount with at most 8 decimals. */
export function zecToZat(input: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(input.trim());
  if (!m) return null;
  const z = BigInt(m[1]!) * ZAT_PER_ZEC + BigInt((m[2] ?? "").padEnd(8, "0") || "0");
  return z > 0n ? z : null;
}

const b64url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/**
 * ZIP-321 payment request. Wallets such as Zashi and Ywallet open it and pre-fill address, amount and memo.
 * https://zips.z.cash/zip-0321
 */
export function paymentUri(address: string, zat: bigint, memo: string): string {
  return `zcash:${address}?amount=${zatToZec(zat)}&memo=${b64url(memo)}`;
}

/** Shielded addresses only. Mirrors the backend check. */
export const isShieldedAddress = (a: string) =>
  /^(u1|utest1|uregtest1|zs1|ztestsapling1|zregtestsapling1)[a-z0-9]{30,}$/.test(a.trim());

export const shortAddr = (a: string) => (a.length > 20 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a);
