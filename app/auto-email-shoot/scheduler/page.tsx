"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isConfigured, supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import {
  DEFAULT_SETTINGS,
  FREQUENCY_OPTIONS,
  getSchedulerSettings,
  nextScheduledRun,
  setSchedulerSettings,
  type ReminderFrequency,
  type SchedulerSettings,
} from "@/lib/schedulerSettings";
import { getSchedulerLog, type SchedulerRunEntry } from "@/lib/schedulerLog";
import { countPendingReminders, runScheduledCheck } from "@/lib/reminderScheduler";
import type { Invoice, ReceiptAllocation } from "@/lib/types";

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

interface LogRow extends SchedulerRunEntry {
  id: string;
}

export default function SchedulerSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [settings, setSettings] = useState<SchedulerSettings>(DEFAULT_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

  const [log, setLog] = useState<LogRow[]>([]);
  const [running, setRunning] = useState(false);

  const [totalOverdue, setTotalOverdue] = useState(0);
  const [totalReceivables, setTotalReceivables] = useState(0);
  const [sentToday, setSentToday] = useState(0);
  const [failedToday, setFailedToday] = useState(0);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    setSettings(getSchedulerSettings());
    void loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    setError(null);

    const [invoicesRes, allocationsRes, logsRes] = await Promise.all([
      supabase!.from("invoices").select("*").neq("status", "paid"),
      supabase!.from("receipt_allocations").select("*"),
      supabase!.from("reminder_log").select("*"),
    ]);

    if (invoicesRes.error || allocationsRes.error || logsRes.error) {
      setError(invoicesRes.error?.message || allocationsRes.error?.message || logsRes.error?.message || "Failed to load dashboard.");
      setLoading(false);
      return;
    }

    const invoices = (invoicesRes.data ?? []) as Invoice[];
    const allocations = (allocationsRes.data ?? []) as ReceiptAllocation[];
    const allocatedByInvoice = new Map<string, number>();
    allocations.forEach((a) => allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + a.amount));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let overdueCount = 0;
    let overdueTotal = 0;
    invoices.forEach((inv) => {
      const outstanding = inv.total - (allocatedByInvoice.get(inv.id) ?? 0);
      if (outstanding <= 0.005) return;
      const dueDate = new Date(inv.due_date);
      dueDate.setHours(0, 0, 0, 0);
      if (dueDate.getTime() < today.getTime()) {
        overdueCount++;
        overdueTotal += outstanding;
      }
    });
    setTotalOverdue(overdueCount);
    setTotalReceivables(overdueTotal);

    const logs = (logsRes.data ?? []) as { sent_at: string; status: string }[];
    const todayStr = new Date().toDateString();
    setSentToday(logs.filter((l) => new Date(l.sent_at).toDateString() === todayStr && l.status === "sent").length);
    setFailedToday(logs.filter((l) => new Date(l.sent_at).toDateString() === todayStr && l.status === "failed").length);

    setPending(await countPendingReminders());
    setLog(getSchedulerLog().map((entry, i) => ({ ...entry, id: `${entry.runDate}-${entry.runTime}-${i}` })));
    setLoading(false);
  }

  async function handleSaveSettings() {
    setSavingSettings(true);
    setSchedulerSettings(settings);
    setSettingsMessage("Settings saved.");
    setSavingSettings(false);
    await loadDashboard();
  }

  async function handleRunNow() {
    setRunning(true);
    setSettingsMessage(null);
    await runScheduledCheck({ manual: true });
    setSettings(getSchedulerSettings());
    await loadDashboard();
    setRunning(false);
  }

  const logColumns: Column<LogRow>[] = [
    { key: "runDate", header: "Run Date" },
    { key: "runTime", header: "Run Time" },
    {
      key: "manual",
      header: "Trigger",
      render: (row) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            row.manual ? "bg-slate-100 text-slate-600" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {row.manual ? "Manual" : "Automatic"}
        </span>
      ),
    },
    { key: "totalChecked", header: "Checked", className: "text-right", render: (r) => r.totalChecked },
    { key: "sent", header: "Sent", className: "text-right", render: (r) => r.sent },
    { key: "failed", header: "Failed", className: "text-right", render: (r) => r.failed },
    { key: "skipped", header: "Skipped", className: "text-right", render: (r) => r.skipped },
    {
      key: "failureReasons",
      header: "Failure Reason",
      render: (r) => (r.failureReasons.length > 0 ? r.failureReasons.join("; ") : "—"),
    },
  ];

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Automatic Reminder Scheduler" />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Automatic Reminder Scheduler"
        subtitle="Checks overdue invoices and sends reminders using the Auto Email Shoot template."
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/auto-email-shoot"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Back to Auto Email Shoot
            </Link>
            <button
              onClick={handleRunNow}
              disabled={running}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Running…" : "Run Scheduler Now"}
            </button>
          </div>
        }
      />

      <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        This app has no always-on server, so &quot;automatic&quot; means: while a browser tab has this app open, it checks
        every few minutes whether today&apos;s scheduled time has passed and runs then. It will not run if nobody has the
        app open — use <span className="font-medium">Run Scheduler Now</span> to trigger it on demand.
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryCard label="Total Overdue Invoices" value={totalOverdue} />
            <SummaryCard label="Sent Today" value={sentToday} />
            <SummaryCard label="Failed Today" value={failedToday} />
            <SummaryCard label="Pending" value={pending} />
            <SummaryCard label="Total Outstanding Receivables" value={money(totalReceivables)} />
            <SummaryCard
              label="Next Scheduled Run"
              value={settings.enabled ? nextScheduledRun(settings).toLocaleString() : "Disabled"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Configuration</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(e) => setSettings((p) => ({ ...p, enabled: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                  />
                  Enable automatic reminders
                </label>

                <FormField label="Reminder frequency">
                  <select
                    className={inputClass}
                    value={settings.frequency}
                    onChange={(e) => setSettings((p) => ({ ...p, frequency: e.target.value as ReminderFrequency }))}
                  >
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </FormField>

                {settings.frequency === "custom" && (
                  <FormField label="Custom interval (days between reminders)">
                    <input
                      type="number"
                      min={1}
                      value={settings.customIntervalDays}
                      onChange={(e) => setSettings((p) => ({ ...p, customIntervalDays: Math.max(1, Number(e.target.value) || 1) }))}
                      className={inputClass}
                    />
                  </FormField>
                )}
                <p className="-mt-2 text-xs text-slate-400">
                  The first reminder always fires the day after an invoice becomes overdue. This sets the gap between
                  every reminder after that.
                </p>

                <FormField label="Daily execution time">
                  <input
                    type="time"
                    value={settings.dailyTime}
                    onChange={(e) => setSettings((p) => ({ ...p, dailyTime: e.target.value }))}
                    className={inputClass}
                  />
                </FormField>

                <FormField label="Time zone">
                  <input type="text" value={settings.timeZone} disabled className={`${inputClass} bg-slate-50 text-slate-400`} />
                </FormField>
                <p className="-mt-2 text-xs text-slate-400">
                  Informational only — the check runs against this browser&apos;s own clock.
                </p>

                <FormField label="Max reminders per invoice (blank = unlimited)">
                  <input
                    type="number"
                    min={1}
                    value={settings.maxRemindersPerInvoice ?? ""}
                    onChange={(e) =>
                      setSettings((p) => ({
                        ...p,
                        maxRemindersPerInvoice: e.target.value === "" ? null : Math.max(1, Number(e.target.value)),
                      }))
                    }
                    className={inputClass}
                  />
                </FormField>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={settings.skipWeekends}
                    onChange={(e) => setSettings((p) => ({ ...p, skipWeekends: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                  />
                  Skip weekends
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={settings.skipHolidays}
                    onChange={(e) => setSettings((p) => ({ ...p, skipHolidays: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                  />
                  Skip public holidays
                </label>
                <p className="text-xs text-slate-400">Uses a small fixed demo holiday list — not a live holiday calendar.</p>

                <button
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingSettings ? "Saving…" : "Save Settings"}
                </button>
                {settingsMessage && <p className="text-xs text-emerald-600">{settingsMessage}</p>}
                <p className="text-xs text-slate-400">
                  Settings are saved in this browser only — not shared across your team&apos;s devices.
                </p>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Execution Log</h3>
              <DataTable columns={logColumns} rows={log} empty="No scheduler runs yet." />
            </div>
          </div>
        </>
      )}
    </>
  );
}
