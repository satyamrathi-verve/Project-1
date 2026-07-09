export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToCsv<T>(rows: T[], columns: ExportColumn<T>[], filename: string) {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.map((c) => escape(c.header)).join(","),
    ...rows.map((row) => columns.map((c) => escape(c.value(row))).join(",")),
  ];
  downloadBlob(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }), filename);
}

export async function exportToExcel<T>(rows: T[], columns: ExportColumn<T>[], filename: string) {
  const XLSX = await import("xlsx");
  const data = rows.map((row) => {
    const record: Record<string, string | number> = {};
    columns.forEach((c) => {
      record[c.header] = c.value(row);
    });
    return record;
  });
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  XLSX.writeFile(workbook, filename);
}

/** PDF uses "Rs." instead of "₹" — jsPDF's built-in fonts don't reliably render the rupee glyph. */
export async function exportToPdf<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  filename: string,
  title: string
) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(title, 14, 15);
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 21);

  autoTable(doc, {
    startY: 26,
    head: [columns.map((c) => c.header)],
    body: rows.map((row) => columns.map((c) => String(c.value(row)))),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [47, 107, 255] },
  });

  doc.save(filename);
}
