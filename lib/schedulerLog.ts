/* No table exists for scheduler run history either — kept in localStorage, capped to the most recent runs. */

const KEY = "ar-manager-scheduler-log";
const MAX_ENTRIES = 30;

export interface SchedulerRunEntry {
  runDate: string; // display-formatted date
  runTime: string; // display-formatted time
  totalChecked: number;
  sent: number;
  failed: number;
  skipped: number;
  failureReasons: string[];
  manual: boolean;
}

export function getSchedulerLog(): SchedulerRunEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function appendSchedulerLog(entry: SchedulerRunEntry) {
  if (typeof window === "undefined") return;
  const existing = getSchedulerLog();
  const next = [entry, ...existing].slice(0, MAX_ENTRIES);
  window.localStorage.setItem(KEY, JSON.stringify(next));
}
