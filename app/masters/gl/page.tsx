"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import type { GLAccount } from "@/lib/types";

const ACCOUNT_TYPES: GLAccount["type"][] = ["asset", "liability", "income", "expense"];

const EMPTY_FORM = { code: "", name: "", type: "asset" as GLAccount["type"], parent_group: "" };
type FormState = typeof EMPTY_FORM;

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
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function openAddForm() {
    setForm(EMPTY_FORM);
    setError(null);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (!form.code.trim() || !form.name.trim()) {
      setError("Code and name are required.");
      return;
    }
    setSaving(true);
    setError(null);

    const { error: dbError } = await supabase.from("gl_accounts").insert({
      code: form.code.trim(),
      name: form.name.trim(),
      type: form.type,
      parent_group: form.parent_group.trim() || null,
    });

    setSaving(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    setShowForm(false);
    await loadAccounts();
  }

  const columns: Column<GLAccount>[] = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    {
      key: "type",
      header: "Type",
      render: (a) => (
        <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${typePillClass(a.type)}`}>
          {a.type}
        </span>
      ),
    },
    {
      key: "parent_group",
      header: "Group",
      render: (a) => a.parent_group || "—",
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
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark"
          >
            + Add Account
          </button>
        }
      />

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 grid grid-cols-1 gap-4 rounded-xl border border-line bg-surface p-6 sm:grid-cols-4"
        >
          <FormField label="Code">
            <input
              className={inputClass}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              autoFocus
            />
          </FormField>
          <FormField label="Name">
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
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

          {error && <p className="col-span-full text-sm text-red-600">{error}</p>}

          <div className="col-span-full flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark disabled:opacity-60"
            >
              {saving ? "Saving…" : "Add Account"}
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
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading accounts…</p>
      ) : (
        <DataTable columns={columns} rows={accounts} empty="No GL accounts yet — add the first one." />
      )}
    </>
  );
}
