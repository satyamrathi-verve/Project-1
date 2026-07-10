"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";

const AUTH_KEY = "ar-manager-auth";

/*
  Hides the app until someone is "signed in" (per CLAUDE.md: front-end-only
  gate, session kept in localStorage). Owns the shell decision: /signin gets
  full-bleed control of the viewport (no sidebar before login); every other
  route gets the Nav + main shell once authed.
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
  if (!ready || !authed) return null;

  return (
    <div className="flex h-screen">
      <Nav />
      <main className="flex-1 overflow-y-auto bg-canvas p-8">{children}</main>
    </div>
  );
}
