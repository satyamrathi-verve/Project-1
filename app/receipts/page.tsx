"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { KpiTile } from "@/app/dashboard/charts";
import { money, formatDate, formatInvoiceNo, isOverdue, daysLate, statusPill } from "@/lib/format";
import type { ReceiptMode } from "@/lib/types";

interface CustomerOption {
  id: string;
  code: string;
  name: string;
}

interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  customer_id: string;
  total: number;
  status: string;
  customers: { name: string; code: string } | null;
}

interface AllocationRow {
  id: string;
  receipt_id: string;
  invoice_id: string;
  amount: number;
}

interface ReceiptRow {
  id: string;
  receipt_no: string;
  receipt_date: string;
  customer_id: string;
  amount: number;
  mode: ReceiptMode;
  reference: string | null;
  customers: { name: string; code: string } | null;
}

interface LedgerRow extends InvoiceRow {
  outstanding: number;
  tds: number;
}

interface ReceiptRegisterRow extends ReceiptRow {
  tds: number;
  allocationDetail: { label: string; amount: number }[];
  statusKey: "paid" | "partial" | "unapplied";
}

// The DB has no TDS column on receipts/receipt_allocations (can't alter tables — see
// CLAUDE.md), so TDS is never stored: it's derived per receipt as
// (sum of its allocations) − (cash received), then apportioned pro-rata to invoices.
type BucketKey = "notDue" | "d0_30" | "d31_60" | "d61_90" | "d90Plus";

const BUCKET_LABEL: Record<BucketKey, string> = {
  notDue: "Not due",
  d0_30: "0–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90Plus: "90+ days",
};
const BUCKET_COLOR: Record<BucketKey, string> = {
  notDue: "var(--brand)",
  d0_30: "#16a34a",
  d31_60: "#d97706",
  d61_90: "#ea580c",
  d90Plus: "#dc2626",
};

function bucketFor(daysOverdue: number): BucketKey {
  if (daysOverdue < 0) return "notDue";
  if (daysOverdue <= 30) return "d0_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90Plus";
}

const MODES: ReceiptMode[] = ["cash", "cheque", "upi", "neft"];
const TDS_RATE_OPTIONS = [0, 1, 2, 5, 10];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReceiptEntryPage() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [receiptsRaw, setReceiptsRaw] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [animate, setAnimate] = useState(false);

  const [receiptNo, setReceiptNo] = useState("");
  const [receiptDate, setReceiptDate] = useState(todayISO());
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<ReceiptMode>("neft");
  const [reference, setReference] = useState("");
  const [tdsRate, setTdsRate] = useState(10);
  const [tdsAmount, setTdsAmount] = useState("");
  const [allocInputs, setAllocInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    setReceiptNo(`RC-${Date.now().toString().slice(-6)}`);
  }, []);

  async function loadAll() {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [custRes, invRes, allocRes, recRes] = await Promise.all([
      supabase.from("customers").select("id, code, name").order("name"),
      supabase
        .from("invoices")
        .select("id, invoice_no, invoice_date, due_date, customer_id, total, status, customers(name, code)")
        .order("invoice_date", { ascending: false }),
      supabase.from("receipt_allocations").select("id, receipt_id, invoice_id, amount"),
      supabase
        .from("receipts")
        .select("id, receipt_no, receipt_date, customer_id, amount, mode, reference, customers(name, code)")
        .order("receipt_date", { ascending: false }),
    ]);

    const firstError = custRes.error ?? invRes.error ?? allocRes.error ?? recRes.error;
    if (firstError) {
      setLoadError(firstError.message);
      setLoading(false);
      return;
    }

    setCustomers((custRes.data as unknown as CustomerOption[]) ?? []);
    setInvoices((invRes.data as unknown as InvoiceRow[]) ?? []);
    setAllocations((allocRes.data as unknown as AllocationRow[]) ?? []);
    setReceiptsRaw((recRes.data as unknown as ReceiptRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!loading) {
      const t = setTimeout(() => setAnimate(true), 80);
      return () => clearTimeout(t);
    }
  }, [loading]);

  // ---- derived maps (all live-computed — nothing stored beyond the base tables) ----
  const allocatedByInvoice = useMemo(() => {
    const m = new Map<string, number>();
    allocations.forEach((a) => m.set(a.invoice_id, (m.get(a.invoice_id) ?? 0) + Number(a.amount)));
    return m;
  }, [allocations]);

  const allocatedByReceipt = useMemo(() => {
    const m = new Map<string, number>();
    allocations.forEach((a) => m.set(a.receipt_id, (m.get(a.receipt_id) ?? 0) + Number(a.amount)));
    return m;
  }, [allocations]);

  // Per receipt: whatever was allocated beyond the cash actually received is the TDS portion.
  const tdsByReceipt = useMemo(() => {
    const m = new Map<string, number>();
    receiptsRaw.forEach((r) => {
      const allocated = allocatedByReceipt.get(r.id) ?? 0;
      m.set(r.id, Math.max(0, allocated - Number(r.amount)));
    });
    return m;
  }, [receiptsRaw, allocatedByReceipt]);

  // Spread each receipt's TDS pro-rata across the invoices it was allocated to.
  const tdsByInvoice = useMemo(() => {
    const m = new Map<string, number>();
    allocations.forEach((a) => {
      const receiptTotal = allocatedByReceipt.get(a.receipt_id) ?? 0;
      const receiptTds = tdsByReceipt.get(a.receipt_id) ?? 0;
      const portion = receiptTotal > 0 ? (Number(a.amount) * receiptTds) / receiptTotal : 0;
      m.set(a.invoice_id, (m.get(a.invoice_id) ?? 0) + portion);
    });
    return m;
  }, [allocations, allocatedByReceipt, tdsByReceipt]);

  const outstandingOf = (inv: InvoiceRow) => Math.max(0, Number(inv.total) - (allocatedByInvoice.get(inv.id) ?? 0));

  // ---- KPIs ----
  const kpis = useMemo(() => {
    const totalInvoiceValue = invoices.reduce((s, i) => s + Number(i.total), 0);
    const totalOutstanding = invoices.reduce((s, i) => s + outstandingOf(i), 0);
    const cashCollected = receiptsRaw.reduce((s, r) => s + Number(r.amount), 0);
    const tdsDeducted = Array.from(tdsByReceipt.values()).reduce((s, v) => s + v, 0);
    const overdueCount = invoices.filter((i) => isOverdue(i.status, i.due_date)).length;
    return {
      totalInvoiceValue,
      totalOutstanding,
      cashCollected,
      tdsDeducted,
      totalSettled: cashCollected + tdsDeducted,
      overdueCount,
    };
  }, [invoices, receiptsRaw, tdsByReceipt, allocatedByInvoice]);

  // ---- Ageing (same bucketing as the AR Ageing report) ----
  const ageing = useMemo(() => {
    const totals: Record<BucketKey, number> = { notDue: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90Plus: 0 };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    invoices.forEach((inv) => {
      const outstanding = outstandingOf(inv);
      if (outstanding <= 0.005 || !inv.due_date) return;
      const daysOverdue = Math.floor((today.getTime() - new Date(inv.due_date).getTime()) / 86400000);
      totals[bucketFor(daysOverdue)] += outstanding;
    });
    return totals;
  }, [invoices, allocatedByInvoice]);

  const ageingMax = Math.max(1, ...Object.values(ageing));

  // ---- Open item ledger ----
  const ledgerRows = useMemo<LedgerRow[]>(() => {
    return invoices
      .map((inv) => ({ ...inv, outstanding: outstandingOf(inv), tds: tdsByInvoice.get(inv.id) ?? 0 }))
      .filter((inv) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "paid") return inv.outstanding <= 0.005;
        if (statusFilter === "partial") return inv.outstanding > 0.005 && inv.outstanding < Number(inv.total) - 0.005;
        return inv.outstanding >= Number(inv.total) - 0.005;
      });
  }, [invoices, allocatedByInvoice, tdsByInvoice, statusFilter]);

  // ---- Receipt register ----
  const receiptRows = useMemo<ReceiptRegisterRow[]>(() => {
    return receiptsRaw.map((r) => {
      const allocsForReceipt = allocations.filter((a) => a.receipt_id === r.id);
      const tds = tdsByReceipt.get(r.id) ?? 0;
      const allocationDetail = allocsForReceipt.map((a) => {
        const inv = invoices.find((i) => i.id === a.invoice_id);
        return { label: inv ? formatInvoiceNo(inv.invoice_no, inv.invoice_date) : "—", amount: Number(a.amount) };
      });
      const allApplied =
        allocsForReceipt.length > 0 &&
        allocsForReceipt.every((a) => {
          const inv = invoices.find((i) => i.id === a.invoice_id);
          return inv ? outstandingOf(inv) <= 0.005 : false;
        });
      const statusKey: ReceiptRegisterRow["statusKey"] =
        allocsForReceipt.length === 0 ? "unapplied" : allApplied ? "paid" : "partial";
      return { ...r, tds, allocationDetail, statusKey };
    });
  }, [receiptsRaw, allocations, tdsByReceipt, invoices, allocatedByInvoice]);

  // ---- Payment form: open invoices for the selected customer ----
  const openInvoicesForCustomer = useMemo(() => {
    if (!customerId) return [];
    return invoices
      .filter((inv) => inv.customer_id === customerId)
      .map((inv) => ({ ...inv, outstanding: outstandingOf(inv) }))
      .filter((inv) => inv.outstanding > 0.005)
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  }, [invoices, customerId, allocatedByInvoice]);

  useEffect(() => {
    setAllocInputs({});
  }, [customerId]);

  const amountNum = parseFloat(amount) || 0;
  const tdsAmountNum = parseFloat(tdsAmount) || 0;
  const pool = amountNum + tdsAmountNum;
  const allocatedTotal = useMemo(
    () => Object.values(allocInputs).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [allocInputs]
  );
  const onAccount = Math.max(0, Math.round((pool - allocatedTotal) * 100) / 100);
  const overAllocated = allocatedTotal > pool + 0.005;

  function setAllocInput(invoiceId: string, value: string) {
    setAllocInputs((prev) => ({ ...prev, [invoiceId]: value }));
  }

  function applyTdsRate() {
    setTdsAmount(((amountNum * tdsRate) / 100).toFixed(2));
  }

  function autoAllocate() {
    let remaining = pool;
    const next: Record<string, string> = {};
    for (const inv of openInvoicesForCustomer) {
      if (remaining <= 0) break;
      const take = Math.min(inv.outstanding, remaining);
      next[inv.id] = take.toFixed(2);
      remaining -= take;
    }
    setAllocInputs(next);
  }

  function clearAllocations() {
    setAllocInputs({});
  }

  function resetForm() {
    setReceiptNo(`RC-${Date.now().toString().slice(-6)}`);
    setReceiptDate(todayISO());
    setCustomerId("");
    setAmount("");
    setTdsAmount("");
    setMode("neft");
    setReference("");
    setAllocInputs({});
    setFormError(null);
    setFormSuccess(null);
  }

  async function handleSave() {
    setFormError(null);
    setFormSuccess(null);
    if (!supabase) return;
    if (!receiptNo.trim()) return setFormError("Enter a receipt number.");
    if (!customerId) return setFormError("Pick a customer.");
    if (amountNum <= 0) return setFormError("Enter an amount greater than zero.");
    if (overAllocated) return setFormError("Allocated amount can't exceed the receipt amount + TDS.");
    for (const inv of openInvoicesForCustomer) {
      const alloc = parseFloat(allocInputs[inv.id] || "0");
      if (alloc > inv.outstanding + 0.005) {
        setFormError(`Allocation for ${formatInvoiceNo(inv.invoice_no, inv.invoice_date)} exceeds its outstanding amount.`);
        return;
      }
    }

    setSaving(true);
    const { data: receipt, error: insertError } = await supabase
      .from("receipts")
      .insert({
        receipt_no: receiptNo.trim(),
        receipt_date: receiptDate,
        customer_id: customerId,
        amount: amountNum,
        mode,
        reference: reference.trim() || null,
      })
      .select("id")
      .single();

    if (insertError || !receipt) {
      setFormError(insertError?.message ?? "Could not save the receipt.");
      setSaving(false);
      return;
    }

    const allocRows = openInvoicesForCustomer
      .map((inv) => ({ invoice_id: inv.id, amount: parseFloat(allocInputs[inv.id] || "0") }))
      .filter((a) => a.amount > 0);

    if (allocRows.length) {
      const { error: allocError } = await supabase
        .from("receipt_allocations")
        .insert(allocRows.map((a) => ({ ...a, receipt_id: receipt.id })));
      if (allocError) {
        setFormError(`Receipt saved, but allocation failed: ${allocError.message}`);
        setSaving(false);
        return;
      }

      for (const a of allocRows) {
        const inv = openInvoicesForCustomer.find((i) => i.id === a.invoice_id)!;
        const newOutstanding = inv.outstanding - a.amount;
        await supabase
          .from("invoices")
          .update({ status: newOutstanding <= 0.005 ? "paid" : "partial" })
          .eq("id", inv.id);
      }
    }

    setFormSuccess(
      `Receipt ${receiptNo.trim()} saved — ${money(amountNum)} cash${
        tdsAmountNum > 0 ? ` + ${money(tdsAmountNum)} TDS` : ""
      } settled.`
    );
    resetForm();
    setSaving(false);
    loadAll();
  }

  const ledgerColumns: Column<LedgerRow>[] = [
    {
      key: "invoice_no",
      header: "Invoice #",
      render: (r) => (
        <Link href={`/invoices/${r.id}`} className="font-medium text-brand hover:underline">
          {formatInvoiceNo(r.invoice_no, r.invoice_date)}
        </Link>
      ),
    },
    { key: "customer", header: "Customer", render: (r) => r.customers?.name ?? "—" },
    { key: "invoice_date", header: "Date", render: (r) => formatDate(r.invoice_date) },
    { key: "total", header: "Amount (INR)", className: "text-right tabular-nums", render: (r) => money(Number(r.total)) },
    {
      key: "tds",
      header: "TDS deducted (INR)",
      className: "text-right tabular-nums",
      render: (r) => (r.tds > 0.5 ? money(r.tds) : "—"),
    },
    {
      key: "outstanding",
      header: "Outstanding (INR)",
      className: "text-right tabular-nums",
      render: (r) => money(r.outstanding),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const overdue = isOverdue(r.status, r.due_date);
        const key = r.outstanding <= 0.005 ? "paid" : overdue ? "overdue" : "partial" === r.status ? "partial" : "open";
        const label = key === "overdue" ? "overdue" : key;
        return (
          <span>
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusPill(key)}`}>
              {label}
            </span>
            {overdue && r.outstanding > 0.005 && (
              <span className="mt-0.5 block text-[10px] font-medium text-red-600">
                {daysLate(r.due_date)} days overdue
              </span>
            )}
          </span>
        );
      },
    },
  ];

  const receiptColumns: Column<ReceiptRegisterRow>[] = [
    { key: "receipt_no", header: "Receipt #" },
    { key: "receipt_date", header: "Date", render: (r) => formatDate(r.receipt_date) },
    { key: "customer", header: "Customer", render: (r) => r.customers?.name ?? "—" },
    { key: "mode", header: "Mode", className: "capitalize", render: (r) => r.mode },
    { key: "reference", header: "Reference", render: (r) => r.reference ?? "—" },
    { key: "amount", header: "Cash (INR)", className: "text-right tabular-nums", render: (r) => money(Number(r.amount)) },
    { key: "tds", header: "TDS (INR)", className: "text-right tabular-nums", render: (r) => (r.tds > 0.5 ? money(r.tds) : "—") },
    {
      key: "settled",
      header: "Total settled (INR)",
      className: "text-right tabular-nums",
      render: (r) => money(Number(r.amount) + r.tds),
    },
    {
      key: "allocation",
      header: "Allocation",
      render: (r) =>
        r.allocationDetail.length === 0 ? (
          <span className="text-faint">On account</span>
        ) : (
          <div className="space-y-0.5">
            {r.allocationDetail.map((a, i) => (
              <div key={i} className="flex justify-between gap-3 text-xs">
                <span className="font-medium text-ink">{a.label}</span>
                <span className="tabular-nums text-muted">{money(a.amount)}</span>
              </div>
            ))}
          </div>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const map: Record<ReceiptRegisterRow["statusKey"], [string, string]> = {
          paid: ["Paid", "paid"],
          partial: ["Partial", "partial"],
          unapplied: ["On account", "open"],
        };
        const [label, key] = map[r.statusKey];
        return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPill(key)}`}>{label}</span>;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Receipt Entry"
        subtitle="Record a payment, allocate it against a customer's open invoices, and watch each invoice flip to Paid as it's settled."
      />

      {!isConfigured ? (
        <NotConfigured />
      ) : loadError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">
          Could not load data: {loadError}
        </div>
      ) : loading ? (
        <div className="themed-surface rounded-xl border border-line bg-surface p-10 text-center text-faint">Loading…</div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <KpiTile
              label="Total invoice value"
              target={kpis.totalInvoiceValue}
              sub={`${invoices.length} invoices`}
              accent="text-ink"
              format={money}
              run={animate}
            />
            <KpiTile
              label="Total outstanding"
              target={kpis.totalOutstanding}
              sub="Open & partial items"
              accent="text-red-600"
              format={money}
              run={animate}
            />
            <KpiTile
              label="Cash collected"
              target={kpis.cashCollected}
              sub={`${receiptsRaw.length} receipts posted`}
              accent="text-green-600"
              format={money}
              run={animate}
            />
            <KpiTile
              label="TDS deducted"
              target={kpis.tdsDeducted}
              sub="Pending certificate reconciliation"
              accent="text-amber-600"
              format={money}
              run={animate}
            />
            <KpiTile
              label="Total settled"
              target={kpis.totalSettled}
              sub="Cash + TDS"
              accent="text-brand"
              format={money}
              run={animate}
            />
            <KpiTile
              label="Overdue invoices"
              target={kpis.overdueCount}
              sub="Past due date"
              accent="text-red-600"
              format={(n) => String(Math.round(n))}
              run={animate}
            />
          </div>

          <div className="themed-surface mb-6 rounded-xl border border-line bg-surface p-6">
            <h2 className="mb-4 text-sm font-semibold text-ink">Record a payment</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Customer">
                <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Select customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Receipt #">
                <input className={inputClass} value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
              </FormField>
              <FormField label="Date">
                <input
                  type="date"
                  className={inputClass}
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.target.value)}
                />
              </FormField>
              <FormField label="Amount (INR, cash)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputClass}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </FormField>
              <FormField label="Mode">
                <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as ReceiptMode)}>
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {m.toUpperCase()}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Reference">
                <input
                  className={inputClass}
                  placeholder="Cheque no. / UTR / txn id…"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </FormField>
              <FormField label="TDS rate (u/s 194J)">
                <select className={inputClass} value={tdsRate} onChange={(e) => setTdsRate(Number(e.target.value))}>
                  {TDS_RATE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </select>
              </FormField>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <FormField label="TDS amount (INR)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className={inputClass}
                      value={tdsAmount}
                      onChange={(e) => setTdsAmount(e.target.value)}
                    />
                  </FormField>
                </div>
                <button
                  type="button"
                  onClick={applyTdsRate}
                  className="h-[38px] rounded-lg bg-surface2 px-3 text-xs font-medium text-muted hover:text-ink"
                >
                  Apply rate
                </button>
              </div>
            </div>

            {customerId && (
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink">Allocate against open invoices</h3>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={autoAllocate}
                      disabled={!pool || openInvoicesForCustomer.length === 0}
                      className="rounded-lg bg-surface2 px-3 py-1.5 text-xs font-medium text-muted hover:text-ink disabled:opacity-40"
                    >
                      Auto-allocate (FIFO)
                    </button>
                    <button
                      type="button"
                      onClick={clearAllocations}
                      className="rounded-lg bg-surface2 px-3 py-1.5 text-xs font-medium text-muted hover:text-ink"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {openInvoicesForCustomer.length === 0 ? (
                  <div className="themed-surface rounded-xl border border-line bg-surface p-6 text-center text-sm text-faint">
                    This customer has no open invoices.
                  </div>
                ) : (
                  <div className="themed-surface overflow-hidden rounded-xl border border-line bg-surface">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line bg-surface2 text-left">
                          <th className="px-4 py-2 font-semibold text-muted">Invoice #</th>
                          <th className="px-4 py-2 font-semibold text-muted">Due</th>
                          <th className="px-4 py-2 text-right font-semibold text-muted">Total</th>
                          <th className="px-4 py-2 text-right font-semibold text-muted">Outstanding</th>
                          <th className="px-4 py-2 text-right font-semibold text-muted">Allocate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openInvoicesForCustomer.map((inv) => (
                          <tr key={inv.id} className="border-b border-line last:border-0">
                            <td className="px-4 py-2 text-ink">{formatInvoiceNo(inv.invoice_no, inv.invoice_date)}</td>
                            <td className="px-4 py-2 text-ink">{formatDate(inv.due_date)}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-ink">{money(Number(inv.total))}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-ink">{money(inv.outstanding)}</td>
                            <td className="px-4 py-2 text-right">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className={`${inputClass} w-32 text-right`}
                                value={allocInputs[inv.id] ?? ""}
                                onChange={(e) => setAllocInput(inv.id, e.target.value)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap justify-end gap-6 border-t border-line pt-3">
                  <div className="text-right">
                    <p className="text-xs text-muted">Allocated</p>
                    <p className="font-mono text-sm font-semibold text-ink">{money(allocatedTotal)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted">TDS applied</p>
                    <p className="font-mono text-sm font-semibold text-ink">{money(tdsAmountNum)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted">On account</p>
                    <p className={`font-mono text-sm font-semibold ${overAllocated ? "text-red-600" : "text-ink"}`}>
                      {overAllocated ? `Over by ${money(allocatedTotal - pool)}` : money(onAccount)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {formError && (
              <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
                {formError}
              </div>
            )}
            {formSuccess && (
              <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-600">
                {formSuccess}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg bg-surface2 px-5 py-2 text-sm font-semibold text-muted hover:text-ink"
              >
                Reset form
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark disabled:opacity-50"
              >
                {saving ? "Saving…" : "Post receipt"}
              </button>
            </div>
          </div>

          <div className="themed-surface mb-6 rounded-xl border border-line bg-surface p-6">
            <h2 className="mb-4 text-sm font-semibold text-ink">Ageing analysis — outstanding by days</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(Object.keys(BUCKET_LABEL) as BucketKey[]).map((key) => (
                <div key={key} className="rounded-lg bg-surface2 p-3">
                  <p className="text-xs text-muted">{BUCKET_LABEL[key]}</p>
                  <p className="mt-1 font-mono text-base font-semibold text-ink">{money(ageing[key])}</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.round((ageing[key] / ageingMax) * 100)}%`, background: BUCKET_COLOR[key] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <PageHeader
            title="Open item ledger"
            action={
              <select
                className={`${inputClass} w-44`}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="open">Unpaid</option>
                <option value="partial">Partially paid</option>
                <option value="paid">Paid</option>
              </select>
            }
          />
          <div className="mb-6">
            <DataTable
              columns={ledgerColumns}
              rows={ledgerRows}
              empty="No invoices match this status."
              rowClassName={(r) => (isOverdue(r.status, r.due_date) && r.outstanding > 0.005 ? "bg-red-500/10 hover:bg-red-500/20" : "")}
            />
          </div>

          <PageHeader title="Receipt register" subtitle="All posted entries. Post a receipt above to add a new one." />
          <DataTable columns={receiptColumns} rows={receiptRows} empty="No receipts recorded yet." />
        </>
      )}
    </div>
  );
}
