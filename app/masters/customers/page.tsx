"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Download, Pencil, Trash2, Users, Plus } from "lucide-react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { SlideOver } from "@/components/SlideOver";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { toast } from "@/components/Toast";
import { money } from "@/lib/format";
import { exportToCsv } from "@/lib/exportUtils";
import { pushRecent } from "@/lib/recent";
import type { Customer } from "@/lib/types";

const EMPTY_FORM = {
  code: "",
  name: "",
  contact_person: "",
  email: "",
  phone: "",
  credit_days: "30",
  credit_limit: "0",
};

type FormState = typeof EMPTY_FORM;
type SortKey = "code" | "name" | "credit_days" | "credit_limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CustomerMasterPage() {
  return (
    <Suspense fallback={null}>
      <CustomerMasterContent />
    </Suspense>
  );
}

function CustomerMasterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadCustomers() {
    if (!supabase) return;
    setLoading(true);
    const { data } = await supabase.from("customers").select("*").order("name");
    setCustomers((data as Customer[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-linked from the command palette: ?new=1 opens the add form, ?edit=<id>
  // opens that customer once the list has loaded.
  useEffect(() => {
    if (loading) return;
    if (searchParams.get("new") === "1") {
      openAddForm();
      router.replace("/masters/customers");
    } else {
      const editId = searchParams.get("edit");
      if (editId) {
        const match = customers.find((c) => c.id === editId);
        if (match) openEditForm(match);
        router.replace("/masters/customers");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function openAddForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setShowForm(true);
  }

  function openEditForm(c: Customer) {
    setEditingId(c.id);
    setForm({
      code: c.code,
      name: c.name,
      contact_person: c.contact_person ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      credit_days: String(c.credit_days ?? 0),
      credit_limit: String(c.credit_limit ?? 0),
    });
    setFieldErrors({});
    setShowForm(true);
    pushRecent({ kind: "customer", id: c.id, code: c.code, label: c.name });
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof FormState, string>> = {};
    if (!form.code.trim()) errors.code = "Code is required.";
    if (!form.name.trim()) errors.name = "Name is required.";
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) errors.email = "Enter a valid email address.";
    if (Number(form.credit_days) < 0) errors.credit_days = "Can't be negative.";
    if (Number(form.credit_limit) < 0) errors.credit_limit = "Can't be negative.";
    const dupe = customers.find(
      (c) => c.code.toLowerCase() === form.code.trim().toLowerCase() && c.id !== editingId
    );
    if (dupe) errors.code = `Code already used by ${dupe.name}.`;
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (!validate()) return;
    setSaving(true);

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      contact_person: form.contact_person.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      credit_days: Number(form.credit_days) || 0,
      credit_limit: Number(form.credit_limit) || 0,
    };

    const { error: dbError } = editingId
      ? await supabase.from("customers").update(payload).eq("id", editingId)
      : await supabase.from("customers").insert(payload);

    setSaving(false);
    if (dbError) {
      toast(dbError.message, { variant: "error" });
      return;
    }
    toast(editingId ? `Saved changes to ${payload.name}.` : `Added ${payload.name}.`, { variant: "success" });
    setShowForm(false);
    await loadCustomers();
  }

  async function handleDelete() {
    if (!supabase || !deleteTarget) return;
    setDeleting(true);
    const { error: dbError } = await supabase.from("customers").delete().eq("id", deleteTarget.id);
    setDeleting(false);
    if (dbError) {
      const friendly = dbError.code === "23503"
        ? `Can't delete ${deleteTarget.name} — they still have invoices or receipts on file.`
        : dbError.message;
      toast(friendly, { variant: "error" });
      return;
    }
    toast(`Deleted ${deleteTarget.name}.`, { variant: "success" });
    setDeleteTarget(null);
    await loadCustomers();
  }

  function handleExport() {
    exportToCsv(
      filteredSorted,
      [
        { header: "Code", value: (c: Customer) => c.code },
        { header: "Name", value: (c: Customer) => c.name },
        { header: "Contact", value: (c: Customer) => c.contact_person ?? "" },
        { header: "Email", value: (c: Customer) => c.email ?? "" },
        { header: "Phone", value: (c: Customer) => c.phone ?? "" },
        { header: "Credit Days", value: (c: Customer) => c.credit_days },
        { header: "Credit Limit", value: (c: Customer) => c.credit_limit },
      ],
      "customers.csv"
    );
    toast("Exported customers.csv", { variant: "success" });
  }

  function toggleSort(key: string) {
    if (key !== sortKey) {
      setSortKey(key as SortKey);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? customers.filter((c) =>
          [c.code, c.name, c.contact_person, c.email, c.phone].some((f) => f?.toLowerCase().includes(q))
        )
      : customers;
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [customers, search, sortKey, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  const paged = filteredSorted.slice((page - 1) * pageSize, page * pageSize);

  const columns: Column<Customer>[] = [
    { key: "code", header: "Code", sortable: true },
    { key: "name", header: "Name", sortable: true },
    { key: "contact_person", header: "Contact", render: (c) => c.contact_person || "—" },
    { key: "email", header: "Email", render: (c) => c.email || "—" },
    { key: "credit_days", header: "Credit Days", sortable: true, render: (c) => `${c.credit_days} days` },
    {
      key: "credit_limit",
      header: "Credit Limit",
      sortable: true,
      className: "text-right",
      render: (c) => money(c.credit_limit),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (c) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEditForm(c);
            }}
            aria-label={`Edit ${c.name}`}
            className="rounded-lg p-1.5 text-faint hover:bg-surface2 hover:text-ink"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(c);
            }}
            aria-label={`Delete ${c.name}`}
            className="rounded-lg p-1.5 text-faint hover:bg-red-500/10 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Customer Master" subtitle="The reference list of customers every other screen leans on." />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Customer Master"
        subtitle="The reference list of customers every other screen leans on."
        action={
          <button
            onClick={openAddForm}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark"
          >
            <Plus className="h-4 w-4" />
            Add Customer
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code, name, contact, email…"
            aria-label="Search customers"
            className={`${inputClass} w-full pl-9`}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-faint">
            {filteredSorted.length} customer{filteredSorted.length === 1 ? "" : "s"}
          </span>
          <button
            onClick={handleExport}
            disabled={filteredSorted.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={paged}
        loading={loading}
        onRowClick={openEditForm}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={toggleSort}
        caption="Customer master list"
        empty={
          search ? (
            <EmptyState icon={Search} title="No matches" description={`No customers match "${search}".`} />
          ) : (
            <EmptyState
              icon={Users}
              title="No customers yet"
              description="Add your first customer to get started."
              action={
                <button
                  onClick={openAddForm}
                  className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brandink hover:bg-brand-dark"
                >
                  + Add Customer
                </button>
              }
            />
          )
        }
      />

      {!loading && filteredSorted.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={filteredSorted.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

      <SlideOver
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? "Edit Customer" : "Add Customer"}
        subtitle={editingId ? form.name : "Add a customer to the master list."}
      >
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <FormField label="Code *">
            <input
              className={inputClass}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              aria-invalid={Boolean(fieldErrors.code)}
              autoFocus
            />
            {fieldErrors.code && <p className="mt-1 text-xs text-red-600">{fieldErrors.code}</p>}
          </FormField>
          <FormField label="Name *">
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              aria-invalid={Boolean(fieldErrors.name)}
            />
            {fieldErrors.name && <p className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>}
          </FormField>
          <FormField label="Contact Person">
            <input
              className={inputClass}
              value={form.contact_person}
              onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
            />
          </FormField>
          <FormField label="Email">
            <input
              type="email"
              className={inputClass}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              aria-invalid={Boolean(fieldErrors.email)}
            />
            {fieldErrors.email && <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>}
          </FormField>
          <FormField label="Phone">
            <input
              className={inputClass}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Credit Days">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={form.credit_days}
                onChange={(e) => setForm({ ...form, credit_days: e.target.value })}
                aria-invalid={Boolean(fieldErrors.credit_days)}
              />
              {fieldErrors.credit_days && <p className="mt-1 text-xs text-red-600">{fieldErrors.credit_days}</p>}
            </FormField>
            <FormField label="Credit Limit">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={form.credit_limit}
                onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
                aria-invalid={Boolean(fieldErrors.credit_limit)}
              />
              {fieldErrors.credit_limit && <p className="mt-1 text-xs text-red-600">{fieldErrors.credit_limit}</p>}
            </FormField>
          </div>

          <div className="mt-2 flex gap-2 border-t border-line pt-4">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? "Saving…" : editingId ? "Save Changes" : "Add Customer"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted hover:bg-surface2"
            >
              Cancel
            </button>
          </div>
        </form>
      </SlideOver>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.name ?? "this customer"}?`}
        description="This can't be undone. Customers with existing invoices or receipts can't be deleted."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
