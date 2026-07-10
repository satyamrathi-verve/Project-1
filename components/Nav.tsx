"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, LogOut } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { OPEN_EVENT } from "./CommandPalette";

const AUTH_KEY = "ar-manager-auth";

/*
  Left sidebar. Each unbuilt screen shows a "build me" tag. When a screen is
  finished, flip its `built` to true (and point `href` at the created route).
  Below the md breakpoint this becomes an off-canvas drawer (see mobile FAB)
  so it doesn't crush the page content on phones.
*/
const LINKS: { href: string; label: string; built: boolean }[] = [
  { href: "/", label: "Home", built: true },
  { href: "/signin", label: "Sign In", built: true },
  { href: "/masters/customers", label: "Customer Master", built: true },
  { href: "/masters/gl", label: "GL Master", built: true },
  { href: "/invoices", label: "Sales Invoices", built: true },
  { href: "/receipts", label: "Receipt Entry", built: true },
  { href: "/upload", label: "Upload Report", built: true },
  { href: "/auto-email-shoot/template", label: "Reminder Template", built: true },
  { href: "/auto-email-shoot", label: "Auto Email Shoot", built: true },
  { href: "/reports/statement", label: "Customer Statement", built: true },
  { href: "/reports/ageing", label: "AR Ageing", built: true },
  { href: "/cashflow", label: "Cashflow Projection", built: true },
  { href: "/dashboard", label: "Dashboard", built: true },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Close the drawer whenever the route changes (link click, back/forward, etc.).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function handleSignOut() {
    localStorage.removeItem(AUTH_KEY);
    router.push("/signin");
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        className="fixed bottom-4 left-4 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-brand text-brandink shadow-lg md:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}

      <nav
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-60 flex-col gap-1 overflow-y-auto border-r border-line bg-surface p-4 transition-transform duration-200 md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          onClick={() => setOpen(false)}
          aria-label="Close navigation menu"
          className="absolute right-2 top-2 rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-ink md:hidden"
        >
          ✕
        </button>
        <div className="mb-4 px-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">Verve</p>
          <h1 className="font-display text-xl font-bold text-ink">AR Manager</h1>
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
          className="mb-3 flex items-center justify-between rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-faint hover:border-brand hover:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
        >
          <span className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5" />
            Search…
          </span>
          <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium">Ctrl K</kbd>
        </button>
        <div className="flex-1">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            if (!l.built) {
              return (
                <span key={l.href} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-faint">
                  {l.label}
                  <span className="rounded bg-surface2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">build me</span>
                </span>
              );
            }
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand ${
                  active ? "bg-brand text-brandink" : "text-muted hover:bg-surface2 hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
        <div className="mt-2">
          <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Appearance</p>
          <ThemeToggle />
        </div>
        <button
          onClick={handleSignOut}
          className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted hover:bg-surface2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </nav>
    </>
  );
}
