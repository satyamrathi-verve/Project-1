export type ReminderCountBucket = "1 Time" | "2 Times" | "3 Times" | "4 Times" | "5+ Times";

export const REMINDER_COUNT_BUCKETS: ReminderCountBucket[] = [
  "1 Time",
  "2 Times",
  "3 Times",
  "4 Times",
  "5+ Times",
];

export function reminderCountBucket(count: number): ReminderCountBucket {
  if (count <= 1) return "1 Time";
  if (count === 2) return "2 Times";
  if (count === 3) return "3 Times";
  if (count === 4) return "4 Times";
  return "5+ Times";
}
