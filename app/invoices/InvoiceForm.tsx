"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { FormField, inputClass } from "@/components/FormField";
import { NotConfigured } from "@/components/NotConfigured";
import {
  money,
  splitTax,
  GST_RATE,
  nextInvoiceNo,
  addDays,
  formatInvoiceNo,
  SERVICE_SAC,
} from "@/lib/format";

interface CustomerOpt {
  id: string;
  name: string;
  code: string;
  credit_days: number;
  gstin: string | null;
}

interface ItemRow {
  description: string;
  qty: string;
  rate: string;
}

const blankItem = (): ItemRow => ({ description: "", qty: "1", rate: "" });

// Standard credit terms. Default for a customer comes from their credit_days.
const CREDIT_TERMS = [
  { label: "Immediate", days: 0 },
  { label: "Net 7", days: 7 },
  { label: "Net 15", days: 15 },
  { label: "Net 30", days: 30 },
  { label: "Net 45", days: 45 },
  { label: "Net 60", days: 60 },
];

export function InvoiceForm({ invoiceId }: { invoiceId?: string }) {
  const router = useRouter();
  const editing = Boolean(invoiceId);
  const today = new Date().toISOString().slice(0, 10);

  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [companyGstin, setCompanyGstin] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [creditTermDays, setCreditTermDays] = useState(30);
  const [dueDate, setDueDate] = useState(() => addDays(today, 30));
  const [items, setItems] = useState<ItemRow[]>([blankItem()]);
  const [notes, setNotes] = useState("");
  const [invoiceNo, setInvoiceNo] = useState<string | null>(null); // set when editing

  // When customer changes: pull their credit term and refresh the due date.
  function onCustomerChange(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c) {
      setCreditTermDays(c.credit_days);
      setDueDate(addDays(invoiceDate, c.credit_days));
    }
  }
  // Invoice date or credit term changes → recompute the (still editable) due date.
  function onInvoiceDateChange(v: string) {
    setInvoiceDate(v);
    setDueDate(addDays(v, creditTermDays));
  }
  function onCreditTermChange(days: number) {
    setCreditTermDays(days);
    setDueDate(addDays(invoiceDate, days));
  }

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load customers, company, and (if editing) the invoice + its items.
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      const client = supabase!;
      const [custRes, compRes] = await Promise.all([
        client.from("customers").select("id, name, code, credit_days, gstin").order("name"),
        client.from("company").select("gstin").limit(1).single(),
      ]);
      setCustomers((custRes.data as CustomerOpt[]) ?? []);
      if (!compRes.error) setCompanyGstin((compRes.data as { gstin: string | null }).gstin);

      if (invoiceId) {
        const [inv, li] = await Promise.all([
          client
            .from("invoices")
            .select("invoice_no, invoice_date, due_date, customer_id, notes")
            .eq("id", invoiceId)
            .single(),
          client.from("invoice_items").select("description, qty, rate").eq("invoice_id", invoiceId),
        ]);
        if (inv.error) {
          setError(inv.error.message);
        } else {
          const d = inv.data as {
            invoice_no: string;
            invoice_date: string;
            due_date: string | null;
            customer_id: string;
            notes: string | null;
          };
          setInvoiceNo(d.invoice_no);
          setInvoiceDate(d.invoice_date);
          setCustomerId(d.customer_id);
          setNotes(d.notes ?? "");
          if (d.due_date) {
            setDueDate(d.due_date);
            const diff = Math.round((new Date(d.due_date).getTime() - new Date(d.invoice_date).getTime()) / 86400000);
            setCreditTermDays(diff);
          }
          const rows = (li.data as { description: string; qty: number; rate: number }[]) ?? [];
          setItems(
            rows.length
              ? rows.map((r) => ({ description: r.description, qty: String(r.qty), rate: String(r.rate) }))
              : [blankItem()]
          );
        }
      }
      setLoading(false);
    })();
  }, [invoiceId]);

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;
  // Show a custom option if an edited due date doesn't match a standard term.
  const termOptions = CREDIT_TERMS.some((t) => t.days === creditTermDays)
    ? CREDIT_TERMS
    : [...CREDIT_TERMS, { label: `Net ${creditTermDays}`, days: creditTermDays }];

  // Live totals.
  const { subtotal, tax, total } = useMemo(() => {
    const sub = items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.rate) || 0), 0);
    const t = Math.round(sub * GST_RATE * 100) / 100;
    return { subtotal: sub, tax: t, total: sub + t };
  }, [items]);

  const taxSplit = splitTax(companyGstin, selectedCustomer?.gstin ?? null, tax);

  const setItem = (i: number, patch: Partial<ItemRow>) =>
    setItems((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const addRow = () => setItems((prev) => [...prev, blankItem()]);
  const removeRow = (i: number) => setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  async function handleSave() {
    setError(null);
    if (!supabase) return;
    if (!customerId) return setError("Please pick a customer.");
    const cleanItems = items
      .map((it) => ({
        description: it.description.trim(),
        qty: parseFloat(it.qty) || 0,
        rate: parseFloat(it.rate) || 0,
      }))
      .filter((it) => it.description && it.qty > 0);
    if (cleanItems.length === 0) return setError("Add at least one line item with a description and quantity.");

    setSaving(true);
    const client = supabase;
    const itemsWithAmount = cleanItems.map((it) => ({ ...it, amount: Math.round(it.qty * it.rate * 100) / 100 }));

    try {
      if (editing && invoiceId) {
        // Update the invoice, then replace its line items.
        const { error: upErr } = await client
          .from("invoices")
          .update({ customer_id: customerId, invoice_date: invoiceDate, due_date: dueDate, subtotal, tax_amount: tax, total, notes: notes || null })
          .eq("id", invoiceId);
        if (upErr) throw upErr;
        await client.from("invoice_items").delete().eq("invoice_id", invoiceId);
        const { error: itErr } = await client
          .from("invoice_items")
          .insert(itemsWithAmount.map((it) => ({ ...it, invoice_id: invoiceId })));
        if (itErr) throw itErr;
        router.push(`/invoices/${invoiceId}`);
      } else {
        // New: generate the next number, insert invoice, then its items.
        const { data: nums } = await client.from("invoices").select("invoice_no");
        const invoice_no = nextInvoiceNo(((nums as { invoice_no: string }[]) ?? []).map((n) => n.invoice_no));
        const { data: created, error: insErr } = await client
          .from("invoices")
          .insert({ invoice_no, invoice_date: invoiceDate, customer_id: customerId, due_date: dueDate, subtotal, tax_amount: tax, total, status: "open", notes: notes || null })
          .select("id")
          .single();
        if (insErr) throw insErr;
        const newId = (created as { id: string }).id;
        const { error: itErr } = await client
          .from("invoice_items")
          .insert(itemsWithAmount.map((it) => ({ ...it, invoice_id: newId })));
        if (itErr) throw itErr;
        router.push(`/invoices/${newId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the invoice.");
      setSaving(false);
    }
  }

  if (!isConfigured) {
    return (
      <div>
        <PageHeader title="Invoice" />
        <NotConfigured />
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <PageHeader title={editing ? "Edit invoice" : "New invoice"} />
        <div className="rounded-xl border border-line bg-surface themed-surface p-10 text-center text-faint">Loading…</div>
      </div>
    );
  }

  const previewNo = editing && invoiceNo ? formatInvoiceNo(invoiceNo, invoiceDate) : "auto (VAPL / FY / next number)";

  return (
    <div>
      <PageHeader
        title={editing ? "Edit invoice" : "New invoice"}
        subtitle={`Invoice no: ${previewNo}. Amounts in INR.`}
        action={
          <Link
            href={editing && invoiceId ? `/invoices/${invoiceId}` : "/invoices"}
            className="rounded-lg bg-surface2 px-4 py-2 text-sm font-medium text-muted hover:bg-surface2"
          >
            Cancel
          </Link>
        }
      />

      <div className="space-y-6">
        {/* Customer + dates + credit term */}
        <div className="space-y-4 rounded-xl border border-line bg-surface themed-surface p-5">
          <FormField label="Customer">
            <select className={inputClass} value={customerId} onChange={(e) => onCustomerChange(e.target.value)}>
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid gap-4 md:grid-cols-3">
            <FormField label="Invoice date">
              <input type="date" className={inputClass} value={invoiceDate} onChange={(e) => onInvoiceDateChange(e.target.value)} />
            </FormField>
            <FormField label="Credit term (from customer)">
              <select className={inputClass} value={creditTermDays} onChange={(e) => onCreditTermChange(Number(e.target.value))}>
                {termOptions.map((t) => (
                  <option key={t.days} value={t.days}>
                    {t.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Due date (editable)">
              <input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </FormField>
          </div>
        </div>

        {/* Line items */}
        <div className="rounded-xl border border-line bg-surface themed-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">Line items</p>
            <button onClick={addRow} className="rounded-lg bg-surface2 px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface2">
              + Add row
            </button>
          </div>
          <div className="space-y-2">
            <div className="hidden grid-cols-12 gap-2 px-1 text-xs font-medium uppercase tracking-wide text-faint md:grid">
              <span className="col-span-6">Description</span>
              <span className="col-span-1 text-center">SAC</span>
              <span className="col-span-1 text-right">Qty</span>
              <span className="col-span-2 text-right">Rate</span>
              <span className="col-span-2 text-right">Amount</span>
            </div>
            {items.map((it, i) => {
              const amount = (parseFloat(it.qty) || 0) * (parseFloat(it.rate) || 0);
              return (
                <div key={i} className="grid grid-cols-12 items-center gap-2">
                  <input
                    className={`${inputClass} col-span-12 md:col-span-6`}
                    placeholder="Description of service"
                    value={it.description}
                    onChange={(e) => setItem(i, { description: e.target.value })}
                  />
                  <span className="col-span-2 text-center text-xs text-faint md:col-span-1">{SERVICE_SAC}</span>
                  <input
                    className={`${inputClass} col-span-3 text-right md:col-span-1`}
                    type="number"
                    min="0"
                    value={it.qty}
                    onChange={(e) => setItem(i, { qty: e.target.value })}
                  />
                  <input
                    className={`${inputClass} col-span-4 text-right md:col-span-2`}
                    type="number"
                    min="0"
                    placeholder="Rate"
                    value={it.rate}
                    onChange={(e) => setItem(i, { rate: e.target.value })}
                  />
                  <span className="col-span-2 text-right text-sm tabular-nums text-ink md:col-span-2">{money(amount)}</span>
                  <button
                    onClick={() => removeRow(i)}
                    className="col-span-1 text-faint hover:text-red-500"
                    title="Remove row"
                    aria-label="Remove row"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Totals + notes */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface themed-surface p-5">
            <FormField label="Notes (optional)">
              <textarea className={`${inputClass} h-24 resize-none`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any note for this invoice…" />
            </FormField>
          </div>
          <div className="space-y-2 rounded-xl border border-line bg-surface themed-surface p-5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal (taxable)</span>
              <span className="tabular-nums text-ink">{money(subtotal)}</span>
            </div>
            {taxSplit.intraState ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted">CGST (9%)</span>
                  <span className="tabular-nums text-ink">{money(taxSplit.cgst)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">SGST (9%)</span>
                  <span className="tabular-nums text-ink">{money(taxSplit.sgst)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between">
                <span className="text-muted">IGST (18%)</span>
                <span className="tabular-nums text-ink">{money(taxSplit.igst)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
              <span className="text-ink">Total (INR)</span>
              <span className="tabular-nums text-ink">{money(total)}</span>
            </div>
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">{error}</div>}

        <div className="flex justify-end gap-3">
          <Link
            href={editing && invoiceId ? `/invoices/${invoiceId}` : "/invoices"}
            className="rounded-lg bg-surface2 px-5 py-2.5 text-sm font-medium text-muted hover:bg-surface2"
          >
            Cancel
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-brandink hover:bg-brand-dark disabled:opacity-60"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Create invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}
