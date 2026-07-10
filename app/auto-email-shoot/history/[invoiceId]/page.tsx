"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { isConfigured, supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { MultiSelect } from "@/components/MultiSelect";
import { inputClass } from "@/components/FormField";
import { exportToCsv, exportToExcel, exportToPdf, type ExportColumn } from "@/lib/exportUtils";
import type { Customer, Invoice, ReceiptAllocation, ReminderLog } from "@/lib/types";

interface HistoryRow {
  id: string;
  sent_at: string;
  recipient: string;
  status: string;
  sent_by: string;
}

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function statusStyle(status: string) {
  const s = status.toLowerCase();
  if (s === "failed") return "bg-red-100 text-red-700";
  if (s === "pending") return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700";
}

function reminderCountLabel(count: number) {
  return count === 1 ? "1 Time" : `${count} Times`;
}

export default function InvoiceReminderHistoryPage() {
  const params = useParams<{ invoiceId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [outstanding, setOutstanding] = useState(0);
  const [rows, setRows] = useState<HistoryRow[]>([]);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isConfigured || !supabase || !params.invoiceId) {
      setLoading(false);
      return;
    }
    void loadData(params.invoiceId);
  }, [params.invoiceId]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setExportOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  async function loadData(invoiceId: string) {
    setLoading(true);
    setError(null);
    setNotFound(false);

    const { data: invoiceData, error: invoiceError } = await supabase!
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceError) {
      setError(invoiceError.message);
      setLoading(false);
      return;
    }
    if (!invoiceData) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const inv = invoiceData as Invoice;

    const [customerRes, allocationsRes, logsRes] = await Promise.all([
      supabase!.from("customers").select("*").eq("id", inv.customer_id).maybeSingle(),
      supabase!.from("receipt_allocations").select("*").eq("invoice_id", inv.id),
      supabase!.from("reminder_log").select("*").eq("invoice_id", inv.id),
    ]);

    if (customerRes.error || allocationsRes.error || logsRes.error) {
      setError(customerRes.error?.message || allocationsRes.error?.message || logsRes.error?.message || "Failed to load reminder history.");
      setLoading(false);
      return;
    }

    const allocated = ((allocationsRes.data ?? []) as ReceiptAllocation[]).reduce((sum, a) => sum + a.amount, 0);
    const logs = (logsRes.data ?? []) as ReminderLog[];

    setInvoice(inv);
    setCustomer((customerRes.data as Customer) ?? null);
    setOutstanding(inv.total - allocated);
    setRows(
      logs.map((log) => ({
        id: log.id,
        sent_at: log.sent_at,
        recipient: log.to_email ?? "—",
        status: log.status ?? "sent",
        sent_by: "—",
      }))
    );
    setLoading(false);
  }

  const statusOptions = useMemo(() => [...new Set(rows.map((r) => r.status))].sort(), [rows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo) : null;
    if (to) to.setHours(23, 59, 59, 999);
    const invoiceNo = invoice?.invoice_no.toLowerCase() ?? "";
    const customerName = customer?.name.toLowerCase() ?? "";

    return rows
      .filter((row) => {
        if (term) {
          const haystack = `${customerName} ${invoiceNo} ${row.recipient}`.toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        if (statusFilter.size > 0 && !statusFilter.has(row.status)) return false;
        const sentAt = new Date(row.sent_at);
        if (from && sentAt < from) return false;
        if (to && sentAt > to) return false;
        return true;
      })
      .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
  }, [rows, search, statusFilter, dateFrom, dateTo, invoice, customer]);

  const exportColumns: ExportColumn<HistoryRow>[] = [
    { header: "Sent Date", value: (r) => new Date(r.sent_at).toLocaleDateString() },
    { header: "Sent Time", value: (r) => new Date(r.sent_at).toLocaleTimeString() },
    { header: "Customer Name", value: () => customer?.name ?? "" },
    { header: "Invoice #", value: () => invoice?.invoice_no ?? "" },
    { header: "Invoice Date", value: () => (invoice?.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString() : "") },
    { header: "Due Date", value: () => (invoice?.due_date ? new Date(invoice.due_date).toLocaleDateString() : "") },
    { header: "Receivables", value: () => outstanding.toFixed(2) },
    { header: "Recipient Email", value: (r) => r.recipient },
    { header: "Status", value: (r) => r.status },
    { header: "Sent By", value: (r) => r.sent_by },
  ];

  function handleExport(kind: "csv" | "excel" | "pdf") {
    setExportOpen(false);
    const stamp = new Date().toISOString().slice(0, 10);
    const name = invoice?.invoice_no ?? "invoice";
    if (kind === "csv") exportToCsv(filteredRows, exportColumns, `reminder-history-${name}-${stamp}.csv`);
    if (kind === "excel") void exportToExcel(filteredRows, exportColumns, `reminder-history-${name}-${stamp}.xlsx`);
    if (kind === "pdf") void exportToPdf(filteredRows, exportColumns, `reminder-history-${name}-${stamp}.pdf`, `Email Reminder History — ${name}`);
  }

  const columns: Column<HistoryRow>[] = [
    {
      key: "sent_at",
      header: "Sent",
      render: (row) => (
        <span>
          {new Date(row.sent_at).toLocaleDateString()}{" "}
          <span className="text-faint">{new Date(row.sent_at).toLocaleTimeString()}</span>
        </span>
      ),
    },
    { key: "customer_name", header: "Customer Name", render: () => customer?.name ?? "—" },
    { key: "invoice_no", header: "Invoice #", render: () => invoice?.invoice_no ?? "—" },
    {
      key: "invoice_date",
      header: "Invoice Date",
      render: () => (invoice?.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString() : "—"),
    },
    {
      key: "due_date",
      header: "Due Date",
      render: () => (invoice?.due_date ? new Date(invoice.due_date).toLocaleDateString() : "—"),
    },
    { key: "outstanding", header: "Receivables", render: () => money(outstanding) },
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
  ];

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Email Reminder History" />
        <NotConfigured />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Email Reminder History" />
        <p className="text-sm text-muted">Loading reminder history…</p>
      </>
    );
  }

  if (notFound || error) {
    return (
      <>
        <PageHeader title="Email Reminder History" />
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? "This invoice could not be found."}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Email Reminder History — ${invoice?.invoice_no}`}
        subtitle={`${customer?.name ?? "Unknown customer"} · Reminder Count: ${reminderCountLabel(rows.length)}`}
        action={
          <div ref={exportRef} className="relative">
            <button
              onClick={() => setExportOpen((v) => !v)}
              disabled={filteredRows.length === 0}
              aria-label="Export"
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Export ▾
            </button>
            {exportOpen && (
              <div className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-line bg-surface p-1 shadow-lg">
                <button onClick={() => handleExport("excel")} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-surface2">
                  Excel (.xlsx)
                </button>
                <button onClick={() => handleExport("csv")} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-surface2">
                  CSV (.csv)
                </button>
                <button onClick={() => handleExport("pdf")} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-surface2">
                  PDF (.pdf)
                </button>
              </div>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Invoice #, customer, or email…"
            className={`${inputClass} w-56`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">From</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">To</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
        </label>
        <MultiSelect label="Status" options={statusOptions} selected={statusFilter} onChange={setStatusFilter} />
      </div>

      <DataTable
        columns={columns}
        rows={filteredRows}
        empty={rows.length === 0 ? "No Reminder History Found" : "No reminders match the current filters."}
      />
    </>
  );
}
