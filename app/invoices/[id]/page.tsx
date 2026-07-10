"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import {
  money,
  formatDate,
  isOverdue,
  statusPill,
  placeOfSupply,
  splitTax,
  amountInWords,
  formatInvoiceNo,
  computeTDS,
  SERVICE_SAC,
} from "@/lib/format";

interface Customer {
  name: string;
  code: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
}

interface Company {
  name: string;
  address: string | null;
  gstin: string | null;
  email: string | null;
  phone: string | null;
}

interface Invoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  subtotal: number;
  tax_amount: number;
  total: number;
  status: string;
  notes: string | null;
  customers: Customer | null;
}

interface LineItem {
  id: string;
  description: string;
  qty: number;
  rate: number;
  amount: number;
}

interface Allocation {
  amount: number;
  receipts: { receipt_no: string; receipt_date: string; mode: string } | null;
}

export default function InvoiceViewPage() {
  const params = useParams();
  const id = params.id as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      const client = supabase!;
      const [inv, comp, li, alloc] = await Promise.all([
        client
          .from("invoices")
          .select(
            "id, invoice_no, invoice_date, due_date, subtotal, tax_amount, total, status, notes, customers(name, code, contact_person, email, phone, gstin, pan, address)"
          )
          .eq("id", id)
          .single(),
        client.from("company").select("name, address, gstin, email, phone").limit(1).single(),
        client.from("invoice_items").select("id, description, qty, rate, amount").eq("invoice_id", id),
        client
          .from("receipt_allocations")
          .select("amount, receipts(receipt_no, receipt_date, mode)")
          .eq("invoice_id", id),
      ]);

      if (inv.error) setError(inv.error.message);
      else setInvoice(inv.data as unknown as Invoice);
      if (!comp.error) setCompany(comp.data as unknown as Company);
      setItems((li.data as unknown as LineItem[]) ?? []);
      setAllocations((alloc.data as unknown as Allocation[]) ?? []);
      setLoading(false);
    })();
  }, [id]);

  const received = allocations.reduce((sum, a) => sum + Number(a.amount), 0);
  const outstanding = invoice ? Number(invoice.total) - received : 0;

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
        <PageHeader title="Invoice" />
        <div className="rounded-xl border border-line bg-surface themed-surface p-10 text-center text-faint">
          Loading invoice…
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div>
        <PageHeader title="Invoice" />
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">
          Could not load this invoice{error ? `: ${error}` : "."}{" "}
          <Link href="/invoices" className="font-medium text-brand hover:underline">
            Back to list
          </Link>
        </div>
      </div>
    );
  }

  const overdue = isOverdue(invoice.status, invoice.due_date);
  const c = invoice.customers;
  const tax = splitTax(company?.gstin ?? null, c?.gstin ?? null, Number(invoice.tax_amount));
  const tds = computeTDS(Number(invoice.subtotal));
  const netPayable = Number(invoice.total) - tds;

  return (
    <div>
      <PageHeader
        title={`Invoice ${formatInvoiceNo(invoice.invoice_no, invoice.invoice_date)}`}
        subtitle="Read-only view. All amounts in INR."
        action={
          <div className="flex gap-2">
            <Link
              href="/invoices"
              className="rounded-lg bg-surface2 px-4 py-2 text-sm font-medium text-muted hover:bg-surface2"
            >
              ← Back
            </Link>
            <Link
              href={`/invoices/${invoice.id}/edit`}
              className="rounded-lg bg-surface2 px-4 py-2 text-sm font-medium text-muted hover:bg-surface2"
            >
              Edit
            </Link>
            <Link
              href={`/invoices/${invoice.id}/print`}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brandink hover:bg-brand-dark"
            >
              Print
            </Link>
          </div>
        }
      />

      <div className="space-y-6">
        {/* From (our company) + status */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface themed-surface p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-faint">From</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/verve-logo.png" alt="Verve Advisory" className="mb-2 inline-block h-8 w-auto rounded-md bg-white p-1.5 shadow-sm" />
            <p className="mt-1 text-lg font-semibold text-ink">{company?.name ?? "—"}</p>
            <dl className="mt-2 space-y-1 text-sm text-muted">
              {company?.address && <div>{company.address}</div>}
              {company?.gstin && <div>GSTIN: {company.gstin}</div>}
              {company?.email && <div>{company.email}</div>}
              {company?.phone && <div>{company.phone}</div>}
            </dl>
          </div>

          <div className="rounded-xl border border-line bg-surface themed-surface p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-faint">Status</p>
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusPill(
                  overdue ? "overdue" : invoice.status
                )}`}
              >
                {overdue && invoice.status !== "overdue" ? "overdue" : invoice.status}
              </span>
            </div>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Invoice date</dt>
                <dd className="text-ink">{formatDate(invoice.invoice_date)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Due date</dt>
                <dd className={overdue ? "font-medium text-red-600" : "text-ink"}>
                  {formatDate(invoice.due_date)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Place of supply</dt>
                <dd className="text-ink">{placeOfSupply(c?.gstin ?? null)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Currency</dt>
                <dd className="text-ink">INR</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Bill To + Ship To */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface themed-surface p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-faint">Bill To</p>
            <p className="mt-1 text-base font-semibold text-ink">{c?.name ?? "—"}</p>
            <p className="text-sm text-muted">{c?.code}</p>
            <dl className="mt-2 space-y-1 text-sm text-muted">
              {c?.address && <div>{c.address}</div>}
              {c?.gstin && <div>GSTIN: {c.gstin}</div>}
              {c?.pan && <div>PAN: {c.pan}</div>}
              {c?.contact_person && <div>Attn: {c.contact_person}</div>}
              {c?.phone && <div>{c.phone}</div>}
            </dl>
          </div>

          <div className="rounded-xl border border-line bg-surface themed-surface p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-faint">
              Ship To <span className="normal-case text-faint">(same as billing)</span>
            </p>
            <p className="mt-1 text-base font-semibold text-ink">{c?.name ?? "—"}</p>
            <dl className="mt-2 space-y-1 text-sm text-muted">
              {c?.address && <div>{c.address}</div>}
              {c?.gstin && <div>GSTIN: {c.gstin}</div>}
            </dl>
            <div className="mt-3 border-t border-line pt-3">
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">PO No.</dt>
                  <dd className="text-ink">&nbsp;</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">PO Date</dt>
                  <dd className="text-ink">&nbsp;</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="overflow-hidden rounded-xl border border-line bg-surface themed-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface2 text-left">
                <th className="px-4 py-3 font-semibold text-muted">Description</th>
                <th className="px-4 py-3 font-semibold text-muted">HSN/SAC</th>
                <th className="px-4 py-3 text-right font-semibold text-muted">Qty</th>
                <th className="px-4 py-3 text-right font-semibold text-muted">Rate</th>
                <th className="px-4 py-3 text-right font-semibold text-muted">Amount (INR)</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-faint">
                    No line items.
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">{it.description}</td>
                    <td className="px-4 py-3 tabular-nums text-ink">{SERVICE_SAC}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{it.qty}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{money(it.rate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{money(it.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Totals with GST split + outstanding */}
        <div className="flex justify-end">
          <div className="w-full max-w-sm space-y-2 rounded-xl border border-line bg-surface themed-surface p-5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal (taxable)</span>
              <span className="tabular-nums text-ink">{money(invoice.subtotal)}</span>
            </div>
            {tax.intraState ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted">CGST</span>
                  <span className="tabular-nums text-ink">{money(tax.cgst)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">SGST</span>
                  <span className="tabular-nums text-ink">{money(tax.sgst)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between">
                <span className="text-muted">IGST</span>
                <span className="tabular-nums text-ink">{money(tax.igst)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
              <span className="text-ink">Total (INR)</span>
              <span className="tabular-nums text-ink">{money(invoice.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Less: TDS u/s 194J @10%</span>
              <span className="tabular-nums text-ink">− {money(tds)}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-2 font-medium">
              <span className="text-ink">Net payable after TDS</span>
              <span className="tabular-nums text-ink">{money(netPayable)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-line pt-2">
              <span className="text-muted">Received</span>
              <span className="tabular-nums text-green-600">− {money(received)}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
              <span className={outstanding > 0 ? "text-red-600" : "text-green-600"}>Outstanding</span>
              <span className={`tabular-nums ${outstanding > 0 ? "text-red-600" : "text-green-600"}`}>
                {money(outstanding)}
              </span>
            </div>
          </div>
        </div>

        {/* Amount in words */}
        <div className="rounded-xl border border-line bg-surface themed-surface p-4 text-sm">
          <span className="text-muted">Total in words: </span>
          <span className="font-medium italic text-ink">{amountInWords(invoice.total)}</span>
        </div>

        {/* Payment history */}
        {allocations.length > 0 && (
          <div className="rounded-xl border border-line bg-surface themed-surface p-5">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-faint">
              Payments received
            </p>
            <ul className="space-y-1 text-sm text-muted">
              {allocations.map((a, i) => (
                <li key={i} className="flex justify-between">
                  <span>
                    {a.receipts?.receipt_no} · {formatDate(a.receipts?.receipt_date)} ·{" "}
                    <span className="capitalize">{a.receipts?.mode}</span>
                  </span>
                  <span className="tabular-nums">{money(a.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Bank details (masked) */}
        <div className="rounded-xl border border-line bg-surface themed-surface p-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
            Bank details <span className="normal-case text-faint">(masked)</span>
          </p>
          <dl className="grid gap-1 text-sm text-muted sm:grid-cols-2">
            <div>Bank: HDFC Bank Ltd</div>
            <div>A/c No: ••••••••••</div>
            <div>IFSC: HDFC0••••••</div>
            <div>Type: Current</div>
          </dl>
        </div>

        {invoice.notes && (
          <div className="rounded-xl border border-line bg-surface themed-surface p-5 text-sm text-muted">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">Notes</p>
            {invoice.notes}
          </div>
        )}
      </div>
    </div>
  );
}
