"use client";

import { useEffect, useState } from "react";

type Mode = "normal" | "dark" | "bluish";
const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: "normal", label: "Light", icon: "☀" },
  { id: "dark", label: "Dark", icon: "☾" },
  { id: "bluish", label: "Blue", icon: "◑" },
];

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("normal");

  useEffect(() => {
    const saved = (localStorage.getItem("ar-theme") as Mode) || "normal";
    setMode(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);

  const pick = (m: Mode) => {
    setMode(m);
    document.documentElement.setAttribute("data-theme", m);
    try { localStorage.setItem("ar-theme", m); } catch { /* ignore */ }
  };

  return (
    <div className="flex gap-1 rounded-lg border border-line bg-surface2 p-1">
      {MODES.map((m) => (
        <button
          key={m.id}
          onClick={() => pick(m.id)}
          title={m.label}
          aria-pressed={mode === m.id}
          className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            mode === m.id ? "bg-brand text-brandink" : "text-muted hover:text-ink"
          }`}
        >
          <span aria-hidden="true">{m.icon}</span>
        </button>
      ))}
    </div>
  );
}
