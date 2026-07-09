"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { isConfigured, supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { MultiSelect } from "@/components/MultiSelect";
import { Pagination } from "@/components/Pagination";
import { inputClass } from "@/components/FormField";
import { AGING_BUCKETS, agingBucket, daysOverdue, type AgingBucket } from "@/lib/aging";
import { exportToCsv, exportToExcel, exportToPdf, type ExportColumn } from "@/lib/exportUtils";
import type { Customer, Invoice, ReceiptAllocation, ReminderLog, ReminderTemplate } from "@/lib/types";

interface OverdueRow {
  id: string;
  invoice_no: string;
  customer_name: string;
  customer_email: string | null;
  location: string;
  outstanding: number;
  days_overdue: number;
  aging: AgingBucket;
}

const DEFAULT_AGING = new Set<string>(AGING_BUCKETS.filter((b) => b !== "Not Due"));
const UNSPECIFIED_LOCATION = "Unspecified";

function fillTemplate(
  template: string,
  vars: { customer: string; amount: string; days_overdue: string; invoice_no: string }
) {
  return template
    .replaceAll("{customer}", vars.customer)
    .replaceAll("{amount}", vars.amount)
    .replaceAll("{days_overdue}", vars.days_overdue)
    .replaceAll("{invoice_no}", vars.invoice_no);
}

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function AutoEmailShootPage() {
  const [loading, setLoading] = useState(true);
  const [baseRows, setBaseRows] = useState<OverdueRow[]>([]);
  const [template, setTemplate] = useState<ReminderTemplate | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sentLog, setSentLog] = useState<ReminderLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<Set<string>>(new Set());
  const [agingFilter, setAgingFilter] = useState<Set<string>>(DEFAULT_AGING);

  // Sort
  const [sortKey, setSortKey] = useState<string>("days_overdue");
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

  // Reset to page 1 whenever the filtered set would change shape.
  useEffect(() => {
    setPage(1);
  }, [search, locationFilter, agingFilter, sortKey, sortDir]);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [invoicesRes, customersRes, allocationsRes, templateRes] = await Promise.all([
      supabase!.from("invoices").select("*").in("status", ["open", "partial"]),
      supabase!.from("customers").select("*"),
      supabase!.from("receipt_allocations").select("*"),
      supabase!.from("reminder_templates").select("*").limit(1).maybeSingle(),
    ]);

    if (invoicesRes.error || customersRes.error || allocationsRes.error || templateRes.error) {
      setError(
        invoicesRes.error?.message ||
          customersRes.error?.message ||
          allocationsRes.error?.message ||
          templateRes.error?.message ||
          "Failed to load data."
      );
      setLoading(false);
      return;
    }

    const invoices = (invoicesRes.data ?? []) as Invoice[];
    const customers = (customersRes.data ?? []) as Customer[];
    const allocations = (allocationsRes.data ?? []) as ReceiptAllocation[];
    const customerById = new Map(customers.map((c) => [c.id, c]));

    const rows: OverdueRow[] = invoices
      .map((inv) => {
        const allocated = allocations
          .filter((a) => a.invoice_id === inv.id)
          .reduce((sum, a) => sum + a.amount, 0);
        const outstanding = inv.total - allocated;
        const days = daysOverdue(inv.due_date);
        const customer = customerById.get(inv.customer_id);
        return {
          id: inv.id,
          invoice_no: inv.invoice_no,
          customer_name: customer?.name ?? "Unknown customer",
          customer_email: customer?.email ?? null,
          location: customer?.address?.trim() || UNSPECIFIED_LOCATION,
          outstanding,
          days_overdue: days,
          aging: agingBucket(days),
        };
      })
      .filter((row) => row.outstanding > 0);

    setBaseRows(rows);
    setTemplate((templateRes.data as ReminderTemplate) ?? null);
    setLoading(false);
  }

  const locationOptions = useMemo(
    () => [...new Set(baseRows.map((r) => r.location))].sort(),
    [baseRows]
  );

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return baseRows.filter((row) => {
      if (term && !row.invoice_no.toLowerCase().includes(term) && !row.customer_name.toLowerCase().includes(term)) {
        return false;
      }
      if (locationFilter.size > 0 && !locationFilter.has(row.location)) return false;
      if (agingFilter.size > 0 && !agingFilter.has(row.aging)) return false;
      return true;
    });
  }, [baseRows, search, locationFilter, agingFilter]);

  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "invoice_no":
          return a.invoice_no.localeCompare(b.invoice_no) * dir;
        case "customer_name":
          return a.customer_name.localeCompare(b.customer_name) * dir;
        case "outstanding":
          return (a.outstanding - b.outstanding) * dir;
        case "days_overdue":
        default:
          return (a.days_overdue - b.days_overdue) * dir;
      }
    });
    return sorted;
  }, [filteredRows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const pagedRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    const filteredIds = filteredRows.map((r) => r.id);
    const allSelected = filteredIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      filteredIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  async function handleSend() {
    if (!supabase || !template || selected.size === 0) return;
    setSending(true);
    setError(null);

    const toSend = baseRows.filter((r) => selected.has(r.id));
    const logRows = toSend.map((row) => {
      const vars = {
        customer: row.customer_name,
        amount: row.outstanding.toLocaleString("en-IN", { maximumFractionDigits: 2 }),
        days_overdue: String(row.days_overdue),
        invoice_no: row.invoice_no,
      };
      return {
        invoice_id: row.id,
        to_email: row.customer_email,
        subject: fillTemplate(template.subject, vars),
        body: fillTemplate(template.body, vars),
        status: "sent",
      };
    });

    const { data, error: insertError } = await supabase.from("reminder_log").insert(logRows).select();

    if (insertError) {
      setError(insertError.message);
      setSending(false);
      return;
    }

    setSentLog((prev) => [...(data as ReminderLog[]), ...prev]);
    setSending(false);
  }

  const exportColumns: ExportColumn<OverdueRow>[] = [
    { header: "Invoice #", value: (r) => r.invoice_no },
    { header: "Customer", value: (r) => r.customer_name },
    { header: "Email", value: (r) => r.customer_email ?? "" },
    { header: "Location", value: (r) => r.location },
    { header: "Outstanding", value: (r) => r.outstanding.toFixed(2) },
    { header: "Days Overdue", value: (r) => r.days_overdue },
    { header: "Aging Bucket", value: (r) => r.aging },
  ];

  function handleExport(kind: "csv" | "excel" | "pdf") {
    setExportOpen(false);
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "csv") exportToCsv(sortedRows, exportColumns, `ar-followup-${stamp}.csv`);
    if (kind === "excel") void exportToExcel(sortedRows, exportColumns, `ar-followup-${stamp}.xlsx`);
    if (kind === "pdf") void exportToPdf(sortedRows, exportColumns, `ar-followup-${stamp}.pdf`, "AR Followup Report");
  }

  const columns: Column<OverdueRow>[] = [
    {
      key: "select",
      header: "",
      render: (row) => (
        <input
          type="checkbox"
          checked={selected.has(row.id)}
          onChange={() => toggleRow(row.id)}
          className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
        />
      ),
      className: "w-10",
    },
    {
      key: "invoice_no",
      header: "Invoice #",
      sortable: true,
      render: (row) => (
        <Link
          href={`/invoices/${row.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand hover:underline"
        >
          {row.invoice_no}
        </Link>
      ),
    },
    { key: "customer_name", header: "Customer", sortable: true },
    { key: "location", header: "Location" },
    { key: "customer_email", header: "Email", render: (row) => row.customer_email ?? "—" },
    {
      key: "outstanding",
      header: "Outstanding",
      sortable: true,
      render: (row) => money(row.outstanding),
    },
    {
      key: "days_overdue",
      header: "Days overdue",
      sortable: true,
      render: (row) => (
        <span className={row.days_overdue > 0 ? "font-medium text-red-600" : "text-slate-500"}>
          {row.days_overdue > 0 ? row.days_overdue : "—"}
        </span>
      ),
    },
    {
      key: "aging",
      header: "Aging",
      render: (row) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            row.aging === "Not Due" ? "bg-slate-100 text-slate-600" : "bg-red-100 text-red-700"
          }`}
        >
          {row.aging}
        </span>
      ),
    },
    {
      key: "history",
      header: "",
      render: (row) => (
        <Link
          href={`/reminders/history/${row.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          History
        </Link>
      ),
    },
  ];

  const sentColumns: Column<ReminderLog>[] = [
    { key: "to_email", header: "To", render: (row) => row.to_email ?? "—" },
    { key: "subject", header: "Subject" },
    {
      key: "sent_at",
      header: "Sent at",
      render: (row) => new Date(row.sent_at).toLocaleString(),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
          {row.status}
        </span>
      ),
    },
  ];

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="AR Followup — Auto Email Shoot" />
        <NotConfigured />
      </>
    );
  }

  const allFilteredSelected = filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.id));

  return (
    <>
      <PageHeader
        title="AR Followup — Auto Email Shoot"
        subtitle="Chase overdue customers, filter by location or aging, and export what you see."
        action={
          <div className="flex items-center gap-2">
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
            <button
              onClick={handleSend}
              disabled={sending || selected.size === 0 || !template}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Sending…" : `Send Reminders (${selected.size})`}
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!template && !loading && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No reminder template found in <code className="rounded bg-amber-100 px-1">reminder_templates</code>.
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Invoice # or customer…"
            className={`${inputClass} w-56`}
          />
        </label>
        <MultiSelect label="Location" options={locationOptions} selected={locationFilter} onChange={setLocationFilter} />
        <MultiSelect label="Aging" options={AGING_BUCKETS} selected={agingFilter} onChange={setAgingFilter} />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading invoices…</p>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Invoices ({sortedRows.length})
            </h3>
            {filteredRows.length > 0 && (
              <button onClick={toggleAllFiltered} className="text-xs font-medium text-brand hover:underline">
                {allFilteredSelected ? "Deselect all filtered" : "Select all filtered"}
              </button>
            )}
          </div>
          <DataTable
            columns={columns}
            rows={pagedRows}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            empty="No invoices match the current filters."
          />
          {sortedRows.length > 0 && (
            <Pagination page={page} pageSize={pageSize} total={sortedRows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          )}
        </>
      )}

      {sentLog.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Just sent ({sentLog.length})
          </h3>
          <DataTable columns={sentColumns} rows={sentLog} />
        </div>
      )}
    </>
  );
}
