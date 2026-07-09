"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { money } from "@/lib/format";
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

export default function CustomerMasterPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadCustomers() {
    if (!supabase) return;
    setLoading(true);
    const { data } = await supabase.from("customers").select("*").order("name");
    setCustomers((data as Customer[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadCustomers();
  }, []);

  function openAddForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
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
      setError(dbError.message);
      return;
    }
    setShowForm(false);
    await loadCustomers();
  }

  const columns: Column<Customer>[] = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    {
      key: "contact_person",
      header: "Contact",
      render: (c) => c.contact_person || "—",
    },
    {
      key: "credit_days",
      header: "Credit Days",
      render: (c) => `${c.credit_days} days`,
    },
    {
      key: "credit_limit",
      header: "Credit Limit",
      className: "text-right",
      render: (c) => money(c.credit_limit),
    },
    {
      key: "edit",
      header: "",
      className: "text-right",
      render: (c) => (
        <button
          onClick={() => openEditForm(c)}
          className="rounded-lg px-2 py-1 text-xs font-medium text-brand hover:bg-surface2"
        >
          Edit
        </button>
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
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark"
          >
            + Add Customer
          </button>
        }
      />

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 grid grid-cols-1 gap-4 rounded-xl border border-line bg-surface p-6 sm:grid-cols-3"
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
            />
          </FormField>
          <FormField label="Phone">
            <input
              className={inputClass}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </FormField>
          <FormField label="Credit Days">
            <input
              type="number"
              className={inputClass}
              value={form.credit_days}
              onChange={(e) => setForm({ ...form, credit_days: e.target.value })}
            />
          </FormField>
          <FormField label="Credit Limit">
            <input
              type="number"
              className={inputClass}
              value={form.credit_limit}
              onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
            />
          </FormField>

          {error && <p className="col-span-full text-sm text-red-600">{error}</p>}

          <div className="col-span-full flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark disabled:opacity-60"
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
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading customers…</p>
      ) : (
        <DataTable columns={columns} rows={customers} empty="No customers yet — add the first one." />
      )}
    </>
  );
}
