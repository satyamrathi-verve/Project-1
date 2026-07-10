"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/*
  A right-hand slide-over panel for add/edit forms — the Stripe/Linear pattern.
  Keeps the underlying table visible instead of a form pushing content down.
  Same focus-trap/Escape/restore-focus contract as Modal, adapted for a
  right-aligned full-height panel (Modal's wrapper centers its dialog, which
  doesn't fit this layout, so this stays a sibling rather than wrapping Modal).
*/
export function SlideOver({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusable = panel?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    (focusable?.[0] ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      triggerRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onMouseDown={onClose} role="presentation" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="slideover-title"
        tabIndex={-1}
        className="themed-surface relative flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl"
        style={{ animation: "slideIn 0.2s ease-out" }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <h2 id="slideover-title" className="font-display text-lg font-semibold text-ink">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="flex-none rounded-lg p-1.5 text-faint hover:bg-surface2 hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
