import { useEffect, useState, type ReactNode } from "react";
import { listCampaigns } from "./lib/api";
import { zatToZec } from "./lib/zcash";
import {
  Icon,
  Logo,
  SceneCommunity,
  SceneEducation,
  SceneHero,
  SceneMedical,
  SceneWater,
} from "./art";

const APP = "#/app";

function go(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function useStats() {
  const [s, setS] = useState<{ campaigns: number; donations: number; raised: number } | null>(null);
  useEffect(() => {
    let alive = true;
    listCampaigns()
      .then((rows) => {
        if (!alive || !Array.isArray(rows)) return;
        // Running totals stay private until a campaign ends, so only count the ones that revealed theirs.
        const raised = rows.reduce((a, r) => a + (r.totalZat === null ? 0n : BigInt(r.totalZat)), 0n);
        setS({
          campaigns: rows.length,
          donations: rows.reduce((a, r) => a + r.donationCount, 0),
          raised: Number(zatToZec(raised)),
        });
      })
      .catch(() => {
        /* stats are decorative; stay hidden if the coordinator is unreachable */
      });
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

function Button({
  href,
  onClick,
  children,
  variant = "primary",
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  variant?: "primary" | "secondary" | "light";
}) {
  const styles = {
    primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
    secondary: "border border-ink/15 bg-white text-ink hover:border-ink/40",
    light: "bg-white text-brand-700 hover:bg-brand-50",
  }[variant];
  const cls = `inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30 ${styles}`;
  return href ? (
    <a href={href} className={cls}>
      {children}
    </a>
  ) : (
    <button onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-brand-700">
      {children}
    </div>
  );
}

function Nav() {
  const [open, setOpen] = useState(false);
  const links: [string, string][] = [
    ["how", "How it works"],
    ["trust", "Why Sod"],
    ["use-cases", "Use cases"],
    ["privacy", "Privacy"],
    ["faq", "FAQ"],
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#/" className="flex items-center gap-2.5" onClick={() => window.scrollTo(0, 0)}>
          <Logo />
          <span className="text-xl font-extrabold tracking-tight text-ink">Sod</span>
        </a>
        <nav className="hidden items-center gap-8 md:flex">
          {links.map(([id, label]) => (
            <button
              key={id}
              onClick={() => go(id)}
              className="text-[15px] font-medium text-ink/70 hover:text-ink"
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a
            href={APP}
            className="hidden rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 sm:inline-block"
          >
            Launch app
          </a>
          <button
            aria-label="Menu"
            className="rounded-lg p-2 text-ink md:hidden"
            onClick={() => setOpen(!open)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-ink/10 bg-white px-5 pb-5 pt-2 md:hidden">
          {links.map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setOpen(false);
                go(id);
              }}
              className="block w-full py-3 text-left text-base font-medium text-ink"
            >
              {label}
            </button>
          ))}
          <a href={APP} className="mt-2 block rounded-full bg-brand-600 py-3 text-center font-semibold text-white">
            Launch app
          </a>
        </div>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-cream">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 lg:grid-cols-[1.05fr_1fr] lg:pb-28 lg:pt-20">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-600/20 bg-white px-3.5 py-1.5 text-sm font-medium text-brand-700">
            <span className="h-2 w-2 rounded-full bg-brand-500" />
            Shielded Zcash, testnet
          </div>
          <h1 className="text-[2.6rem] font-extrabold leading-[1.05] tracking-tight text-ink sm:text-6xl">
            Fundraising you can trust,{" "}
            <span className="text-brand-600">without trusting one party.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink/70">
            Every donation is a private, shielded Zcash payment held in escrow by
            a group of independent signers, not one company. Reach the goal and
            the organizer is paid. Miss it and every donor can take their money
            back. Pay from any Zcash wallet.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button href={APP}>
              Start a campaign <Icon.Arrow width={18} height={18} />
            </Button>
            <Button href={APP} variant="secondary">
              Browse campaigns
            </Button>
          </div>
          <ul className="mt-9 flex flex-wrap gap-x-7 gap-y-3 text-sm font-medium text-ink/70">
            {["Refund if the goal is missed", "No platform cut", "Shielded by default"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Icon.Check width={18} height={18} className="text-brand-600" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-xl">
          <div className="overflow-hidden rounded-[2rem] shadow-card">
            <SceneHero className="block aspect-[4/3.4] w-full" />
          </div>
          <div className="absolute -bottom-8 -left-3 w-64 rounded-2xl bg-white p-4 shadow-float sm:-left-8">
            <div className="flex items-center justify-between text-xs font-semibold text-ink/50">
              <span>EXAMPLE CAMPAIGN</span>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">Active</span>
            </div>
            <div className="mt-2 text-sm font-bold text-ink">Library for Ikorodu Primary</div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/10">
              <div className="h-full w-[78%] rounded-full bg-brand-500" />
            </div>
            <div className="mt-2 flex justify-between text-xs text-ink/60">
              <span><b className="text-ink">39</b> of 50 ZEC</span>
              <span>78%</span>
            </div>
          </div>
          <div className="absolute -right-2 top-8 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-float sm:-right-6">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-brand-700">
              <Icon.Refund />
            </span>
            <div>
              <div className="text-sm font-bold text-ink">Refund protection</div>
              <div className="text-xs text-ink/60">Enforced by the signers</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatStrip() {
  const s = useStats();
  if (!s) return null;
  const items = [
    [s.campaigns.toLocaleString(), "campaigns created"],
    [s.donations.toLocaleString(), "donations made"],
    [s.raised.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " ZEC", "raised in ended campaigns"],
  ];
  return (
    <section className="border-y border-ink/10 bg-white">
      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 text-center sm:grid-cols-3">
        {items.map(([v, l]) => (
          <div key={l}>
            <div className="text-3xl font-extrabold tracking-tight text-ink">{v}</div>
            <div className="mt-1 text-sm text-ink/60">{l}</div>
          </div>
        ))}
        <p className="text-xs text-ink/40 sm:col-span-3">
          Read live from the Sod coordinator. Running totals stay private until a campaign ends. Testnet: no real money.
        </p>
      </div>
    </section>
  );
}

function How() {
  const steps = [
    {
      icon: <Icon.User width={26} height={26} />,
      title: "Use the wallet you have",
      body: "Scan a code or tap a link and pay from Zashi, Ywallet or any Zcash wallet. There is nothing to install and no account to make.",
    },
    {
      icon: <Icon.Rocket width={26} height={26} />,
      title: "Start or back a campaign",
      body: "Organizers set a story, a goal and a deadline. Donors choose an amount and give. The money goes to a shielded escrow address, not to a person.",
    },
    {
      icon: <Icon.Heart width={26} height={26} />,
      title: "Funds go where they should",
      body: "Goal reached by the deadline? The organizer withdraws. Goal missed? Donors reclaim their full donation. Nobody has to be asked nicely.",
    },
  ];
  return (
    <section id="how" className="scroll-mt-16 bg-white py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="text-4xl font-extrabold tracking-tight text-ink">
            Three steps from idea to funded
          </h2>
          <p className="mt-4 text-lg text-ink/70">
            The familiar crowdfunding flow, with the trust handled by software
            that no single party controls.
          </p>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <div key={s.title} className="relative rounded-3xl border border-ink/10 bg-cream p-8">
              <div className="mb-6 flex items-center justify-between">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-brand-700 shadow-sm">
                  {s.icon}
                </span>
                <span className="text-5xl font-extrabold text-ink/10">0{i + 1}</span>
              </div>
              <h3 className="text-xl font-bold text-ink">{s.title}</h3>
              <p className="mt-3 leading-relaxed text-ink/70">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Trust() {
  const items = [
    {
      icon: <Icon.Refund width={24} height={24} />,
      title: "Automatic refund protection",
      body: "If a campaign ends below its goal, every donation can be refunded in full. Donors can also pull out before the deadline.",
    },
    {
      icon: <Icon.Lock width={24} height={24} />,
      title: "Funds are locked until the goal is met",
      body: "Organizers cannot touch the money early. The signers release a payout only after the deadline, only if the goal was reached, and only to the address fixed at launch.",
    },
    {
      icon: <Icon.Key width={24} height={24} />,
      title: "Works with any Zcash wallet",
      body: "Pay from any Zcash wallet with a link or QR code. Your refund secret is made in your browser, and a backup file keeps it safe.",
    },
    {
      icon: <Icon.Eye width={24} height={24} />,
      title: "Public rules, private amounts",
      body: "Goals, deadlines and payout addresses are fixed at launch and published. Donor identities and amounts stay shielded on the Zcash chain.",
    },
  ];
  return (
    <section id="trust" className="scroll-mt-16 bg-ink py-24 text-white">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid items-end gap-6 md:grid-cols-2">
          <div>
            <div className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-brand-500">
              Why Sod
            </div>
            <h2 className="text-4xl font-extrabold tracking-tight">
              Trust shouldn't depend on a stranger's word
            </h2>
          </div>
          <p className="text-lg text-white/70">
            Traditional platforms ask you to trust the organizer and the
            company. Zcash has no smart contracts, so Sod uses a threshold
            group instead: any 3 of 5 independent signers must each re-check
            the rules and agree before a single zatoshi moves.
          </p>
        </div>
        <div className="mt-14 grid gap-5 sm:grid-cols-2">
          {items.map((it) => (
            <div key={it.title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-8">
              <span className="mb-5 grid h-12 w-12 place-items-center rounded-xl bg-brand-500/15 text-brand-500">
                {it.icon}
              </span>
              <h3 className="text-xl font-bold">{it.title}</h3>
              <p className="mt-3 leading-relaxed text-white/70">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function UseCases() {
  const cases = [
    {
      Art: SceneEducation,
      tag: "Education",
      title: "Fund a school library",
      story:
        "A teacher needs 50 ZEC for books and shelves. Parents and alumni give small amounts from different countries. The doors open only once the full amount is pledged.",
      point: "Donors know the money goes to the library or comes back.",
    },
    {
      Art: SceneMedical,
      tag: "Medical",
      title: "Cover an urgent treatment",
      story:
        "A family raises money for surgery with a hard deadline. If the target isn't reached, no one is left out of pocket and donors can redirect their giving.",
      point: "Refunds go to a different address if a donor wants one.",
    },
    {
      Art: SceneWater,
      tag: "Clean water",
      title: "Dig a village well",
      story:
        "A community group raises for a borehole. Backers see the final total once the deadline passes, and the group is paid only if the whole project is covered.",
      point: "A final total anyone can check after the deadline.",
    },
    {
      Art: SceneCommunity,
      tag: "Community",
      title: "Rebuild after a flood",
      story:
        "Neighbors pool funds to repair homes. Donors who prefer not to broadcast how much they gave are covered, because shielded payments hide the amount.",
      point: "Give generously without publishing the number.",
    },
  ];
  return (
    <section id="use-cases" className="scroll-mt-16 bg-cream py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Real-world use cases</Eyebrow>
          <h2 className="text-4xl font-extrabold tracking-tight text-ink">
            Built for causes that need confidence
          </h2>
          <p className="mt-4 text-lg text-ink/70">
            Any all-or-nothing fundraiser works better when backers can see the
            rules in advance.
          </p>
        </div>
        <div className="mt-14 grid gap-8 md:grid-cols-2">
          {cases.map(({ Art, tag, title, story, point }) => (
            <article key={title} className="group overflow-hidden rounded-3xl bg-white shadow-card">
              <div className="relative overflow-hidden">
                <Art className="block aspect-[16/9] w-full transition duration-500 group-hover:scale-[1.03]" />
                <span className="absolute left-4 top-4 rounded-full bg-white/95 px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink">
                  {tag}
                </span>
              </div>
              <div className="p-7">
                <h3 className="text-2xl font-bold text-ink">{title}</h3>
                <p className="mt-3 leading-relaxed text-ink/70">{story}</p>
                <div className="mt-5 flex items-start gap-2 rounded-xl bg-brand-50 p-3.5 text-sm font-medium text-brand-900">
                  <Icon.Check width={18} height={18} className="mt-0.5 shrink-0 text-brand-600" />
                  {point}
                </div>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-ink/50">
          Scenarios are illustrative examples of how Sod works, not real campaigns.
        </p>
      </div>
    </section>
  );
}

function Walkthrough() {
  const paths = [
    {
      tone: "bg-brand-50 border-brand-600/20",
      chip: "bg-brand-600 text-white",
      label: "Goal reached",
      steps: [
        "Day 1: Amara opens a 50 ZEC campaign for a school library, ending in 30 days.",
        "Day 12: Chidi donates 0.5 ZEC from his wallet. The escrow holds it and his browser keeps a refund receipt.",
        "Day 30: The total hits 51 ZEC. The deadline passes.",
        "The signers release the full amount to Amara's address. No one else can receive it.",
      ],
    },
    {
      tone: "bg-amber-50 border-amber-500/30",
      chip: "bg-amber-600 text-white",
      label: "Goal missed",
      steps: [
        "Same campaign, same 0.5 ZEC donation from Chidi on day 12.",
        "Day 30: The total reaches only 32 ZEC. The deadline passes.",
        "The campaign is marked failed and refunds open automatically.",
        "Chidi uses his receipt and gets his 0.5 ZEC back (less a tiny network fee), to the shielded address he chose.",
      ],
    },
  ];
  return (
    <section className="bg-white py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Follow a donation</Eyebrow>
          <h2 className="text-4xl font-extrabold tracking-tight text-ink">
            One donation, two possible endings
          </h2>
          <p className="mt-4 text-lg text-ink/70">
            Either way, the donor is protected and the outcome is decided by the
            deadline, not by anyone's discretion.
          </p>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {paths.map((p) => (
            <div key={p.label} className={`rounded-3xl border p-8 ${p.tone}`}>
              <span className={`inline-block rounded-full px-3.5 py-1 text-sm font-bold ${p.chip}`}>
                {p.label}
              </span>
              <ol className="mt-6 space-y-5">
                {p.steps.map((t, i) => (
                  <li key={i} className="flex gap-4">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-sm font-bold text-ink shadow-sm">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed text-ink/80">{t}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-ink/50">
          Names and amounts are fictional, used to illustrate the flow.
        </p>
      </div>
    </section>
  );
}

function Privacy() {
  return (
    <section id="privacy" className="scroll-mt-16 bg-cream py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 lg:grid-cols-2">
        <div>
          <Eyebrow>Privacy</Eyebrow>
          <h2 className="text-4xl font-extrabold tracking-tight text-ink">
            Give without announcing who or how much
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-ink/70">
            Donations are shielded Zcash payments. On the public chain there is
            no donor address and no amount, only an encrypted transaction. The
            refund secret and the refund address are bound together, so nobody
            who learns the secret can redirect your refund.
          </p>
          <p className="mt-4 leading-relaxed text-ink/70">
            We're upfront about the limits: the escrow signers hold the viewing
            key for the campaign address, so they can see amounts and refund
            addresses. Your own wallet and exchange history are outside what Sod
            can protect, and the escrow is only as trustworthy as its signer
            group.
          </p>
          <div className="mt-8">
            <Button href={APP}>Browse campaigns</Button>
          </div>
        </div>
        <div className="rounded-3xl bg-white p-8 shadow-card">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="mb-4 flex items-center gap-2 font-bold text-brand-700">
                <Icon.EyeOff width={20} height={20} /> Hidden from the public
              </div>
              <ul className="space-y-3 text-sm text-ink/80">
                {["Who donated", "Each donation amount", "Refund and payout amounts"].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <Icon.Lock width={16} height={16} className="text-brand-600" /> {t}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-4 flex items-center gap-2 font-bold text-ink/70">
                <Icon.Eye width={20} height={20} /> Visible to the signers
              </div>
              <ul className="space-y-3 text-sm text-ink/70">
                {["Donation amounts", "Refund addresses", "Goal and deadline"].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-ink/30" /> {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-8 rounded-2xl bg-ink p-5 font-mono text-xs leading-relaxed text-white/80">
            <div className="text-white/40">// what a chain observer sees</div>
            <div>orchard_action(</div>
            <div className="pl-4">value: <span className="text-brand-500">hidden</span>,</div>
            <div className="pl-4">memo: <span className="text-brand-500">encrypted</span>)</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const qs: [string, string][] = [
    [
      "Do I need to know anything about crypto?",
      "You need a Zcash wallet such as Zashi or Ywallet. Sod gives you a payment link or QR code with the amount and a memo filled in, so you just approve the payment.",
    ],
    [
      "What happens if a campaign doesn't reach its goal?",
      "It is marked failed shortly after the deadline and refunds open. Each donor reclaims their donation using the receipt saved when they gave. The refund goes to the shielded address you gave at donation time, minus a tiny network fee.",
    ],
    [
      "Can the organizer take the money early?",
      "No. The signers only release a payout after the deadline, and only if the goal was reached. It always goes to the address the organizer fixed at launch.",
    ],
    [
      "Who are the signers, and can they steal the money?",
      "Zcash has no smart contracts, so the escrow key is split among independent signers (FROST threshold signatures). Each signer re-derives every payout from the public rules before signing. It takes 3 of the 5 signers colluding to break the rules, which is a weaker guarantee than a contract, so pick signers you trust.",
    ],
    [
      "What is the memo, and why must I include it?",
      "The memo carries a commitment to your refund secret and address. Without it, nobody can prove a payment is yours, so it can't be counted toward the goal or refunded. The payment link fills it in for you.",
    ],
    [
      "What currency does it use?",
      "ZEC. Sod currently runs against testnet or a demo network, so no real money is involved.",
    ],
    [
      "Is it audited and ready for real funds?",
      "Not yet. Sod is a prototype and has not been security audited. Please don't use it with real money until that changes.",
    ],
  ];
  return (
    <section id="faq" className="scroll-mt-16 bg-white py-24">
      <div className="mx-auto max-w-3xl px-5">
        <div className="text-center">
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="text-4xl font-extrabold tracking-tight text-ink">Questions, answered</h2>
        </div>
        <div className="mt-12 divide-y divide-ink/10 rounded-3xl border border-ink/10">
          {qs.map(([q, a]) => (
            <details key={q} className="group px-7 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold text-ink">
                {q}
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cream text-xl text-brand-700 transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 pr-10 leading-relaxed text-ink/70">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="bg-white px-5 pb-24">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-brand-700 px-8 py-16 text-center text-white">
        <h2 className="mx-auto max-w-2xl text-4xl font-extrabold tracking-tight">
          Ready to raise money people can trust?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-white/80">
          Launch the app and start your first campaign, or back someone
          else's from your Zcash wallet.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button href={APP} variant="light">
            Launch app <Icon.Arrow width={18} height={18} />
          </Button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-ink/10 bg-cream">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-12 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <Logo className="h-7 w-7" />
            <span className="text-lg font-extrabold text-ink">Sod</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink/60">
            Private crowdfunding on Zcash. Funds held by a threshold escrow,
            refunds enforced by independent signers.
          </p>
        </div>
        <div className="max-w-md text-sm leading-relaxed text-ink/50">
          <b className="text-ink/70">Prototype.</b> Not audited. Donations are
          shielded on-chain, but the escrow signers can see amounts and refund
          addresses, and the escrow is only as trustworthy as its signer group.
        </div>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className="font-sans text-ink">
      <Nav />
      <Hero />
      <StatStrip />
      <How />
      <Trust />
      <UseCases />
      <Walkthrough />
      <Privacy />
      <Faq />
      <Cta />
      <Footer />
    </div>
  );
}
