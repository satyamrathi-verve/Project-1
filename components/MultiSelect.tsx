"use client";

import { useEffect, useRef, useState } from "react";

/* A checkbox-list dropdown for filtering by one or many values. Reuse for any report filter. */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  const summary =
    selected.size === 0
      ? "All"
      : selected.size === options.length
        ? "All"
        : selected.size === 1
          ? [...selected][0]
          : `${selected.size} selected`;

  return (
    <div ref={ref} className="relative">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-44 items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand"
      >
        <span className="truncate">{summary}</span>
        <span className="ml-2 text-faint">▾</span>
      </button>
      {open && (
        <div className="absolute z-10 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-line bg-surface p-2 shadow-lg">
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="mb-1 w-full rounded px-2 py-1 text-left text-xs font-medium text-brand hover:bg-surface2"
          >
            Clear ({options.length} available)
          </button>
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-ink hover:bg-surface2">
              <input
                type="checkbox"
                checked={selected.has(opt)}
                onChange={() => toggle(opt)}
                className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
              />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
