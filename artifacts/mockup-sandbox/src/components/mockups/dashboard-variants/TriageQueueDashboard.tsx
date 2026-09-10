import { useState } from "react";
import "./triage-queue-dashboard.css";

/**
 * TriageQueueDashboard — a fundamentally different hypothesis for the BMS home screen.
 *
 * Instead of a metrics-grid overview, the dashboard IS the work queue:
 * every item that needs the dealer's attention is ranked by urgency and
 * rendered as an actionable card with inline one-tap actions. Numbers only
 * appear as a compact "day pulse" strip. The mental model shifts from
 * "how is my shop doing?" to "what do I do next?"
 */

type Urgency = "now" | "waiting" | "moving";

interface QueueItem {
  id: string;
  urgency: Urgency;
  icon: string;
  title: string;
  sub: string;
  meta: string;
  action: string;
  actionIcon: string;
  device?: string;
}

const INITIAL_ITEMS: QueueItem[] = [
  {
    id: "q1", urgency: "now", icon: "₹",
    title: "Estimate approval pending 2 days",
    sub: "Ramesh Traders · LED TV 43\" panel swap",
    meta: "₹4,850 quote sent Tue",
    action: "Call now", actionIcon: "call", device: "Samsung UA43",
  },
  {
    id: "q2", urgency: "now", icon: "!",
    title: "Part out of stock, repair blocked",
    sub: "IR2153 driver IC · needed for 2 open jobs",
    meta: "0 left · min 5",
    action: "Order part", actionIcon: "cart",
  },
  {
    id: "q3", urgency: "now", icon: "✓",
    title: "Ready 3 days — customer not informed",
    sub: "Shobha Nair · Mixer grinder, motor rewound",
    meta: "Bench 2 · ₹720 due",
    action: "Send SMS", actionIcon: "msg", device: "Preethi Blue Leaf",
  },
  {
    id: "q4", urgency: "waiting", icon: "◔",
    title: "Backdated entry needs your approval",
    sub: "Suresh (technician) · expense ₹340 on 12 Jan",
    meta: "Requested 4h ago",
    action: "Review", actionIcon: "eye",
  },
  {
    id: "q5", urgency: "waiting", icon: "◔",
    title: "Diagnosis overdue on intake",
    sub: "Anil Kumar · Home theatre, no power",
    meta: "Received 26h ago · unassigned",
    action: "Assign tech", actionIcon: "user",
  },
  {
    id: "q6", urgency: "moving", icon: "→",
    title: "Testing since this morning",
    sub: "Vasanth · Soundbar amplifier board",
    meta: "Karthik on it · Bench 1",
    action: "View", actionIcon: "eye",
  },
  {
    id: "q7", urgency: "moving", icon: "→",
    title: "Parts arrived, repair resuming",
    sub: "Lakshmi Stores · CCTV SMPS, cap kit fitted",
    meta: "ETA today 6 PM",
    action: "View", actionIcon: "eye",
  },
];

const URGENCY_META: Record<Urgency, { label: string; hint: string; cls: string }> = {
  now: { label: "Needs you now", hint: "Blocking money or a customer", cls: "tqd-band-now" },
  waiting: { label: "Waiting on a decision", hint: "One tap unblocks these", cls: "tqd-band-wait" },
  moving: { label: "Moving on its own", hint: "No action needed — just awareness", cls: "tqd-band-move" },
};

const PULSE = [
  { label: "In today", value: "4" },
  { label: "Out today", value: "2" },
  { label: "Cash in", value: "₹6,420" },
  { label: "Due to you", value: "₹11,370" },
];

function ActionGlyph({ kind }: { kind: string }) {
  const paths: Record<string, React.JSX.Element> = {
    call: <path d="M4 3h3l1.5 4-2 1.5a11 11 0 0 0 5 5L13 11.5l4 1.5v3a1.5 1.5 0 0 1-1.7 1.5C8.6 16.7 3.3 11.4 2.5 4.7A1.5 1.5 0 0 1 4 3Z" />,
    cart: <path d="M3 4h2l2 9h8l2-6H7M9 17.5a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1Zm6 0a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1Z" />,
    msg: <path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8l-4 3v-3H5a2 2 0 0 1-2-2V5Z" />,
    eye: <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Zm8 2.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" />,
    user: <path d="M10 9.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM3.5 17c.7-3 3.3-4.6 6.5-4.6s5.8 1.6 6.5 4.6" />,
  };
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {paths[kind] ?? paths.eye}
    </svg>
  );
}

export default function TriageQueueDashboard() {
  const [done, setDone] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  const items = INITIAL_ITEMS.filter((i) => !done.includes(i.id));
  const nowCount = items.filter((i) => i.urgency === "now").length;

  const handle = (id: string) => {
    setFlash(id);
    setTimeout(() => {
      setDone((d) => [...d, id]);
      setFlash(null);
    }, 420);
  };

  const bands: Urgency[] = ["now", "waiting", "moving"];

  return (
    <div className="tqd-root">
      <div className="tqd-noise" />

      {/* Header */}
      <header className="tqd-header">
        <div className="tqd-header-row">
          <div>
            <p className="tqd-kicker">Thursday · 5 Feb</p>
            <h1 className="tqd-title">
              {nowCount > 0 ? (
                <>{nowCount} thing{nowCount > 1 ? "s" : ""} need<span className="tqd-title-accent"> you now</span></>
              ) : (
                <>All clear.<span className="tqd-title-accent"> Shop is flowing.</span></>
              )}
            </h1>
          </div>
          <div className="tqd-avatar">VE</div>
        </div>

        {/* Day pulse strip — replaces the stat grid */}
        <div className="tqd-pulse">
          {PULSE.map((p, i) => (
            <div key={p.label} className="tqd-pulse-cell" style={{ animationDelay: `${i * 70}ms` }}>
              <span className="tqd-pulse-value">{p.value}</span>
              <span className="tqd-pulse-label">{p.label}</span>
            </div>
          ))}
        </div>
      </header>

      {/* Queue */}
      <main className="tqd-queue">
        {bands.map((band) => {
          const bandItems = items.filter((i) => i.urgency === band);
          if (bandItems.length === 0) return null;
          const meta = URGENCY_META[band];
          return (
            <section key={band} className={`tqd-band ${meta.cls}`}>
              <div className="tqd-band-head">
                <span className="tqd-band-dot" />
                <h2 className="tqd-band-label">{meta.label}</h2>
                <span className="tqd-band-hint">{meta.hint}</span>
              </div>

              <div className="tqd-cards">
                {bandItems.map((item, i) => (
                  <article
                    key={item.id}
                    className={`tqd-card ${flash === item.id ? "tqd-card-clearing" : ""}`}
                    style={{ animationDelay: `${120 + i * 80}ms` }}
                  >
                    <div className="tqd-card-glyph">{item.icon}</div>
                    <div className="tqd-card-body">
                      <h3 className="tqd-card-title">{item.title}</h3>
                      <p className="tqd-card-sub">{item.sub}</p>
                      <div className="tqd-card-meta-row">
                        <span className="tqd-card-meta">{item.meta}</span>
                        {item.device && <span className="tqd-chip">{item.device}</span>}
                      </div>
                    </div>
                    <div className="tqd-card-actions">
                      <button className="tqd-act-primary" onClick={() => handle(item.id)}>
                        <ActionGlyph kind={item.actionIcon} />
                        {item.action}
                      </button>
                      <button className="tqd-act-snooze" onClick={() => handle(item.id)}>
                        Later
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}

        {items.length === 0 && (
          <div className="tqd-empty">
            <div className="tqd-empty-ring">✓</div>
            <p className="tqd-empty-title">Queue cleared</p>
            <p className="tqd-empty-sub">Everything else is moving on its own. New items appear here as they need you.</p>
          </div>
        )}

        <p className="tqd-footnote">Ranked by what's blocking money or a customer · updated live</p>
      </main>

      {/* Bottom bar */}
      <nav className="tqd-nav">
        {[
          { l: "Queue", active: true },
          { l: "Repairs" },
          { l: "Customers" },
          { l: "Stock" },
          { l: "More" },
        ].map((t) => (
          <button key={t.l} className={`tqd-nav-item ${t.active ? "tqd-nav-active" : ""}`}>
            {t.l}
          </button>
        ))}
      </nav>
    </div>
  );
}
