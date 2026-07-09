"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import type { Customer, Invoice, Receipt, ReceiptAllocation } from "@/lib/types";

type BucketKey = "notDue" | "d0_30" | "d31_60" | "d61_90" | "d90Plus";

// Demo-only: the database has no manager/relationship-owner field. Assigned
// round-robin per customer just so the report has something to show and
// filter by — replace with the real field if one gets added later.
const DEMO_MANAGERS = ["Ananya Rao", "Vikram Desai", "Priya Nair", "Rahul Chatterjee"];

interface AgeingInvoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  total: number;
  outstanding: number;
  bucket: BucketKey;
  daysOverdue: number;
  notes: string | null;
}

interface AdvanceReceipt {
  id: string;
  receipt_no: string;
  receipt_date: string;
  mode: string;
  amount: number;
  unapplied: number;
}

interface AgeingRow {
  id: string;
  code: string;
  name: string;
  location: string;
  manager: string;
  remark: string;
  notDue: number;
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90Plus: number;
  total: number;
  advance: number;
  invoices: AgeingInvoice[];
  advanceReceipts: AdvanceReceipt[];
}

const ZERO_TOTALS = { notDue: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90Plus: 0, total: 0, advance: 0 };

const BUCKET_LABEL: Record<BucketKey, string> = {
  notDue: "Not due",
  d0_30: "0–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90Plus: "90+ days",
};

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function bucketFor(daysOverdue: number): BucketKey {
  if (daysOverdue < 0) return "notDue";
  if (daysOverdue <= 30) return "d0_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90Plus";
}

export default function AgeingReportPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [allocations, setAllocations] = useState<ReceiptAllocation[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState("all");
  const [managerFilter, setManagerFilter] = useState("all");
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      const [customersRes, invoicesRes, allocationsRes, receiptsRes] = await Promise.all([
        supabase.from("customers").select("*"),
        supabase.from("invoices").select("*").neq("status", "paid"),
        supabase.from("receipt_allocations").select("*"),
        supabase.from("receipts").select("*"),
      ]);

      const firstError = customersRes.error ?? invoicesRes.error ?? allocationsRes.error ?? receiptsRes.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }

      setCustomers(customersRes.data ?? []);
      setInvoices(invoicesRes.data ?? []);
      setAllocations(allocationsRes.data ?? []);
      setReceipts(receiptsRes.data ?? []);
      setLoading(false);
    })();
  }, []);

  const locations = useMemo(
    () => Array.from(new Set(customers.map((c) => c.address).filter((a): a is string => Boolean(a)))).sort(),
    [customers]
  );

  const allRows = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // demo-only manager assignment, stable by customer code order
    const codesInOrder = [...customers].map((c) => c.code).sort();

    const allocatedByInvoice = new Map<string, number>();
    const allocatedByReceipt = new Map<string, number>();
    for (const a of allocations) {
      allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + a.amount);
      allocatedByReceipt.set(a.receipt_id, (allocatedByReceipt.get(a.receipt_id) ?? 0) + a.amount);
    }

    const byCustomer = new Map<string, AgeingRow>();
    for (const c of customers) {
      const managerIdx = codesInOrder.indexOf(c.code) % DEMO_MANAGERS.length;
      byCustomer.set(c.id, {
        id: c.id,
        code: c.code,
        name: c.name,
        location: c.address ?? "—",
        manager: DEMO_MANAGERS[managerIdx],
        remark: "",
        invoices: [],
        advanceReceipts: [],
        ...ZERO_TOTALS,
      });
    }

    const remarksByCustomer = new Map<string, Set<string>>();

    for (const inv of invoices) {
      const outstanding = inv.total - (allocatedByInvoice.get(inv.id) ?? 0);
      if (outstanding <= 0.005) continue;
      const row = byCustomer.get(inv.customer_id);
      if (!row) continue;

      const daysOverdue = Math.floor(
        (today.getTime() - new Date(inv.due_date).getTime()) / (1000 * 60 * 60 * 24)
      );
      const bucket = bucketFor(daysOverdue);

      row[bucket] += outstanding;
      row.total += outstanding;
      row.invoices.push({
        id: inv.id,
        invoice_no: inv.invoice_no,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        total: inv.total,
        outstanding,
        bucket,
        daysOverdue,
        notes: inv.notes,
      });

      if (inv.notes && inv.notes.trim()) {
        if (!remarksByCustomer.has(inv.customer_id)) remarksByCustomer.set(inv.customer_id, new Set());
        remarksByCustomer.get(inv.customer_id)!.add(inv.notes.trim());
      }
    }

    // advance = receipts received but not yet applied against any invoice
    for (const r of receipts) {
      const unapplied = r.amount - (allocatedByReceipt.get(r.id) ?? 0);
      if (unapplied <= 0.005) continue;
      const row = byCustomer.get(r.customer_id);
      if (!row) continue;
      row.advance += unapplied;
      row.advanceReceipts.push({
        id: r.id,
        receipt_no: r.receipt_no,
        receipt_date: r.receipt_date,
        mode: r.mode,
        amount: r.amount,
        unapplied,
      });
    }

    for (const row of byCustomer.values()) {
      const notes = remarksByCustomer.get(row.id);
      row.remark = notes && notes.size > 0 ? Array.from(notes).join("; ") : "—";
    }

    return Array.from(byCustomer.values())
      .filter((r) => r.total > 0.005 || r.advance > 0.005)
      .sort((a, b) => b.total - a.total);
  }, [customers, invoices, allocations, receipts]);

  const managers = useMemo(() => Array.from(new Set(allRows.map((r) => r.manager))).sort(), [allRows]);

  const rows = useMemo(
    () =>
      allRows.filter(
        (r) =>
          (locationFilter === "all" || r.location === locationFilter) &&
          (managerFilter === "all" || r.manager === managerFilter)
      ),
    [allRows, locationFilter, managerFilter]
  );

  const grandTotal = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          notDue: acc.notDue + r.notDue,
          d0_30: acc.d0_30 + r.d0_30,
          d31_60: acc.d31_60 + r.d31_60,
          d61_90: acc.d61_90 + r.d61_90,
          d90Plus: acc.d90Plus + r.d90Plus,
          total: acc.total + r.total,
          advance: acc.advance + r.advance,
        }),
        { ...ZERO_TOTALS }
      ),
    [rows]
  );

  const worstTotal = rows.length ? Math.max(...rows.map((r) => r.total)) : 0;

  function exportSummary() {
    const sheetRows = rows.map((r) => ({
      "Customer Code": r.code,
      "Customer Name": r.name,
      Location: r.location,
      Manager: r.manager,
      Outstanding: r.total,
      Advance: r.advance,
      "Not Due": r.notDue,
      "0–30 days": r.d0_30,
      "31–60 days": r.d31_60,
      "61–90 days": r.d61_90,
      "90+ days": r.d90Plus,
      Remark: r.remark,
    }));
    sheetRows.push({
      "Customer Code": "",
      "Customer Name": "TOTAL",
      Location: "",
      Manager: "",
      Outstanding: grandTotal.total,
      Advance: grandTotal.advance,
      "Not Due": grandTotal.notDue,
      "0–30 days": grandTotal.d0_30,
      "31–60 days": grandTotal.d31_60,
      "61–90 days": grandTotal.d61_90,
      "90+ days": grandTotal.d90Plus,
      Remark: "",
    });

    const worksheet = XLSX.utils.json_to_sheet(sheetRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "AR Ageing Summary");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `ar-ageing-summary-${today}.xlsx`);
  }

  function exportDetailed() {
    const sheetRows = rows.flatMap((r) =>
      r.invoices.map((inv) => ({
        "Customer Code": r.code,
        "Customer Name": r.name,
        Location: r.location,
        Manager: r.manager,
        "Invoice No": inv.invoice_no,
        "Invoice Date": inv.invoice_date,
        "Due Date": inv.due_date,
        Bucket: BUCKET_LABEL[inv.bucket],
        "Invoice Total": inv.total,
        Outstanding: inv.outstanding,
        Notes: inv.notes ?? "",
      }))
    );

    const worksheet = XLSX.utils.json_to_sheet(sheetRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "AR Ageing Detail");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `ar-ageing-detailed-${today}.xlsx`);
  }

  const columns: Column<AgeingRow>[] = [
    {
      key: "name",
      header: "Customer",
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="text-slate-400">{expandedCustomerId === r.id ? "▾" : "▸"}</span>
          <div>
            <p className="font-medium text-slate-800">{r.name}</p>
            <p className="text-xs text-slate-400">
              {r.code} · {r.location}
            </p>
          </div>
        </div>
      ),
    },
    { key: "manager", header: "Manager*" },
    {
      key: "total",
      header: "Outstanding",
      className: "text-right",
      render: (r) => (
        <span
          className={`font-semibold ${
            worstTotal > 0 && r.total === worstTotal ? "text-red-600" : "text-slate-900"
          }`}
        >
          {currency.format(r.total)}
        </span>
      ),
    },
    {
      key: "advance",
      header: "Advance",
      className: "text-right",
      render: (r) => (
        <span className={r.advance > 0 ? "font-medium text-emerald-600" : "text-slate-400"}>
          {r.advance > 0 ? currency.format(r.advance) : "—"}
        </span>
      ),
    },
    { key: "notDue", header: "Not Due", className: "text-right", render: (r) => currency.format(r.notDue) },
    { key: "d0_30", header: "0–30 days", className: "text-right", render: (r) => currency.format(r.d0_30) },
    { key: "d31_60", header: "31–60 days", className: "text-right", render: (r) => currency.format(r.d31_60) },
    { key: "d61_90", header: "61–90 days", className: "text-right", render: (r) => currency.format(r.d61_90) },
    {
      key: "d90Plus",
      header: "90+ days",
      className: "text-right",
      render: (r) => (
        <span className={r.d90Plus > 0 ? "font-semibold text-red-600" : ""}>{currency.format(r.d90Plus)}</span>
      ),
    },
    {
      key: "remark",
      header: "Remark",
      render: (r) => <span className="text-slate-500">{r.remark}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="AR Ageing"
        subtitle="Outstanding per customer, split by how overdue it is. Click a row for invoice-wise detail."
        action={
          rows.length > 0 ? (
            <div className="flex gap-2 print:hidden">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value === "summary") exportSummary();
                  if (e.target.value === "detailed") exportDetailed();
                  e.target.value = "";
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <option value="" disabled>
                  Export to Excel ▾
                </option>
                <option value="summary">Summary (customer-wise)</option>
                <option value="detailed">Detailed (customer + invoice-wise)</option>
              </select>
              <button
                onClick={() => window.print()}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
              >
                Print
              </button>
            </div>
          ) : undefined
        }
      />

      {!isConfigured && (
        <div className="mb-6">
          <NotConfigured />
        </div>
      )}

      {isConfigured && error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-700">
          <p className="font-semibold">Couldn&apos;t load the ageing report.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}

      {isConfigured && !error && loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Loading outstanding invoices…
        </div>
      )}

      {isConfigured && !error && !loading && (
        <>
          <div className="mb-4 flex flex-wrap gap-4 print:hidden">
            {locations.length > 0 && (
              <div className="w-56">
                <FormField label="Location">
                  <select
                    className={inputClass}
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                  >
                    <option value="all">All locations</option>
                    {locations.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            )}
            {managers.length > 0 && (
              <div className="w-56">
                <FormField label="Manager">
                  <select
                    className={inputClass}
                    value={managerFilter}
                    onChange={(e) => setManagerFilter(e.target.value)}
                  >
                    <option value="all">All managers</option>
                    {managers.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            )}
          </div>

          <DataTable
            columns={columns}
            rows={rows}
            empty="Nothing outstanding — every invoice is paid up."
            expandedRowId={expandedCustomerId}
            onRowClick={(r) => setExpandedCustomerId((prev) => (prev === r.id ? null : r.id))}
            renderExpanded={(r) => (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-left text-slate-500">
                        <th className="px-3 py-2 font-semibold">Invoice</th>
                        <th className="px-3 py-2 font-semibold">Invoice Date</th>
                        <th className="px-3 py-2 font-semibold">Due Date</th>
                        <th className="px-3 py-2 font-semibold">Bucket</th>
                        <th className="px-3 py-2 text-right font-semibold">Invoice Total</th>
                        <th className="px-3 py-2 text-right font-semibold">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...r.invoices]
                        .sort((a, b) => a.due_date.localeCompare(b.due_date))
                        .map((inv) => (
                          <tr key={inv.id} className="border-t border-slate-100 bg-white">
                            <td className="px-3 py-2 font-medium text-slate-700">{inv.invoice_no}</td>
                            <td className="px-3 py-2 text-slate-600">
                              {dateFmt.format(new Date(inv.invoice_date))}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{dateFmt.format(new Date(inv.due_date))}</td>
                            <td className="px-3 py-2 text-slate-600">{BUCKET_LABEL[inv.bucket]}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{currency.format(inv.total)}</td>
                            <td className="px-3 py-2 text-right font-medium text-slate-800">
                              {currency.format(inv.outstanding)}
                            </td>
                          </tr>
                        ))}
                      {r.invoices.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-3 text-center text-slate-400">
                            No outstanding invoices.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {r.advanceReceipts.length > 0 && (
                  <div className="overflow-hidden rounded-lg border border-emerald-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-emerald-50 text-left text-emerald-700">
                          <th className="px-3 py-2 font-semibold" colSpan={2}>
                            Unapplied advance received
                          </th>
                          <th className="px-3 py-2 font-semibold">Mode</th>
                          <th className="px-3 py-2 text-right font-semibold">Receipt Amount</th>
                          <th className="px-3 py-2 text-right font-semibold">Unapplied</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.advanceReceipts.map((rec) => (
                          <tr key={rec.id} className="border-t border-emerald-100 bg-white">
                            <td className="px-3 py-2 font-medium text-slate-700" colSpan={2}>
                              {rec.receipt_no} · {dateFmt.format(new Date(rec.receipt_date))}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{rec.mode}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{currency.format(rec.amount)}</td>
                            <td className="px-3 py-2 text-right font-medium text-emerald-700">
                              {currency.format(rec.unapplied)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            footer={
              rows.length > 0 ? (
                <tr className="bg-slate-50 font-semibold text-slate-900">
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3">—</td>
                  <td className="px-4 py-3 text-right">{currency.format(grandTotal.total)}</td>
                  <td className="px-4 py-3 text-right">
                    {grandTotal.advance > 0 ? currency.format(grandTotal.advance) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">{currency.format(grandTotal.notDue)}</td>
                  <td className="px-4 py-3 text-right">{currency.format(grandTotal.d0_30)}</td>
                  <td className="px-4 py-3 text-right">{currency.format(grandTotal.d31_60)}</td>
                  <td className="px-4 py-3 text-right">{currency.format(grandTotal.d61_90)}</td>
                  <td className="px-4 py-3 text-right">{currency.format(grandTotal.d90Plus)}</td>
                  <td className="px-4 py-3">—</td>
                </tr>
              ) : null
            }
          />

          <p className="mt-3 text-xs text-slate-400 print:hidden">
            * Manager is placeholder demo data for now — it isn&apos;t stored in the database yet.
          </p>
        </>
      )}
    </>
  );
}
