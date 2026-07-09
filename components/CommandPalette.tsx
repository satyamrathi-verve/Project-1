"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
  { href: "/reports/statement", label: "Customer Statement" },
  { href: "/reports/ageing", label: "AR Ageing" },
  { href: "/cashflow", label: "Cashflow Projection" },
  { href: "/dashboard", label: "Dashboard" },
];

/** Global Ctrl/Cmd+K jump-to-screen palette. Mounted once in app/layout.tsx. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const filtered = ROUTES.filter((r) => r.label.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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

  function go(href: string) {
    setOpen(false);
    router.push(href);
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
          placeholder="Jump to a screen…"
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
              go(filtered[activeIndex].href);
            }
          }}
        />
        <ul role="listbox" aria-label="Screens" className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-faint">No screens match &quot;{query}&quot;</li>
          ) : (
            filtered.map((r, i) => (
              <li key={r.href} role="option" aria-selected={i === activeIndex}>
                <button
                  onClick={() => go(r.href)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                    i === activeIndex ? "bg-brand text-brandink" : "text-ink hover:bg-surface2"
                  }`}
                >
                  {r.label}
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
