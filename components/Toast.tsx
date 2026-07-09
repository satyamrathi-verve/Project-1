"use client";

import { useEffect, useState } from "react";

export interface ToastOptions {
  variant?: "success" | "error" | "info";
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

type Listener = (item: ToastItem) => void;
const listeners = new Set<Listener>();
let nextId = 1;

/** Fire a toast from anywhere: toast("Saved", { variant: "success" }). */
export function toast(message: string, options: ToastOptions = {}) {
  const item: ToastItem = { id: nextId++, message, ...options };
  listeners.forEach((l) => l(item));
}

const VARIANT_CLASSES: Record<NonNullable<ToastOptions["variant"]>, string> = {
  success: "border-green-500/30 bg-green-500/10 text-green-700",
  error: "border-red-500/30 bg-red-500/10 text-red-600",
  info: "border-line bg-surface text-ink",
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    const duration = item.duration ?? 4000;
    const timer = setTimeout(() => onDismiss(item.id), duration);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="status"
      className={`themed-surface pointer-events-auto flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg transition-all duration-200 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      } ${VARIANT_CLASSES[item.variant ?? "success"]}`}
    >
      <span>{item.message}</span>
      <div className="flex flex-none items-center gap-3">
        {item.actionLabel && item.onAction && (
          <button
            onClick={() => {
              item.onAction?.();
              onDismiss(item.id);
            }}
            className="font-semibold underline underline-offset-2 hover:no-underline"
          >
            {item.actionLabel}
          </button>
        )}
        <button onClick={() => onDismiss(item.id)} aria-label="Dismiss notification" className="text-faint hover:text-ink">
          ✕
        </button>
      </div>
    </div>
  );
}

/** Mount once near the root (see app/layout.tsx). Renders whatever toast() fires. */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: Listener = (item) => setItems((prev) => [...prev, item]);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  function dismiss(id: number) {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div aria-live="polite" aria-atomic="true" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={dismiss} />
      ))}
    </div>
  );
}
