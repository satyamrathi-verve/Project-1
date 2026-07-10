"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import {
  money,
  formatDate,
  splitTax,
  amountInWords,
  formatInvoiceNo,
  placeOfSupply,
  computeTDS,
  panFromGstin,
  SERVICE_SAC,
} from "@/lib/format";

interface Customer {
  name: string;
  code: string;
  contact_person: string | null;
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
  customers: Customer | null;
}
interface LineItem {
  id: string;
  description: string;
  qty: number;
  rate: number;
  amount: number;
}

export default function InvoicePrintPage() {
  const { id } = useParams() as { id: string };
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [received, setReceived] = useState(0);
  const [loading, setLoading] = useState(true);

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
            "id, invoice_no, invoice_date, due_date, subtotal, tax_amount, total, status, customers(name, code, contact_person, gstin, pan, address)"
          )
          .eq("id", id)
          .single(),
        client.from("company").select("name, address, gstin, email, phone").limit(1).single(),
        client.from("invoice_items").select("id, description, qty, rate, amount").eq("invoice_id", id),
        client.from("receipt_allocations").select("amount").eq("invoice_id", id),
      ]);
      if (!inv.error) setInvoice(inv.data as unknown as Invoice);
      if (!comp.error) setCompany(comp.data as unknown as Company);
      setItems((li.data as unknown as LineItem[]) ?? []);
      setReceived(((alloc.data as { amount: number }[]) ?? []).reduce((s, a) => s + Number(a.amount), 0));
      setLoading(false);
    })();
  }, [id]);

  if (!isConfigured) return <div className="p-4"><NotConfigured /></div>;
  if (loading) return <div className="p-10 text-center text-slate-400">Loading…</div>;
  if (!invoice)
    return (
      <div className="p-10 text-center text-slate-500">
        Invoice not found. <Link href="/invoices" className="text-brand underline">Back</Link>
      </div>
    );

  const c = invoice.customers;
  const tax = splitTax(company?.gstin ?? null, c?.gstin ?? null, Number(invoice.tax_amount));
  const tds = computeTDS(Number(invoice.subtotal));
  const balanceDue = Number(invoice.total) - received;
  const invNo = formatInvoiceNo(invoice.invoice_no, invoice.invoice_date);
  const companyPan = panFromGstin(company?.gstin ?? null);
  const rounding = Math.round((Number(invoice.total) - Number(invoice.subtotal) - Number(invoice.tax_amount)) * 100) / 100;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Print-only styles: hide app chrome + action bar when printing */}
      <style>{`
        @media print {
          nav { display: none !important; }
          main { padding: 0 !important; overflow: visible !important; }
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .invoice-sheet { border: none !important; box-shadow: none !important; }
        }
      `}</style>

      {/* Action bar (screen only) */}
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/invoices/${invoice.id}`} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200">
          ← Back
        </Link>
        <button onClick={() => window.print()} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
          🖨 Print / Save as PDF
        </button>
      </div>

      {/* The invoice sheet */}
      <div className="invoice-sheet rounded-xl border border-slate-200 bg-white p-8 text-[13px] text-slate-800">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 pb-5">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/verve-logo.png" alt="Verve Advisory" className="mb-2 h-10 w-auto" />
            <h1 className="text-xl font-extrabold text-brand">{company?.name ?? "—"}</h1>
            <p className="mt-1 whitespace-pre-line text-slate-500">{company?.address}</p>
            {company?.gstin && <p className="text-slate-500">GSTIN: {company.gstin}</p>}
            {companyPan && <p className="text-slate-500">PAN: {companyPan}</p>}
            {company?.email && <p className="text-slate-500">{company.email}</p>}
            {company?.phone && <p className="text-slate-500">{company.phone}</p>}
          </div>
          <div className="text-right">
            <h2 className="text-2xl font-bold tracking-wide text-slate-800">TAX INVOICE</h2>
            <p className="mt-1 text-slate-600">No. {invNo}</p>
            <p className="mt-3 text-xs uppercase tracking-wide text-slate-400">Balance Due</p>
            <p className="text-lg font-bold text-slate-900">{money(balanceDue)}</p>
          </div>
        </div>

        {/* Parties + meta */}
        <div className="grid grid-cols-2 gap-6 py-5">
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bill To</p>
              <p className="font-semibold text-slate-900">{c?.name ?? "—"}</p>
              <p className="whitespace-pre-line text-slate-600">{c?.address}</p>
              {c?.gstin && <p className="text-slate-600">GSTIN: {c.gstin}</p>}
              {c?.pan && <p className="text-slate-600">PAN: {c.pan}</p>}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ship To</p>
              <p className="font-medium text-slate-800">{c?.name}</p>
              <p className="whitespace-pre-line text-slate-600">{c?.address}</p>
              {c?.gstin && <p className="text-slate-600">GSTIN: {c.gstin}</p>}
              {c?.pan && <p className="text-slate-600">PAN: {c.pan}</p>}
            </div>
          </div>
          <div>
            <table className="w-full text-slate-700">
              <tbody>
                <tr>
                  <td className="py-1 text-slate-500">Invoice Date</td>
                  <td className="py-1 text-right">{formatDate(invoice.invoice_date)}</td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-500">Due Date</td>
                  <td className="py-1 text-right">{formatDate(invoice.due_date)}</td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-500">PO No.</td>
                  <td className="py-1 text-right">&nbsp;</td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-500">PO Date</td>
                  <td className="py-1 text-right">&nbsp;</td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-500">Place of Supply</td>
                  <td className="py-1 text-right">{placeOfSupply(c?.gstin ?? null)}</td>
                </tr>
                {c?.contact_person && (
                  <tr>
                    <td className="py-1 text-slate-500">Kind Attention</td>
                    <td className="py-1 text-right">{c.contact_person}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Line items */}
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-800 text-left text-xs uppercase tracking-wide text-white">
              <th className="px-3 py-2">Sr</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">HSN/SAC</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id} className="border-b border-slate-100">
                <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                <td className="px-3 py-2">{it.description}</td>
                <td className="px-3 py-2 tabular-nums">{SERVICE_SAC}</td>
                <td className="px-3 py-2 text-right tabular-nums">{it.qty}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(it.rate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <table className="w-72 text-slate-700">
            <tbody>
              <tr>
                <td className="py-1 text-slate-500">Sub Total</td>
                <td className="py-1 text-right tabular-nums">{money(invoice.subtotal)}</td>
              </tr>
              {tax.intraState ? (
                <>
                  <tr>
                    <td className="py-1 text-slate-500">CGST (9%)</td>
                    <td className="py-1 text-right tabular-nums">{money(tax.cgst)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-slate-500">SGST (9%)</td>
                    <td className="py-1 text-right tabular-nums">{money(tax.sgst)}</td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td className="py-1 text-slate-500">IGST (18%)</td>
                  <td className="py-1 text-right tabular-nums">{money(tax.igst)}</td>
                </tr>
              )}
              {rounding !== 0 && (
                <tr>
                  <td className="py-1 text-slate-500">Rounding</td>
                  <td className="py-1 text-right tabular-nums">{money(rounding)}</td>
                </tr>
              )}
              <tr className="border-t border-slate-300 bg-slate-50 text-base font-bold text-slate-900">
                <td className="px-2 py-2">Total</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(invoice.total)}</td>
              </tr>
              <tr>
                <td className="py-1 text-slate-500">Less: TDS u/s 194J @10%</td>
                <td className="py-1 text-right tabular-nums">− {money(tds)}</td>
              </tr>
              <tr className="border-t border-slate-200 font-medium">
                <td className="py-1">Net Payable</td>
                <td className="py-1 text-right tabular-nums">{money(Number(invoice.total) - tds)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Amount in words */}
        <div className="mt-3 border-t border-slate-200 pt-3">
          <span className="text-slate-500">Total in words: </span>
          <span className="font-semibold italic">{amountInWords(invoice.total)}</span>
        </div>

        {/* Bank details (masked) + signature */}
        <div className="mt-6 grid grid-cols-2 gap-6 border-t border-slate-200 pt-5">
          <div className="text-slate-600">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Bank Details (masked)
            </p>
            <p>Mode of Payment: Cheque / NEFT / Wire</p>
            <p>Bank: HDFC Bank Ltd</p>
            <p>A/c No: ••••••••••</p>
            <p>IFSC: HDFC0••••••</p>
            <p>MICR: •••••••••</p>
            <p>Type: Current</p>
          </div>
          <div className="flex flex-col items-end justify-end text-right">
            <p className="font-semibold text-slate-800">For {company?.name}</p>
            <div className="mt-10 border-t border-slate-400 px-8 pt-1 text-slate-500">Authorised Signatory</div>
          </div>
        </div>

        {/* e-invoicing note (no real IRN/QR available in this dataset) */}
        <p className="mt-6 border-t border-slate-100 pt-3 text-center text-[11px] text-slate-400">
          Computer-generated tax invoice. e-Invoice IRN &amp; QR are generated on submission to the GST portal.
        </p>
      </div>
    </div>
  );
}
