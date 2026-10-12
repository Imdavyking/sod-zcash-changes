/**
 * A donation is a plain shielded payment to the campaign's escrow address with this text memo:
 *
 *     sod1:<64 hex chars of the refund commitment>
 *
 * Text memos work in every Zcash wallet (and in a ZIP-321 payment link), so donors need no special software.
 * A donation without a valid memo cannot be refunded (nobody can prove it is theirs) and is never counted.
 */
export const MEMO_PREFIX = "sod1:";

export function encodeMemo(commitment: string): string {
  return MEMO_PREFIX + commitment;
}

export function parseMemo(memo: string | null): string | null {
  if (!memo) return null;
  const m = /^sod1:([0-9a-f]{64})$/.exec(memo.trim());
  return m ? (m[1] as string) : null;
}
