import { Fragment, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  /** Optional custom cell; defaults to String(row[key]). */
  render?: (row: T) => ReactNode;
  className?: string;
}

/*
  A plain, reusable table. Copy this pattern for every list screen (invoices,
  receipts, GL accounts…). Pass your columns and rows; it handles the empty state.
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
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-4 py-3 font-semibold text-slate-600 ${c.className ?? ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-400">
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
                    className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${
                      onRowClick ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand" : ""
                    } ${rowClassName ? rowClassName(row) : ""}`}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={`px-4 py-3 text-slate-700 ${c.className ?? ""}`}>
                        {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                  {expanded && (
                    <tr className="border-b border-slate-100 bg-slate-50/60 last:border-0">
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
