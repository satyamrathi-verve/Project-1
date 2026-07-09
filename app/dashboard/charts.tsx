"use client";

import { useEffect, useState, type ReactNode } from "react";
import { money } from "@/lib/format";

/* Card shell for every widget. */
export function Card({ title, subtitle, children, right }: { title: string; subtitle?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="themed-surface flex h-full flex-col rounded-xl border border-line bg-surface p-5">
      <div className="mb-1 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {right}
      </div>
      {subtitle && <p className="mb-4 text-xs text-muted">{subtitle}</p>}
      <div className="flex-1">{children}</div>
    </div>
  );
}

/* Count-up number. */
export function useCountUp(target: number, run: boolean, ms = 1000) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setVal(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return val;
}

export function KpiTile({ label, target, sub, accent, format, run, size = "lg" }: {
  label: string; target: number; sub: string; accent: string; format: (n: number) => string; run: boolean;
  /** "sm" for dense rows (5+ tiles) where a text-3xl figure would overflow the column. */
  size?: "lg" | "sm";
}) {
  const v = useCountUp(target, run);
  const valueSize = size === "sm" ? "text-2xl" : "text-3xl";
  return (
    <div className="themed-surface min-w-0 rounded-xl border border-line bg-surface p-5 transition-shadow hover:shadow-md">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-2 min-w-0 font-display ${valueSize} font-bold tabular-nums ${accent}`}>{format(v)}</p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  );
}

/* Vertical bars with gridlines, gradient fills, staggered grow + hover. */
export function VBars({ bars, run, fmt = money }: { bars: { label: string; value: number; color: string }[]; run: boolean; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="relative h-56">
      {[0, 25, 50, 75, 100].map((g) => (
        <div key={g} className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${g + 6}%` }} />
      ))}
      {/* plot area: leave room at top for value labels, bottom for x labels */}
      <div className="absolute inset-x-0 bottom-6 top-5 flex items-end justify-between gap-3">
        {bars.map((b, i) => (
          <div key={b.label} className="group relative flex h-full flex-1 items-end justify-center" title={`${b.label}: ${fmt(b.value)}`}>
            <div
              className="relative w-full rounded-t-md shadow-sm transition-[height,filter] duration-700 ease-out group-hover:brightness-110"
              style={{ height: run ? `${(b.value / max) * 100}%` : "0%", minHeight: b.value > 0 ? 4 : 0, transitionDelay: `${i * 90}ms`, backgroundImage: `linear-gradient(to top, ${b.color}, color-mix(in srgb, ${b.color} 72%, transparent))` }}
            >
              <span className="absolute inset-x-0 -top-5 text-center text-[11px] font-semibold tabular-nums text-ink opacity-80 group-hover:opacity-100">
                {b.value > 0 ? Math.round(b.value).toLocaleString("en-IN") : ""}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex justify-between gap-3">
        {bars.map((b) => (<span key={b.label} className="flex-1 text-center text-[11px] leading-tight text-muted">{b.label}</span>))}
      </div>
    </div>
  );
}

/* Grouped bars: two series per category. */
export function GroupedVBars({ categories, seriesA, seriesB, run }: {
  categories: string[]; run: boolean;
  seriesA: { name: string; color: string; values: number[] };
  seriesB: { name: string; color: string; values: number[] };
}) {
  const max = Math.max(1, ...seriesA.values, ...seriesB.values);
  return (
    <>
      <div className="mb-2 flex gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: seriesA.color }} />{seriesA.name}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: seriesB.color }} />{seriesB.name}</span>
      </div>
      <div className="relative h-48">
        {[0, 25, 50, 75, 100].map((g) => (<div key={g} className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${g * 0.86 + 12}%` }} />))}
        <div className="absolute inset-x-0 bottom-6 top-1 flex items-end justify-between gap-4">
          {categories.map((cat, i) => (
            <div key={i} className="flex h-full flex-1 items-end justify-center gap-1">
              {[seriesA, seriesB].map((s, si) => (
                <div key={s.name} className="w-1/2 max-w-[24px] rounded-t shadow-sm transition-[height] duration-700 ease-out hover:brightness-110"
                  title={`${cat} · ${s.name}: ${money(s.values[i])}`}
                  style={{ height: run ? `${(s.values[i] / max) * 100}%` : "0%", minHeight: s.values[i] > 0 ? 3 : 0, transitionDelay: `${i * 80 + si * 40}ms`, background: s.color }} />
              ))}
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex justify-between gap-4">
          {categories.map((cat, i) => (<span key={i} className="flex-1 text-center text-[11px] text-muted">{cat}</span>))}
        </div>
      </div>
    </>
  );
}

/* Donut with draw-in animation + legend. */
export function Donut({ segments, total, run, centerLabel, valueFmt }: {
  segments: { label: string; value: number; color: string }[]; total: number; run: boolean; centerLabel?: string; valueFmt?: (n: number) => string;
}) {
  const fmtV = valueFmt ?? ((n: number) => String(n));
  let offset = 25;
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 36 36" className="h-32 w-32 -rotate-90">
        <circle cx="18" cy="18" r="15.915" fill="none" stroke="var(--surface2)" strokeWidth="3.6" />
        {segments.map((s, i) => {
          const pct = total ? (s.value / total) * 100 : 0;
          const seg = (
            <circle key={s.label} cx="18" cy="18" r="15.915" fill="none" stroke={s.color} strokeWidth="3.6"
              strokeDasharray={run ? `${pct} ${100 - pct}` : `0 100`} strokeDashoffset={offset} strokeLinecap="round"
              style={{ transition: "stroke-dasharray 900ms ease-out", transitionDelay: `${i * 150}ms` }} />
          );
          offset -= pct;
          return seg;
        })}
        <text x="18" y="18" transform="rotate(90 18 18)" textAnchor="middle" dominantBaseline="central" className="fill-ink text-[5px] font-bold">
          {centerLabel ?? total}
        </text>
      </svg>
      <ul className="space-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-muted">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="capitalize">{s.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-ink">{fmtV(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* Horizontal bars (top customers, credit utilisation). */
export function HBars({ rows, run, fmt = money }: { rows: { name: string; value: number; label?: string; danger?: boolean }[]; run: boolean; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-faint">Nothing to show. 🎉</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.name} title={`${r.name}: ${r.label ?? fmt(r.value)}`}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="truncate text-muted">{r.name}</span>
            <span className={`ml-2 shrink-0 font-semibold tabular-nums ${r.danger ? "text-red-500" : "text-ink"}`}>{r.label ?? fmt(r.value)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface2">
            <div className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{ width: run ? `${Math.min(100, (r.value / max) * 100)}%` : "0%", transitionDelay: `${i * 90}ms`, backgroundImage: r.danger ? "linear-gradient(to right,#dc2626,#b91c1c)" : "linear-gradient(to right, var(--brand), var(--brand-dark))" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* "Coming Soon" placeholder with an honest note. */
export function ComingSoon({ note }: { note: string }) {
  return (
    <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 text-center">
      <span className="rounded-full bg-surface2 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted">Coming soon</span>
      <p className="max-w-[220px] text-xs text-faint">{note}</p>
    </div>
  );
}
