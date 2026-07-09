import { supabase } from "@/lib/supabase";
import { getBranding } from "@/lib/companyBranding";
import { getIntervalDays, getSchedulerSettings, markRunComplete } from "@/lib/schedulerSettings";
import { appendSchedulerLog, type SchedulerRunEntry } from "@/lib/schedulerLog";
import {
  buildEmailHtml,
  buildInvoiceTableHtml,
  decomposeBody,
  fillPlaceholders,
  type FillVars,
  type InvoiceLineItem,
} from "@/lib/emailTemplate";
import type { Customer, Invoice, ReceiptAllocation, ReminderLog, ReminderTemplate } from "@/lib/types";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

interface EligibleInvoice {
  invoiceId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  outstanding: number;
  daysOverdue: number;
  location: string;
}

/** Read-only count of invoices that would be reminded if the scheduler ran right now — for the dashboard's "Emails Pending" card. */
export async function countPendingReminders(): Promise<number> {
  if (!supabase) return 0;
  const settings = getSchedulerSettings();
  const now = new Date();
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const todayStr = now.toDateString();

  const [invoicesRes, customersRes, allocationsRes, logsRes] = await Promise.all([
    supabase.from("invoices").select("*").neq("status", "paid"),
    supabase.from("customers").select("*"),
    supabase.from("receipt_allocations").select("*"),
    supabase.from("reminder_log").select("invoice_id, sent_at"),
  ]);
  if (invoicesRes.error || customersRes.error || allocationsRes.error || logsRes.error) return 0;

  const invoices = (invoicesRes.data ?? []) as Invoice[];
  const customers = (customersRes.data ?? []) as Customer[];
  const allocations = (allocationsRes.data ?? []) as ReceiptAllocation[];
  const logs = (logsRes.data ?? []) as { invoice_id: string | null; sent_at: string }[];

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const allocatedByInvoice = new Map<string, number>();
  allocations.forEach((a) => allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + a.amount));
  const countByInvoice = new Map<string, number>();
  const lastReminderByInvoice = new Map<string, Date>();
  logs.forEach((l) => {
    if (!l.invoice_id) return;
    countByInvoice.set(l.invoice_id, (countByInvoice.get(l.invoice_id) ?? 0) + 1);
    const sentAt = new Date(l.sent_at);
    const prior = lastReminderByInvoice.get(l.invoice_id);
    if (!prior || sentAt > prior) lastReminderByInvoice.set(l.invoice_id, sentAt);
  });
  const remindedToday = new Set(
    logs.filter((l) => l.invoice_id && new Date(l.sent_at).toDateString() === todayStr).map((l) => l.invoice_id as string)
  );
  const intervalDays = getIntervalDays(settings.frequency, settings.customIntervalDays);

  let pending = 0;
  for (const inv of invoices) {
    const outstanding = inv.total - (allocatedByInvoice.get(inv.id) ?? 0);
    const dueDate = new Date(inv.due_date);
    dueDate.setHours(0, 0, 0, 0);
    const days = Math.floor((todayMidnight.getTime() - dueDate.getTime()) / 86400000);
    if (days <= 0) continue;
    if (outstanding <= 0.005) continue;
    if (remindedToday.has(inv.id)) continue;
    const lastReminder = lastReminderByInvoice.get(inv.id);
    if (lastReminder && Math.floor((todayMidnight.getTime() - lastReminder.getTime()) / 86400000) < intervalDays) continue;
    const priorCount = countByInvoice.get(inv.id) ?? 0;
    if (settings.maxRemindersPerInvoice !== null && priorCount >= settings.maxRemindersPerInvoice) continue;
    const customer = customerById.get(inv.customer_id);
    if (!customer || !customer.email || !emailRegex.test(customer.email)) continue;
    pending++;
  }
  return pending;
}

/**
 * Finds every genuinely-overdue, unpaid, not-yet-reminded-today invoice with a valid
 * customer email, groups them by customer (same model the manual Auto Email Shoot send
 * uses), renders each with the exact same template primitives as everywhere else in this
 * app, writes to reminder_log, and records a run entry. Called both by the automatic
 * in-browser check and the manual "Run Scheduler Now" button — same function either way.
 */
export async function runScheduledCheck(options: { manual: boolean }): Promise<SchedulerRunEntry> {
  const now = new Date();
  const runDate = now.toLocaleDateString();
  const runTime = now.toLocaleTimeString();
  const settings = getSchedulerSettings();
  const failureReasons: string[] = [];

  if (!supabase) {
    const entry: SchedulerRunEntry = {
      runDate,
      runTime,
      totalChecked: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      failureReasons: ["Supabase is not configured."],
      manual: options.manual,
    };
    appendSchedulerLog(entry);
    return entry;
  }

  const [invoicesRes, customersRes, allocationsRes, templateRes, companyRes, logsRes] = await Promise.all([
    supabase.from("invoices").select("*").neq("status", "paid"),
    supabase.from("customers").select("*"),
    supabase.from("receipt_allocations").select("*"),
    // Multiple templates can exist (Save As New); this is always the one Auto Email Shoot uses.
    supabase.from("reminder_templates").select("*").eq("name", "Default reminder").maybeSingle(),
    supabase.from("company").select("name, email, phone, address").limit(1).maybeSingle(),
    supabase.from("reminder_log").select("*"),
  ]);

  const fetchError =
    invoicesRes.error || customersRes.error || allocationsRes.error || templateRes.error || logsRes.error;
  if (fetchError) {
    const entry: SchedulerRunEntry = {
      runDate,
      runTime,
      totalChecked: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      failureReasons: [fetchError.message],
      manual: options.manual,
    };
    appendSchedulerLog(entry);
    markRunComplete(now);
    return entry;
  }

  const template = templateRes.data as ReminderTemplate | null;
  if (!template) {
    const entry: SchedulerRunEntry = {
      runDate,
      runTime,
      totalChecked: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      failureReasons: ["No active reminder template found (none named \"Default reminder\")."],
      manual: options.manual,
    };
    appendSchedulerLog(entry);
    markRunComplete(now);
    return entry;
  }

  const invoices = (invoicesRes.data ?? []) as Invoice[];
  const customers = (customersRes.data ?? []) as Customer[];
  const allocations = (allocationsRes.data ?? []) as ReceiptAllocation[];
  const company = companyRes.data as { name: string; email: string; phone: string; address: string } | null;
  const logs = (logsRes.data ?? []) as ReminderLog[];

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const allocatedByInvoice = new Map<string, number>();
  allocations.forEach((a) => allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + a.amount));

  const countByInvoice = new Map<string, number>();
  const lastReminderByInvoice = new Map<string, Date>();
  logs.forEach((l) => {
    if (!l.invoice_id) return;
    countByInvoice.set(l.invoice_id, (countByInvoice.get(l.invoice_id) ?? 0) + 1);
    const sentAt = new Date(l.sent_at);
    const prior = lastReminderByInvoice.get(l.invoice_id);
    if (!prior || sentAt > prior) lastReminderByInvoice.set(l.invoice_id, sentAt);
  });

  const todayStr = now.toDateString();
  const remindedTodayByInvoice = new Set(
    logs.filter((l) => l.invoice_id && new Date(l.sent_at).toDateString() === todayStr).map((l) => l.invoice_id as string)
  );

  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const intervalDays = getIntervalDays(settings.frequency, settings.customIntervalDays);

  let totalChecked = 0;
  let skipped = 0;
  const eligible: EligibleInvoice[] = [];

  for (const inv of invoices) {
    totalChecked++;

    const outstanding = inv.total - (allocatedByInvoice.get(inv.id) ?? 0);
    const dueDate = new Date(inv.due_date);
    dueDate.setHours(0, 0, 0, 0);
    const days = Math.floor((todayMidnight.getTime() - dueDate.getTime()) / 86400000);

    if (days <= 0) {
      skipped++; // Current Date > Due Date required — due today or not yet due doesn't qualify.
      continue;
    }
    if (outstanding <= 0.005) {
      skipped++; // fully settled
      continue;
    }
    if (remindedTodayByInvoice.has(inv.id)) {
      skipped++; // no duplicate reminders same day
      continue;
    }
    const lastReminder = lastReminderByInvoice.get(inv.id);
    if (lastReminder) {
      const daysSinceLastReminder = Math.floor((todayMidnight.getTime() - lastReminder.getTime()) / 86400000);
      if (daysSinceLastReminder < intervalDays) {
        skipped++; // not due for its next reminder yet, per the configured frequency
        continue;
      }
    }
    const priorCount = countByInvoice.get(inv.id) ?? 0;
    if (settings.maxRemindersPerInvoice !== null && priorCount >= settings.maxRemindersPerInvoice) {
      skipped++;
      continue;
    }
    const customer = customerById.get(inv.customer_id);
    if (!customer || !customer.email || !emailRegex.test(customer.email)) {
      skipped++; // no valid customer email on file
      continue;
    }

    eligible.push({
      invoiceId: inv.id,
      customerId: inv.customer_id,
      customerName: customer.name,
      customerEmail: customer.email,
      invoiceNo: inv.invoice_no,
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date,
      outstanding,
      daysOverdue: days,
      location: customer.address?.trim() || "Unspecified",
    });
  }

  const byCustomer = new Map<string, EligibleInvoice[]>();
  eligible.forEach((row) => {
    const list = byCustomer.get(row.customerId) ?? [];
    list.push(row);
    byCustomer.set(row.customerId, list);
  });

  const sections = decomposeBody(template.body);
  const branding = getBranding();
  const companyName = company?.name ?? "Verve Advisory";
  const companyEmail = company?.email ?? "";
  const companyPhone = company?.phone ?? "";
  const companyAddress = company?.address ?? "";

  let sent = 0;
  let failed = 0;

  for (const rows of byCustomer.values()) {
    const first = rows[0];
    const totalReceivables = rows.reduce((sum, r) => sum + r.outstanding, 0);
    const totalFormatted = money(totalReceivables);
    const items: InvoiceLineItem[] = rows.map((r) => ({
      invoiceNumber: r.invoiceNo,
      invoiceDate: new Date(r.invoiceDate).toLocaleDateString(),
      dueDate: new Date(r.dueDate).toLocaleDateString(),
      daysOverdue: String(r.daysOverdue),
      outstandingAmount: money(r.outstanding),
    }));

    const vars: FillVars = {
      CustomerName: first.customerName,
      CompanyName: companyName,
      CompanyAddress: companyAddress,
      CompanyWebsite: branding.website,
      InvoiceNumber: first.invoiceNo,
      InvoiceDate: new Date(first.invoiceDate).toLocaleDateString(),
      DueDate: new Date(first.dueDate).toLocaleDateString(),
      OutstandingAmount: money(first.outstanding),
      DaysOverdue: String(first.daysOverdue),
      Location: first.location,
      CurrentDate: now.toLocaleDateString(),
      CurrentTime: now.toLocaleTimeString(),
      ARExecutive: "Automatic Scheduler",
      CompanyEmail: companyEmail,
      CompanyPhone: companyPhone,
      PaymentLink: branding.paymentLink,
      BankName: branding.bankName,
      BankAccountName: branding.bankAccountName,
      BankAccountNumber: branding.bankAccountNumber,
      IFSCOrSWIFT: branding.ifscOrSwift,
      UPIId: branding.upiId,
      TotalReceivables: totalFormatted,
    };

    const subject = fillPlaceholders(template.subject, vars);
    const bodyHtml = buildEmailHtml(sections, vars, {
      invoiceTableHtml: buildInvoiceTableHtml(items, totalFormatted),
      logoUrl: branding.logoUrl || undefined,
    });

    const groupLogRows = rows.map((r) => ({
      invoice_id: r.invoiceId,
      to_email: r.customerEmail,
      subject,
      body: bodyHtml,
      status: "sent",
    }));

    const { error: insertError } = await supabase.from("reminder_log").insert(groupLogRows);
    if (insertError) {
      failed += groupLogRows.length;
      failureReasons.push(`${first.customerName}: ${insertError.message}`);
    } else {
      sent += groupLogRows.length;
    }
  }

  const entry: SchedulerRunEntry = {
    runDate,
    runTime,
    totalChecked,
    sent,
    failed,
    skipped,
    failureReasons,
    manual: options.manual,
  };
  appendSchedulerLog(entry);
  markRunComplete(now);
  return entry;
}
