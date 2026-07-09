import { Fragment, type ReactNode } from "react";

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
}) {
  return (
    <div className="themed-surface overflow-x-auto overflow-y-hidden rounded-xl border border-line bg-surface">
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line bg-surface2 text-left">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                onClick={c.sortable && onSort ? () => onSort(c.key) : undefined}
                className={`px-4 py-3 font-semibold text-muted ${c.className ?? ""} ${
                  c.sortable && onSort ? "cursor-pointer select-none whitespace-nowrap hover:text-ink" : ""
                }`}
              >
                {c.headerContent ?? c.header}
                {c.sortable && sortKey === c.key && <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-faint">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const expanded = renderExpanded && expandedRowId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr
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
                    aria-expanded={renderExpanded ? expanded : undefined}
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
                  {expanded && (
                    <tr className="border-b border-line bg-surface2/60 last:border-0">
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
