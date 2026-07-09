"use client";

import { useEffect, useRef } from "react";
import { isConfigured } from "@/lib/supabase";
import { getSchedulerSettings, isDueToRun } from "@/lib/schedulerSettings";
import { runScheduledCheck } from "@/lib/reminderScheduler";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/*
  Renders nothing. This is the "automatic" half of the scheduler — there's no real
  always-on server process in this app (no deploy step, browser-only Supabase access), so
  this checks once on mount and every few minutes after: if today's configured time has
  passed and today's run hasn't happened yet, it runs. Only fires while some browser tab
  has the app open — not a true background job. See app/auto-email-shoot/scheduler for the
  manual "Run Scheduler Now" path and an explanation of this limitation.
*/
export function ReminderSchedulerRunner() {
  const runningRef = useRef(false);

  useEffect(() => {
    if (!isConfigured) return;

    async function checkAndRun() {
      if (runningRef.current) return;
      const settings = getSchedulerSettings();
      if (!isDueToRun(settings)) return;
      runningRef.current = true;
      try {
        await runScheduledCheck({ manual: false });
      } finally {
        runningRef.current = false;
      }
    }

    void checkAndRun();
    const interval = setInterval(checkAndRun, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return null;
}
