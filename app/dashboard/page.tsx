"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { money, isOverdue, daysLate } from "@/lib/format";
import { Card, KpiTile, VBars, GroupedVBars, Donut, HBars, ComingSoon } from "./charts";

interface InvoiceRow { id: string; invoice_date: string; due_date: string | null; total: number; status: string; customer_id: string; customers: { name: string } | null; }
interface ReceiptRow { receipt_date: string; amount: number; mode: string; customer_id: string; }
interface CustomerRow { id: string; name: string; credit_limit: number; address: string | null; }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STORE_KEY = "ar-dash-config-v4";

/* Widget catalogue. render() returns the inner content for the given metrics. */
interface Metrics {
  run: boolean;
  customerCount: number; invoiceCount: number;
  dso: number; cei: number; totalOutstanding: number; overduePct: number; overdueOutstanding: number;
  ageing: { label: string; value: number; color: string }[];
  statusSeg: { label: string; value: number; color: string }[];
  months: string[]; invoicedByMonth: number[]; collectedByMonth: number[];
  topOverdue: { name: string; value: number }[];
  receiptsMode: { label: string; value: number; color: string }[]; receiptsTotal: number; receiptCount: number;
  creditUtil: { name: string; value: number; label: string; danger: boolean }[];
  badDebt90: number; badDebtPct: number; badDebtCustomers: { name: string; value: number }[];
  forecast: { label: string; value: number; color: string }[];
}

interface WidgetDef { id: string; title: string; subtitle?: string; span: 1 | 2 | 3; comingSoon?: string; kpi?: boolean; render?: (m: Metrics) => ReactNode; }

const WIDGETS: WidgetDef[] = [
  { id: "kpis", title: "Key AR metrics", span: 3, kpi: true },
  { id: "ageing", title: "AR Ageing — outstanding by bucket", subtitle: "How much is owed, grouped by how late it is (INR). Blue = current, amber = watch, red = critical.", span: 2, render: (m) => <VBars bars={m.ageing} run={m.run} /> },
  { id: "status", title: "Invoices by status", subtitle: "Portfolio mix across all invoices.", span: 1, render: (m) => <Donut segments={m.statusSeg} total={m.invoiceCount} run={m.run} /> },
  { id: "trend", title: "Invoiced vs Collected — by month", subtitle: "Cash raised vs cash received each month (INR).", span: 2, render: (m) => <GroupedVBars categories={m.months} seriesA={{ name: "Invoiced", color: "var(--brand)", values: m.invoicedByMonth }} seriesB={{ name: "Collected", color: "#16a34a", values: m.collectedByMonth }} run={m.run} /> },
  { id: "topOverdue", title: "Top overdue customers", subtitle: "Who to chase first — overdue outstanding (INR).", span: 1, render: (m) => <HBars rows={m.topOverdue} run={m.run} /> },
  { id: "receiptsMode", title: "Receipts by mode", subtitle: "How customers are paying.", span: 1, render: (m) => <Donut segments={m.receiptsMode} total={m.receiptsTotal} run={m.run} centerLabel={`${m.receiptCount}`} valueFmt={money} /> },
  { id: "creditUtil", title: "Credit-limit utilisation", subtitle: "Outstanding vs each customer's credit limit. Red = over limit.", span: 2, render: (m) => <HBars rows={m.creditUtil} run={m.run} /> },
  { id: "badDebt", title: "Bad-debt risk (90+ days)", subtitle: "Outstanding past 90 days — highest risk of turning bad.", span: 1, render: (m) => (
    <div>
      <p className="text-3xl font-bold tabular-nums text-red-600">{money(m.badDebt90)}</p>
      <p className="mb-4 text-xs text-muted">{m.badDebtPct.toFixed(1)}% of total outstanding</p>
      <HBars rows={m.badDebtCustomers} run={m.run} />
    </div>
  ) },
  { id: "cashForecast", title: "Cash forecast — expected inflows", subtitle: "Outstanding grouped by when it's due (INR). A dashboard summary of expected collections.", span: 2, render: (m) => <VBars bars={m.forecast} run={m.run} /> },
  { id: "glSales", title: "GL-head-wise sales", span: 1, comingSoon: "Invoices aren't linked to GL accounts in the data yet, so sales can't be split by ledger head." },
  { id: "collector", title: "Collector performance", span: 1, comingSoon: "Needs a collector/agent assigned per invoice or receipt — not captured in the data yet." },
  { id: "dispute", title: "Dispute rate", span: 1, comingSoon: "Needs a 'disputed' flag on invoices — not captured in the data yet." },
];

const DEFAULT_WIDGETS = ["kpis", "trend", "status", "ageing", "topOverdue", "receiptsMode", "creditUtil", "badDebt", "cashForecast", "glSales"];

interface Board { id: string; name: string; widgets: string[]; }
interface Config { activeId: string; boards: Board[]; }
const defaultConfig = (): Config => ({ activeId: "default", boards: [{ id: "default", name: "AR Overview", widgets: [...DEFAULT_WIDGETS] }] });

export default function DashboardPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [receivedByInvoice, setReceivedByInvoice] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [animate, setAnimate] = useState(false);
  const [lastUpdate, setLastUpdate] = useState("");
  const started = useRef(false);

  // Dashboard config (multi-board + customise), persisted to localStorage.
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [customise, setCustomise] = useState(false);
  const [location, setLocation] = useState("all");
  const [zoomed, setZoomed] = useState<string | null>(null);
  const configLoaded = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Config;
        if (parsed.boards?.length && parsed.boards.every((b) => Array.isArray(b.widgets))) setConfig(parsed);
      }
    } catch { /* ignore */ }
    configLoaded.current = true;
  }, []);
  useEffect(() => {
    if (configLoaded.current) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(config)); } catch { /* ignore */ }
    }
  }, [config]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const c = supabase;
    const [inv, alloc, rec, cust] = await Promise.all([
      c.from("invoices").select("id, invoice_date, due_date, total, status, customer_id, customers(name)").order("invoice_date", { ascending: false }),
      c.from("receipt_allocations").select("invoice_id, amount"),
      c.from("receipts").select("receipt_date, amount, mode, customer_id"),
      c.from("customers").select("id, name, credit_limit, address"),
    ]);
    setInvoices((inv.data as unknown as InvoiceRow[]) ?? []);
    setReceipts((rec.data as unknown as ReceiptRow[]) ?? []);
    setCustomers((cust.data as unknown as CustomerRow[]) ?? []);
    const map: Record<string, number> = {};
    ((alloc.data as { invoice_id: string; amount: number }[]) ?? []).forEach((a) => { map[a.invoice_id] = (map[a.invoice_id] ?? 0) + Number(a.amount); });
    setReceivedByInvoice(map);
    const n = new Date();
    setLastUpdate(`${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}:${String(n.getSeconds()).padStart(2, "0")}`);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    load();
    const c = supabase;
    const ch = c.channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "receipts" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "receipt_allocations" }, load)
      .subscribe();
    const poll = setInterval(load, 15000);
    return () => { c.removeChannel(ch); clearInterval(poll); };
  }, [load]);

  useEffect(() => {
    if (!loading && !started.current) { started.current = true; const t = setTimeout(() => setAnimate(true), 80); return () => clearTimeout(t); }
  }, [loading]);

  // ---- Location filter (by customer city) ----
  const cityByCustomer: Record<string, string> = {}; customers.forEach((c) => (cityByCustomer[c.id] = c.address ?? "—"));
  const locations = Array.from(new Set(customers.map((c) => c.address ?? "—"))).filter(Boolean).sort();
  const inLoc = (custId: string) => location === "all" || cityByCustomer[custId] === location;
  const invF = location === "all" ? invoices : invoices.filter((r) => inLoc(r.customer_id));
  const recF = location === "all" ? receipts : receipts.filter((r) => inLoc(r.customer_id));
  const custF = location === "all" ? customers : customers.filter((c) => (c.address ?? "—") === location);

  // ---- Metrics (computed from the location-filtered data) ----
  const outstandingOf = (r: InvoiceRow) => Math.max(0, Number(r.total) - (receivedByInvoice[r.id] ?? 0));
  const effStatus = (r: InvoiceRow) => (isOverdue(r.status, r.due_date) ? "overdue" : r.status);
  const unpaid = invF.filter((r) => r.status !== "paid");
  const overdue = invF.filter((r) => isOverdue(r.status, r.due_date));
  const totalOutstanding = unpaid.reduce((s, r) => s + outstandingOf(r), 0);
  const overdueOutstanding = overdue.reduce((s, r) => s + outstandingOf(r), 0);
  const totalInvoiced = invF.reduce((s, r) => s + Number(r.total), 0);

  // DSO (estimate): outstanding / credit sales × days in period.
  const dates = invF.map((r) => new Date(r.invoice_date).getTime()).filter((t) => !isNaN(t));
  const periodDays = dates.length ? Math.max(1, Math.round((Math.max(...dates) - Math.min(...dates)) / 86400000)) : 1;
  const dso = totalInvoiced > 0 ? (totalOutstanding / totalInvoiced) * periodDays : 0;
  // CEI (estimate): collected-on-due / amount-due × 100.
  const dueInvoices = invF.filter((r) => r.due_date && new Date(r.due_date) <= new Date());
  const amountDue = dueInvoices.reduce((s, r) => s + Number(r.total), 0);
  const collectedOnDue = dueInvoices.reduce((s, r) => s + (receivedByInvoice[r.id] ?? 0), 0);
  const cei = amountDue > 0 ? Math.min(100, (collectedOnDue / amountDue) * 100) : 100;
  const overduePct = totalOutstanding > 0 ? (overdueOutstanding / totalOutstanding) * 100 : 0;

  const ageing = [
    { label: "Not due", color: "var(--brand)", value: unpaid.filter((r) => !isOverdue(r.status, r.due_date)).reduce((s, r) => s + outstandingOf(r), 0) },
    { label: "0–30", color: "var(--brand)", value: unpaid.filter((r) => isOverdue(r.status, r.due_date) && daysLate(r.due_date) <= 30).reduce((s, r) => s + outstandingOf(r), 0) },
    { label: "31–60", color: "#d97706", value: unpaid.filter((r) => daysLate(r.due_date) >= 31 && daysLate(r.due_date) <= 60).reduce((s, r) => s + outstandingOf(r), 0) },
    { label: "61–90", color: "#d97706", value: unpaid.filter((r) => daysLate(r.due_date) >= 61 && daysLate(r.due_date) <= 90).reduce((s, r) => s + outstandingOf(r), 0) },
    { label: "90+", color: "#dc2626", value: unpaid.filter((r) => daysLate(r.due_date) > 90).reduce((s, r) => s + outstandingOf(r), 0) },
  ];

  const statusColors: Record<string, string> = { open: "#64748b", partial: "#d97706", overdue: "#dc2626", paid: "#16a34a" };
  const statusSeg = ["open", "partial", "overdue", "paid"].map((st) => ({ label: st, color: statusColors[st], value: invF.filter((r) => effStatus(r) === st).length })).filter((s) => s.value > 0);

  const monthKey = (d: string) => d.slice(0, 7);
  const mset = new Set<string>(); invF.forEach((r) => mset.add(monthKey(r.invoice_date))); recF.forEach((r) => mset.add(monthKey(r.receipt_date)));
  const monthsArr = Array.from(mset).sort();
  const months = monthsArr.map((m) => MONTHS[parseInt(m.slice(5, 7), 10) - 1]);
  const invoicedByMonth = monthsArr.map((m) => invF.filter((r) => monthKey(r.invoice_date) === m).reduce((s, r) => s + Number(r.total), 0));
  const collectedByMonth = monthsArr.map((m) => recF.filter((r) => monthKey(r.receipt_date) === m).reduce((s, r) => s + Number(r.amount), 0));

  const custName: Record<string, string> = {}; customers.forEach((c) => (custName[c.id] = c.name));
  const overdueByCust: Record<string, number> = {};
  overdue.forEach((r) => { const n = r.customers?.name ?? custName[r.customer_id] ?? "—"; overdueByCust[n] = (overdueByCust[n] ?? 0) + outstandingOf(r); });
  const topOverdue = Object.entries(overdueByCust).map(([name, value]) => ({ name, value })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 5);

  const modeColors: Record<string, string> = { cash: "#2f6bff", cheque: "#16a34a", upi: "#d97706", neft: "#7c3aed" };
  const modeAgg: Record<string, number> = {};
  recF.forEach((r) => { modeAgg[r.mode] = (modeAgg[r.mode] ?? 0) + Number(r.amount); });
  const receiptsMode = Object.entries(modeAgg).map(([label, value]) => ({ label, value, color: modeColors[label] ?? "#64748b" }));
  const receiptsTotal = recF.reduce((s, r) => s + Number(r.amount), 0);

  const outByCust: Record<string, number> = {};
  unpaid.forEach((r) => { outByCust[r.customer_id] = (outByCust[r.customer_id] ?? 0) + outstandingOf(r); });
  const creditUtil = custF.filter((c) => c.credit_limit > 0).map((c) => {
    const out = outByCust[c.id] ?? 0; const pct = (out / c.credit_limit) * 100;
    return { name: c.name, value: pct, label: `${pct.toFixed(0)}%`, danger: pct > 100 };
  }).filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 6);

  const badDebt90 = ageing[4].value;
  const badDebtPct = totalOutstanding > 0 ? (badDebt90 / totalOutstanding) * 100 : 0;
  const bd: Record<string, number> = {};
  unpaid.filter((r) => daysLate(r.due_date) > 90).forEach((r) => { const n = r.customers?.name ?? custName[r.customer_id] ?? "—"; bd[n] = (bd[n] ?? 0) + outstandingOf(r); });
  const badDebtCustomers = Object.entries(bd).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 4);

  // Cash forecast: overdue now + next 3 months by due month.
  const now = new Date(); const curM = now.getMonth(); const curY = now.getFullYear();
  const monthIndex = (d: Date) => (d.getFullYear() - curY) * 12 + (d.getMonth() - curM);
  const fc = [0, 0, 0, 0]; // [overdue, this month, +1, +2]
  unpaid.forEach((r) => {
    if (!r.due_date) return;
    const due = new Date(r.due_date); const mi = monthIndex(due);
    if (due < now) fc[0] += outstandingOf(r);       // all overdue (any past due date)
    else if (mi === 0) fc[1] += outstandingOf(r);   // rest of this month, not yet due
    else if (mi === 1) fc[2] += outstandingOf(r);
    else if (mi === 2) fc[3] += outstandingOf(r);
    // due beyond +2 months isn't shown in this 4-bar summary
  });
  const forecast = [
    { label: "Overdue", color: "#dc2626", value: fc[0] },
    { label: MONTHS[curM], color: "var(--brand)", value: fc[1] },
    { label: MONTHS[(curM + 1) % 12], color: "var(--brand)", value: fc[2] },
    { label: MONTHS[(curM + 2) % 12], color: "var(--brand)", value: fc[3] },
  ];

  const metrics: Metrics = {
    run: animate, customerCount: custF.length, invoiceCount: invF.length,
    dso, cei, totalOutstanding, overduePct, overdueOutstanding,
    ageing, statusSeg, months, invoicedByMonth, collectedByMonth, topOverdue,
    receiptsMode, receiptsTotal, receiptCount: receipts.length, creditUtil, badDebt90, badDebtPct, badDebtCustomers, forecast,
  };

  // ---- Config helpers ----
  const active = config.boards.find((b) => b.id === config.activeId) ?? config.boards[0];
  const update = (fn: (b: Board) => Board) => setConfig((c) => ({ ...c, boards: c.boards.map((b) => (b.id === active.id ? fn(b) : b)) }));
  const move = (idx: number, dir: -1 | 1) => update((b) => { const w = [...b.widgets]; const j = idx + dir; if (j < 0 || j >= w.length) return b; [w[idx], w[j]] = [w[j], w[idx]]; return { ...b, widgets: w }; });
  const remove = (id: string) => update((b) => ({ ...b, widgets: b.widgets.filter((x) => x !== id) }));
  const add = (id: string) => update((b) => ({ ...b, widgets: [...b.widgets, id] }));
  const resetBoard = () => update((b) => ({ ...b, widgets: [...DEFAULT_WIDGETS] }));
  const newBoard = () => { const name = window.prompt("Name your new dashboard:", "My dashboard"); if (!name) return; const id = `b${Date.now()}`; setConfig((c) => ({ activeId: id, boards: [...c.boards, { id, name, widgets: [...DEFAULT_WIDGETS] }] })); };
  const renameBoard = () => { const name = window.prompt("Rename dashboard:", active.name); if (!name) return; update((b) => ({ ...b, name })); };
  const deleteBoard = () => { if (config.boards.length <= 1) return; if (!window.confirm(`Delete "${active.name}"?`)) return; setConfig((c) => { const boards = c.boards.filter((b) => b.id !== active.id); return { activeId: boards[0].id, boards }; }); };

  const kpiRow = (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile label="DSO (est.)" target={metrics.dso} sub="avg days to collect · <45 healthy" accent={metrics.dso <= 45 ? "text-green-600" : "text-red-600"} format={(n) => `${Math.round(n)} d`} run={animate} />
      <KpiTile label="CEI (est.)" target={metrics.cei} sub="collection effectiveness · >80% good" accent={metrics.cei >= 80 ? "text-green-600" : "text-amber-600"} format={(n) => `${n.toFixed(0)}%`} run={animate} />
      <KpiTile label="Total Outstanding" target={metrics.totalOutstanding} sub="across open invoices" accent="text-brand" format={money} run={animate} />
      <KpiTile label="Overdue" target={metrics.overduePct} sub={`${money(metrics.overdueOutstanding)} overdue`} accent="text-red-600" format={(n) => `${n.toFixed(0)}%`} run={animate} />
    </div>
  );

  const hidden = WIDGETS.filter((w) => !active.widgets.includes(w.id));

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="The finance team's at-a-glance AR view. All amounts in INR."
        action={
          <span className="flex items-center gap-2 rounded-full bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-500">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" /></span>
            Live{lastUpdate ? ` · ${lastUpdate}` : ""}
          </span>
        }
      />

      {!isConfigured ? (
        <NotConfigured />
      ) : loading ? (
        <div className="themed-surface rounded-xl border border-line bg-surface p-10 text-center text-faint">Loading…</div>
      ) : (
        <>
          {/* Dashboard tabs + customise controls */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {config.boards.map((b) => (
              <button key={b.id} onClick={() => setConfig((c) => ({ ...c, activeId: b.id }))}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${b.id === active.id ? "bg-brand text-brandink" : "bg-surface2 text-muted hover:text-ink"}`}>
                {b.name}
              </button>
            ))}
            <button onClick={newBoard} className="rounded-lg border border-dashed border-line px-3 py-1.5 text-sm font-medium text-muted hover:border-brand hover:text-brand">+ New Dashboard</button>
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <span className="uppercase tracking-wide">Location</span>
                <select
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand"
                >
                  <option value="all">All ({customers.length})</option>
                  {locations.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </label>
              {customise && (
                <>
                  <button onClick={renameBoard} className="rounded-lg bg-surface2 px-3 py-1.5 text-sm text-muted hover:text-ink">Rename</button>
                  <button onClick={resetBoard} className="rounded-lg bg-surface2 px-3 py-1.5 text-sm text-muted hover:text-ink">Reset</button>
                  {config.boards.length > 1 && <button onClick={deleteBoard} className="rounded-lg bg-red-500/10 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/20">Delete</button>}
                </>
              )}
              <button onClick={() => setCustomise((v) => !v)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${customise ? "bg-brand text-brandink" : "bg-surface2 text-ink hover:opacity-80"}`}>
                {customise ? "✓ Done" : "⚙ Customise"}
              </button>
            </div>
          </div>

          {/* Widget grid */}
          <div className="grid gap-4 lg:grid-cols-3">
            {active.widgets.map((wid, idx) => {
              const def = WIDGETS.find((w) => w.id === wid);
              if (!def) return null;
              const spanClass = def.span === 3 ? "lg:col-span-3" : def.span === 2 ? "lg:col-span-2" : "lg:col-span-1";
              const controls = customise && (
                <div className="mb-2 flex items-center justify-end gap-1">
                  <button onClick={() => move(idx, -1)} className="rounded bg-surface2 px-2 py-0.5 text-xs text-muted hover:text-ink" title="Move up">↑</button>
                  <button onClick={() => move(idx, 1)} className="rounded bg-surface2 px-2 py-0.5 text-xs text-muted hover:text-ink" title="Move down">↓</button>
                  <button onClick={() => remove(wid)} className="rounded bg-red-500/10 px-2 py-0.5 text-xs text-red-500 hover:bg-red-500/20" title="Remove">✕</button>
                </div>
              );
              return (
                <div key={wid} className={`relative ${spanClass} ${customise ? "rounded-xl p-2 ring-1 ring-dashed ring-line" : ""}`}>
                  {controls}
                  {def.kpi ? kpiRow : (
                    <div
                      onClick={!customise ? () => setZoomed(wid) : undefined}
                      className={!customise ? "group relative h-full cursor-zoom-in transition-all duration-200 hover:-translate-y-0.5 [&>*]:transition-shadow [&:hover>*]:shadow-xl" : "h-full"}
                    >
                      {!customise && (
                        <span className="pointer-events-none absolute right-3 top-3 z-10 rounded-md bg-brand px-2 py-1 text-[10px] font-semibold text-brandink opacity-0 shadow transition-opacity group-hover:opacity-100">⤢ Expand</span>
                      )}
                      <Card title={def.title} subtitle={def.subtitle}>
                        {def.comingSoon ? <ComingSoon note={def.comingSoon} /> : def.render?.(metrics)}
                      </Card>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Zoom / expand overlay */}
          {zoomed && (() => {
            const def = WIDGETS.find((w) => w.id === zoomed);
            if (!def || def.kpi) return null;
            return (
              <div onClick={() => setZoomed(null)} className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/70 p-6 backdrop-blur-sm">
                <div onClick={(e) => e.stopPropagation()} className="relative">
                  <button onClick={() => setZoomed(null)} className="absolute -top-11 right-0 rounded-lg bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-lg hover:bg-surface2">✕ Close</button>
                  <div className="origin-center scale-[0.62] sm:scale-90 lg:scale-110" style={{ width: 760 }}>
                    <Card title={def.title} subtitle={def.subtitle}>
                      {def.comingSoon ? <ComingSoon note={def.comingSoon} /> : def.render?.(metrics)}
                    </Card>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Add-widget tray (customise mode) */}
          {customise && hidden.length > 0 && (
            <div className="mt-5 rounded-xl border border-dashed border-line bg-surface2 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Add a widget</p>
              <div className="flex flex-wrap gap-2">
                {hidden.map((w) => (
                  <button key={w.id} onClick={() => add(w.id)} className="themed-surface rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted hover:border-brand hover:text-brand">
                    + {w.title}{w.comingSoon ? " (soon)" : ""}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
