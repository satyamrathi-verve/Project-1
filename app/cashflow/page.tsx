"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { inputClass } from "@/components/FormField";
import { toast } from "@/components/Toast";
import { money, isOverdue } from "@/lib/format";
import { exportToCsv } from "@/lib/exportCsv";

// One open/partial/overdue invoice, with enough to compute what's still owed on it.
interface OpenInvoiceRow {
  id: string;
  invoice_no: string;
  due_date: string | null;
  total: number;
  status: string;
  customers: { name: string } | null;
  receipt_allocations: { amount: number }[] | null;
}

// The team's editable projection for one invoice: when and how much they expect
// to actually collect, defaulting to the invoice's own due date and outstanding.
interface ProjectionRow {
  id: string;
  invoiceNo: string;
  customer: string;
  outstanding: number;
  expectedDate: string;
  expectedAmount: number;
  dueDate: string | null;
  status: string;
}

type Grouping = "week" | "month";
type StatusFilter = "all" | "overdue" | "ontime";

const GROUPING_STORAGE_KEY = "ar-cashflow-grouping";

// Monday-start ISO week key, e.g. "2026-07-06".
function weekKey(d: Date): string {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // 0 = Monday
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function bucketLabel(key: string, grouping: Grouping): string {
  const d = new Date(key);
  if (grouping === "month") {
    return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  }
  return `Week of ${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
}

// Compact figure for the chart labels (table below has the exact 2-decimal amount).
function shortMoney(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// One row in the period summary — the bucket's totals, plus the invoices inside it
// so expanding the row can show them without a second fetch.
interface BucketRow {
  id: string;
  key: string;
  label: string;
  amount: number;
  count: number;
  invoices: ProjectionRow[];
}

function StatCard({
  label,
  value,
  hint,
  accent,
  live,
}: {
  label: string;
  value: string;
  hint?: string;
  accent: "brand" | "red" | "green" | "neutral";
  /** Announce value changes to screen readers (use on figures that update as the team edits data). */
  live?: boolean;
}) {
  const accentBorder: Record<typeof accent, string> = {
    brand: "border-l-brand",
    red: "border-l-red-500",
    green: "border-l-green-500",
    neutral: "border-l-line",
  };
  return (
    <div className={`themed-surface rounded-xl border border-line border-l-4 bg-surface p-4 ${accentBorder[accent]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p
        className="mt-1 text-2xl font-bold tabular-nums text-ink"
        aria-live={live ? "polite" : undefined}
        aria-atomic={live ? "true" : undefined}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export default function CashflowProjectionPage() {
  const [invoices, setInvoices] = useState<OpenInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Grouping>("week");
  // Per-invoice overrides the team has typed in; anything not here uses the default.
  const [overrides, setOverrides] = useState<Record<string, { date?: string; amount?: number }>>({});
  // Which period row is currently expanded (only one at a time), if any.
  const [expandedBucketId, setExpandedBucketId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusValueRef = useRef<Record<string, number>>({});

  // Remember the last grouping choice across visits.
  useEffect(() => {
    const saved = localStorage.getItem(GROUPING_STORAGE_KEY);
    if (saved === "week" || saved === "month") setGrouping(saved);
  }, []);

  // "/" jumps to the search box, like Linear/GitHub — unless already typing somewhere.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_no, due_date, total, status, customers(name), receipt_allocations(amount)")
        .neq("status", "paid")
        .order("due_date", { ascending: true });
      if (error) setError(error.message);
      else setInvoices((data as unknown as OpenInvoiceRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const projection: ProjectionRow[] = useMemo(() => {
    return invoices.map((inv) => {
      const received = (inv.receipt_allocations ?? []).reduce((sum, a) => sum + a.amount, 0);
      const outstanding = inv.total - received;
      const override = overrides[inv.id];
      return {
        id: inv.id,
        invoiceNo: inv.invoice_no,
        customer: inv.customers?.name ?? "—",
        outstanding,
        expectedDate: override?.date ?? inv.due_date ?? "",
        expectedAmount: override?.amount ?? outstanding,
        dueDate: inv.due_date,
        status: inv.status,
      };
    });
  }, [invoices, overrides]);

  const filteredProjection: ProjectionRow[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projection.filter((r) => {
      const overdue = isOverdue(r.status, r.dueDate);
      const matchesSearch = !q || r.customer.toLowerCase().includes(q) || r.invoiceNo.toLowerCase().includes(q);
      const matchesStatus = statusFilter === "all" || (statusFilter === "overdue" ? overdue : !overdue);
      return matchesSearch && matchesStatus;
    });
  }, [projection, search, statusFilter]);

  const buckets: BucketRow[] = useMemo(() => {
    const map = new Map<string, ProjectionRow[]>();
    for (const row of filteredProjection) {
      if (!row.expectedDate) continue;
      const key = grouping === "week" ? weekKey(new Date(row.expectedDate)) : monthKey(new Date(row.expectedDate));
      const existing = map.get(key) ?? [];
      existing.push(row);
      map.set(key, existing);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rows]) => ({
        id: key,
        key,
        label: bucketLabel(key, grouping),
        amount: rows.reduce((sum, r) => sum + r.expectedAmount, 0),
        count: rows.length,
        invoices: rows,
      }));
  }, [filteredProjection, grouping]);

  const totalExpected = buckets.reduce((sum, b) => sum + b.amount, 0);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.amount));
  const overdueAmount = useMemo(
    () => filteredProjection.filter((r) => isOverdue(r.status, r.dueDate)).reduce((sum, r) => sum + r.expectedAmount, 0),
    [filteredProjection]
  );
  const thisWeekAmount = useMemo(() => {
    const key = weekKey(new Date());
    return filteredProjection
      .filter((r) => r.expectedDate && weekKey(new Date(r.expectedDate)) === key)
      .reduce((sum, r) => sum + r.expectedAmount, 0);
  }, [filteredProjection]);

  // --- Extra visualisations (additive) ---
  // Running total of expected cash as each period lands.
  const cumulative = useMemo(() => {
    let run = 0;
    return buckets.map((b) => { run += b.amount; return { label: b.label, value: run }; });
  }, [buckets]);
  const cumChart = useMemo(() => {
    const n = cumulative.length;
    const maxCum = Math.max(1, ...cumulative.map((p) => p.value));
    const pts = cumulative.map((p, i) => ({ x: n > 1 ? (i / (n - 1)) * 100 : 50, y: 38 - (p.value / maxCum) * 33 }));
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const area = n > 0 ? `${line} L ${pts[n - 1].x.toFixed(1)} 40 L ${pts[0].x.toFixed(1)} 40 Z` : "";
    return { pts, line, area };
  }, [cumulative]);
  const ontimeAmount = Math.max(0, totalExpected - overdueAmount);
  const overduePct = totalExpected > 0 ? (overdueAmount / totalExpected) * 100 : 0;
  const topCustomers = useMemo(() => {
    const m = new Map<string, number>();
    filteredProjection.forEach((r) => m.set(r.customer, (m.get(r.customer) ?? 0) + r.expectedAmount));
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 4);
  }, [filteredProjection]);
  const maxCust = Math.max(1, ...topCustomers.map((c) => c.value));

  function setOverride(id: string, patch: { date?: string; amount?: number }) {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function resetOverride(id: string, invoiceNo: string) {
    setOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    toast(`${invoiceNo} reset to its default due date and outstanding amount`, { variant: "info" });
  }

  // Switching how periods are grouped makes the old expanded period key meaningless.
  function changeGrouping(g: Grouping) {
    setGrouping(g);
    setExpandedBucketId(null);
    localStorage.setItem(GROUPING_STORAGE_KEY, g);
  }

  function handleExportCsv() {
    exportToCsv(
      `cashflow-projection-${grouping}-${new Date().toISOString().slice(0, 10)}.csv`,
      [grouping === "week" ? "Week" : "Month", "Invoices", "Expected Inflow (INR)"],
      buckets.map((b) => [b.label, b.count, b.amount.toFixed(2)])
    );
    toast("Exported the current summary to CSV", { variant: "success" });
  }

  const bucketColumns: Column<BucketRow>[] = [
    {
      key: "label",
      header: grouping === "week" ? "Week" : "Month",
      render: (b) => (
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="text-faint">
            {expandedBucketId === b.id ? "▾" : "▸"}
          </span>
          {b.label}
        </span>
      ),
    },
    { key: "count", header: "Invoices", className: "text-center" },
    {
      key: "amount",
      header: "Expected inflow (INR)",
      className: "text-right tabular-nums",
      render: (b) => money(b.amount),
    },
  ];

  return (
    <div>
      <style>{`
        @media print {
          nav { display: none !important; }
          main { padding: 0 !important; overflow: visible !important; }
          body { background: #fff !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <PageHeader
        title="Cashflow Projection"
        subtitle="Expected collections from open invoices, grouped by when the money should land. Click a period to see (and adjust) its invoices."
        action={
          <div className="no-print flex gap-2">
            <button
              onClick={handleExportCsv}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface2"
            >
              ⬇ Export CSV
            </button>
            <button
              onClick={() => window.print()}
              className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark"
            >
              🖨 Print
            </button>
          </div>
        }
      />

      {!isConfigured ? (
        <NotConfigured />
      ) : error ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">
          Could not load invoices: {error}
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Total Expected" value={loading ? "—" : money(totalExpected)} accent="brand" live />
            <StatCard label="Due This Week" value={loading ? "—" : money(thisWeekAmount)} accent="green" live />
            <StatCard label="Overdue Amount" value={loading ? "—" : money(overdueAmount)} accent="red" live />
            <StatCard
              label="Open Invoices"
              value={loading ? "—" : String(filteredProjection.length)}
              hint={statusFilter !== "all" || search ? "matching filters" : undefined}
              accent="neutral"
            />
          </div>

          <section className="no-print mb-4">
            <h3 className="mb-2 text-sm font-semibold text-muted">Filters &amp; period</h3>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer or invoice # ( / )"
                aria-label="Search by customer or invoice number"
                className={`${inputClass} w-64`}
              />
              <div role="radiogroup" aria-label="Filter by status" className="flex gap-1">
                {(["all", "overdue", "ontime"] as StatusFilter[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={statusFilter === s}
                    onClick={() => setStatusFilter(s)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                      statusFilter === s ? "bg-brand text-brandink" : "bg-surface2 text-muted hover:bg-surface2/70"
                    }`}
                  >
                    {s === "ontime" ? "On time" : s}
                  </button>
                ))}
              </div>
              <div role="radiogroup" aria-label="Group projection by" className="flex gap-1">
                {(["week", "month"] as Grouping[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    role="radio"
                    aria-checked={grouping === g}
                    tabIndex={grouping === g ? 0 : -1}
                    data-grouping={g}
                    onClick={() => changeGrouping(g)}
                    onKeyDown={(e) => {
                      if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) {
                        e.preventDefault();
                        const next: Grouping = g === "week" ? "month" : "week";
                        changeGrouping(next);
                        e.currentTarget.parentElement
                          ?.querySelector<HTMLButtonElement>(`[data-grouping="${next}"]`)
                          ?.focus();
                      }
                    }}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                      grouping === g ? "bg-brand text-brandink" : "bg-surface2 text-muted hover:bg-surface2/70"
                    }`}
                  >
                    By {g}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section aria-label="Expected inflow chart" className="themed-surface mb-6 rounded-xl border border-line bg-surface p-4">
            {loading ? (
              <div className="flex h-32 items-end gap-3">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-20 flex-none animate-pulse rounded-t bg-surface2"
                    style={{ height: `${30 + ((i * 17) % 60)}%` }}
                  />
                ))}
              </div>
            ) : buckets.length === 0 ? (
              <p className="text-sm text-faint">No open invoices match the current filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <div
                  role="img"
                  aria-label={`Bar chart of expected inflow per ${grouping}, see the table below for exact figures`}
                  className="flex items-end gap-3"
                >
                  {buckets.map((b) => (
                    <div
                      key={b.id}
                      tabIndex={0}
                      title={`${b.label}: ${money(b.amount)}`}
                      className="flex w-20 flex-none flex-col items-center gap-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      <span className="text-[10px] font-medium text-muted">{shortMoney(b.amount)}</span>
                      <div className="flex h-32 w-full items-end">
                        <div
                          className="w-full rounded-t bg-brand"
                          style={{ height: `${Math.max(4, (b.amount / maxBucket) * 100)}%` }}
                        />
                      </div>
                      <span className="w-full truncate text-center text-[10px] text-muted">{b.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {!loading && buckets.length > 0 && (
            <section aria-label="Additional cashflow insights" className="mb-6 grid gap-4 lg:grid-cols-3">
              {/* Cumulative expected inflow */}
              <div className="themed-surface rounded-xl border border-line bg-surface p-4">
                <h3 className="text-sm font-semibold text-ink">Cumulative expected inflow</h3>
                <p className="mb-2 text-xs text-faint">Closing {money(cumulative[cumulative.length - 1]?.value ?? 0)}</p>
                <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-24 w-full" role="img" aria-label="Cumulative expected inflow trend">
                  {[10, 20, 30].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="var(--line)" strokeWidth="0.3" strokeDasharray="1 1" />)}
                  {cumChart.area && <path d={cumChart.area} fill="var(--brand)" opacity="0.12" />}
                  <path d={cumChart.line} fill="none" stroke="var(--brand)" strokeWidth="0.9" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                  {cumChart.pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="0.9" fill="var(--brand)" />)}
                </svg>
                <div className="mt-1 flex justify-between text-[10px] text-faint">
                  <span>{cumulative[0]?.label}</span>
                  <span>{cumulative[cumulative.length - 1]?.label}</span>
                </div>
              </div>

              {/* On-time vs Overdue donut */}
              <div className="themed-surface rounded-xl border border-line bg-surface p-4">
                <h3 className="text-sm font-semibold text-ink">At-risk inflow</h3>
                <p className="mb-2 text-xs text-faint">Overdue vs on-time share.</p>
                <div className="flex items-center gap-3">
                  <svg viewBox="0 0 36 36" className="h-20 w-20 shrink-0 -rotate-90" role="img" aria-label={`${overduePct.toFixed(0)} percent overdue`}>
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="#22c55e" strokeWidth="4" />
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="#ef4444" strokeWidth="4" strokeDasharray={`${overduePct} ${100 - overduePct}`} strokeDashoffset="25" strokeLinecap="round" />
                    <text x="18" y="18" transform="rotate(90 18 18)" textAnchor="middle" dominantBaseline="central" className="fill-ink text-[6px] font-bold">{overduePct.toFixed(0)}%</text>
                  </svg>
                  <ul className="space-y-1.5 text-xs">
                    <li className="flex items-center gap-2 text-muted"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Overdue <span className="ml-auto font-semibold tabular-nums text-ink">{money(overdueAmount)}</span></li>
                    <li className="flex items-center gap-2 text-muted"><span className="h-2.5 w-2.5 rounded-sm bg-green-500" /> On-time <span className="ml-auto font-semibold tabular-nums text-ink">{money(ontimeAmount)}</span></li>
                  </ul>
                </div>
              </div>

              {/* Top customers by expected inflow */}
              <div className="themed-surface rounded-xl border border-line bg-surface p-4">
                <h3 className="text-sm font-semibold text-ink">Top customers by inflow</h3>
                <p className="mb-2 text-xs text-faint">Biggest expected collections (INR).</p>
                <ul className="space-y-1.5">
                  {topCustomers.map((cst) => (
                    <li key={cst.name}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="truncate text-muted">{cst.name}</span>
                        <span className="ml-2 shrink-0 font-semibold tabular-nums text-ink">{money(cst.value)}</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-surface2">
                        <div className="h-full rounded-full" style={{ width: `${(cst.value / maxCust) * 100}%`, background: "linear-gradient(to right, var(--brand), var(--brand-dark))" }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-muted">
              {grouping === "week" ? "Weekly" : "Monthly"} summary — click a period to see its invoices
            </h3>
            <DataTable
              columns={bucketColumns}
              rows={buckets}
              loading={loading}
              empty="No open invoices match the current filters."
              caption={`Expected cash inflow grouped by ${grouping}, with invoice count and expected amount per period. Click a row to expand its invoices.`}
              expandedRowId={expandedBucketId}
              onRowClick={(b) => setExpandedBucketId((prev) => (prev === b.id ? null : b.id))}
              renderExpanded={(b) => (
                <div className="themed-surface overflow-x-auto rounded-lg border border-line bg-surface">
                  <table className="w-full text-xs">
                    <caption className="sr-only">Invoices due in {b.label}, with editable expected date and amount</caption>
                    <thead>
                      <tr className="bg-surface2 text-left text-muted">
                        <th scope="col" className="px-3 py-2 font-semibold">Invoice #</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Customer</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Outstanding (INR)</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Expected date</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Expected amount (INR)</th>
                        <th scope="col" className="no-print px-3 py-2 font-semibold">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.invoices.map((r) => {
                        const overdue = isOverdue(r.status, r.dueDate);
                        const isEdited = Boolean(overrides[r.id]);
                        return (
                          <tr key={r.id} className={`border-t border-line ${overdue ? "bg-red-500/10" : ""}`}>
                            <td className="px-3 py-2 font-medium text-ink">
                              {r.invoiceNo}
                              {overdue && (
                                <span className="ml-2 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-600">
                                  Overdue
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-muted">{r.customer}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted">{money(r.outstanding)}</td>
                            <td className="px-3 py-2">
                              <label className="sr-only" htmlFor={`date-${r.id}`}>
                                Expected collection date for invoice {r.invoiceNo}
                              </label>
                              <input
                                id={`date-${r.id}`}
                                type="date"
                                className={`${inputClass} w-36 py-1 text-xs`}
                                value={r.expectedDate}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setOverride(r.id, { date: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <label className="sr-only" htmlFor={`amount-${r.id}`}>
                                Expected collection amount in INR for invoice {r.invoiceNo}
                              </label>
                              <input
                                id={`amount-${r.id}`}
                                type="number"
                                min="0"
                                step="0.01"
                                className={`${inputClass} w-28 py-1 text-right text-xs tabular-nums`}
                                value={r.expectedAmount}
                                onClick={(e) => e.stopPropagation()}
                                onFocus={() => {
                                  focusValueRef.current[r.id] = r.expectedAmount;
                                }}
                                onChange={(e) => setOverride(r.id, { amount: Number(e.target.value) })}
                                onBlur={() => {
                                  const before = focusValueRef.current[r.id];
                                  if (before !== undefined && before !== r.expectedAmount) {
                                    toast(`${r.invoiceNo} expected amount updated to ${money(r.expectedAmount)}`, {
                                      variant: "success",
                                      actionLabel: "Undo",
                                      onAction: () => resetOverride(r.id, r.invoiceNo),
                                    });
                                  }
                                }}
                                onWheel={(e) => e.currentTarget.blur()}
                              />
                            </td>
                            <td className="no-print px-3 py-2 text-right">
                              {isEdited && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    resetOverride(r.id, r.invoiceNo);
                                  }}
                                  className="text-[11px] font-medium text-muted underline underline-offset-2 hover:text-ink"
                                >
                                  Reset
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            />
          </div>
        </>
      )}
    </div>
  );
}
