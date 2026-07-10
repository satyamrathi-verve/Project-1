"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, BookPlus, LogOut, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getRecent } from "@/lib/recent";

const AUTH_KEY = "ar-manager-auth";
export const OPEN_EVENT = "ar:open-command-palette";

// Kept as its own small list (rather than importing Nav's) so this file never
// conflicts with edits to the sidebar — worth the minor duplication.
const ROUTES = [
  { href: "/", label: "Home" },
  { href: "/signin", label: "Sign In" },
  { href: "/masters/customers", label: "Customer Master" },
  { href: "/masters/gl", label: "GL Master" },
  { href: "/invoices", label: "Sales Invoices" },
  { href: "/receipts", label: "Receipt Entry" },
  { href: "/upload", label: "Upload Report" },
  { href: "/auto-email-shoot", label: "Auto Email Shoot" },
  { href: "/auto-email-shoot/template", label: "Auto Email Shoot Template" },
  { href: "/auto-email-shoot/scheduler", label: "Automatic Reminder Scheduler" },
  { href: "/auto-email-shoot/history", label: "Reminder History" },
  { href: "/reports/statement", label: "Customer Statement" },
  { href: "/reports/ageing", label: "AR Ageing" },
  { href: "/cashflow", label: "Cashflow Projection" },
  { href: "/dashboard", label: "Dashboard" },
];

interface PaletteItem {
  href: string;
  label: string;
  sublabel?: string;
  tag: "Screen" | "Action" | "Recent" | "Customer" | "GL Account";
  icon?: React.ReactNode;
}

const QUICK_ACTIONS: PaletteItem[] = [
  { href: "/masters/customers?new=1", label: "Add Customer", tag: "Action", icon: <UserPlus className="h-3.5 w-3.5" /> },
  { href: "/masters/gl?new=1", label: "Add GL Account", tag: "Action", icon: <BookPlus className="h-3.5 w-3.5" /> },
  { href: "__signout__", label: "Sign out", tag: "Action", icon: <LogOut className="h-3.5 w-3.5" /> },
];

/**
 * Global Ctrl/Cmd+K jump-to-screen palette. Mounted once in app/layout.tsx.
 * Also runs quick actions and a live Supabase search across customers & GL
 * accounts once you've typed 2+ characters.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [dbResults, setDbResults] = useState<PaletteItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const staticItems: PaletteItem[] = useMemo(() => {
    const recentItems: PaletteItem[] = getRecent().map((r) => ({
      href: r.kind === "customer" ? `/masters/customers?edit=${r.id}` : `/masters/gl?edit=${r.id}`,
      label: r.label,
      sublabel: r.code,
      tag: "Recent",
      icon: <Clock className="h-3.5 w-3.5" />,
    }));
    const routeItems: PaletteItem[] = ROUTES.map((r) => ({ href: r.href, label: r.label, tag: "Screen" }));
    return [...recentItems, ...QUICK_ACTIONS, ...routeItems];
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? staticItems.filter((i) => i.label.toLowerCase().includes(q)) : staticItems;
    return [...base, ...dbResults];
  }, [query, staticItems, dbResults]);

  // Live search against Supabase for customers + GL accounts, debounced.
  useEffect(() => {
    if (!open || !supabase || query.trim().length < 2) {
      setDbResults([]);
      return;
    }
    const q = query.trim();
    const handle = window.setTimeout(async () => {
      const [{ data: customers }, { data: accounts }] = await Promise.all([
        supabase!.from("customers").select("id, code, name").or(`name.ilike.%${q}%,code.ilike.%${q}%`).limit(5),
        supabase!.from("gl_accounts").select("id, code, name").or(`name.ilike.%${q}%,code.ilike.%${q}%`).limit(5),
      ]);
      setDbResults([
        ...((customers ?? []) as { id: string; code: string; name: string }[]).map((c) => ({
          href: `/masters/customers?edit=${c.id}`,
          label: c.name,
          sublabel: c.code,
          tag: "Customer" as const,
          icon: <UserPlus className="h-3.5 w-3.5" />,
        })),
        ...((accounts ?? []) as { id: string; code: string; name: string }[]).map((a) => ({
          href: `/masters/gl?edit=${a.id}`,
          label: a.name,
          sublabel: a.code,
          tag: "GL Account" as const,
          icon: <BookPlus className="h-3.5 w-3.5" />,
        })),
      ]);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [open, query]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function go(item: PaletteItem) {
    setOpen(false);
    if (item.href === "__signout__") {
      window.localStorage.removeItem(AUTH_KEY);
      router.push("/signin");
      return;
    }
    router.push(item.href);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="themed-surface w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to a screen, or search customers & GL accounts…"
          aria-label="Jump to a screen"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-faint"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && filtered[activeIndex]) {
              go(filtered[activeIndex]);
            }
          }}
        />
        <ul role="listbox" aria-label="Screens and records" className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-faint">No matches for &quot;{query}&quot;</li>
          ) : (
            filtered.map((item, i) => (
              <li key={`${item.tag}-${item.href}-${item.label}`} role="option" aria-selected={i === activeIndex}>
                <button
                  onClick={() => go(item)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                    i === activeIndex ? "bg-brand text-brandink" : "text-ink hover:bg-surface2"
                  }`}
                >
                  {item.icon && <span className={i === activeIndex ? "text-brandink" : "text-faint"}>{item.icon}</span>}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.sublabel && (
                    <span className={`text-xs ${i === activeIndex ? "text-brandink/80" : "text-faint"}`}>{item.sublabel}</span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      i === activeIndex ? "bg-white/20 text-brandink" : "bg-surface2 text-faint"
                    }`}
                  >
                    {item.tag}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-faint">
          <span>↑↓ to navigate · Enter to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
