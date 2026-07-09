/*
  Small shared formatting helpers used across the invoice screens.
  Keep display consistent everywhere (numbers, dates, status colours).
*/

// Amount with Indian-style grouping and 2 decimals — no currency symbol.
// e.g. 1146000 -> "11,46,000.00"
export function money(n: number | null | undefined): string {
  const value = typeof n === "number" ? n : 0;
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// A yyyy-mm-dd string -> "06 Jul 2026"
export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Overdue = still owing (open/partial) and past its due date, or already flagged overdue.
export function isOverdue(status: string, dueDate: string | null): boolean {
  if (status === "overdue") return true;
  if (status !== "open" && status !== "partial") return false;
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate) < today;
}

// Whole days a due date is past (0 if not past / missing).
export function daysLate(dueDate: string | null): number {
  if (!dueDate) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - due.getTime()) / 86400000);
  return diff > 0 ? diff : 0;
}

// Tailwind classes for a coloured status pill.
export function statusPill(status: string): string {
  switch (status) {
    case "paid":
      return "bg-green-100 text-green-700";
    case "overdue":
      return "bg-red-100 text-red-700";
    case "partial":
      return "bg-amber-100 text-amber-700";
    default: // open
      return "bg-slate-100 text-slate-600";
  }
}
