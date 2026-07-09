"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { inputClass } from "@/components/FormField";
import { money, formatDate, isOverdue, statusPill } from "@/lib/format";

// One invoice row joined with its customer's name/code.
interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  total: number;
  status: string;
  customers: { name: string; code: string } | null;
}

const STATUS_FILTERS = ["all", "open", "overdue", "partial", "paid"] as const;

export default function InvoiceListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_no, invoice_date, due_date, total, status, customers(name, code)")
        .order("invoice_date", { ascending: false });
      if (error) setError(error.message);
      else setRows((data as unknown as InvoiceRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  // Apply the search box + status filter in the browser.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const effectiveOverdue = isOverdue(r.status, r.due_date);
      const matchesStatus =
        status === "all" ||
        (status === "overdue" ? effectiveOverdue : r.status === status);
      const matchesSearch =
        !q ||
        r.customers?.name.toLowerCase().includes(q) ||
        r.customers?.code.toLowerCase().includes(q) ||
        r.invoice_no.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [rows, search, status]);

  const columns: Column<InvoiceRow>[] = [
    {
      key: "invoice_no",
      header: "Invoice #",
      render: (r) => (
        <Link
          href={`/invoices/${r.id}`}
          className="font-medium text-brand hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {r.invoice_no}
        </Link>
      ),
    },
    { key: "invoice_date", header: "Date", render: (r) => formatDate(r.invoice_date) },
    { key: "customer", header: "Customer", render: (r) => r.customers?.name ?? "—" },
    { key: "due_date", header: "Due", render: (r) => formatDate(r.due_date) },
    {
      key: "currency",
      header: "Currency",
      className: "text-center",
      render: () => "INR",
    },
    {
      key: "total",
      header: "Total (INR)",
      className: "text-right tabular-nums",
      render: (r) => money(r.total),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const overdue = isOverdue(r.status, r.due_date);
        const label = overdue && r.status !== "overdue" ? "overdue" : r.status;
        return (
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusPill(
              overdue ? "overdue" : r.status
            )}`}
          >
            {label}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Sales Invoices"
        subtitle="All invoices. Search by customer, filter by status. Overdue rows are red."
      />

      {!isConfigured ? (
        <NotConfigured />
      ) : (
        <>
          {/* Search + status filter */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              className={`${inputClass} w-72`}
              placeholder="Search customer or invoice no…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex gap-1">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                    status === s
                      ? "bg-brand text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <span className="ml-auto text-sm text-slate-500">
              {loading ? "Loading…" : `${filtered.length} invoice${filtered.length === 1 ? "" : "s"}`}
            </span>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Could not load invoices: {error}
            </div>
          ) : loading ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400">
              Loading invoices…
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={filtered}
              empty="No invoices match your search."
              onRowClick={(r) => router.push(`/invoices/${r.id}`)}
              rowClassName={(r) =>
                isOverdue(r.status, r.due_date) ? "bg-red-50 hover:bg-red-100" : ""
              }
            />
          )}
        </>
      )}
    </div>
  );
}
