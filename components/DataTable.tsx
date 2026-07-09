import { Fragment, useEffect, useId, useRef, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  /** Optional custom cell; defaults to String(row[key]). */
  render?: (row: T) => ReactNode;
  className?: string;
  /** Set to make this column's header clickable for sorting (requires sortKey/onSort on DataTable). */
  sortable?: boolean;
  /** Renders instead of `header` text — e.g. a select-all checkbox in a header cell. */
  headerContent?: ReactNode;
}

/*
  A plain, reusable table. Copy this pattern for every list screen (invoices,
  receipts, GL accounts…). Pass your columns and rows; it handles the empty state.
  Pass sortKey/sortDir/onSort to make `sortable` columns clickable.
*/
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty = "Nothing here yet.",
  rowClassName,
  footer,
  expandedRowId,
  renderExpanded,
  onRowClick,
  caption,
  sortKey,
  sortDir,
  onSort,
  loading = false,
  skeletonRows = 6,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  /** Optional extra classes per row (e.g. red for overdue). */
  rowClassName?: (row: T) => string;
  /** Optional <tr> rendered after the body, e.g. a grand-total row. */
  footer?: ReactNode;
  /** id of the row currently expanded, if any. */
  expandedRowId?: string | null;
  /** Content shown in a full-width row under an expanded row. */
  renderExpanded?: (row: T) => ReactNode;
  /** Optional click handler for a whole row (e.g. open the detail screen, or toggle expansion). */
  onRowClick?: (row: T) => void;
  /** Visually-hidden table description for screen readers. */
  caption?: string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
  /** Shows animated placeholder rows instead of `rows` while data is still loading. */
  loading?: boolean;
  /** How many placeholder rows to show while `loading`. */
  skeletonRows?: number;
}) {
  const tableId = useId();
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const focusedRowId = useRef<string | null>(null);
  const prevExpandedRowId = useRef<string | null>(expandedRowId ?? null);

  // If the row whose expanded content had focus just collapsed (or a
  // different row expanded instead), that focused input is now gone from the
  // DOM. Bring focus back to the trigger row instead of losing it to <body>.
  useEffect(() => {
    const prev = prevExpandedRowId.current;
    if (prev && prev !== expandedRowId && focusedRowId.current === prev) {
      rowRefs.current[prev]?.focus();
    }
    prevExpandedRowId.current = expandedRowId ?? null;
  }, [expandedRowId]);

  return (
    <div className="themed-surface overflow-x-auto overflow-y-hidden rounded-xl border border-line bg-surface">
      <table className="w-full text-sm" aria-busy={loading || undefined}>
        {(caption || loading) && (
          <caption className="sr-only" role={loading ? "status" : undefined}>
            {loading ? "Loading…" : caption}
          </caption>
        )}
        <thead>
          <tr className="border-b border-line bg-surface2 text-left">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                onClick={c.sortable && onSort ? () => onSort(c.key) : undefined}
                className={`sticky top-0 z-10 bg-surface2 px-4 py-3 font-semibold text-muted ${c.className ?? ""} ${
                  c.sortable && onSort ? "cursor-pointer select-none whitespace-nowrap hover:text-ink" : ""
                }`}
              >
                {c.headerContent ?? c.header}
                {c.sortable && sortKey === c.key && <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody
          onFocus={(e) => {
            const el = (e.target as HTMLElement).closest("[data-row-id]");
            focusedRowId.current = el?.getAttribute("data-row-id") ?? null;
          }}
        >
          {loading ? (
            Array.from({ length: skeletonRows }).map((_, i) => (
              <tr key={`skeleton-${i}`} className="border-b border-line last:border-0" aria-hidden="true">
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 ${c.className ?? ""}`}>
                    <div
                      className="h-4 animate-pulse rounded bg-surface2 motion-reduce:animate-none"
                      style={{ width: `${55 + ((i * 13 + c.key.length * 7) % 35)}%` }}
                    />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-faint">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const isExpandedRow = expandedRowId === row.id;
              const panelId = `${tableId}-panel-${row.id}`;
              return (
                <Fragment key={row.id}>
                  <tr
                    ref={(el) => {
                      rowRefs.current[row.id] = el;
                    }}
                    data-row-id={row.id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                    role={onRowClick ? "button" : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-expanded={renderExpanded ? isExpandedRow : undefined}
                    aria-controls={renderExpanded ? panelId : undefined}
                    className={`border-b border-line last:border-0 hover:bg-surface2 ${
                      onRowClick ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand" : ""
                    } ${rowClassName ? rowClassName(row) : ""}`}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={`px-4 py-3 align-middle text-ink ${c.className ?? ""}`}>
                        {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                  {renderExpanded && isExpandedRow && (
                    <tr id={panelId} data-row-id={row.id} className="border-b border-line bg-surface2/60 last:border-0">
                      <td colSpan={columns.length} className="px-4 py-4">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}
