"use client";

const PAGE_SIZES = [10, 25, 50];

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <div className="flex items-center gap-2">
        <span>
          {from}–{to} of {total}
        </span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-line px-3 py-1 text-ink hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Prev
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-lg border border-line px-3 py-1 text-ink hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Next
        </button>
      </div>
    </div>
  );
}
