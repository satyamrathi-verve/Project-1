"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isConfigured, supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { MultiSelect } from "@/components/MultiSelect";
import { Pagination } from "@/components/Pagination";
import { inputClass } from "@/components/FormField";
import { reminderCountBucket, type ReminderCountBucket } from "@/lib/reminderCount";
import { exportToCsv, exportToExcel, exportToPdf, type ExportColumn } from "@/lib/exportUtils";
import type { Customer, Invoice, ReceiptAllocation, ReminderLog } from "@/lib/types";

interface HistoryRow {
  id: string;
  sent_at: string;
  invoice_no: string;
  invoice_date: string | null;
  due_date: string | null;
  customer_name: string;
  customer_phone: string | null;
  outstanding: number;
  recipient: string;
  status: string;
  sent_by: string;
  reminder_count: number;
  count_bucket: ReminderCountBucket;
}

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function isSuccessful(status: string) {
  return ["sent", "delivered"].includes(status.toLowerCase());
}

function statusStyle(status: string) {
  const s = status.toLowerCase();
  if (s === "failed") return "bg-red-100 text-red-700";
  if (s === "pending") return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700";
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

export default function ReminderHistoryPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baseRows, setBaseRows] = useState<HistoryRow[]>([]);

  // Filters
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState<Set<string>>(new Set());
  const [invoiceFilter, setInvoiceFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<string>("sent_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    void loadData();
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, customerFilter, invoiceFilter, statusFilter, dateFrom, dateTo, sortKey, sortDir]);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [logsRes, invoicesRes, customersRes, allocationsRes] = await Promise.all([
      supabase!.from("reminder_log").select("*"),
      supabase!.from("invoices").select("*"),
      supabase!.from("customers").select("*"),
      supabase!.from("receipt_allocations").select("*"),
    ]);

    if (logsRes.error || invoicesRes.error || customersRes.error || allocationsRes.error) {
      setError(
        logsRes.error?.message ||
          invoicesRes.error?.message ||
          customersRes.error?.message ||
          allocationsRes.error?.message ||
          "Failed to load reminder history."
      );
      setLoading(false);
      return;
    }

    const logs = (logsRes.data ?? []) as ReminderLog[];
    const invoices = (invoicesRes.data ?? []) as Invoice[];
    const customers = (customersRes.data ?? []) as Customer[];
    const allocations = (allocationsRes.data ?? []) as ReceiptAllocation[];

    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    const customerById = new Map(customers.map((c) => [c.id, c]));

    // Reminder Count = how many times this invoice has been reminded, derived live from
    // reminder_log rather than a stored counter, so it's always accurate as sends happen.
    const countByInvoice = new Map<string, number>();
    logs.forEach((log) => {
      if (!log.invoice_id) return;
      countByInvoice.set(log.invoice_id, (countByInvoice.get(log.invoice_id) ?? 0) + 1);
    });

    const rows = logs.map((log) => {
      const invoice = log.invoice_id ? invoiceById.get(log.invoice_id) : undefined;
      const customer = invoice ? customerById.get(invoice.customer_id) : undefined;
      const allocated = invoice
        ? allocations.filter((a) => a.invoice_id === invoice.id).reduce((sum, a) => sum + a.amount, 0)
        : 0;
      const outstanding = invoice ? invoice.total - allocated : 0;
      const count = log.invoice_id ? countByInvoice.get(log.invoice_id) ?? 1 : 1;

      const row: HistoryRow = {
        id: log.id,
        sent_at: log.sent_at,
        invoice_no: invoice?.invoice_no ?? "Unknown invoice",
        invoice_date: invoice?.invoice_date ?? null,
        due_date: invoice?.due_date ?? null,
        customer_name: customer?.name ?? "Unknown customer",
        customer_phone: customer?.phone ?? null,
        outstanding,
        recipient: log.to_email ?? "—",
        status: log.status ?? "sent",
        sent_by: "—",
        reminder_count: count,
        count_bucket: reminderCountBucket(count),
      };
      return row;
    });

    setBaseRows(rows);
    setLoading(false);
  }

  const customerOptions = useMemo(() => [...new Set(baseRows.map((r) => r.customer_name))].sort(), [baseRows]);
  const invoiceOptions = useMemo(() => [...new Set(baseRows.map((r) => r.invoice_no))].sort(), [baseRows]);
  const statusOptions = useMemo(() => [...new Set(baseRows.map((r) => r.status))].sort(), [baseRows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo) : null;
    if (to) to.setHours(23, 59, 59, 999);

    return baseRows.filter((row) => {
      if (term) {
        const haystack = `${row.customer_name} ${row.invoice_no} ${row.recipient}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (customerFilter.size > 0 && !customerFilter.has(row.customer_name)) return false;
      if (invoiceFilter.size > 0 && !invoiceFilter.has(row.invoice_no)) return false;
      if (statusFilter.size > 0 && !statusFilter.has(row.status)) return false;
      const sentAt = new Date(row.sent_at);
      if (from && sentAt < from) return false;
      if (to && sentAt > to) return false;
      return true;
    });
  }, [baseRows, search, customerFilter, invoiceFilter, statusFilter, dateFrom, dateTo]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "customer_name":
          return a.customer_name.localeCompare(b.customer_name) * dir;
        case "invoice_no":
          return a.invoice_no.localeCompare(b.invoice_no) * dir;
        case "reminder_count":
          return (a.reminder_count - b.reminder_count) * dir;
        case "sent_at":
        default:
          return (new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()) * dir;
      }
    });
  }, [filteredRows, sortKey, sortDir]);

  const pagedRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const summary = useMemo(() => {
    const totalCustomers = new Set(filteredRows.map((r) => r.customer_name)).size;
    const totalInvoices = new Set(filteredRows.map((r) => r.invoice_no)).size;
    const successful = filteredRows.filter((r) => isSuccessful(r.status)).length;
    const failed = filteredRows.filter((r) => r.status.toLowerCase() === "failed").length;
    const pending = filteredRows.filter((r) => r.status.toLowerCase() === "pending").length;
    return { total: filteredRows.length, totalCustomers, totalInvoices, successful, failed, pending };
  }, [filteredRows]);

  const exportColumns: ExportColumn<HistoryRow>[] = [
    { header: "Sent Date", value: (r) => new Date(r.sent_at).toLocaleDateString() },
    { header: "Sent Time", value: (r) => new Date(r.sent_at).toLocaleTimeString() },
    { header: "Customer", value: (r) => r.customer_name },
    { header: "Invoice #", value: (r) => r.invoice_no },
    { header: "Invoice Date", value: (r) => (r.invoice_date ? new Date(r.invoice_date).toLocaleDateString() : "") },
    { header: "Due Date", value: (r) => (r.due_date ? new Date(r.due_date).toLocaleDateString() : "") },
    { header: "Outstanding", value: (r) => r.outstanding.toFixed(2) },
    { header: "Recipient Email", value: (r) => r.recipient },
    { header: "Status", value: (r) => r.status },
    { header: "Sent By", value: (r) => r.sent_by },
    { header: "Reminder Count", value: (r) => r.reminder_count },
  ];

  function handleExport(kind: "csv" | "excel" | "pdf") {
    setExportOpen(false);
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "csv") exportToCsv(sortedRows, exportColumns, `reminder-history-${stamp}.csv`);
    if (kind === "excel") void exportToExcel(sortedRows, exportColumns, `reminder-history-${stamp}.xlsx`);
    if (kind === "pdf") void exportToPdf(sortedRows, exportColumns, `reminder-history-${stamp}.pdf`, "Email Reminder History");
  }

  const columns: Column<HistoryRow>[] = [
    {
      key: "sent_at",
      header: "Sent",
      sortable: true,
      render: (row) => (
        <span>
          {new Date(row.sent_at).toLocaleDateString()}{" "}
          <span className="text-slate-400">{new Date(row.sent_at).toLocaleTimeString()}</span>
        </span>
      ),
    },
    { key: "customer_name", header: "Customer", sortable: true },
    { key: "invoice_no", header: "Invoice #", sortable: true },
    {
      key: "invoice_date",
      header: "Invoice Date",
      render: (row) => (row.invoice_date ? new Date(row.invoice_date).toLocaleDateString() : "—"),
    },
    {
      key: "due_date",
      header: "Due Date",
      render: (row) => (row.due_date ? new Date(row.due_date).toLocaleDateString() : "—"),
    },
    { key: "outstanding", header: "Outstanding", render: (row) => money(row.outstanding) },
    { key: "recipient", header: "Recipient Email" },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusStyle(row.status)}`}>
          {row.status}
        </span>
      ),
    },
    { key: "sent_by", header: "Sent By" },
    {
      key: "reminder_count",
      header: "Reminder Count",
      sortable: true,
      render: (row) => <span className="font-medium">{row.count_bucket}</span>,
    },
  ];

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Email Reminder History" />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Email Reminder History"
        subtitle="Every email reminder ever sent across the app, with filters to narrow it down."
        action={
          <div ref={exportRef} className="relative">
            <button
              onClick={() => setExportOpen((v) => !v)}
              disabled={sortedRows.length === 0}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Export ▾
            </button>
            {exportOpen && (
              <div className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                <button onClick={() => handleExport("excel")} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-50">
                  Excel (.xlsx)
                </button>
                <button onClick={() => handleExport("csv")} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-50">
                  CSV (.csv)
                </button>
                <button onClick={() => handleExport("pdf")} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-50">
                  PDF (.pdf)
                </button>
              </div>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard label="Total Reminders" value={summary.total} />
        <SummaryCard label="Customers" value={summary.totalCustomers} />
        <SummaryCard label="Invoices" value={summary.totalInvoices} />
        <SummaryCard label="Successful" value={summary.successful} />
        <SummaryCard label="Failed" value={summary.failed} />
        <SummaryCard label="Pending" value={summary.pending} />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, invoice #, or email…"
            className={`${inputClass} w-56`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">From</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">To</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
        </label>
        <MultiSelect label="Customer" options={customerOptions} selected={customerFilter} onChange={setCustomerFilter} />
        <MultiSelect label="Invoice #" options={invoiceOptions} selected={invoiceFilter} onChange={setInvoiceFilter} />
        <MultiSelect label="Status" options={statusOptions} selected={statusFilter} onChange={setStatusFilter} />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading reminder history…</p>
      ) : (
        <>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Reminders ({sortedRows.length})
          </h3>
          <DataTable
            columns={columns}
            rows={pagedRows}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            empty={baseRows.length === 0 ? "No Reminder History Found" : "No reminders match the current filters."}
          />
          {sortedRows.length > 0 && (
            <Pagination page={page} pageSize={pageSize} total={sortedRows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          )}
        </>
      )}
    </>
  );
}
