"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { money, formatDate, formatInvoiceNo } from "@/lib/format";

/*
  For one customer: every invoice (debit) and receipt (credit) in date order
  with a running balance. Closing balance = that customer's total outstanding.
  Only reads from the existing customers/invoices/receipts tables.
*/

interface CustomerOption {
  id: string;
  code: string;
  name: string;
}

interface CustomerDetail {
  name: string;
  code: string;
  address: string | null;
  gstin: string | null;
  opening_balance: number;
}

interface Company {
  name: string;
  address: string | null;
  gstin: string | null;
}

type EntryType = "opening" | "invoice" | "receipt";

interface LedgerEntry {
  id: string;
  date: string | null;
  type: EntryType;
  particulars: string;
  debit: number;
  credit: number;
}

export default function CustomerStatementPage() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("customers")
      .select("id, code, name")
      .order("name")
      .then(({ data }) => setCustomers((data as CustomerOption[]) ?? []));
    supabase
      .from("company")
      .select("name, address, gstin")
      .limit(1)
      .single()
      .then(({ data }) => setCompany((data as Company) ?? null));
  }, []);

  useEffect(() => {
    if (!supabase || !customerId) {
      setCustomer(null);
      setEntries([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      const client = supabase!;
      const [custRes, invRes, recRes] = await Promise.all([
        client.from("customers").select("name, code, address, gstin, opening_balance").eq("id", customerId).single(),
        client.from("invoices").select("id, invoice_no, invoice_date, total").eq("customer_id", customerId),
        client.from("receipts").select("id, receipt_no, receipt_date, amount, mode, reference").eq("customer_id", customerId),
      ]);

      const firstError = custRes.error ?? invRes.error ?? recRes.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }

      const cust = custRes.data as CustomerDetail;
      setCustomer(cust);

      const invoiceEntries: LedgerEntry[] = (invRes.data ?? []).map(
        (inv: { id: string; invoice_no: string; invoice_date: string; total: number }) => ({
          id: `inv-${inv.id}`,
          date: inv.invoice_date,
          type: "invoice" as const,
          particulars: `Invoice ${formatInvoiceNo(inv.invoice_no, inv.invoice_date)}`,
          debit: Number(inv.total),
          credit: 0,
        })
      );

      const receiptEntries: LedgerEntry[] = (recRes.data ?? []).map(
        (r: { id: string; receipt_no: string; receipt_date: string; amount: number; mode: string; reference: string | null }) => ({
          id: `rec-${r.id}`,
          date: r.receipt_date,
          type: "receipt" as const,
          particulars: `Receipt ${r.receipt_no} (${r.mode.toUpperCase()}${r.reference ? " · " + r.reference : ""})`,
          debit: 0,
          credit: Number(r.amount),
        })
      );

      const sorted = [...invoiceEntries, ...receiptEntries].sort((a, b) => {
        const byDate = (a.date ?? "").localeCompare(b.date ?? "");
        if (byDate !== 0) return byDate;
        return a.type === "invoice" ? -1 : 1;
      });

      const opening: LedgerEntry[] =
        Number(cust.opening_balance) !== 0
          ? [
              {
                id: "opening",
                date: null,
                type: "opening",
                particulars: "Opening Balance",
                debit: Number(cust.opening_balance) > 0 ? Number(cust.opening_balance) : 0,
                credit: Number(cust.opening_balance) < 0 ? -Number(cust.opening_balance) : 0,
              },
            ]
          : [];

      setEntries([...opening, ...sorted]);
      setLoading(false);
    })();
  }, [customerId]);

  const rows = useMemo(() => {
    let balance = 0;
    return entries.map((e) => {
      balance += e.debit - e.credit;
      return { ...e, balance };
    });
  }, [entries]);

  const totals = useMemo(
    () => rows.reduce((acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }), { debit: 0, credit: 0 }),
    [rows]
  );
  const closingBalance = rows.length ? rows[rows.length - 1].balance : 0;

  function balanceLabel(b: number) {
    return `${money(Math.abs(b))} ${b >= 0 ? "Dr" : "Cr"}`;
  }

  return (
    <>
      <style>{`
        @media print {
          nav { display: none !important; }
          main { padding: 0 !important; overflow: visible !important; }
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .statement-sheet { border: none !important; box-shadow: none !important; }
        }
      `}</style>

      <PageHeader
        title="Customer Statement"
        subtitle="Pick a customer to see their running ledger — every invoice and receipt, in order."
        action={
          customer ? (
            <button
              onClick={() => window.print()}
              className="no-print rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark"
            >
              🖨 Print
            </button>
          ) : undefined
        }
      />

      {!isConfigured ? (
        <NotConfigured />
      ) : (
        <>
          <div className="no-print mb-6 w-72">
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
          </div>

          {!customerId && <p className="text-sm text-faint">Choose a customer above to see their statement.</p>}

          {customerId && error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-600">
              <p className="font-semibold">Couldn&apos;t load this customer&apos;s statement.</p>
              <p className="mt-1 text-sm">{error}</p>
            </div>
          )}

          {customerId && !error && loading && <p className="text-sm text-muted">Loading ledger…</p>}

          {customer && !error && !loading && (
            <div className="statement-sheet mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 text-[13px] text-slate-800">
              <div className="flex items-start justify-between border-b border-slate-200 pb-5">
                <div>
                  <h1 className="text-xl font-extrabold text-brand">{company?.name ?? "—"}</h1>
                  {company?.address && <p className="mt-1 whitespace-pre-line text-slate-500">{company.address}</p>}
                  {company?.gstin && <p className="text-slate-500">GSTIN: {company.gstin}</p>}
                </div>
                <div className="text-right">
                  <h2 className="text-lg font-bold tracking-wide text-slate-800">STATEMENT OF ACCOUNT</h2>
                  <p className="mt-1 text-slate-500">as on {formatDate(new Date().toISOString().slice(0, 10))}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Statement For</p>
                  <p className="font-semibold text-slate-900">{customer.name}</p>
                  <p className="text-slate-600">{customer.code}</p>
                  {customer.address && <p className="whitespace-pre-line text-slate-600">{customer.address}</p>}
                  {customer.gstin && <p className="text-slate-600">GSTIN: {customer.gstin}</p>}
                </div>
                <div className="flex flex-col items-end justify-end text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Closing Balance</p>
                  <p className={`text-lg font-bold ${closingBalance > 0 ? "text-red-600" : "text-slate-900"}`}>
                    {balanceLabel(closingBalance)}
                  </p>
                </div>
              </div>

              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-800 text-left text-xs uppercase tracking-wide text-white">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Particulars</th>
                    <th className="px-3 py-2 text-right">Debit</th>
                    <th className="px-3 py-2 text-right">Credit</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-10 text-center text-slate-400">
                        No invoices or receipts recorded yet for this customer.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100">
                        <td className="px-3 py-2 tabular-nums text-slate-600">{r.date ? formatDate(r.date) : "—"}</td>
                        <td className="px-3 py-2">{r.particulars}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.debit > 0 ? money(r.debit) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.credit > 0 ? money(r.credit) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{balanceLabel(r.balance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-slate-300 bg-slate-50 font-semibold text-slate-900">
                      <td className="px-3 py-2" colSpan={2}>
                        Total
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(totals.debit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(totals.credit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{balanceLabel(closingBalance)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>

              <p className="mt-4 text-[11px] text-slate-400">
                Dr = this customer owes us · Cr = we owe this customer (advance / credit balance).
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
}
