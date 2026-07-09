"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { inputClass } from "@/components/FormField";
import { money } from "@/lib/format";

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

interface BucketRow {
  id: string;
  key: string;
  label: string;
  amount: number;
  count: number;
}

export default function CashflowProjectionPage() {
  const [invoices, setInvoices] = useState<OpenInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Grouping>("week");
  // Per-invoice overrides the team has typed in; anything not here uses the default.
  const [overrides, setOverrides] = useState<Record<string, { date?: string; amount?: number }>>({});

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
      };
    });
  }, [invoices, overrides]);

  const buckets: BucketRow[] = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const row of projection) {
      if (!row.expectedDate) continue;
      const key = grouping === "week" ? weekKey(new Date(row.expectedDate)) : monthKey(new Date(row.expectedDate));
      const existing = map.get(key) ?? { amount: 0, count: 0 };
      existing.amount += row.expectedAmount;
      existing.count += 1;
      map.set(key, existing);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ id: key, key, label: bucketLabel(key, grouping), amount: v.amount, count: v.count }));
  }, [projection, grouping]);

  const totalExpected = buckets.reduce((sum, b) => sum + b.amount, 0);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.amount));

  function setOverride(id: string, patch: { date?: string; amount?: number }) {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const bucketColumns: Column<BucketRow>[] = [
    { key: "label", header: grouping === "week" ? "Week" : "Month" },
    { key: "count", header: "Invoices", className: "text-center" },
    {
      key: "amount",
      header: "Expected inflow (INR)",
      className: "text-right tabular-nums",
      render: (b) => money(b.amount),
    },
  ];

  const invoiceColumns: Column<ProjectionRow>[] = [
    { key: "invoiceNo", header: "Invoice #" },
    { key: "customer", header: "Customer" },
    {
      key: "outstanding",
      header: "Outstanding (INR)",
      className: "text-right tabular-nums",
      render: (r) => money(r.outstanding),
    },
    {
      key: "expectedDate",
      header: "Expected date",
      render: (r) => (
        <>
          <label className="sr-only" htmlFor={`date-${r.id}`}>
            Expected collection date for invoice {r.invoiceNo}
          </label>
          <input
            id={`date-${r.id}`}
            type="date"
            className={`${inputClass} w-40`}
            value={r.expectedDate}
            onChange={(e) => setOverride(r.id, { date: e.target.value })}
          />
        </>
      ),
    },
    {
      key: "expectedAmount",
      header: "Expected amount (INR)",
      className: "text-right",
      render: (r) => (
        <>
          <label className="sr-only" htmlFor={`amount-${r.id}`}>
            Expected collection amount for invoice {r.invoiceNo}
          </label>
          <input
            id={`amount-${r.id}`}
            type="number"
            step="0.01"
            className={`${inputClass} w-32 text-right tabular-nums`}
            value={r.expectedAmount}
            onChange={(e) => setOverride(r.id, { amount: Number(e.target.value) })}
          />
        </>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Cashflow Projection"
        subtitle="Expected collections from open invoices, grouped by when the money should land. Adjust any date or amount below."
      />

      {!isConfigured ? (
        <NotConfigured />
      ) : error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load invoices: {error}
        </div>
      ) : loading ? (
        <div aria-live="polite" className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400">
          Loading open invoices…
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <fieldset className="flex gap-1">
              <legend className="sr-only">Group projection by</legend>
              {(["week", "month"] as Grouping[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGrouping(g)}
                  aria-pressed={grouping === g}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                    grouping === g ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  By {g}
                </button>
              ))}
            </fieldset>
            <span className="ml-auto text-sm text-slate-500">
              Total expected: <span className="font-semibold text-slate-700">{money(totalExpected)}</span>
            </span>
          </div>

          <section aria-label="Expected inflow chart" className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            {buckets.length === 0 ? (
              <p className="text-sm text-slate-400">No open invoices to project.</p>
            ) : (
              <div role="img" aria-label={`Bar chart of expected inflow per ${grouping}, see the table below for exact figures`}
                   className="flex items-end gap-2">
                {buckets.map((b) => (
                  <div key={b.id} className="flex flex-1 flex-col items-center gap-1" title={`${b.label}: ${money(b.amount)}`}>
                    <div className="flex h-32 w-full items-end">
                      <div
                        className="w-full rounded-t bg-brand"
                        style={{ height: `${Math.max(4, (b.amount / maxBucket) * 100)}%` }}
                      />
                    </div>
                    <span className="w-full truncate text-center text-[10px] text-slate-500">{b.label}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="mb-8">
            <h3 className="mb-2 text-sm font-semibold text-slate-600">
              {grouping === "week" ? "Weekly" : "Monthly"} summary
            </h3>
            <DataTable
              columns={bucketColumns}
              rows={buckets}
              empty="No open invoices to project."
              caption={`Expected cash inflow grouped by ${grouping}, with invoice count and expected amount per period`}
            />
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-600">Open invoices (adjust date/amount)</h3>
            <DataTable
              columns={invoiceColumns}
              rows={projection}
              empty="No open invoices right now."
              caption="All open, partial, and overdue invoices with editable expected collection date and amount"
            />
          </div>
        </>
      )}
    </div>
  );
}
