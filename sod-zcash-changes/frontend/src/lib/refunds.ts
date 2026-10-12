/** Receipt the donor needs to refund later. The secret never leaves the browser until a refund. */
export interface Receipt {
  campaignId: string;
  secret: string;
  commitment: string;
  /** Shielded address the refund will be paid to. It is bound into the commitment. */
  refundTo: string;
  /** Amount the donor intended to send, in zatoshi. The escrow's view is authoritative. */
  amountZat: string;
  createdAt: number;
}

const KEY = "sod:receipts:zcash:v1";

export function loadReceipts(): Receipt[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveReceipt(r: Receipt) {
  try {
    const all = loadReceipts().filter((x) => x.commitment !== r.commitment);
    all.push(r);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage blocked: the donor still gets the downloaded backup */
  }
}

export function downloadReceipt(r: Receipt) {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sod-refund-${r.campaignId.slice(0, 8)}-${r.commitment.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
