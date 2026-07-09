"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";

const AUTH_KEY = "ar-manager-auth";

/*
  Left sidebar. Each unbuilt screen shows a "build me" tag. When a screen is
  finished, flip its `built` to true (and point `href` at the created route).
*/
const LINKS: { href: string; label: string; built: boolean }[] = [
  { href: "/", label: "Home", built: true },
  { href: "/signin", label: "Sign In", built: true },
  { href: "/masters/customers", label: "Customer Master", built: true },
  { href: "/masters/gl", label: "GL Master", built: true },
  { href: "/invoices", label: "Sales Invoices", built: true },
  { href: "/receipts", label: "Receipt Entry", built: true },
  { href: "/upload", label: "Upload Report", built: false },
  { href: "/reminders", label: "AR Followup", built: true },
  { href: "/reports/statement", label: "Customer Statement", built: false },
  { href: "/reports/ageing", label: "AR Ageing", built: true },
  { href: "/cashflow", label: "Cashflow Projection", built: true },
  { href: "/dashboard", label: "Dashboard", built: true },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  function handleSignOut() {
    localStorage.removeItem(AUTH_KEY);
    router.push("/signin");
  }

  return (
    <nav className="flex h-full w-60 flex-col gap-1 border-r border-line bg-surface p-4">
      <div className="mb-4 px-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">Verve</p>
        <h1 className="font-display text-xl font-bold text-ink">AR Manager</h1>
      </div>
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
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
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
        className="mt-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted hover:bg-surface2 hover:text-ink"
      >
        Sign out
      </button>
    </nav>
  );
}
