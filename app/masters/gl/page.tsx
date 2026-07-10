"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Download, Pencil, Trash2, BookOpen, Plus } from "lucide-react";
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
import { exportToCsv } from "@/lib/exportUtils";
import { pushRecent } from "@/lib/recent";
import type { GLAccount } from "@/lib/types";

const ACCOUNT_TYPES: GLAccount["type"][] = ["asset", "liability", "income", "expense"];
const EMPTY_FORM = { code: "", name: "", type: "asset" as GLAccount["type"], parent_group: "" };
type FormState = typeof EMPTY_FORM;
type SortKey = "code" | "name" | "type";

function typePillClass(type: GLAccount["type"]) {
  switch (type) {
    case "asset":
      return "bg-green-500/15 text-green-600";
    case "liability":
      return "bg-red-500/15 text-red-600";
    case "income":
      return "bg-brand/15 text-brand";
    default: // expense
      return "bg-amber-500/15 text-amber-600";
  }
}

export default function GLMasterPage() {
  return (
    <Suspense fallback={null}>
      <GLMasterContent />
    </Suspense>
  );
}

function GLMasterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<GLAccount["type"] | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<GLAccount | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadAccounts() {
    if (!supabase) return;
    setLoading(true);
    const { data } = await supabase.from("gl_accounts").select("*").order("code");
    setAccounts((data as GLAccount[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (loading) return;
    if (searchParams.get("new") === "1") {
      openAddForm();
      router.replace("/masters/gl");
    } else {
      const editId = searchParams.get("edit");
      if (editId) {
        const match = accounts.find((a) => a.id === editId);
        if (match) openEditForm(match);
        router.replace("/masters/gl");
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

  function openEditForm(a: GLAccount) {
    setEditingId(a.id);
    setForm({ code: a.code, name: a.name, type: a.type, parent_group: a.parent_group ?? "" });
    setFieldErrors({});
    setShowForm(true);
    pushRecent({ kind: "gl_account", id: a.id, code: a.code, label: a.name });
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof FormState, string>> = {};
    if (!form.code.trim()) errors.code = "Code is required.";
    if (!form.name.trim()) errors.name = "Name is required.";
    const dupe = accounts.find(
      (a) => a.code.toLowerCase() === form.code.trim().toLowerCase() && a.id !== editingId
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
      type: form.type,
      parent_group: form.parent_group.trim() || null,
    };

    const { error: dbError } = editingId
      ? await supabase.from("gl_accounts").update(payload).eq("id", editingId)
      : await supabase.from("gl_accounts").insert(payload);

    setSaving(false);
    if (dbError) {
      toast(dbError.message, { variant: "error" });
      return;
    }
    toast(editingId ? `Saved changes to ${payload.name}.` : `Added ${payload.name}.`, { variant: "success" });
    setShowForm(false);
    await loadAccounts();
  }

  async function handleDelete() {
    if (!supabase || !deleteTarget) return;
    setDeleting(true);
    const { error: dbError } = await supabase.from("gl_accounts").delete().eq("id", deleteTarget.id);
    setDeleting(false);
    if (dbError) {
      const friendly = dbError.code === "23503"
        ? `Can't delete ${deleteTarget.name} — it's still referenced elsewhere.`
        : dbError.message;
      toast(friendly, { variant: "error" });
      return;
    }
    toast(`Deleted ${deleteTarget.name}.`, { variant: "success" });
    setDeleteTarget(null);
    await loadAccounts();
  }

  function handleExport() {
    exportToCsv(
      filteredSorted,
      [
        { header: "Code", value: (a: GLAccount) => a.code },
        { header: "Name", value: (a: GLAccount) => a.name },
        { header: "Type", value: (a: GLAccount) => a.type },
        { header: "Group", value: (a: GLAccount) => a.parent_group ?? "" },
      ],
      "gl-accounts.csv"
    );
    toast("Exported gl-accounts.csv", { variant: "success" });
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
    let filtered = accounts;
    if (typeFilter !== "all") filtered = filtered.filter((a) => a.type === typeFilter);
    if (q) {
      filtered = filtered.filter((a) =>
        [a.code, a.name, a.parent_group].some((f) => f?.toLowerCase().includes(q))
      );
    }
    return [...filtered].sort((a, b) => {
      const cmp = String(a[sortKey]).localeCompare(String(b[sortKey]));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [accounts, search, typeFilter, sortKey, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, pageSize]);

  const paged = filteredSorted.slice((page - 1) * pageSize, page * pageSize);

  const columns: Column<GLAccount>[] = [
    { key: "code", header: "Code", sortable: true },
    { key: "name", header: "Name", sortable: true },
    {
      key: "type",
      header: "Type",
      sortable: true,
      render: (a) => (
        <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${typePillClass(a.type)}`}>
          {a.type}
        </span>
      ),
    },
    { key: "parent_group", header: "Group", render: (a) => a.parent_group || "—" },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (a) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEditForm(a);
            }}
            aria-label={`Edit ${a.name}`}
            className="rounded-lg p-1.5 text-faint hover:bg-surface2 hover:text-ink"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(a);
            }}
            aria-label={`Delete ${a.name}`}
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
        <PageHeader title="GL Master" subtitle="The reference list of ledger accounts." />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="GL Master"
        subtitle="The reference list of ledger accounts — Sales, Debtors, Bank, Discount…"
        action={
          <button
            onClick={openAddForm}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark"
          >
            <Plus className="h-4 w-4" />
            Add Account
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by code, name, group…"
              aria-label="Search GL accounts"
              className={`${inputClass} w-full pl-9`}
            />
          </div>
          <div className="flex gap-1 rounded-lg border border-line bg-surface2 p-1">
            <button
              onClick={() => setTypeFilter("all")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                typeFilter === "all" ? "bg-brand text-brandink" : "text-muted hover:text-ink"
              }`}
            >
              All
            </button>
            {ACCOUNT_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  typeFilter === t ? "bg-brand text-brandink" : "text-muted hover:text-ink"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-faint">
            {filteredSorted.length} account{filteredSorted.length === 1 ? "" : "s"}
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
        caption="GL account master list"
        empty={
          search || typeFilter !== "all" ? (
            <EmptyState icon={Search} title="No matches" description="Try a different search or filter." />
          ) : (
            <EmptyState
              icon={BookOpen}
              title="No GL accounts yet"
              description="Add your first ledger account to get started."
              action={
                <button
                  onClick={openAddForm}
                  className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brandink hover:bg-brand-dark"
                >
                  + Add Account
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
        title={editingId ? "Edit GL Account" : "Add GL Account"}
        subtitle={editingId ? form.name : "Add a ledger account to the chart of accounts."}
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
          <FormField label="Type">
            <select
              className={inputClass}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as GLAccount["type"] })}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t} className="capitalize">
                  {t}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Parent Group (optional)">
            <input
              className={inputClass}
              value={form.parent_group}
              onChange={(e) => setForm({ ...form, parent_group: e.target.value })}
            />
          </FormField>

          <div className="mt-2 flex gap-2 border-t border-line pt-4">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? "Saving…" : editingId ? "Save Changes" : "Add Account"}
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
        title={`Delete ${deleteTarget?.name ?? "this account"}?`}
        description="This can't be undone. Accounts referenced elsewhere can't be deleted."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
