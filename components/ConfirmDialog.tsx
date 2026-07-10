"use client";

import { useId } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/Modal";

/*
  A reusable confirm dialog for destructive actions (delete, discard…), built
  on the shared Modal primitive so it gets the same focus-trap/Escape/outside
  -click behaviour as every other dialog. Reuse instead of window.confirm().
*/
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();

  return (
    <Modal
      open={open}
      onClose={onCancel}
      titleId={titleId}
      className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 flex-none items-center justify-center rounded-full ${
            danger ? "bg-red-500/15 text-red-600" : "bg-brand/15 text-brand"
          }`}
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h2 id={titleId} className="font-display text-base font-semibold text-ink">
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted hover:bg-surface2 hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
            danger ? "bg-red-600 hover:bg-red-700" : "bg-brand hover:bg-brand-dark"
          }`}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
