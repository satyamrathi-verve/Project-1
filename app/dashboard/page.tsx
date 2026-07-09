"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { money, isOverdue, daysLate } from "@/lib/format";

interface InvoiceRow {
  id: string;
  invoice_date: string;
  due_date: string | null;
  total: number;
  status: string;
  customers: { name: string } | null;
}
interface ReceiptRow {
  receipt_date: string;
  amount: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* Count-up for KPI numbers. */
function useCountUp(target: number, run: boolean, ms = 1000) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setVal(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return val;
}

function Tile({ label, target, sub, accent, isMoney, run }: {
  label: string; target: number; sub: string; accent: string; isMoney?: boolean; run: boolean;
}) {
  const v = useCountUp(target, run);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${accent}`}>
        {isMoney ? money(v) : Math.round(v).toLocaleString("en-IN")}
      </p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

/* One vertical bar with gridlines behind, gradient fill, staggered grow + hover. */
function BarPlot({ title, subtitle, bars, run }: {
  title: string; subtitle: string; run: boolean;
  bars: { label: string; value: number; color: string }[];
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      <p className="mb-4 text-xs text-slate-400">{subtitle}</p>
      <div className="relative h-56">
        {/* gridlines */}
        {[0, 25, 50, 75, 100].map((g) => (
          <div key={g} className="absolute inset-x-0 border-t border-dashed border-slate-100" style={{ bottom: `${g}%` }} />
        ))}
        <div className="absolute inset-0 flex items-end justify-between gap-3 pb-6">
          {bars.map((b, i) => (
            <div key={b.label} className="group flex flex-1 flex-col items-center justify-end gap-2" title={`${b.label}: ${money(b.value)}`}>
              <span className="text-xs font-semibold tabular-nums text-slate-700 opacity-80 transition-opacity group-hover:opacity-100">
                {b.value > 0 ? Math.round(b.value).toLocaleString("en-IN") : ""}
              </span>
              <div
                className="w-full rounded-t-md shadow-sm transition-[height,filter] duration-700 ease-out group-hover:brightness-110"
                style={{
                  height: run ? `${(b.value / max) * 100}%` : "0%",
                  minHeight: b.value > 0 ? 4 : 0,
                  transitionDelay: `${i * 90}ms`,
                  backgroundImage: `linear-gradient(to top, ${b.color}, ${b.color}bb)`,
                }}
              />
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex justify-between gap-3">
          {bars.map((b) => (
            <span key={b.label} className="flex-1 text-center text-[11px] leading-tight text-slate-500">{b.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Grouped bars: two series per category (Invoiced vs Collected). */
function GroupedBars({ title, subtitle, categories, seriesA, seriesB, run }: {
  title: string; subtitle: string; run: boolean;
  categories: string[];
  seriesA: { name: string; color: string; values: number[] };
  seriesB: { name: string; color: string; values: number[] };
}) {
  const max = Math.max(1, ...seriesA.values, ...seriesB.values);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <div className="flex gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: seriesA.color }} />{seriesA.name}</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: seriesB.color }} />{seriesB.name}</span>
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-400">{subtitle}</p>
      <div className="relative h-56">
        {[0, 25, 50, 75, 100].map((g) => (
          <div key={g} className="absolute inset-x-0 border-t border-dashed border-slate-100" style={{ bottom: `${g}%` }} />
        ))}
        <div className="absolute inset-0 flex items-end justify-between gap-4 pb-6">
          {categories.map((cat, i) => (
            <div key={cat} className="flex flex-1 flex-col items-center justify-end">
              <div className="flex h-full w-full items-end justify-center gap-1">
                {[seriesA, seriesB].map((s, si) => (
                  <div
                    key={s.name}
                    className="w-1/2 max-w-[26px] rounded-t shadow-sm transition-[height] duration-700 ease-out hover:brightness-110"
                    title={`${cat} · ${s.name}: ${money(s.values[i])}`}
                    style={{
                      height: run ? `${(s.values[i] / max) * 100}%` : "0%",
                      minHeight: s.values[i] > 0 ? 3 : 0,
                      transitionDelay: `${i * 80 + si * 40}ms`,
                      background: s.color,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex justify-between gap-4">
          {categories.map((cat) => (
            <span key={cat} className="flex-1 text-center text-[11px] text-slate-500">{cat}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Donut with draw-in animation. */
function StatusDonut({ segments, total, run }: {
  segments: { label: string; value: number; color: string }[]; total: number; run: boolean;
}) {
  let offset = 25;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-700">Invoices by status</h3>
      <p className="mb-4 text-xs text-slate-400">Portfolio mix across all invoices.</p>
      <div className="flex items-center gap-6">
        <svg viewBox="0 0 36 36" className="h-32 w-32 -rotate-90">
          <circle cx="18" cy="18" r="15.915" fill="none" stroke="#f1f5f9" strokeWidth="3.6" />
          {segments.map((s, i) => {
            const pct = total ? (s.value / total) * 100 : 0;
            const seg = (
              <circle
                key={s.label} cx="18" cy="18" r="15.915" fill="none" stroke={s.color} strokeWidth="3.6"
                strokeDasharray={run ? `${pct} ${100 - pct}` : `0 100`}
                strokeDashoffset={offset} strokeLinecap="round"
                style={{ transition: "stroke-dasharray 900ms ease-out", transitionDelay: `${i * 150}ms` }}
              />
            );
            offset -= pct;
            return seg;
          })}
          <text x="18" y="18" transform="rotate(90 18 18)" textAnchor="middle" dominantBaseline="central" className="fill-slate-800 text-[6px] font-bold">
            {total}
          </text>
        </svg>
        <ul className="space-y-1.5 text-sm">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              <span className="capitalize">{s.label}</span>
              <span className="ml-auto font-semibold tabular-nums text-slate-800">{s.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* Horizontal bars — top customers by outstanding. */
function TopCustomers({ rows, run }: { rows: { name: string; value: number }[]; run: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-700">Top customers by outstanding</h3>
      <p className="mb-4 text-xs text-slate-400">Who owes the most right now (INR).</p>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Nothing outstanding. 🎉</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={r.name} title={`${r.name}: ${money(r.value)}`}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="truncate text-slate-600">{r.name}</span>
                <span className="ml-2 shrink-0 font-semibold tabular-nums text-slate-800">{money(r.value)}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: run ? `${(r.value / max) * 100}%` : "0%", transitionDelay: `${i * 90}ms`, backgroundImage: "linear-gradient(to right, #2f6bff, #1f4ed8)" }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [receivedByInvoice, setReceivedByInvoice] = useState<Record<string, number>>({});
  const [customerCount, setCustomerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [animate, setAnimate] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const started = useRef(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const client = supabase;
    const [inv, alloc, rec, custCount] = await Promise.all([
      client.from("invoices").select("id, invoice_date, due_date, total, status, customers(name)").order("invoice_date", { ascending: false }),
      client.from("receipt_allocations").select("invoice_id, amount"),
      client.from("receipts").select("receipt_date, amount"),
      client.from("customers").select("id", { count: "exact", head: true }),
    ]);
    setInvoices((inv.data as unknown as InvoiceRow[]) ?? []);
    setReceipts((rec.data as unknown as ReceiptRow[]) ?? []);
    const map: Record<string, number> = {};
    ((alloc.data as { invoice_id: string; amount: number }[]) ?? []).forEach((a) => {
      map[a.invoice_id] = (map[a.invoice_id] ?? 0) + Number(a.amount);
    });
    setReceivedByInvoice(map);
    setCustomerCount(custCount.count ?? 0);
    const now = new Date();
    setLastUpdate(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`);
    setLoading(false);
  }, []);

  // Initial load + real-time subscription (re-fetch on any change to the AR tables).
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    load();
    const client = supabase;
    // Instant updates when the project has realtime enabled for these tables…
    const channel = client
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "receipts" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "receipt_allocations" }, load)
      .subscribe();
    // …plus a gentle poll so it stays current regardless.
    const poll = setInterval(load, 15000);
    return () => {
      client.removeChannel(channel);
      clearInterval(poll);
    };
  }, [load]);

  useEffect(() => {
    if (!loading && !started.current) {
      started.current = true;
      const t = setTimeout(() => setAnimate(true), 80);
      return () => clearTimeout(t);
    }
  }, [loading]);

  const outstandingOf = (r: InvoiceRow) => Math.max(0, Number(r.total) - (receivedByInvoice[r.id] ?? 0));
  const effectiveStatus = (r: InvoiceRow) => (isOverdue(r.status, r.due_date) ? "overdue" : r.status);

  const overdue = invoices.filter((r) => isOverdue(r.status, r.due_date));
  const totalOutstanding = invoices.filter((r) => r.status !== "paid").reduce((s, r) => s + outstandingOf(r), 0);
  const overdueOutstanding = overdue.reduce((s, r) => s + outstandingOf(r), 0);

  // Ageing buckets.
  const unpaid = invoices.filter((r) => r.status !== "paid");
  const buckets = [
    { label: "Not due", color: "#2f6bff", value: unpaid.filter((r) => !isOverdue(r.status, r.due_date)).reduce((s, r) => s + outstandingOf(r), 0) },
    { label: "0–30", color: "#2f6bff", value: unpaid.filter((r) => { const d = daysLate(r.due_date); return isOverdue(r.status, r.due_date) && d >= 1 && d <= 30; }).reduce((s, r) => s + outstandingOf(r), 0) },
    { label: "31–60", color: "#d97706", value: unpaid.filter((r) => { const d = daysLate(r.due_date); return d >= 31 && d <= 60; }).reduce((s, r) => s + outstandingOf(r), 0) },
    { label: "61–90", color: "#d97706", value: unpaid.filter((r) => { const d = daysLate(r.due_date); return d >= 61 && d <= 90; }).reduce((s, r) => s + outstandingOf(r), 0) },
    { label: "90+", color: "#dc2626", value: unpaid.filter((r) => daysLate(r.due_date) > 90).reduce((s, r) => s + outstandingOf(r), 0) },
  ];

  // Status donut.
  const statusColors: Record<string, string> = { open: "#64748b", partial: "#d97706", overdue: "#dc2626", paid: "#16a34a" };
  const statusSegments = ["open", "partial", "overdue", "paid"]
    .map((st) => ({ label: st, color: statusColors[st], value: invoices.filter((r) => effectiveStatus(r) === st).length }))
    .filter((s) => s.value > 0);

  // Top customers by outstanding.
  const byCustomer: Record<string, number> = {};
  unpaid.forEach((r) => { const n = r.customers?.name ?? "—"; byCustomer[n] = (byCustomer[n] ?? 0) + outstandingOf(r); });
  const topCustomers = Object.entries(byCustomer).map(([name, value]) => ({ name, value })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 5);

  // Monthly invoiced vs collected.
  const monthKey = (d: string) => d.slice(0, 7); // yyyy-mm
  const monthsSet = new Set<string>();
  invoices.forEach((r) => monthsSet.add(monthKey(r.invoice_date)));
  receipts.forEach((r) => monthsSet.add(monthKey(r.receipt_date)));
  const months = Array.from(monthsSet).sort();
  const invoicedByMonth = months.map((m) => invoices.filter((r) => monthKey(r.invoice_date) === m).reduce((s, r) => s + Number(r.total), 0));
  const collectedByMonth = months.map((m) => receipts.filter((r) => monthKey(r.receipt_date) === m).reduce((s, r) => s + Number(r.amount), 0));
  const monthLabels = months.map((m) => MONTHS[parseInt(m.slice(5, 7), 10) - 1]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="The finance team's at-a-glance view. All amounts in INR."
        action={
          <span className="flex items-center gap-2 rounded-full bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            Live{lastUpdate ? ` · ${lastUpdate}` : ""}
          </span>
        }
      />

      {!isConfigured ? (
        <NotConfigured />
      ) : loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400">Loading…</div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Customers" target={customerCount} sub="on the master" accent="text-slate-900" run={animate} />
            <Tile label="Invoices" target={invoices.length} sub="total raised" accent="text-slate-900" run={animate} />
            <Tile label="Overdue" target={overdue.length} sub={`${money(overdueOutstanding)} outstanding`} accent="text-red-600" run={animate} />
            <Tile label="Total Outstanding" target={totalOutstanding} sub="across open invoices" accent="text-brand" isMoney run={animate} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <BarPlot title="AR Ageing — outstanding by bucket" subtitle="How much is owed, grouped by how late it is (INR). Blue = current, amber = watch, red = critical." bars={buckets} run={animate} />
            </div>
            <StatusDonut segments={statusSegments} total={invoices.length} run={animate} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <GroupedBars
                title="Invoiced vs Collected — by month"
                subtitle="Cash raised vs cash received each month (INR)."
                categories={monthLabels}
                seriesA={{ name: "Invoiced", color: "#2f6bff", values: invoicedByMonth }}
                seriesB={{ name: "Collected", color: "#16a34a", values: collectedByMonth }}
                run={animate}
              />
            </div>
            <TopCustomers rows={topCustomers} run={animate} />
          </div>
        </div>
      )}
    </div>
  );
}
