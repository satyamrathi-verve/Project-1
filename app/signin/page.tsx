"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { inputClass, FormField } from "@/components/FormField";

/*
  Front-end-only login gate — no real auth backend, per CLAUDE.md. Checks the
  typed username/password against a small built-in demo list, then remembers
  the session in localStorage so a refresh stays signed in.
*/

const DEMO_USERS = [
  { username: "admin", password: "admin123" },
  { username: "finance", password: "finance123" },
];

export const AUTH_KEY = "ar-manager-auth";

export default function SignInPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const match = DEMO_USERS.find(
      (u) => u.username === username.trim() && u.password === password
    );
    if (!match) {
      setError("Wrong username or password. Try admin / admin123.");
      return;
    }
    localStorage.setItem(AUTH_KEY, username.trim());
    setError(null);
    router.push("/");
  }

  return (
    <div className="mx-auto max-w-sm">
      <PageHeader title="Sign in" subtitle="AR Manager — enter your team demo login." />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6">
        <FormField label="Username">
          <input
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            autoFocus
          />
        </FormField>

        <FormField label="Password">
          <input
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="admin123"
          />
        </FormField>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark"
        >
          Sign In
        </button>

        <p className="text-center text-xs text-faint">Demo login: admin / admin123</p>
      </form>
    </div>
  );
}
