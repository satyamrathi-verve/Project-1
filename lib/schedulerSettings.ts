/*
  No settings table exists for this (and can't be added — never alter tables), so scheduler
  configuration lives in localStorage, same pattern as Company Branding. Per-browser only.
*/

const KEY = "ar-manager-scheduler-settings";

export type ReminderFrequency = "daily" | "every2" | "every3" | "weekly" | "every15" | "monthly" | "custom";

export const FREQUENCY_OPTIONS: { value: ReminderFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "every2", label: "Every 2 Days" },
  { value: "every3", label: "Every 3 Days" },
  { value: "weekly", label: "Weekly" },
  { value: "every15", label: "Every 15 Days" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom Interval" },
];

/** "Monthly" is approximated as 30 days — true calendar-month math (Feb 28/29, etc.) is out of scope here. */
export function getIntervalDays(frequency: ReminderFrequency, customIntervalDays: number): number {
  switch (frequency) {
    case "daily":
      return 1;
    case "every2":
      return 2;
    case "every3":
      return 3;
    case "weekly":
      return 7;
    case "every15":
      return 15;
    case "monthly":
      return 30;
    case "custom":
      return Math.max(1, customIntervalDays || 1);
  }
}

export interface SchedulerSettings {
  enabled: boolean;
  dailyTime: string; // "HH:MM", 24h
  timeZone: string; // IANA zone name, informational — the browser's own clock is what's actually used
  frequency: ReminderFrequency;
  customIntervalDays: number; // only used when frequency === "custom"
  maxRemindersPerInvoice: number | null; // null = unlimited
  skipWeekends: boolean;
  skipHolidays: boolean;
  lastRunDate: string | null; // "YYYY-MM-DD" — prevents running twice in the same day
}

export const DEFAULT_SETTINGS: SchedulerSettings = {
  enabled: false,
  dailyTime: "09:00",
  timeZone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "Asia/Kolkata",
  frequency: "daily",
  customIntervalDays: 5,
  maxRemindersPerInvoice: null,
  skipWeekends: false,
  skipHolidays: false,
  lastRunDate: null,
};

/* Demo-only fixed list — no holiday calendar API exists to check against. */
export const DEMO_HOLIDAYS_2026 = [
  "2026-01-26", // Republic Day
  "2026-08-15", // Independence Day
  "2026-10-02", // Gandhi Jayanti
  "2026-12-25", // Christmas
];

export function getSchedulerSettings(): SchedulerSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function setSchedulerSettings(settings: SchedulerSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(settings));
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function isHoliday(date: Date): boolean {
  const iso = date.toISOString().slice(0, 10);
  return DEMO_HOLIDAYS_2026.includes(iso);
}

function todayKey(date: Date = new Date()): string {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

/** True once "now" is past today's configured time and today's run hasn't happened yet. */
export function isDueToRun(settings: SchedulerSettings, now: Date = new Date()): boolean {
  if (!settings.enabled) return false;
  if (settings.lastRunDate === todayKey(now)) return false;
  if (settings.skipWeekends && isWeekend(now)) return false;
  if (settings.skipHolidays && isHoliday(now)) return false;

  const [hours, minutes] = settings.dailyTime.split(":").map(Number);
  const scheduledToday = new Date(now);
  scheduledToday.setHours(hours || 0, minutes || 0, 0, 0);
  return now.getTime() >= scheduledToday.getTime();
}

export function nextScheduledRun(settings: SchedulerSettings, now: Date = new Date()): Date {
  const [hours, minutes] = settings.dailyTime.split(":").map(Number);
  const next = new Date(now);
  next.setHours(hours || 0, minutes || 0, 0, 0);
  if (next.getTime() <= now.getTime() || settings.lastRunDate === todayKey(now)) {
    next.setDate(next.getDate() + 1);
  }
  while (
    (settings.skipWeekends && isWeekend(next)) ||
    (settings.skipHolidays && isHoliday(next))
  ) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

export function markRunComplete(now: Date = new Date()) {
  const settings = getSchedulerSettings();
  setSchedulerSettings({ ...settings, lastRunDate: todayKey(now) });
}
