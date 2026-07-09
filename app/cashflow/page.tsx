"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { inputClass } from "@/components/FormField";
import { money, isOverdue } from "@/lib/format";

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

export default function CashflowProjectionPage() {
  const [invoices, setInvoices] = useState<OpenInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Grouping>("week");
  // Per-invoice overrides the team has typed in; anything not here uses the default.
  const [overrides, setOverrides] = useState<Record<string, { date?: string; amount?: number }>>({});
  // Which period row is currently expanded (only one at a time), if any.
  const [expandedBucketId, setExpandedBucketId] = useState<string | null>(null);

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

  const buckets: BucketRow[] = useMemo(() => {
    const map = new Map<string, ProjectionRow[]>();
    for (const row of projection) {
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
  }, [projection, grouping]);

  const totalExpected = buckets.reduce((sum, b) => sum + b.amount, 0);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.amount));

  function setOverride(id: string, patch: { date?: string; amount?: number }) {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  // Switching how periods are grouped makes the old expanded period key meaningless.
  function changeGrouping(g: Grouping) {
    setGrouping(g);
    setExpandedBucketId(null);
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
      <PageHeader
        title="Cashflow Projection"
        subtitle="Expected collections from open invoices, grouped by when the money should land. Click a period to see (and adjust) its invoices."
      />

      {!isConfigured ? (
        <NotConfigured />
      ) : error ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">
          Could not load invoices: {error}
        </div>
      ) : loading ? (
        <div aria-live="polite" className="themed-surface rounded-xl border border-line bg-surface p-10 text-center text-faint">
          Loading open invoices…
        </div>
      ) : (
        <>
          <section className="mb-4">
            <h3 className="mb-2 text-sm font-semibold text-muted">Period selection</h3>
            <div className="flex flex-wrap items-center gap-3">
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
              <span className="ml-auto text-sm text-muted">
                Total expected:{" "}
                <span aria-live="polite" aria-atomic="true" className="font-semibold text-ink">
                  {money(totalExpected)}
                </span>
              </span>
            </div>
          </section>

          <section aria-label="Expected inflow chart" className="themed-surface mb-6 rounded-xl border border-line bg-surface p-4">
            {buckets.length === 0 ? (
              <p className="text-sm text-faint">No open invoices to project.</p>
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

          <div>
            <h3 className="mb-2 text-sm font-semibold text-muted">
              {grouping === "week" ? "Weekly" : "Monthly"} summary — click a period to see its invoices
            </h3>
            <DataTable
              columns={bucketColumns}
              rows={buckets}
              empty="No open invoices to project."
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
                      </tr>
                    </thead>
                    <tbody>
                      {b.invoices.map((r) => {
                        const overdue = isOverdue(r.status, r.dueDate);
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
                                onChange={(e) => setOverride(r.id, { amount: Number(e.target.value) })}
                                onWheel={(e) => e.currentTarget.blur()}
                              />
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
