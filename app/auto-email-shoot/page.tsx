"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { isConfigured, supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { Modal } from "@/components/Modal";
import { MultiSelect } from "@/components/MultiSelect";
import { Pagination } from "@/components/Pagination";
import { inputClass } from "@/components/FormField";
import { AGING_BUCKETS, agingBucket, daysOverdue, type AgingBucket } from "@/lib/aging";
import { exportToCsv, exportToExcel, exportToPdf, type ExportColumn } from "@/lib/exportUtils";
import { buildEmailHtml, buildInvoiceTableHtml, decomposeBody, fillPlaceholders, type FillVars, type InvoiceLineItem } from "@/lib/emailTemplate";
import { getBranding, getSignedInUser } from "@/lib/companyBranding";
import type { Customer, Invoice, ReceiptAllocation, ReminderLog, ReminderTemplate } from "@/lib/types";
import { Clock3, Download, FileSpreadsheet, FileText, Mail, MoreVertical, Table2 } from "lucide-react";
import { toast } from "@/components/Toast";

interface CustomerEmailGroup {
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  invoiceIds: string[];
  invoiceCount: number;
  subject: string;
  bodyHtml: string;
}

interface OverdueRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
  location: string;
  outstanding: number;
  days_overdue: number;
  aging: AgingBucket;
}

const DEFAULT_AGING = new Set<string>(AGING_BUCKETS.filter((b) => b !== "Not Due"));
const UNSPECIFIED_LOCATION = "Unspecified";

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function AutoEmailShootPage() {
  const [loading, setLoading] = useState(true);
  const [baseRows, setBaseRows] = useState<OverdueRow[]>([]);
  const [template, setTemplate] = useState<ReminderTemplate | null>(null);
  const [company, setCompany] = useState({ name: "Verve Advisory", email: "", phone: "", address: "" });
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

  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [exportSubmenuOpen, setExportSubmenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState(0);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    void loadData();
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
        setExportSubmenuOpen(false);
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMoreMenuOpen(false);
        setExportSubmenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  // Collapse the export submenu whenever the parent menu closes, so it doesn't stay expanded next time it opens.
  useEffect(() => {
    if (!moreMenuOpen) setExportSubmenuOpen(false);
  }, [moreMenuOpen]);

  // Reset to page 1 whenever the filtered set would change shape.
  useEffect(() => {
    setPage(1);
  }, [search, locationFilter, agingFilter, sortKey, sortDir]);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [invoicesRes, customersRes, allocationsRes, templateRes, companyRes] = await Promise.all([
      supabase!.from("invoices").select("*").neq("status", "paid"),
      supabase!.from("customers").select("*"),
      supabase!.from("receipt_allocations").select("*"),
      // Multiple templates can exist (Save As New); this is always the one Auto Email Shoot uses.
      supabase!.from("reminder_templates").select("*").eq("name", "Default reminder").maybeSingle(),
      supabase!.from("company").select("name, email, phone, address").limit(1).maybeSingle(),
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
          invoice_date: inv.invoice_date,
          due_date: inv.due_date,
          customer_id: inv.customer_id,
          customer_name: customer?.name ?? "Unknown customer",
          customer_email: customer?.email ?? null,
          location: customer?.address?.trim() || UNSPECIFIED_LOCATION,
          outstanding,
          days_overdue: days,
          aging: agingBucket(days),
        };
      })
      .filter((row) => row.outstanding > 0.005);

    setBaseRows(rows);
    setTemplate((templateRes.data as ReminderTemplate) ?? null);
    if (companyRes.data) setCompany(companyRes.data as { name: string; email: string; phone: string; address: string });
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

  const allFilteredSelected = filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.id));
  const someFilteredSelected = filteredRows.some((r) => selected.has(r.id)) && !allFilteredSelected;
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someFilteredSelected;
  }, [someFilteredSelected]);

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

  // Sum across every filtered row, not just the current page, so pagination never changes the total.
  const totalOutstanding = useMemo(
    () => sortedRows.reduce((sum, row) => sum + row.outstanding, 0),
    [sortedRows]
  );

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

  /**
   * One group per customer, covering every selected invoice of theirs. Used identically by
   * the real send and the Preview modal, so the preview is guaranteed to match what's sent —
   * not just a separately-maintained lookalike.
   */
  function buildCustomerEmailGroups(rows: OverdueRow[]): CustomerEmailGroup[] {
    if (!template) return [];
    const sections = decomposeBody(template.body);
    const branding = getBranding();
    const arExecutive = getSignedInUser() || "—";
    const now = new Date();

    const byCustomer = new Map<string, OverdueRow[]>();
    rows.forEach((row) => {
      const list = byCustomer.get(row.customer_id) ?? [];
      list.push(row);
      byCustomer.set(row.customer_id, list);
    });

    return [...byCustomer.values()].map((groupRows) => {
      const first = groupRows[0];
      const totalReceivables = groupRows.reduce((sum, r) => sum + r.outstanding, 0);
      const totalFormatted = money(totalReceivables);
      const items: InvoiceLineItem[] = groupRows.map((r) => ({
        invoiceNumber: r.invoice_no,
        invoiceDate: new Date(r.invoice_date).toLocaleDateString(),
        dueDate: new Date(r.due_date).toLocaleDateString(),
        daysOverdue: String(r.days_overdue),
        outstandingAmount: money(r.outstanding),
      }));

      const vars: FillVars = {
        CustomerName: first.customer_name,
        CompanyName: company.name,
        CompanyAddress: company.address,
        CompanyWebsite: branding.website,
        InvoiceNumber: first.invoice_no,
        InvoiceDate: new Date(first.invoice_date).toLocaleDateString(),
        DueDate: new Date(first.due_date).toLocaleDateString(),
        OutstandingAmount: money(first.outstanding),
        DaysOverdue: String(first.days_overdue),
        Location: first.location,
        CurrentDate: now.toLocaleDateString(),
        CurrentTime: now.toLocaleTimeString(),
        ARExecutive: arExecutive,
        CompanyEmail: company.email,
        CompanyPhone: company.phone,
        PaymentLink: branding.paymentLink,
        BankName: branding.bankName,
        BankAccountName: branding.bankAccountName,
        BankAccountNumber: branding.bankAccountNumber,
        IFSCOrSWIFT: branding.ifscOrSwift,
        UPIId: branding.upiId,
        TotalReceivables: totalFormatted,
      };

      return {
        customerId: first.customer_id,
        customerName: first.customer_name,
        customerEmail: first.customer_email,
        invoiceIds: groupRows.map((r) => r.id),
        invoiceCount: groupRows.length,
        subject: fillPlaceholders(template.subject, vars),
        bodyHtml: buildEmailHtml(sections, vars, {
          invoiceTableHtml: buildInvoiceTableHtml(items, totalFormatted),
          logoUrl: branding.logoUrl || undefined,
        }),
      };
    });
  }

  const previewGroups = useMemo(() => {
    if (!previewOpen) return [];
    return buildCustomerEmailGroups(baseRows.filter((r) => selected.has(r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen, selected, baseRows, template, company]);

  const activePreviewGroup = previewGroups[Math.min(previewTab, Math.max(previewGroups.length - 1, 0))];
  const previewHasErrors = previewGroups.some((g) => !g.customerEmail || !g.subject.trim() || !g.bodyHtml.trim());

  async function handleSend() {
    if (!supabase || !template || selected.size === 0) return;
    setSending(true);

    const groups = buildCustomerEmailGroups(baseRows.filter((r) => selected.has(r.id)));
    const logRows = groups.flatMap((g) =>
      g.invoiceIds.map((invoiceId) => ({
        invoice_id: invoiceId,
        to_email: g.customerEmail,
        subject: g.subject,
        body: g.bodyHtml,
        status: "sent",
      }))
    );

    const { data, error: insertError } = await supabase.from("reminder_log").insert(logRows).select();

    if (insertError) {
      toast(insertError.message, { variant: "error" });
      setSending(false);
      return;
    }

    setSentLog((prev) => [...(data as ReminderLog[]), ...prev]);
    toast(
      `${logRows.length} reminder${logRows.length === 1 ? "" : "s"} sent across ${groups.length} customer${groups.length === 1 ? "" : "s"}.`,
      { variant: "success" }
    );
    setSending(false);
    setPreviewOpen(false);
  }

  const exportColumns: ExportColumn<OverdueRow>[] = [
    { header: "Invoice #", value: (r) => r.invoice_no },
    { header: "Customer Name", value: (r) => r.customer_name },
    { header: "Email", value: (r) => r.customer_email ?? "" },
    { header: "Location", value: (r) => r.location },
    { header: "Receivables", value: (r) => r.outstanding.toFixed(2) },
    { header: "Days Overdue", value: (r) => r.days_overdue },
    { header: "Ageing Bucket", value: (r) => r.aging },
  ];

  function handleExport(kind: "csv" | "excel" | "pdf") {
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "csv") exportToCsv(sortedRows, exportColumns, `auto-email-shoot-${stamp}.csv`);
    if (kind === "excel") void exportToExcel(sortedRows, exportColumns, `auto-email-shoot-${stamp}.xlsx`);
    if (kind === "pdf") void exportToPdf(sortedRows, exportColumns, `auto-email-shoot-${stamp}.pdf`, "Auto Email Shoot Report");
  }

  const columns: Column<OverdueRow>[] = [
    {
      key: "select",
      header: "",
      headerContent: (
        <input
          ref={headerCheckboxRef}
          type="checkbox"
          checked={allFilteredSelected}
          onChange={toggleAllFiltered}
          aria-label={allFilteredSelected ? "Deselect all filtered invoices" : "Select all filtered invoices"}
          className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
        />
      ),
      render: (row) => (
        <input
          type="checkbox"
          checked={selected.has(row.id)}
          onChange={() => toggleRow(row.id)}
          aria-label={`${selected.has(row.id) ? "Deselect" : "Select"} invoice ${row.invoice_no} (${row.customer_name})`}
          className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
        />
      ),
      className: "w-10 text-center align-middle",
    },
    {
      key: "invoice_no",
      header: "Invoice #",
      sortable: true,
      className: "text-left align-middle whitespace-nowrap",
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
    { key: "customer_name", header: "Customer Name", sortable: true, className: "text-left align-middle" },
    { key: "location", header: "Location", className: "text-left align-middle whitespace-nowrap" },
    {
      key: "customer_email",
      header: "Email",
      className: "text-left align-middle",
      render: (row) => row.customer_email ?? "—",
    },
    {
      key: "outstanding",
      header: "Receivables",
      sortable: true,
      className: "text-right align-middle whitespace-nowrap",
      render: (row) => money(row.outstanding),
    },
    {
      key: "days_overdue",
      header: "Days Overdue",
      sortable: true,
      className: "text-right align-middle whitespace-nowrap",
      render: (row) => (
        <span className={row.days_overdue > 0 ? "font-medium text-red-600" : "text-muted"}>
          {row.days_overdue > 0 ? row.days_overdue : "—"}
        </span>
      ),
    },
    {
      key: "aging",
      header: "Ageing",
      className: "text-left align-middle whitespace-nowrap",
      render: (row) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            row.aging === "Not Due" ? "bg-surface2 text-muted" : "bg-red-100 text-red-700"
          }`}
        >
          {row.aging}
        </span>
      ),
    },
    {
      key: "history",
      header: "",
      className: "text-center align-middle whitespace-nowrap",
      render: (row) => (
        <Link
          href={`/auto-email-shoot/history/${row.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface2"
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
        <PageHeader title="Auto Email Shoot" />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Auto Email Shoot"
        subtitle="Chase overdue customers, filter by location or ageing, and export what you see."
        action={
          <div className="flex items-center gap-2">
            <div ref={moreMenuRef} className="relative">
              <button
                onClick={() => setMoreMenuOpen((v) => !v)}
                title="More options"
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
                className="rounded-lg border border-line bg-surface p-2.5 text-ink transition-colors hover:bg-surface2"
              >
                <MoreVertical className="h-4 w-4" />
              </button>

              <div
                role="menu"
                aria-hidden={!moreMenuOpen}
                className={`absolute right-0 z-10 mt-1 w-64 origin-top-right rounded-lg border border-line bg-surface p-1 shadow-lg transition duration-150 ease-out ${
                  moreMenuOpen ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
                }`}
              >
                <button
                  role="menuitem"
                  onClick={() => setExportSubmenuOpen((v) => !v)}
                  disabled={sortedRows.length === 0}
                  aria-expanded={exportSubmenuOpen}
                  className="flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-sm text-ink hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <Download className="h-4 w-4 text-faint" />
                    Export
                  </span>
                  <span className="text-xs text-faint">{exportSubmenuOpen ? "▾" : "▸"}</span>
                </button>
                {exportSubmenuOpen && (
                  <div className="ml-4 border-l border-line pl-2">
                    <button
                      role="menuitem"
                      onClick={() => {
                        handleExport("excel");
                        setMoreMenuOpen(false);
                        setExportSubmenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink hover:bg-surface2"
                    >
                      <FileSpreadsheet className="h-4 w-4 text-faint" />
                      Export to Excel (.xlsx)
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        handleExport("csv");
                        setMoreMenuOpen(false);
                        setExportSubmenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink hover:bg-surface2"
                    >
                      <Table2 className="h-4 w-4 text-faint" />
                      Export to CSV (.csv)
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        handleExport("pdf");
                        setMoreMenuOpen(false);
                        setExportSubmenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink hover:bg-surface2"
                    >
                      <FileText className="h-4 w-4 text-faint" />
                      Export to PDF (.pdf)
                    </button>
                  </div>
                )}

                <Link
                  role="menuitem"
                  href="/auto-email-shoot/template"
                  onClick={() => setMoreMenuOpen(false)}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink hover:bg-surface2"
                >
                  <Mail className="h-4 w-4 text-faint" />
                  Customize Email Template
                </Link>
                <Link
                  role="menuitem"
                  href="/auto-email-shoot/scheduler"
                  onClick={() => setMoreMenuOpen(false)}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink hover:bg-surface2"
                >
                  <Clock3 className="h-4 w-4 text-faint" />
                  Automatic Reminder Settings
                </Link>
              </div>
            </div>
            <button
              onClick={() => {
                setPreviewTab(0);
                setPreviewOpen(true);
              }}
              disabled={selected.size === 0 || !template}
              title={selected.size === 0 ? "Select at least one invoice to review and send reminders." : undefined}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brandink transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              Review &amp; Send{selected.size > 0 ? ` (${selected.size})` : ""}
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
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Invoice # or customer…"
            className={`${inputClass} w-56`}
          />
        </label>
        <MultiSelect label="Location" options={locationOptions} selected={locationFilter} onChange={setLocationFilter} />
        <MultiSelect label="Ageing" options={AGING_BUCKETS} selected={agingFilter} onChange={setAgingFilter} />
      </div>

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          {loading ? "Loading invoices…" : `Invoices (${sortedRows.length})`}
        </h3>
        {!loading && selected.size > 0 && (
          <span className="text-xs font-medium text-muted">
            {selected.size} Invoices Selected ·{" "}
            <button onClick={() => setSelected(new Set())} className="font-semibold text-brand hover:underline">
              Clear selection
            </button>
          </span>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={pagedRows}
        loading={loading}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        empty="No invoices match the current filters."
        footer={
          !loading ? (
            <tr className="border-t-2 border-line bg-surface2 font-semibold text-ink">
              <td colSpan={5} className="px-4 py-3 text-right align-middle whitespace-nowrap">
                Total Receivables
              </td>
              <td className="px-4 py-3 text-right align-middle whitespace-nowrap">{money(totalOutstanding)}</td>
              <td colSpan={3} className="px-4 py-3" />
            </tr>
          ) : undefined
        }
      />
      {!loading && sortedRows.length > 0 && (
        <Pagination page={page} pageSize={pageSize} total={sortedRows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      {sentLog.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Just sent ({sentLog.length})
          </h3>
          <DataTable columns={sentColumns} rows={sentLog} />
        </div>
      )}

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        titleId="email-preview-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id="email-preview-title" className="text-lg font-semibold text-ink">
            Email Preview
          </h2>
          <button
            onClick={() => setPreviewOpen(false)}
            aria-label="Close preview"
            className="text-faint hover:text-muted"
          >
            ✕
          </button>
        </div>

        {previewGroups.length > 1 && (
          <div className="flex flex-wrap gap-2 border-b border-line px-6 py-3">
            {previewGroups.map((g, i) => (
              <button
                key={g.customerId}
                onClick={() => setPreviewTab(i)}
                aria-current={i === previewTab ? "true" : undefined}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  i === previewTab ? "bg-brand text-brandink" : "bg-surface2 text-muted hover:bg-surface2"
                }`}
              >
                {g.customerName} ({g.invoiceCount}){!g.customerEmail && " ⚠"}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {activePreviewGroup ? (
            <>
              {!activePreviewGroup.customerEmail && (
                <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                  No email on file for {activePreviewGroup.customerName} — this reminder can&apos;t be sent until a customer email is added.
                </div>
              )}
              <p className="mb-2 text-sm">
                <span className="font-medium text-muted">To: </span>
                <span className="text-ink">{activePreviewGroup.customerEmail ?? "—"}</span>
              </p>
              <p className="mb-3 text-sm">
                <span className="font-medium text-muted">Subject: </span>
                <span className="text-ink">{activePreviewGroup.subject || "(empty subject)"}</span>
              </p>
              <div
                className="rounded-lg border border-line bg-surface2 p-4"
                dangerouslySetInnerHTML={{ __html: activePreviewGroup.bodyHtml }}
              />
            </>
          ) : (
            <p className="text-sm text-muted">Nothing selected to preview.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-4">
          <Link
            href="/auto-email-shoot/template"
            className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface2"
          >
            Edit Template
          </Link>
          <button
            onClick={() => setPreviewOpen(false)}
            className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface2"
          >
            Close Preview
          </button>
          <button
            onClick={handleSend}
            disabled={sending || previewHasErrors}
            title={previewHasErrors ? "Fix the issues above before sending" : undefined}
            className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brandink hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send Email"}
          </button>
        </div>
      </Modal>
    </>
  );
}
