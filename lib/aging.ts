export type AgingBucket = "Not Due" | "0-30" | "31-60" | "61-90" | "91-120" | "Above 120";

export const AGING_BUCKETS: AgingBucket[] = ["Not Due", "0-30", "31-60", "61-90", "91-120", "Above 120"];

/** Days overdue = today - due_date. Negative/zero means not yet due. */
export function daysOverdue(dueDate: string, today: Date = new Date()): number {
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.floor((start.getTime() - due.getTime()) / 86400000);
}

export function agingBucket(days: number): AgingBucket {
  if (days <= 0) return "Not Due";
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  if (days <= 120) return "91-120";
  return "Above 120";
}
