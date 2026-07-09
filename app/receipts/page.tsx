"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { money, formatDate } from "@/lib/format";
import type { ReceiptMode } from "@/lib/types";

interface CustomerOption {
  id: string;
  code: string;
  name: string;
}

interface OpenInvoiceRow {
  id: string;
  invoice_no: string;
  due_date: string | null;
  total: number;
  outstanding: number;
}

interface ReceiptRow {
  id: string;
  receipt_no: string;
  receipt_date: string;
  amount: number;
  mode: ReceiptMode;
  reference: string | null;
  customers: { name: string; code: string } | null;
  allocatedTo: string;
}

const MODES: ReceiptMode[] = ["cash", "cheque", "upi", "neft"];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReceiptEntryPage() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(true);

  const [receiptNo, setReceiptNo] = useState("");
  const [receiptDate, setReceiptDate] = useState(todayISO());
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<ReceiptMode>("neft");
  const [reference, setReference] = useState("");

  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceRow[]>([]);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setReceiptNo(`RC-${Date.now().toString().slice(-6)}`);
  }, []);

  async function loadCustomers() {
    if (!supabase) return;
    const { data } = await supabase.from("customers").select("id, code, name").order("name");
    setCustomers((data as unknown as CustomerOption[]) ?? []);
  }

  async function loadReceipts() {
    if (!supabase) return;
    setLoadingReceipts(true);
    const { data: receiptRows } = await supabase
      .from("receipts")
      .select("id, receipt_no, receipt_date, amount, mode, reference, customers(name, code)")
      .order("receipt_date", { ascending: false });

    const rows = (receiptRows as unknown as Omit<ReceiptRow, "allocatedTo">[]) ?? [];
    const ids = rows.map((r) => r.id);

    const { data: allocRows } = ids.length
      ? await supabase
          .from("receipt_allocations")
          .select("receipt_id, invoices(invoice_no)")
          .in("receipt_id", ids)
      : { data: [] as { receipt_id: string; invoices: { invoice_no: string } | null }[] };

    const allocMap = new Map<string, string[]>();
    (allocRows ?? []).forEach((a: { receipt_id: string; invoices: { invoice_no: string } | null }) => {
      const list = allocMap.get(a.receipt_id) ?? [];
      if (a.invoices?.invoice_no) list.push(a.invoices.invoice_no);
      allocMap.set(a.receipt_id, list);
    });

    setReceipts(
      rows.map((r) => ({
        ...r,
        allocatedTo: (allocMap.get(r.id) ?? []).join(", ") || "—",
      }))
    );
    setLoadingReceipts(false);
  }

  useEffect(() => {
    loadCustomers();
    loadReceipts();
  }, []);

  // When the customer changes, load their open/partial/overdue invoices and each one's live outstanding.
  useEffect(() => {
    setAllocations({});
    if (!supabase || !customerId) {
      setOpenInvoices([]);
      return;
    }
    setLoadingInvoices(true);
    (async () => {
      const { data: invoices } = await supabase!
        .from("invoices")
        .select("id, invoice_no, due_date, total, status")
        .eq("customer_id", customerId)
        .in("status", ["open", "partial", "overdue"])
        .order("due_date", { ascending: true });

      const invRows = (invoices as unknown as { id: string; invoice_no: string; due_date: string | null; total: number }[]) ?? [];
      const ids = invRows.map((i) => i.id);

      const { data: allocRows } = ids.length
        ? await supabase!.from("receipt_allocations").select("invoice_id, amount").in("invoice_id", ids)
        : { data: [] as { invoice_id: string; amount: number }[] };

      const allocatedByInvoice = new Map<string, number>();
      (allocRows ?? []).forEach((a) => {
        allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
      });

      const rows: OpenInvoiceRow[] = invRows
        .map((i) => ({
          id: i.id,
          invoice_no: i.invoice_no,
          due_date: i.due_date,
          total: i.total,
          outstanding: i.total - (allocatedByInvoice.get(i.id) ?? 0),
        }))
        .filter((i) => i.outstanding > 0.005);

      setOpenInvoices(rows);
      setLoadingInvoices(false);
    })();
  }, [customerId]);

  const allocatedTotal = useMemo(
    () => Object.values(allocations).reduce((sum, v) => sum + (parseFloat(v) || 0), 0),
    [allocations]
  );
  const amountNum = parseFloat(amount) || 0;
  const unallocated = Math.round((amountNum - allocatedTotal) * 100) / 100;

  function setAllocation(invoiceId: string, value: string) {
    setAllocations((prev) => ({ ...prev, [invoiceId]: value }));
  }

  // Fill oldest-due invoices first, up to the receipt amount.
  function autoAllocate() {
    let remaining = amountNum;
    const next: Record<string, string> = {};
    for (const inv of openInvoices) {
      if (remaining <= 0) break;
      const take = Math.min(inv.outstanding, remaining);
      next[inv.id] = take.toFixed(2);
      remaining -= take;
    }
    setAllocations(next);
  }

  async function handleSave() {
    setError(null);
    setSuccess(null);
    if (!supabase) return;
    if (!receiptNo.trim()) return setError("Enter a receipt number.");
    if (!customerId) return setError("Pick a customer.");
    if (amountNum <= 0) return setError("Enter an amount greater than zero.");
    if (allocatedTotal > amountNum + 0.005) return setError("Allocated amount can't exceed the receipt amount.");
    for (const inv of openInvoices) {
      const alloc = parseFloat(allocations[inv.id] || "0");
      if (alloc > inv.outstanding + 0.005) {
        setError(`Allocation for ${inv.invoice_no} exceeds its outstanding amount.`);
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
      setError(insertError?.message ?? "Could not save the receipt.");
      setSaving(false);
      return;
    }

    const allocRows = openInvoices
      .map((inv) => ({ invoice_id: inv.id, amount: parseFloat(allocations[inv.id] || "0") }))
      .filter((a) => a.amount > 0);

    if (allocRows.length) {
      const { error: allocError } = await supabase
        .from("receipt_allocations")
        .insert(allocRows.map((a) => ({ ...a, receipt_id: receipt.id })));
      if (allocError) {
        setError(`Receipt saved, but allocation failed: ${allocError.message}`);
        setSaving(false);
        return;
      }

      // Flip each allocated invoice: fully covered -> paid, otherwise partial.
      for (const a of allocRows) {
        const inv = openInvoices.find((i) => i.id === a.invoice_id)!;
        const newOutstanding = inv.outstanding - a.amount;
        await supabase
          .from("invoices")
          .update({ status: newOutstanding <= 0.005 ? "paid" : "partial" })
          .eq("id", inv.id);
      }
    }

    setSuccess(`Receipt ${receiptNo.trim()} saved and allocated.`);
    setReceiptNo(`RC-${Date.now().toString().slice(-6)}`);
    setReceiptDate(todayISO());
    setCustomerId("");
    setAmount("");
    setMode("neft");
    setReference("");
    setOpenInvoices([]);
    setAllocations({});
    setSaving(false);
    loadReceipts();
  }

  const receiptColumns: Column<ReceiptRow>[] = [
    { key: "receipt_no", header: "Receipt #" },
    { key: "receipt_date", header: "Date", render: (r) => formatDate(r.receipt_date) },
    { key: "customer", header: "Customer", render: (r) => r.customers?.name ?? "—" },
    { key: "amount", header: "Amount (INR)", className: "text-right tabular-nums", render: (r) => money(r.amount) },
    { key: "mode", header: "Mode", className: "capitalize", render: (r) => r.mode },
    { key: "reference", header: "Reference", render: (r) => r.reference ?? "—" },
    { key: "allocatedTo", header: "Allocated to" },
  ];

  return (
    <div>
      <PageHeader
        title="Receipt Entry"
        subtitle="Record a payment and allocate it against the customer's open invoices."
      />

      {!isConfigured ? (
        <NotConfigured />
      ) : (
        <>
          <div className="mb-8 rounded-xl border border-slate-200 bg-white p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              <FormField label="Amount (INR)">
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
            </div>

            {customerId && (
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700">Allocate against open invoices</h3>
                  <button
                    type="button"
                    onClick={autoAllocate}
                    disabled={!amountNum || openInvoices.length === 0}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                  >
                    Auto-allocate (oldest first)
                  </button>
                </div>

                {loadingInvoices ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
                    Loading open invoices…
                  </div>
                ) : openInvoices.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
                    This customer has no open invoices.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left">
                          <th className="px-4 py-2 font-semibold text-slate-600">Invoice #</th>
                          <th className="px-4 py-2 font-semibold text-slate-600">Due</th>
                          <th className="px-4 py-2 text-right font-semibold text-slate-600">Total</th>
                          <th className="px-4 py-2 text-right font-semibold text-slate-600">Outstanding</th>
                          <th className="px-4 py-2 text-right font-semibold text-slate-600">Allocate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openInvoices.map((inv) => (
                          <tr key={inv.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-4 py-2 text-slate-700">{inv.invoice_no}</td>
                            <td className="px-4 py-2 text-slate-700">{formatDate(inv.due_date)}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-700">{money(inv.total)}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-700">{money(inv.outstanding)}</td>
                            <td className="px-4 py-2 text-right">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className={`${inputClass} w-32 text-right`}
                                value={allocations[inv.id] ?? ""}
                                onChange={(e) => setAllocation(inv.id, e.target.value)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <p className={`mt-2 text-right text-sm ${unallocated < -0.005 ? "text-red-600" : "text-slate-500"}`}>
                  Allocated {money(allocatedTotal)} of {money(amountNum)} —{" "}
                  {unallocated >= 0 ? "unallocated" : "over-allocated"}: {money(Math.abs(unallocated))}
                </p>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
            )}
            {success && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                {success}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save receipt"}
              </button>
            </div>
          </div>

          <PageHeader title="Recent receipts" />
          {loadingReceipts ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400">
              Loading receipts…
            </div>
          ) : (
            <DataTable columns={receiptColumns} rows={receipts} empty="No receipts recorded yet." />
          )}
        </>
      )}
    </div>
  );
}
