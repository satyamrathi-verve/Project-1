"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { money, formatDate, isOverdue, statusPill, formatInvoiceNo } from "@/lib/format";

interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  total: number;
  status: string;
  customers: { name: string } | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [receivedByInvoice, setReceivedByInvoice] = useState<Record<string, number>>({});
  const [customerCount, setCustomerCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      const client = supabase!;
      const [inv, alloc, custCount] = await Promise.all([
        client
          .from("invoices")
          .select("id, invoice_no, invoice_date, due_date, total, status, customers(name)")
          .order("invoice_date", { ascending: false }),
        client.from("receipt_allocations").select("invoice_id, amount"),
        client.from("customers").select("id", { count: "exact", head: true }),
      ]);

      setInvoices((inv.data as unknown as InvoiceRow[]) ?? []);
      const map: Record<string, number> = {};
      ((alloc.data as { invoice_id: string; amount: number }[]) ?? []).forEach((a) => {
        map[a.invoice_id] = (map[a.invoice_id] ?? 0) + Number(a.amount);
      });
      setReceivedByInvoice(map);
      setCustomerCount(custCount.count ?? 0);
      setLoading(false);
    })();
  }, []);

  const outstandingOf = (r: InvoiceRow) => Math.max(0, Number(r.total) - (receivedByInvoice[r.id] ?? 0));

  const overdue = invoices.filter((r) => isOverdue(r.status, r.due_date));
  const totalOutstanding = invoices
    .filter((r) => r.status !== "paid")
    .reduce((s, r) => s + outstandingOf(r), 0);
  const overdueOutstanding = overdue.reduce((s, r) => s + outstandingOf(r), 0);
  const recent = invoices.slice(0, 8);

  const tiles = [
    { label: "Customers", value: String(customerCount), sub: "on the master", accent: "text-slate-900" },
    { label: "Invoices", value: String(invoices.length), sub: "total raised", accent: "text-slate-900" },
    { label: "Overdue", value: String(overdue.length), sub: `${money(overdueOutstanding)} outstanding`, accent: "text-red-600" },
    { label: "Total Outstanding", value: money(totalOutstanding), sub: "across open invoices", accent: "text-brand" },
  ];

  const columns: Column<InvoiceRow>[] = [
    {
      key: "invoice_no",
      header: "Invoice #",
      render: (r) => <span className="font-medium text-brand">{formatInvoiceNo(r.invoice_no, r.invoice_date)}</span>,
    },
    { key: "invoice_date", header: "Date", render: (r) => formatDate(r.invoice_date) },
    { key: "customer", header: "Customer", render: (r) => r.customers?.name ?? "—" },
    { key: "total", header: "Total", className: "text-right tabular-nums", render: (r) => money(r.total) },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const od = isOverdue(r.status, r.due_date);
        return (
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusPill(od ? "overdue" : r.status)}`}>
            {od && r.status !== "overdue" ? "overdue" : r.status}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="The finance team's at-a-glance view. All amounts in INR." />

      {!isConfigured ? (
        <NotConfigured />
      ) : loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400">Loading…</div>
      ) : (
        <div className="space-y-6">
          {/* Tiles */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t.label}</p>
                <p className={`mt-2 text-3xl font-bold tabular-nums ${t.accent}`}>{t.value}</p>
                <p className="mt-1 text-xs text-slate-500">{t.sub}</p>
              </div>
            ))}
          </div>

          {/* Recent invoices */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Recent invoices</h2>
              <Link href="/invoices" className="text-sm font-medium text-brand hover:underline">
                View all →
              </Link>
            </div>
            <DataTable
              columns={columns}
              rows={recent}
              empty="No invoices yet."
              onRowClick={(r) => router.push(`/invoices/${r.id}`)}
              rowClassName={(r) => (isOverdue(r.status, r.due_date) ? "bg-red-50 hover:bg-red-100" : "")}
            />
          </div>
        </div>
      )}
    </div>
  );
}
