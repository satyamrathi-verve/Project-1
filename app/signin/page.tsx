"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, User, ArrowRight, TrendingUp, Clock, PieChart } from "lucide-react";
import { toast } from "@/components/Toast";

/*
  Front-end-only login gate — no real auth backend, per CLAUDE.md. Checks the
  typed username/password against a small built-in demo list, then remembers
  the session in localStorage (read by AuthGate) so a refresh stays signed in.
*/

const DEMO_USERS = [
  { username: "admin", password: "admin123", display: "Admin" },
  { username: "finance", password: "finance123", display: "Finance" },
];

const AUTH_KEY = "ar-manager-auth";

const HIGHLIGHTS = [
  { icon: TrendingUp, text: "See exactly who owes you, and how much, in one screen" },
  { icon: Clock, text: "Chase overdue customers automatically, on schedule" },
  { icon: PieChart, text: "Project next month's cash before it lands" },
];

export default function SignInPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  const canSubmit = username.trim().length > 0 && password.length > 0;

  function signInAs(u: string, p: string) {
    localStorage.setItem(AUTH_KEY, u);
    toast(`Welcome back, ${u}.`, { variant: "success" });
    router.push("/");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;

    const match = DEMO_USERS.find((u) => u.username === username.trim() && u.password === password);
    if (!match) {
      setError("Wrong username or password. Try admin / admin123.");
      toast("Sign in failed — check your username and password.", { variant: "error" });
      return;
    }
    setError(null);
    setSubmitting(true);
    // Brief, deliberate pause so the loading state is visible — this is a
    // local check with no network round-trip to wait on otherwise.
    window.setTimeout(() => signInAs(match.username, match.password), 350);
  }

  function handleDemoLogin(u: (typeof DEMO_USERS)[number]) {
    setUsername(u.username);
    setPassword(u.password);
    setError(null);
    setSubmitting(true);
    window.setTimeout(() => signInAs(u.username, u.password), 250);
  }

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      {/* Branding panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand p-10 text-brandink md:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 60% 70%, white 1px, transparent 1px)",
            backgroundSize: "40px 40px, 60px 60px",
          }}
          aria-hidden="true"
        />
        <div className="relative">
          <div className="inline-flex rounded-lg bg-white px-3 py-2 shadow-sm">
            <img src="/verve-logo.png" alt="Verve Advisory" className="h-6 w-auto" />
          </div>
        </div>
        <div className="relative">
          <h1 className="font-display text-4xl font-bold leading-tight">
            Accounts Receivable,
            <br />
            finally under control.
          </h1>
          <p className="mt-4 max-w-sm text-sm text-brandink/85">
            One place to raise invoices, record payments, chase what&apos;s overdue, and see
            cash coming in before it arrives.
          </p>
          <ul className="mt-8 flex flex-col gap-4">
            {HIGHLIGHTS.map((h) => (
              <li key={h.text} className="flex items-start gap-3 text-sm text-brandink/90">
                <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white/15">
                  <h.icon className="h-3.5 w-3.5" />
                </span>
                {h.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brandink/70">AR Manager — built by Verve, for Verve.</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-canvas p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 md:hidden">
            <img src="/verve-logo.png" alt="Verve Advisory" className="h-7 w-auto" />
          </div>

          <h2 className="font-display text-2xl font-bold text-ink">Sign in to AR Manager</h2>
          <p className="mt-1.5 text-sm text-muted">Enter your team demo login to continue.</p>

          <form onSubmit={handleSubmit} noValidate className="mt-7 flex flex-col gap-4">
            <div>
              <label htmlFor="username" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Username <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  autoFocus
                  aria-invalid={touched && username.trim().length === 0}
                  aria-describedby={error ? "signin-error" : undefined}
                  className="w-full rounded-lg border border-line bg-surface py-2.5 pl-10 pr-3 text-sm text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                />
              </div>
              {touched && username.trim().length === 0 && (
                <p className="mt-1 text-xs text-red-600">Username is required.</p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="admin123"
                  aria-invalid={touched && password.length === 0}
                  aria-describedby={error ? "signin-error" : undefined}
                  className="w-full rounded-lg border border-line bg-surface py-2.5 pl-10 pr-10 text-sm text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-ink"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {touched && password.length === 0 && <p className="mt-1 text-xs text-red-600">Password is required.</p>}
            </div>

            {error && (
              <p id="signin-error" role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-brandink hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brandink/40 border-t-brandink" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 flex items-center gap-3 text-xs text-faint">
            <div className="h-px flex-1 bg-line" />
            or continue as
            <div className="h-px flex-1 bg-line" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {DEMO_USERS.map((u) => (
              <button
                key={u.username}
                type="button"
                onClick={() => handleDemoLogin(u)}
                disabled={submitting}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:border-brand hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {u.display}
              </button>
            ))}
          </div>

          <p className="mt-6 text-center text-xs text-faint">Demo login: admin / admin123</p>
        </div>
      </div>
    </div>
  );
}
