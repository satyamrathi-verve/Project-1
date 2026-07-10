/*
  "Recently viewed" records, kept client-side only (localStorage) — there's no
  backend table for this, and CLAUDE.md says never add one. Used by the
  Command Palette and the master screens to surface quick shortcuts.
*/

export interface RecentItem {
  kind: "customer" | "gl_account";
  id: string;
  code: string;
  label: string;
}

const KEY = "ar-manager-recent";
const MAX_ITEMS = 8;

export function getRecent(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecentItem[]) : [];
  } catch {
    return [];
  }
}

export function pushRecent(item: RecentItem) {
  if (typeof window === "undefined") return;
  const existing = getRecent().filter((r) => !(r.kind === item.kind && r.id === item.id));
  const next = [item, ...existing].slice(0, MAX_ITEMS);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full/unavailable — non-critical */
  }
}
