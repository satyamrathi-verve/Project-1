"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, Download, SlidersHorizontal, Eye, Pencil, Printer, MoreHorizontal, X, Search } from "lucide-react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { inputClass } from "@/components/FormField";
import { toast } from "@/components/Toast";
import { exportToCsv, exportToExcel, exportToPdf, type ExportColumn } from "@/lib/exportUtils";
import { money, formatDate, isOverdue, statusPill, formatInvoiceNo } from "@/lib/format";

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

// Toggleable columns (select + actions are always shown).
const TOGGLE_COLS = [
  { key: "invoice_no", label: "Invoice #" },
  { key: "invoice_date", label: "Date" },
  { key: "customer", label: "Customer" },
  { key: "due_date", label: "Due" },
  { key: "currency", label: "Currency" },
  { key: "total", label: "Total" },
  { key: "balance_due", label: "Balance Due" },
  { key: "status", label: "Status" },
];

export default function InvoiceListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [received, setReceived] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [amtMin, setAmtMin] = useState("");
  const [amtMax, setAmtMax] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // table state
  const [sortKey, setSortKey] = useState("invoice_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState<Set<string>>(new Set(TOGGLE_COLS.map((c) => c.key)));

  // menus
  const [menu, setMenu] = useState<null | "cols" | "export">(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    (async () => {
      const [inv, alloc] = await Promise.all([
        supabase!.from("invoices").select("id, invoice_no, invoice_date, due_date, total, status, customers(name, code)").order("invoice_date", { ascending: false }),
        supabase!.from("receipt_allocations").select("invoice_id, amount"),
      ]);
      if (inv.error) setError(inv.error.message);
      else setRows((inv.data as unknown as InvoiceRow[]) ?? []);
      const m: Record<string, number> = {};
      ((alloc.data as { invoice_id: string; amount: number }[]) ?? []).forEach((a) => { m[a.invoice_id] = (m[a.invoice_id] ?? 0) + Number(a.amount); });
      setReceived(m);
      setLoading(false);
    })();
  }, []);

  // ---- filter → sort pipeline ----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = amtMin ? parseFloat(amtMin) : null;
    const max = amtMax ? parseFloat(amtMax) : null;
    const out = rows.filter((r) => {
      const eff = isOverdue(r.status, r.due_date);
      if (status !== "all" && !(status === "overdue" ? eff : r.status === status)) return false;
      if (q && !(
        r.customers?.name.toLowerCase().includes(q) ||
        r.customers?.code.toLowerCase().includes(q) ||
        r.invoice_no.toLowerCase().includes(q) ||
        formatInvoiceNo(r.invoice_no, r.invoice_date).toLowerCase().includes(q)
      )) return false;
      if (min !== null && Number(r.total) < min) return false;
      if (max !== null && Number(r.total) > max) return false;
      if (dateFrom && r.invoice_date < dateFrom) return false;
      if (dateTo && r.invoice_date > dateTo) return false;
      return true;
    });
    const val = (r: InvoiceRow) => {
      switch (sortKey) {
        case "customer": return r.customers?.name ?? "";
        case "total": return Number(r.total);
        case "balance_due": return balanceDueOf(r);
        case "status": return isOverdue(r.status, r.due_date) ? "overdue" : r.status;
        case "due_date": return r.due_date ?? "";
        case "invoice_no": return r.invoice_no;
        default: return r.invoice_date;
      }
    };
    out.sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? c : -c;
    });
    return out;
  }, [rows, search, status, amtMin, amtMax, dateFrom, dateTo, sortKey, sortDir]);

  useEffect(() => { setPage(1); }, [search, status, amtMin, amtMax, dateFrom, dateTo, pageSize]);

  const balanceDueOf = (r: InvoiceRow) => Math.max(0, Number(r.total) - (received[r.id] ?? 0));
  const grandTotal = filtered.reduce((s, r) => s + Number(r.total), 0);
  const grandBalance = filtered.reduce((s, r) => s + balanceDueOf(r), 0);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const activeFilters = [amtMin, amtMax, dateFrom, dateTo].filter(Boolean).length + (status !== "all" ? 1 : 0);

  const onSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };
  const clearFilters = () => { setStatus("all"); setAmtMin(""); setAmtMax(""); setDateFrom(""); setDateTo(""); };

  // ---- selection ----
  const pageIds = paged.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected((prev) => {
    const n = new Set(prev);
    if (allOnPage) pageIds.forEach((id) => n.delete(id));
    else pageIds.forEach((id) => n.add(id));
    return n;
  });
  const toggleOne = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ---- export ----
  const exportCols: ExportColumn<InvoiceRow>[] = [
    { header: "Invoice No", value: (r) => formatInvoiceNo(r.invoice_no, r.invoice_date) },
    { header: "Date", value: (r) => formatDate(r.invoice_date) },
    { header: "Customer", value: (r) => r.customers?.name ?? "" },
    { header: "Due Date", value: (r) => formatDate(r.due_date) },
    { header: "Currency", value: () => "INR" },
    { header: "Total", value: (r) => Number(r.total).toFixed(2) },
    { header: "Balance Due", value: (r) => balanceDueOf(r).toFixed(2) },
    { header: "Status", value: (r) => (isOverdue(r.status, r.due_date) ? "overdue" : r.status) },
  ];
  async function doExport(fmt: "csv" | "excel" | "pdf") {
    setMenu(null);
    const data = selected.size > 0 ? filtered.filter((r) => selected.has(r.id)) : filtered;
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      if (fmt === "csv") exportToCsv(data, exportCols, `invoices-${stamp}.csv`);
      else if (fmt === "excel") await exportToExcel(data, exportCols, `invoices-${stamp}.xlsx`);
      else await exportToPdf(data, exportCols, `invoices-${stamp}.pdf`, "Sales Invoices");
      toast(`Exported ${data.length} invoice${data.length === 1 ? "" : "s"} to ${fmt.toUpperCase()}`, { variant: "success" });
    } catch {
      toast("Export failed. Please try again.", { variant: "error" });
    }
  }

  // ---- columns ----
  const cols: Column<InvoiceRow>[] = [];
  cols.push({
    key: "_sel",
    header: "",
    className: "w-10",
    headerContent: (
      <input type="checkbox" aria-label="Select all on page" checked={allOnPage} onChange={toggleAll} className="accent-[color:var(--brand)]" onClick={(e) => e.stopPropagation()} />
    ),
    render: (r) => (
      <input type="checkbox" aria-label={`Select ${r.invoice_no}`} checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} onClick={(e) => e.stopPropagation()} className="accent-[color:var(--brand)]" />
    ),
  });
  if (visible.has("invoice_no")) cols.push({ key: "invoice_no", header: "Invoice #", sortable: true, render: (r) => <span className="font-medium text-brand">{formatInvoiceNo(r.invoice_no, r.invoice_date)}</span> });
  if (visible.has("invoice_date")) cols.push({ key: "invoice_date", header: "Date", sortable: true, render: (r) => formatDate(r.invoice_date) });
  if (visible.has("customer")) cols.push({ key: "customer", header: "Customer", sortable: true, render: (r) => r.customers?.name ?? "—" });
  if (visible.has("due_date")) cols.push({ key: "due_date", header: "Due", sortable: true, render: (r) => formatDate(r.due_date) });
  if (visible.has("currency")) cols.push({ key: "currency", header: "Currency", className: "text-center", render: () => "INR" });
  if (visible.has("total")) cols.push({ key: "total", header: "Total (INR)", sortable: true, className: "text-right tabular-nums", render: (r) => money(r.total) });
  if (visible.has("balance_due")) cols.push({ key: "balance_due", header: "Balance Due", sortable: true, className: "text-right tabular-nums", render: (r) => { const b = balanceDueOf(r); return <span className={b > 0 ? "font-medium text-red-600" : "text-muted"}>{money(b)}</span>; } });
  if (visible.has("status")) cols.push({
    key: "status", header: "Status", sortable: true,
    render: (r) => {
      const od = isOverdue(r.status, r.due_date);
      return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusPill(od ? "overdue" : r.status)}`}>{od && r.status !== "overdue" ? "overdue" : r.status}</span>;
    },
  });
  cols.push({
    key: "_act",
    header: "",
    className: "w-10 text-right",
    render: (r) => (
      <div className="relative inline-block">
        <button
          aria-label="Row actions"
          onClick={(e) => { e.stopPropagation(); setRowMenu(rowMenu === r.id ? null : r.id); }}
          className="rounded p-1 text-muted hover:bg-surface2 hover:text-ink"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {rowMenu === r.id && (
          <>
            <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setRowMenu(null); }} />
            <div className="themed-surface absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-lg border border-line bg-surface py-1 text-sm shadow-lg" onClick={(e) => e.stopPropagation()}>
              <Link href={`/invoices/${r.id}`} className="flex items-center gap-2 px-3 py-1.5 text-ink hover:bg-surface2"><Eye className="h-3.5 w-3.5" /> View</Link>
              <Link href={`/invoices/${r.id}/edit`} className="flex items-center gap-2 px-3 py-1.5 text-ink hover:bg-surface2"><Pencil className="h-3.5 w-3.5" /> Edit</Link>
              <Link href={`/invoices/${r.id}/print`} className="flex items-center gap-2 px-3 py-1.5 text-ink hover:bg-surface2"><Printer className="h-3.5 w-3.5" /> Print</Link>
            </div>
          </>
        )}
      </div>
    ),
  });

  const footer = filtered.length > 0 ? (
    <tr className="border-t-2 border-line bg-surface2 font-semibold text-ink">
      {cols.map((c, i) => {
        if (c.key === "total") return <td key={c.key} className="px-4 py-3 text-right tabular-nums">{money(grandTotal)}</td>;
        if (c.key === "balance_due") return <td key={c.key} className="px-4 py-3 text-right tabular-nums text-red-600">{money(grandBalance)}</td>;
        if (i === 1) return <td key={c.key} className="px-4 py-3 whitespace-nowrap">Grand total · {filtered.length} inv</td>;
        return <td key={c.key} className="px-4 py-3" />;
      })}
    </tr>
  ) : null;

  return (
    <div>
      <PageHeader
        title="Sales Invoices"
        subtitle="Search, sort, filter and export. Overdue rows are flagged red."
        action={
          <Link href="/invoices/new" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark">
            + New Invoice
          </Link>
        }
      />

      {!isConfigured ? (
        <NotConfigured />
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">Could not load invoices: {error}</div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <input className={`${inputClass} w-72 pl-9`} placeholder="Search customer or invoice no…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-1">
              {STATUS_FILTERS.map((s) => (
                <button key={s} onClick={() => setStatus(s)} className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${status === s ? "bg-brand text-brandink" : "bg-surface2 text-muted hover:text-ink"}`}>{s}</button>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setShowFilters((v) => !v)} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${activeFilters ? "border-brand text-brand" : "border-line text-muted hover:text-ink"}`}>
                <SlidersHorizontal className="h-4 w-4" /> Filters{activeFilters ? ` (${activeFilters})` : ""}
              </button>

              {/* Columns menu */}
              <div className="relative">
                <button onClick={() => setMenu(menu === "cols" ? null : "cols")} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-ink">Columns</button>
                {menu === "cols" && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
                    <div className="themed-surface absolute right-0 z-20 mt-1 w-44 rounded-lg border border-line bg-surface p-2 shadow-lg">
                      {TOGGLE_COLS.map((c) => (
                        <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-surface2">
                          <input type="checkbox" checked={visible.has(c.key)} onChange={() => setVisible((prev) => { const n = new Set(prev); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n; })} className="accent-[color:var(--brand)]" />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Export menu */}
              <div className="relative">
                <button onClick={() => setMenu(menu === "export" ? null : "export")} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-ink"><Download className="h-4 w-4" /> Export</button>
                {menu === "export" && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
                    <div className="themed-surface absolute right-0 z-20 mt-1 w-52 rounded-lg border border-line bg-surface py-1 text-sm shadow-lg">
                      <p className="px-3 py-1.5 text-xs text-faint">{selected.size > 0 ? `${selected.size} selected` : `All ${filtered.length} rows`}</p>
                      <button onClick={() => doExport("csv")} className="block w-full px-3 py-1.5 text-left text-ink hover:bg-surface2">Export CSV</button>
                      <button onClick={() => doExport("excel")} className="block w-full px-3 py-1.5 text-left text-ink hover:bg-surface2">Export Excel</button>
                      <button onClick={() => doExport("pdf")} className="block w-full px-3 py-1.5 text-left text-ink hover:bg-surface2">Export PDF</button>
                      <button onClick={() => { setMenu(null); window.print(); }} className="block w-full px-3 py-1.5 text-left text-ink hover:bg-surface2">Print</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Advanced filters */}
          {showFilters && (
            <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
              <label className="text-xs text-muted">Amount from<input type="number" className={`${inputClass} mt-1 block w-32`} value={amtMin} onChange={(e) => setAmtMin(e.target.value)} placeholder="0" /></label>
              <label className="text-xs text-muted">Amount to<input type="number" className={`${inputClass} mt-1 block w-32`} value={amtMax} onChange={(e) => setAmtMax(e.target.value)} placeholder="Any" /></label>
              <label className="text-xs text-muted">Date from<input type="date" className={`${inputClass} mt-1 block`} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
              <label className="text-xs text-muted">Date to<input type="date" className={`${inputClass} mt-1 block`} value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
              {activeFilters > 0 && <button onClick={clearFilters} className="flex items-center gap-1 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink"><X className="h-3.5 w-3.5" /> Clear</button>}
            </div>
          )}

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 px-4 py-2.5 text-sm">
              <span className="font-medium text-ink">{selected.size} selected</span>
              <button onClick={() => setMenu("export")} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brandink hover:bg-brand-dark">Export selected</button>
              <button onClick={() => setSelected(new Set())} className="ml-auto text-muted hover:text-ink">Clear</button>
            </div>
          )}

          {/* Count */}
          {!loading && <p className="mb-2 text-sm text-muted">{filtered.length} invoice{filtered.length === 1 ? "" : "s"}{filtered.length !== rows.length ? ` of ${rows.length}` : ""}</p>}

          <DataTable
            columns={cols}
            rows={paged}
            loading={loading}
            caption="Sales invoices"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            footer={footer}
            empty={<EmptyState icon={FileText} title="No invoices found" description={rows.length ? "Try clearing filters or a different search." : "Create your first invoice to get started."} action={!rows.length ? <Link href="/invoices/new" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark">+ New Invoice</Link> : undefined} />}
            onRowClick={(r) => router.push(`/invoices/${r.id}`)}
            rowClassName={(r) => (isOverdue(r.status, r.due_date) ? "bg-red-500/10 hover:bg-red-500/20" : "")}
          />

          {filtered.length > pageSize && (
            <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          )}
        </>
      )}
    </div>
  );
}
