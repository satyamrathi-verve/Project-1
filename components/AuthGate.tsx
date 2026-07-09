"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

const AUTH_KEY = "ar-manager-auth";

/*
  Hides the app until someone is "signed in" (per CLAUDE.md: front-end-only
  gate, session kept in localStorage). Wraps the whole layout; the Sign In
  page itself is always reachable.
*/
export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const user = localStorage.getItem(AUTH_KEY);
    setAuthed(Boolean(user));
    setReady(true);
    if (!user && pathname !== "/signin") {
      router.replace("/signin");
    }
  }, [pathname, router]);

  if (pathname === "/signin") return <>{children}</>;
  if (!ready) return null;
  if (!authed) return null;

  return <>{children}</>;
}
