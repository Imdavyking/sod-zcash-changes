import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Logo } from "./art";
import { CampaignFields, CampaignHeader } from "./CampaignFields";
import {
  EMPTY_INFO,
  validateInfo,
  type CampaignInfoData,
} from "./lib/campaignInfo";
import * as api from "./lib/api";
import type { Campaign, Config, DonationStatus } from "./lib/api";
import { computeCommitment, encodeMemo, newNonce, newSecret } from "./lib/commitment";
import {
  downloadReceipt,
  loadReceipts,
  saveReceipt,
  type Receipt,
} from "./lib/refunds";
import {
  fmtZec,
  isShieldedAddress,
  paymentUri,
  shortAddr,
  zatToZec,
  zecToZat,
} from "./lib/zcash";

type Status = { kind: "info" | "error" | "ok"; text: string } | null;

const errMsg = (e: unknown) => (e as Error)?.message || "Something went wrong";

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>(() => loadReceipts());
  const [donations, setDonations] = useState<Record<string, DonationStatus>>({});
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const rows = await api.listCampaigns();
      setCampaigns(rows);
      const mine = loadReceipts();
      setReceipts(mine);
      const entries = await Promise.all(
        mine.map(async (r) => [r.commitment, await api.getDonation(r.campaignId, r.commitment)] as const),
      );
      setDonations(Object.fromEntries(entries));
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => setOffline(true));
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  /** `fn` may return a sentence to show instead of the generic "done". */
  async function run<T>(label: string, fn: () => Promise<T>) {
    setBusy(true);
    setStatus({ kind: "info", text: `${label}…` });
    try {
      const out = await fn();
      await refresh();
      setStatus({ kind: "ok", text: typeof out === "string" ? out : `${label}: done` });
      return out;
    } catch (e) {
      setStatus({ kind: "error", text: `${label}: ${errMsg(e)}` });
    } finally {
      setBusy(false);
    }
  }

  const create = (info: CampaignInfoData, goal: string, deadline: string, creatorAddress: string) =>
    run("Creating campaign", () =>
      api.createCampaign({
        name: info.name.trim(),
        description: info.description.trim(),
        imageURI: info.imageURI.trim(),
        goalZat: zecToZat(goal)!.toString(),
        deadline: Math.floor(new Date(deadline).getTime() / 1000),
        creatorAddress: creatorAddress.trim(),
        nonce: newNonce(),
      }),
    );

  const refund = (r: Receipt) =>
    run("Refunding", async () => {
      const out = await api.refund(r.campaignId, r.secret, r.refundTo);
      if (!out.ok) throw new Error(api.reasonText(out.reason));
      return `Refund sent: ${zatToZec(out.payoutZat)} ZEC to ${shortAddr(r.refundTo)}. It arrives after the next confirmations.`;
    });

  const release = (c: Campaign) =>
    run("Releasing payout", async () => {
      const out = await api.withdraw(c.id);
      if (!out.ok) throw new Error(api.reasonText(out.reason));
      return `Payout released: ${zatToZec(out.payoutZat)} ZEC to the creator.`;
    });

  const mock = config?.network === "mock";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <a href="#/" className="flex items-center gap-2.5" title="Back to home">
            <Logo />
            <span className="text-xl font-extrabold tracking-tight">Sod</span>
            <span className="hidden rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 sm:inline">
              {mock ? "Demo network" : config?.network === "mainnet" ? "Zcash" : "Zcash testnet"}
            </span>
          </a>
          <span className="text-sm text-slate-400">Pay from any Zcash wallet</span>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-slate-400">
            Back a cause, or start your own. Refunds are guaranteed if the goal is missed.
          </p>
        </div>

        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <strong>Shielded, not anonymous end to end.</strong> Donations are shielded Zcash payments, so
          outsiders see neither who gave nor how much. The escrow signers can see amounts, and your
          wallet's own history is yours to protect. Not audited.{" "}
          {mock
            ? "This is a demo network: no real ZEC moves."
            : config?.network !== "mainnet"
              ? "Testnet only."
              : ""}
        </div>

        {offline && (
          <div className="mb-6 rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-300">
            Can't reach the Sod coordinator. Start it with{" "}
            <code className="text-emerald-400">npm run dev</code> in <code>sod-zcash</code>, or set{" "}
            <code className="text-emerald-400">VITE_SOD_API</code>.
          </div>
        )}

        {status && (
          <div
            className={`mb-6 rounded-lg p-3 text-sm ${
              status.kind === "error"
                ? "bg-red-500/10 text-red-300"
                : status.kind === "ok"
                  ? "bg-emerald-500/10 text-emerald-300"
                  : "bg-slate-800 text-slate-300"
            }`}
          >
            {status.text}
          </div>
        )}

        {!offline && <CreateForm onCreate={create} busy={busy} />}

        <section className="mt-8 space-y-4">
          <h2 className="text-lg font-bold">All campaigns</h2>
          {campaigns.length === 0 && !offline && (
            <p className="text-sm text-slate-500">No campaigns yet.</p>
          )}
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              c={c}
              mock={mock}
              busy={busy}
              receipts={receipts.filter((r) => r.campaignId === c.id)}
              donations={donations}
              onRefund={refund}
              onRelease={release}
              onChanged={refresh}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

function CreateForm({
  onCreate,
  busy,
}: {
  onCreate: (info: CampaignInfoData, goal: string, deadline: string, creatorAddress: string) => void;
  busy: boolean;
}) {
  const [info, setInfo] = useState<CampaignInfoData>(EMPTY_INFO);
  const [goal, setGoal] = useState("");
  const [deadline, setDeadline] = useState("");
  const [creator, setCreator] = useState("");
  const addrOk = isShieldedAddress(creator);
  const valid =
    !validateInfo(info) &&
    zecToZat(goal) !== null &&
    !!deadline &&
    new Date(deadline).getTime() > Date.now() &&
    addrOk;
  return (
    <form
      className="space-y-3 rounded-2xl border border-ink/10 bg-white p-5 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onCreate(info, goal, deadline, creator);
      }}
    >
      <h2 className="font-semibold">Start a campaign</h2>
      <CampaignFields value={info} onChange={setInfo} />
      <div>
        <input
          className="w-full rounded-md bg-slate-800 px-3 py-2 font-mono text-xs"
          placeholder="Your shielded payout address (u1… or zs1…)"
          value={creator}
          onChange={(e) => setCreator(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          Fixed when the campaign is created. If the goal is met, the escrow pays this address and no
          other. Use a unified address with an Orchard receiver; transparent t-addresses are refused.
        </p>
        {creator && !addrOk && (
          <p className="mt-1 text-xs text-red-300">That doesn't look like a shielded Zcash address.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <input
          className="w-40 rounded-md bg-slate-800 px-3 py-2 text-sm"
          placeholder="Goal (ZEC)"
          inputMode="decimal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
        <input
          className="rounded-md bg-slate-800 px-3 py-2 text-sm"
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
        <button
          disabled={!valid || busy}
          className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </form>
  );
}

const STATE_LABEL: Record<Campaign["status"], { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-sky-500/20 text-sky-300" },
  settling: { label: "Ended · settling", cls: "bg-amber-500/20 text-amber-300" },
  funded: { label: "Funded", cls: "bg-emerald-500/20 text-emerald-300" },
  paid_out: { label: "Paid out", cls: "bg-slate-500/20 text-slate-300" },
  failed: { label: "Failed · refunds open", cls: "bg-red-500/20 text-red-300" },
};

function CampaignCard(props: {
  c: Campaign;
  mock: boolean;
  busy: boolean;
  receipts: Receipt[];
  donations: Record<string, DonationStatus>;
  onRefund: (r: Receipt) => void;
  onRelease: (c: Campaign) => void;
  onChanged: () => void;
}) {
  const { c, busy, receipts, donations } = props;
  const [amount, setAmount] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [pay, setPay] = useState<{ receipt: Receipt; uri: string; memo: string } | null>(null);

  const goal = BigInt(c.goalZat);
  const total = c.totalZat === null ? null : BigInt(c.totalZat);
  const pct = total === null || goal === 0n ? 0 : Math.min(100, Number((total * 100n) / goal));
  const state = STATE_LABEL[c.status];
  const open = c.status === "active";
  const amountZat = zecToZat(amount);
  const canDonate = open && amountZat !== null && isShieldedAddress(refundTo);

  const startDonation = () => {
    if (!canDonate || amountZat === null) return;
    // Persist the secret BEFORE showing payment details, so a closed tab can never strand a donation.
    const secret = newSecret();
    const to = refundTo.trim();
    const commitment = computeCommitment(c.id, secret, to);
    const receipt: Receipt = {
      campaignId: c.id,
      secret,
      commitment,
      refundTo: to,
      amountZat: amountZat.toString(),
      createdAt: Date.now(),
    };
    saveReceipt(receipt);
    downloadReceipt(receipt);
    const memo = encodeMemo(commitment);
    setPay({ receipt, uri: paymentUri(c.escrowAddress, amountZat, memo), memo });
    props.onChanged();
  };

  const endsText = useMemo(
    () => new Date(c.deadline * 1000).toLocaleString(),
    [c.deadline],
  );

  return (
    <article className="rounded-2xl border border-ink/10 bg-white p-5 shadow-sm">
      <CampaignHeader id={c.id} info={c} />
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs text-slate-500">#{c.id.slice(0, 8)}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${state.cls}`}>{state.label}</span>
      </div>

      {total !== null ? (
        <>
          <div className="mb-1 h-2 overflow-hidden rounded bg-slate-800">
            <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="mb-3 flex justify-between text-sm text-slate-400">
            <span>
              {fmtZec(total)} / {fmtZec(goal)} ZEC
            </span>
            <span>
              {open ? "Ends" : "Ended"} {endsText}
            </span>
          </div>
        </>
      ) : (
        <div className="mb-3 flex justify-between text-sm text-slate-400">
          <span>
            Goal {fmtZec(goal)} ZEC · progress hidden until the deadline
          </span>
          <span>Ends {endsText}</span>
        </div>
      )}
      <div className="mb-3 text-xs text-slate-500">
        Payout to <span className="font-mono">{shortAddr(c.creatorAddress)}</span> ·{" "}
        {c.donationCount} donation{c.donationCount === 1 ? "" : "s"}
      </div>

      {open && !pay && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              className="w-32 rounded-md bg-slate-800 px-3 py-2 text-sm"
              placeholder="Amount (ZEC)"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              className="min-w-0 flex-1 rounded-md bg-slate-800 px-3 py-2 font-mono text-xs"
              placeholder="Your shielded address, for refunds (u1… or zs1…)"
              value={refundTo}
              onChange={(e) => setRefundTo(e.target.value)}
            />
            <button
              disabled={!canDonate || busy}
              onClick={startDonation}
              className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-40"
            >
              Donate
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Zcash payments don't reveal a sender, so a refund goes to the address you give here. It is
            locked into your donation and nobody can change it.
          </p>
        </div>
      )}

      {pay && (
        <PaymentPanel
          c={c}
          pay={pay}
          status={donations[pay.receipt.commitment]}
          onClose={() => setPay(null)}
        />
      )}

      {c.status === "funded" && (
        <button
          disabled={busy}
          onClick={() => props.onRelease(c)}
          className="mt-2 rounded-full bg-emerald-500 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-40"
        >
          Release payout to the creator
        </button>
      )}
      {c.status === "funded" && (
        <p className="mt-1 text-xs text-slate-500">
          Anyone can press this. The funds go only to the creator address fixed at launch.
        </p>
      )}

      {props.mock && <DevTools c={c} onChanged={props.onChanged} />}

      {receipts.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Your donations on this device
          </div>
          <ul className="space-y-2">
            {receipts.map((r) => {
              const d = donations[r.commitment];
              const held = d?.status === "held" || d?.status === "late";
              const canRefund =
                (d?.status === "late") ||
                (d?.status === "held" && (c.status === "active" || c.status === "failed"));
              return (
                <li key={r.commitment} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">
                    {fmtZec(d && d.status !== "unknown" ? d.valueZat : r.amountZat)} ZEC{" "}
                    <span className="text-xs text-slate-500">
                      {!d || d.status === "unknown"
                        ? "(waiting for payment)"
                        : d.status === "refunded"
                          ? "(refunded)"
                          : d.status === "late"
                            ? "(arrived after the deadline: refundable)"
                            : "(received)"}
                    </span>
                  </span>
                  <span className="flex gap-3">
                    <button
                      onClick={() => downloadReceipt(r)}
                      className="text-xs text-slate-400 hover:underline"
                    >
                      Back up
                    </button>
                    {held && canRefund && (
                      <button
                        disabled={busy}
                        onClick={() => props.onRefund(r)}
                        className="text-xs text-amber-300 hover:underline disabled:opacity-50"
                      >
                        Refund
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Refund secrets live only in this browser. Use Back up so you can refund from another device.
          </p>
        </div>
      )}
    </article>
  );
}

function PaymentPanel({
  c,
  pay,
  status,
  onClose,
}: {
  c: Campaign;
  pay: { receipt: Receipt; uri: string; memo: string };
  status: DonationStatus | undefined;
  onClose: () => void;
}) {
  const received = status && status.status !== "unknown";
  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});
  return (
    <div className="rounded-xl border border-brand-600/20 bg-brand-50 p-4 text-sm text-ink">
      {received ? (
        <>
          <div className="font-semibold text-brand-700">
            Received {fmtZec((status as { valueZat: string }).valueZat)} ZEC. Thank you!
          </div>
          <p className="mt-1 text-ink/70">
            Your refund receipt was downloaded and is saved in this browser. Keep the backup.
          </p>
          <button onClick={onClose} className="mt-3 text-xs font-semibold text-brand-700 hover:underline">
            Done
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="shrink-0 rounded-lg bg-white p-2 shadow-sm">
            <QRCodeSVG value={pay.uri} size={160} />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="font-semibold">
              Send {zatToZec(pay.receipt.amountZat)} ZEC from your Zcash wallet
            </div>
            <a
              href={pay.uri}
              className="inline-block rounded-full bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Open in wallet
            </a>
            <p className="text-xs text-ink/70">
              Or scan the code. Doing it by hand? Send to this shielded address and paste the memo
              exactly, or your donation can't be counted or refunded.
            </p>
            <div className="break-all rounded bg-white px-2 py-1 font-mono text-[11px]">
              {c.escrowAddress}{" "}
              <button onClick={() => copy(c.escrowAddress)} className="font-sans text-brand-700 hover:underline">
                copy
              </button>
            </div>
            <div className="break-all rounded bg-white px-2 py-1 font-mono text-[11px]">
              {pay.memo}{" "}
              <button onClick={() => copy(pay.memo)} className="font-sans text-brand-700 hover:underline">
                copy
              </button>
            </div>
            <p className="text-xs text-ink/60">
              Waiting for the payment. It shows up here after about 3 confirmations (a few minutes).
            </p>
            <button onClick={onClose} className="text-xs font-semibold text-ink/60 hover:underline">
              Close (the payment can still arrive)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Only shown against the demo server: pretend to be a donor's wallet, and move time forward. */
function DevTools({ c, onChanged }: { c: Campaign; onChanged: () => void }) {
  const latest = loadReceipts()
    .filter((r) => r.campaignId === c.id)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const [amount, setAmount] = useState(latest ? zatToZec(latest.amountZat) : "1");
  const [note, setNote] = useState("");
  return (
    <div className="mt-3 rounded-lg border border-dashed border-ink/20 p-3 text-xs text-slate-400">
      <div className="mb-2 font-semibold uppercase tracking-wide">Demo controls</div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded-full bg-slate-800 px-3 py-1 hover:bg-slate-700"
          onClick={async () => {
            await api.dev.advanceTo(c.deadline + 20 * 60);
            setNote("Moved the fake chain past the deadline and settlement window.");
            onChanged();
          }}
        >
          Skip past the deadline
        </button>
        <span>
          Stand in for your wallet and pay the donation you started above:{" "}
          <input
            className="w-16 rounded bg-slate-800 px-2 py-0.5"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />{" "}
          ZEC
        </span>
        <button
          className="rounded-full bg-slate-800 px-3 py-1 hover:bg-slate-700"
          onClick={async () => {
            const last = loadReceipts()
              .filter((r) => r.campaignId === c.id)
              .sort((a, b) => b.createdAt - a.createdAt)[0];
            const zat = zecToZat(amount);
            if (!last || zat === null) return setNote("Start a donation first (it creates the memo).");
            await api.dev.donate(c.id, zat.toString(), last.commitment);
            setNote(`Simulated a ${amount} ZEC shielded payment with your memo.`);
            onChanged();
          }}
        >
          Simulate the wallet payment
        </button>
      </div>
      {note && <div className="mt-2">{note}</div>}
    </div>
  );
}
