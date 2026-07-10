"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { isConfigured, supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/RichTextEditor";
import { toast } from "@/components/Toast";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  FilePlus,
  Landmark,
  MoreVertical,
  RotateCcw,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { getBranding, getSignedInUser, setBranding, type CompanyBranding } from "@/lib/companyBranding";
import {
  DEFAULT_TEMPLATE,
  PLACEHOLDERS,
  buildEmailHtml,
  buildInvoiceTableHtml,
  composeBody,
  decomposeBody,
  findUnknownPlaceholders,
  fillPlaceholders,
  type FillVars,
  type InvoiceLineItem,
  type TemplateSections,
} from "@/lib/emailTemplate";
import type { Company, Customer, Invoice, ReceiptAllocation, ReminderTemplate } from "@/lib/types";

const ACTIVE_TEMPLATE_NAME = "Default reminder";

type PlainField = "subject" | "greeting" | "closing" | "signature" | "footer";
type ActiveField = PlainField | "body";

const FALLBACK_SAMPLE: FillVars = {
  CustomerName: "Sample Customer",
  CompanyName: "Verve Advisory",
  CompanyAddress: "",
  CompanyWebsite: "",
  InvoiceNumber: "INV-0000",
  InvoiceDate: new Date().toLocaleDateString(),
  DueDate: new Date().toLocaleDateString(),
  OutstandingAmount: "₹10,000.00",
  DaysOverdue: "0",
  Location: "—",
  CurrentDate: new Date().toLocaleDateString(),
  CurrentTime: new Date().toLocaleTimeString(),
  ARExecutive: "admin",
  CompanyEmail: "accounts@verveadvisory.in",
  CompanyPhone: "—",
  PaymentLink: "",
  BankName: "",
  BankAccountName: "",
  BankAccountNumber: "",
  IFSCOrSWIFT: "",
  UPIId: "",
  TotalReceivables: "₹10,000.00",
};

const FALLBACK_INVOICE_ITEMS: InvoiceLineItem[] = [
  {
    invoiceNumber: "INV-0000",
    invoiceDate: new Date().toLocaleDateString(),
    dueDate: new Date().toLocaleDateString(),
    daysOverdue: "0",
    outstandingAmount: "₹10,000.00",
  },
];

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailTemplateEditorPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [templates, setTemplates] = useState<ReminderTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [sections, setSections] = useState<TemplateSections>(DEFAULT_TEMPLATE.sections);

  const [company, setCompany] = useState<Company | null>(null);
  const [companyForm, setCompanyForm] = useState({ name: "", address: "", phone: "", email: "" });
  const [branding, setBrandingState] = useState<CompanyBranding>({
    logoUrl: "",
    website: "",
    paymentLink: "",
    bankName: "",
    bankAccountName: "",
    bankAccountNumber: "",
    ifscOrSwift: "",
    upiId: "",
  });

  const [sampleVars, setSampleVars] = useState<FillVars>(FALLBACK_SAMPLE);
  const [sampleItems, setSampleItems] = useState<InvoiceLineItem[]>(FALLBACK_INVOICE_ITEMS);

  const [activeField, setActiveField] = useState<ActiveField>("subject");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [brandingSaving, setBrandingSaving] = useState(false);

  const [testEmail, setTestEmail] = useState("");
  const [testSending, setTestSending] = useState(false);

  const fieldRefs = useRef<Record<PlainField, HTMLInputElement | HTMLTextAreaElement | null>>({
    subject: null,
    greeting: null,
    closing: null,
    signature: null,
    footer: null,
  });
  const richTextRef = useRef<RichTextEditorHandle>(null);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    void loadData();
    setBrandingState(getBranding());
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenuOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [templatesRes, companyRes, invoicesRes] = await Promise.all([
      supabase!.from("reminder_templates").select("*").order("name"),
      supabase!.from("company").select("*").limit(1).maybeSingle(),
      supabase!.from("invoices").select("*").neq("status", "paid"),
    ]);

    if (templatesRes.error || companyRes.error || invoicesRes.error) {
      setError(templatesRes.error?.message || companyRes.error?.message || invoicesRes.error?.message || "Failed to load the template.");
      setLoading(false);
      return;
    }

    const allTemplates = (templatesRes.data ?? []) as ReminderTemplate[];
    setTemplates(allTemplates);
    const active = allTemplates.find((t) => t.name === ACTIVE_TEMPLATE_NAME) ?? allTemplates[0] ?? null;
    if (active) {
      setSelectedTemplateId(active.id);
      setSubject(active.subject);
      setSections(decomposeBody(active.body));
    } else {
      setSelectedTemplateId(null);
      setSubject(DEFAULT_TEMPLATE.subject);
      setSections(DEFAULT_TEMPLATE.sections);
    }

    const companyRow = companyRes.data as Company | null;
    setCompany(companyRow);
    setCompanyForm({
      name: companyRow?.name ?? "",
      address: companyRow?.address ?? "",
      phone: companyRow?.phone ?? "",
      email: companyRow?.email ?? "",
    });

    // Build a realistic multi-invoice sample: the customer (among unpaid invoices) with the most of them.
    const invoices = (invoicesRes.data ?? []) as Invoice[];
    const byCustomer = new Map<string, Invoice[]>();
    invoices.forEach((inv) => {
      const list = byCustomer.get(inv.customer_id) ?? [];
      list.push(inv);
      byCustomer.set(inv.customer_id, list);
    });
    const bestGroup = [...byCustomer.entries()].sort((a, b) => b[1].length - a[1].length)[0];

    if (bestGroup) {
      const [customerId, customerInvoices] = bestGroup;
      const [customerRes, allocationsRes] = await Promise.all([
        supabase!.from("customers").select("*").eq("id", customerId).maybeSingle(),
        supabase!.from("receipt_allocations").select("*"),
      ]);
      const customer = customerRes.data as Customer | null;
      const allocations = (allocationsRes.data ?? []) as ReceiptAllocation[];

      const items: InvoiceLineItem[] = customerInvoices.map((inv) => {
        const allocated = allocations.filter((a) => a.invoice_id === inv.id).reduce((sum, a) => sum + a.amount, 0);
        const outstanding = inv.total - allocated;
        const days = Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000);
        return {
          invoiceNumber: inv.invoice_no,
          invoiceDate: new Date(inv.invoice_date).toLocaleDateString(),
          dueDate: new Date(inv.due_date).toLocaleDateString(),
          daysOverdue: String(days > 0 ? days : 0),
          outstandingAmount: money(outstanding),
        };
      });
      const totalReceivables = items.reduce((sum, i, idx) => {
        const allocated = allocations
          .filter((a) => a.invoice_id === customerInvoices[idx].id)
          .reduce((s, a) => s + a.amount, 0);
        return sum + (customerInvoices[idx].total - allocated);
      }, 0);
      const first = customerInvoices[0];
      const firstDays = Math.floor((Date.now() - new Date(first.due_date).getTime()) / 86400000);

      const brandingNow = getBranding();
      setSampleItems(items);
      setSampleVars({
        CustomerName: customer?.name ?? FALLBACK_SAMPLE.CustomerName,
        CompanyName: companyRow?.name ?? FALLBACK_SAMPLE.CompanyName,
        CompanyAddress: companyRow?.address ?? "",
        CompanyWebsite: brandingNow.website,
        InvoiceNumber: first.invoice_no,
        InvoiceDate: new Date(first.invoice_date).toLocaleDateString(),
        DueDate: new Date(first.due_date).toLocaleDateString(),
        OutstandingAmount: items[0]?.outstandingAmount ?? FALLBACK_SAMPLE.OutstandingAmount,
        DaysOverdue: String(firstDays > 0 ? firstDays : 0),
        Location: customer?.address?.trim() || "Unspecified",
        CurrentDate: new Date().toLocaleDateString(),
        CurrentTime: new Date().toLocaleTimeString(),
        ARExecutive: getSignedInUser() || "admin",
        CompanyEmail: companyRow?.email ?? FALLBACK_SAMPLE.CompanyEmail,
        CompanyPhone: companyRow?.phone ?? FALLBACK_SAMPLE.CompanyPhone,
        PaymentLink: brandingNow.paymentLink,
        BankName: brandingNow.bankName,
        BankAccountName: brandingNow.bankAccountName,
        BankAccountNumber: brandingNow.bankAccountNumber,
        IFSCOrSWIFT: brandingNow.ifscOrSwift,
        UPIId: brandingNow.upiId,
        TotalReceivables: money(totalReceivables),
      });
    } else {
      const brandingNow = getBranding();
      setSampleVars({
        ...FALLBACK_SAMPLE,
        CompanyName: companyRow?.name ?? FALLBACK_SAMPLE.CompanyName,
        CompanyAddress: companyRow?.address ?? "",
        CompanyWebsite: brandingNow.website,
        CompanyEmail: companyRow?.email ?? FALLBACK_SAMPLE.CompanyEmail,
        CompanyPhone: companyRow?.phone ?? FALLBACK_SAMPLE.CompanyPhone,
        ARExecutive: getSignedInUser() || "admin",
        PaymentLink: brandingNow.paymentLink,
        BankName: brandingNow.bankName,
        BankAccountName: brandingNow.bankAccountName,
        BankAccountNumber: brandingNow.bankAccountNumber,
        IFSCOrSWIFT: brandingNow.ifscOrSwift,
        UPIId: brandingNow.upiId,
      });
    }

    setLoading(false);
  }

  function getFieldValue(f: PlainField) {
    return f === "subject" ? subject : sections[f];
  }
  function setFieldValue(f: PlainField, v: string) {
    if (f === "subject") setSubject(v);
    else setSections((prev) => ({ ...prev, [f]: v }));
  }

  function insertPlaceholder(token: string) {
    if (activeField === "body") {
      richTextRef.current?.insertAtCursor(token);
      return;
    }
    const el = fieldRefs.current[activeField];
    const value = getFieldValue(activeField);
    if (!el) {
      setFieldValue(activeField, value + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    setFieldValue(activeField, next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function loadTemplateIntoEditor(t: ReminderTemplate) {
    setSelectedTemplateId(t.id);
    setSubject(t.subject);
    setSections(decomposeBody(t.body));
    setWarnings([]);
  }

  function validateBeforeSave(): string[] {
    const unknown = new Set<string>();
    [subject, sections.greeting, sections.body, sections.closing, sections.signature, sections.footer].forEach((text) => {
      findUnknownPlaceholders(text).forEach((token) => unknown.add(token));
    });
    return [...unknown];
  }

  async function handleSave() {
    if (!supabase) return;
    const unknown = validateBeforeSave();
    setWarnings(unknown);

    setSaving(true);

    const body = composeBody(sections);
    const result = selectedTemplateId
      ? await supabase.from("reminder_templates").update({ subject, body }).eq("id", selectedTemplateId)
      : await supabase
          .from("reminder_templates")
          .insert({ name: ACTIVE_TEMPLATE_NAME, subject, body })
          .select()
          .maybeSingle();

    if (result.error) {
      toast(result.error.message, { variant: "error" });
      setSaving(false);
      return;
    }
    if (!selectedTemplateId && "data" in result && result.data) {
      const created = result.data as ReminderTemplate;
      setSelectedTemplateId(created.id);
      setTemplates((prev) => [...prev, created]);
    } else {
      setTemplates((prev) => prev.map((t) => (t.id === selectedTemplateId ? { ...t, subject, body } : t)));
    }
    toast(
      unknown.length > 0
        ? "Saved — but check the placeholder warning below."
        : "Template saved" +
            (templates.find((t) => t.id === selectedTemplateId)?.name === ACTIVE_TEMPLATE_NAME
              ? " — Auto Email Shoot will use this from now on."
              : "."),
      { variant: unknown.length > 0 ? "info" : "success" }
    );
    setSaving(false);
  }

  async function handleSaveAsNew() {
    if (!supabase) return;
    const name = window.prompt("Name this template:");
    if (!name || !name.trim()) return;
    if (templates.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) {
      toast("A template with that name already exists.", { variant: "error" });
      return;
    }

    setSaving(true);
    const body = composeBody(sections);
    const { data, error: insertError } = await supabase
      .from("reminder_templates")
      .insert({ name: name.trim(), subject, body })
      .select()
      .maybeSingle();

    if (insertError) {
      toast(insertError.message, { variant: "error" });
      setSaving(false);
      return;
    }
    const created = data as ReminderTemplate;
    setTemplates((prev) => [...prev, created]);
    setSelectedTemplateId(created.id);
    toast(`Saved as "${created.name}". It's not active yet — use Activate to make Auto Email Shoot use it.`, {
      variant: "success",
      actionLabel: "Activate now",
      onAction: () => void handleActivate(),
    });
    setSaving(false);
  }

  async function handleActivate() {
    if (!supabase || !selectedTemplateId) return;
    const current = templates.find((t) => t.id === selectedTemplateId);
    if (!current || current.name === ACTIVE_TEMPLATE_NAME) return;

    setSaving(true);

    const body = composeBody(sections);
    const activeRow = templates.find((t) => t.name === ACTIVE_TEMPLATE_NAME);
    const result = activeRow
      ? await supabase.from("reminder_templates").update({ subject, body }).eq("id", activeRow.id)
      : await supabase.from("reminder_templates").insert({ name: ACTIVE_TEMPLATE_NAME, subject, body }).select().maybeSingle();

    if (result.error) {
      toast(result.error.message, { variant: "error" });
      setSaving(false);
      return;
    }
    toast(`"${current.name}" is now active — Auto Email Shoot will use it.`, { variant: "success" });
    await loadData();
    setSaving(false);
  }

  async function handleDelete() {
    if (!supabase || !selectedTemplateId) return;
    const current = templates.find((t) => t.id === selectedTemplateId);
    if (!current) return;
    if (current.name === ACTIVE_TEMPLATE_NAME) {
      toast("Can't delete the active template — activate a different one first.", { variant: "error" });
      return;
    }
    if (!window.confirm(`Delete template "${current.name}"?`)) return;

    const { error: deleteError } = await supabase.from("reminder_templates").delete().eq("id", current.id);
    if (deleteError) {
      toast(deleteError.message, { variant: "error" });
      return;
    }
    setTemplates((prev) => prev.filter((t) => t.id !== current.id));
    toast(`Deleted "${current.name}".`, { variant: "success" });
    const fallback = templates.find((t) => t.name === ACTIVE_TEMPLATE_NAME);
    if (fallback) loadTemplateIntoEditor(fallback);
  }

  function handleResetToDefault() {
    setSubject(DEFAULT_TEMPLATE.subject);
    setSections(DEFAULT_TEMPLATE.sections);
    setWarnings([]);
    toast("Reset to the default template. Click Save Template to keep it.", { variant: "info" });
  }

  async function handleSaveBranding() {
    if (!supabase) return;
    setBrandingSaving(true);

    setBranding(branding);

    const result = company
      ? await supabase.from("company").update(companyForm).eq("id", company.id)
      : await supabase.from("company").insert(companyForm).select().maybeSingle();

    if (result.error) {
      toast(result.error.message, { variant: "error" });
      setBrandingSaving(false);
      return;
    }
    toast("Branding saved.", { variant: "success" });
    setBrandingSaving(false);
  }

  async function handleSendTest() {
    if (!emailRegex.test(testEmail)) {
      toast("Enter a valid email address first.", { variant: "error" });
      return;
    }
    setTestSending(true);
    // Simulated, like every other send in this app — no real email leaves the app.
    await new Promise((resolve) => setTimeout(resolve, 600));
    toast(`Test email would be sent to ${testEmail} (simulated — this app doesn't send real email).`, { variant: "success" });
    setTestSending(false);
  }

  const previewSubject = fillPlaceholders(subject, sampleVars);
  const previewHtml = buildEmailHtml(sections, sampleVars, {
    invoiceTableHtml: buildInvoiceTableHtml(sampleItems, sampleVars.TotalReceivables),
    logoUrl: branding.logoUrl || undefined,
  });

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Reminder Template" />
        <NotConfigured />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Reminder Template" />
        <p className="text-sm text-muted">Loading template…</p>
      </>
    );
  }

  const isActiveTemplate = templates.find((t) => t.id === selectedTemplateId)?.name === ACTIVE_TEMPLATE_NAME;

  return (
    <>
      <PageHeader
        title="Reminder Template"
        subtitle="This is the template Auto Email Shoot uses for every reminder it sends."
        action={
          <Link
            href="/auto-email-shoot"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Auto Email Shoot
          </Link>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
        <FormField label="Template">
          <select
            className={inputClass}
            value={selectedTemplateId ?? ""}
            onChange={(e) => {
              const t = templates.find((x) => x.id === e.target.value);
              if (t) loadTemplateIntoEditor(t);
            }}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.name === ACTIVE_TEMPLATE_NAME ? " (active)" : ""}
              </option>
            ))}
          </select>
        </FormField>
        <button
          onClick={handleActivate}
          disabled={saving || isActiveTemplate}
          title="Activate Template"
          aria-label="Activate Template"
          className="rounded-lg border border-line bg-surface p-2 text-ink hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" />
        </button>
        <button
          onClick={handleDelete}
          disabled={isActiveTemplate}
          title="Delete Template"
          aria-label="Delete Template"
          className="rounded-lg border border-red-200 bg-surface p-2 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <FormField label="Subject">
            <input
              ref={(el) => {
                fieldRefs.current.subject = el;
              }}
              type="text"
              value={subject}
              onFocus={() => setActiveField("subject")}
              onChange={(e) => setSubject(e.target.value)}
              className={inputClass}
            />
          </FormField>

          <FormField label="Greeting">
            <input
              ref={(el) => {
                fieldRefs.current.greeting = el;
              }}
              type="text"
              value={sections.greeting}
              onFocus={() => setActiveField("greeting")}
              onChange={(e) => setFieldValue("greeting", e.target.value)}
              className={inputClass}
            />
          </FormField>

          <div>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Email Body</span>
            <div onFocus={() => setActiveField("body")}>
              <RichTextEditor
                ref={richTextRef}
                value={sections.body}
                onChange={(html) => setSections((prev) => ({ ...prev, body: html }))}
                logoUrl={branding.logoUrl}
              />
            </div>
            <p className="mt-1 text-xs text-faint">
              The Invoice Summary Table is generated automatically and inserted after this section — it isn&apos;t edited here.
            </p>
          </div>

          <FormField label="Closing Message">
            <input
              ref={(el) => {
                fieldRefs.current.closing = el;
              }}
              type="text"
              value={sections.closing}
              onFocus={() => setActiveField("closing")}
              onChange={(e) => setFieldValue("closing", e.target.value)}
              className={inputClass}
            />
          </FormField>

          <FormField label="Signature">
            <textarea
              ref={(el) => {
                fieldRefs.current.signature = el;
              }}
              value={sections.signature}
              onFocus={() => setActiveField("signature")}
              onChange={(e) => setFieldValue("signature", e.target.value)}
              rows={3}
              className={inputClass}
            />
          </FormField>

          <FormField label="Footer">
            <input
              ref={(el) => {
                fieldRefs.current.footer = el;
              }}
              type="text"
              value={sections.footer}
              onFocus={() => setActiveField("footer")}
              onChange={(e) => setFieldValue("footer", e.target.value)}
              className={inputClass}
            />
          </FormField>

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brandink transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save Template"}
            </button>

            <button
              onClick={() => setPreviewOpen((v) => !v)}
              title={previewOpen ? "Hide Preview" : "Preview Email"}
              aria-label={previewOpen ? "Hide Preview" : "Preview Email"}
              className="rounded-lg border border-line bg-surface p-2 text-ink hover:bg-surface2"
            >
              <Eye className="h-4 w-4" />
            </button>

            <div ref={moreMenuRef} className="relative ml-auto">
              <button
                onClick={() => setMoreMenuOpen((v) => !v)}
                title="More actions"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
                className="rounded-lg border border-line bg-surface p-2 text-ink hover:bg-surface2"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
              {moreMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-line bg-surface p-1 shadow-lg"
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      handleSaveAsNew();
                    }}
                    disabled={saving}
                    className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FilePlus className="h-4 w-4 text-faint" />
                    Save As New Template
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      handleResetToDefault();
                    }}
                    className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink hover:bg-surface2"
                  >
                    <RotateCcw className="h-4 w-4 text-faint" />
                    Reset to Default Template
                  </button>
                  <Link
                    role="menuitem"
                    href="/auto-email-shoot"
                    onClick={() => setMoreMenuOpen(false)}
                    className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink hover:bg-surface2"
                  >
                    <X className="h-4 w-4 text-faint" />
                    Cancel
                  </Link>
                </div>
              )}
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Unrecognized placeholder{warnings.length > 1 ? "s" : ""}: {warnings.join(", ")} — check the placeholder list for the correct spelling.
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Insert placeholder</h3>
            <p className="mb-3 text-xs text-muted">
              Click a field to edit, then click a placeholder to insert it there. Currently editing:{" "}
              <span className="font-medium text-ink">{activeField === "body" ? "Email Body" : activeField}</span>.
            </p>
            <div className="flex flex-wrap gap-2">
              {PLACEHOLDERS.map((p) => (
                <button
                  key={p.token}
                  onClick={() => insertPlaceholder(p.token)}
                  title={p.token}
                  className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface2"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Company Branding</h3>
            <div className="space-y-3">
              <FormField label="Company Name">
                <input className={inputClass} value={companyForm.name} onChange={(e) => setCompanyForm((p) => ({ ...p, name: e.target.value }))} />
              </FormField>
              <FormField label="Address">
                <input className={inputClass} value={companyForm.address} onChange={(e) => setCompanyForm((p) => ({ ...p, address: e.target.value }))} />
              </FormField>
              <FormField label="Phone">
                <input className={inputClass} value={companyForm.phone} onChange={(e) => setCompanyForm((p) => ({ ...p, phone: e.target.value }))} />
              </FormField>
              <FormField label="Email">
                <input className={inputClass} value={companyForm.email} onChange={(e) => setCompanyForm((p) => ({ ...p, email: e.target.value }))} />
              </FormField>
              <FormField label="Logo URL (this browser only)">
                <input
                  className={inputClass}
                  value={branding.logoUrl}
                  onChange={(e) => setBrandingState((p) => ({ ...p, logoUrl: e.target.value }))}
                  placeholder="https://…"
                />
              </FormField>
              <FormField label="Website (this browser only)">
                <input
                  className={inputClass}
                  value={branding.website}
                  onChange={(e) => setBrandingState((p) => ({ ...p, website: e.target.value }))}
                  placeholder="https://…"
                />
              </FormField>
              <FormField label="Payment Link (this browser only)">
                <input
                  className={inputClass}
                  value={branding.paymentLink}
                  onChange={(e) => setBrandingState((p) => ({ ...p, paymentLink: e.target.value }))}
                  placeholder="https://…"
                />
              </FormField>

              <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Payment Instructions (this browser only)
              </p>
              <p className="-mt-2 text-xs text-amber-600">
                Stored in plain text in this browser — fine for a demo, not how real bank details should be handled.
              </p>
              <FormField label="Bank Name">
                <input className={inputClass} value={branding.bankName} onChange={(e) => setBrandingState((p) => ({ ...p, bankName: e.target.value }))} />
              </FormField>
              <FormField label="Account Name">
                <input
                  className={inputClass}
                  value={branding.bankAccountName}
                  onChange={(e) => setBrandingState((p) => ({ ...p, bankAccountName: e.target.value }))}
                />
              </FormField>
              <FormField label="Account Number">
                <input
                  className={inputClass}
                  value={branding.bankAccountNumber}
                  onChange={(e) => setBrandingState((p) => ({ ...p, bankAccountNumber: e.target.value }))}
                />
              </FormField>
              <FormField label="IFSC / SWIFT Code">
                <input
                  className={inputClass}
                  value={branding.ifscOrSwift}
                  onChange={(e) => setBrandingState((p) => ({ ...p, ifscOrSwift: e.target.value }))}
                />
              </FormField>
              <FormField label="UPI ID">
                <input className={inputClass} value={branding.upiId} onChange={(e) => setBrandingState((p) => ({ ...p, upiId: e.target.value }))} />
              </FormField>

              <button
                onClick={handleSaveBranding}
                disabled={brandingSaving}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brandink hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Landmark className="h-4 w-4" />
                {brandingSaving ? "Saving…" : "Save Branding"}
              </button>
              <p className="text-xs text-faint">
                Name/Address/Phone/Email are saved to the company record. Everything else here is saved only in this browser (no such columns exist to store them centrally).
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Send Test Email</h3>
            <div className="flex flex-col gap-2">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
              <button
                onClick={handleSendTest}
                disabled={testSending || !testEmail}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brandink transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {testSending ? "Sending…" : "Send Test Email"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {previewOpen && (
        <div className="mt-6 rounded-xl border border-line bg-surface p-6">
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
            Preview — filled with sample data
          </h3>
          <p className="mb-4 text-xs text-faint">
            Sample: {sampleVars.CustomerName} · {sampleItems.length} invoice{sampleItems.length === 1 ? "" : "s"} · Total {sampleVars.TotalReceivables}
          </p>
          <div className="rounded-lg border border-line bg-surface2 p-4">
            <p className="mb-2 text-sm">
              <span className="font-medium text-muted">Subject: </span>
              <span className="text-ink">{previewSubject}</span>
            </p>
            <div className="rounded-lg border border-line bg-surface p-4" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      )}
    </>
  );
}
