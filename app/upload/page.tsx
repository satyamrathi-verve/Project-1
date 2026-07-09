"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField } from "@/components/FormField";
import { exportToCsv, type ExportColumn } from "@/lib/exportUtils";

/*
  Bulk-import customers from a CSV. Only ever INSERTs into the existing
  `customers` table via `supabase` — never creates or alters tables.
*/

type ParsedRow = {
  code: string;
  name: string;
  gstin: string;
  pan: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  credit_limit: string;
  credit_days: string;
};

type PreviewRow = ParsedRow & { id: string; issues: string[] };

const SAMPLE_ROWS: ParsedRow[] = [
  {
    code: "CUST201", name: "Bright Traders", gstin: "27AAACB1234F1Z5", pan: "AAACB1234F",
    contact_person: "Ramesh Iyer", email: "ramesh@brighttraders.com", phone: "9876543210",
    address: "12 MG Road, Pune, MH", credit_limit: "250000", credit_days: "30",
  },
  {
    code: "CUST202", name: "Silverline Textiles", gstin: "07AAACS5678G1Z9", pan: "AAACS5678G",
    contact_person: "Neha Kapoor", email: "neha@silverlinetex.com", phone: "9811122334",
    address: "45 Nehru Place, New Delhi", credit_limit: "400000", credit_days: "45",
  },
  {
    code: "CUST203", name: "Coastal Traders", gstin: "33AAACC9012H1Z4", pan: "AAACC9012H",
    contact_person: "Arjun Pillai", email: "arjun@coastaltraders.in", phone: "9944556677",
    address: "8 Marina Street, Chennai, TN", credit_limit: "150000", credit_days: "15",
  },
  {
    code: "CUST204", name: "Northgate Retail", gstin: "06AAACN3456I1Z8", pan: "AAACN3456I",
    contact_person: "Simran Kaur", email: "simran@northgateretail.com", phone: "9822334455",
    address: "22 Sector 17, Chandigarh", credit_limit: "300000", credit_days: "30",
  },
];

const SAMPLE_COLUMNS: ExportColumn<ParsedRow>[] = [
  { header: "code", value: (r) => r.code },
  { header: "name", value: (r) => r.name },
  { header: "gstin", value: (r) => r.gstin },
  { header: "pan", value: (r) => r.pan },
  { header: "contact_person", value: (r) => r.contact_person },
  { header: "email", value: (r) => r.email },
  { header: "phone", value: (r) => r.phone },
  { header: "address", value: (r) => r.address },
  { header: "credit_limit", value: (r) => r.credit_limit },
  { header: "credit_days", value: (r) => r.credit_days },
];

function validateRows(parsed: ParsedRow[], existingCodes: Set<string>): PreviewRow[] {
  const seenInFile = new Set<string>();
  return parsed.map((r, i) => {
    const issues: string[] = [];
    const code = (r.code ?? "").trim();
    const name = (r.name ?? "").trim();
    const codeKey = code.toLowerCase();

    if (!code) issues.push("Code is required");
    if (!name) issues.push("Name is required");
    if (r.credit_limit?.trim() && isNaN(Number(r.credit_limit))) issues.push("Credit limit must be a number");
    if (r.credit_days?.trim() && isNaN(Number(r.credit_days))) issues.push("Credit days must be a number");
    if (code) {
      if (existingCodes.has(codeKey)) issues.push("Code already exists");
      else if (seenInFile.has(codeKey)) issues.push("Duplicate code in this file");
    }
    seenInFile.add(codeKey);

    return { ...r, id: String(i), issues };
  });
}

export default function UploadReportPage() {
  const [existingCodes, setExistingCodes] = useState<Set<string>>(new Set());
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [inserting, setInserting] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);
  const [insertedCount, setInsertedCount] = useState<number | null>(null);

  async function refreshExistingCodes() {
    if (!supabase) return new Set<string>();
    const { data } = await supabase.from("customers").select("code");
    const codes = new Set((data ?? []).map((c: { code: string }) => c.code.trim().toLowerCase()));
    setExistingCodes(codes);
    return codes;
  }

  useEffect(() => {
    refreshExistingCodes();
  }, []);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setFileName(file.name);
    setParseError(null);
    setInsertError(null);
    setInsertedCount(null);
    setRows([]);
    setParsing(true);

    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json<ParsedRow>(sheet, { raw: false, defval: "" });

      if (parsed.length === 0) {
        setParseError("That file has no rows. Try the sample CSV to see the expected format.");
      } else {
        const codes = await refreshExistingCodes();
        setRows(validateRows(parsed, codes));
      }
    } catch {
      setParseError("Couldn't read that file. Make sure it's a CSV like the sample.");
    } finally {
      setParsing(false);
    }
  }

  async function handleInsert() {
    if (!supabase) return;
    const validRows = rows.filter((r) => r.issues.length === 0);
    if (validRows.length === 0) return;

    setInserting(true);
    setInsertError(null);

    const payload = validRows.map((r) => ({
      code: r.code.trim(),
      name: r.name.trim(),
      gstin: r.gstin?.trim() || null,
      pan: r.pan?.trim() || null,
      contact_person: r.contact_person?.trim() || null,
      email: r.email?.trim() || null,
      phone: r.phone?.trim() || null,
      address: r.address?.trim() || null,
      credit_limit: r.credit_limit?.trim() ? Number(r.credit_limit) : 0,
      credit_days: r.credit_days?.trim() ? Number(r.credit_days) : 0,
    }));

    const { error } = await supabase.from("customers").insert(payload);

    setInserting(false);
    if (error) {
      setInsertError(error.message);
      return;
    }
    setInsertedCount(validRows.length);
    setRows([]);
    setFileName(null);
    await refreshExistingCodes();
  }

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Upload Report" subtitle="Bulk-import customers from a CSV file." />
        <NotConfigured />
      </>
    );
  }

  const readyCount = rows.filter((r) => r.issues.length === 0).length;
  const issueCount = rows.length - readyCount;

  const columns: Column<PreviewRow>[] = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    { key: "contact_person", header: "Contact", render: (r) => r.contact_person || "—" },
    { key: "email", header: "Email", render: (r) => r.email || "—" },
    { key: "credit_days", header: "Credit Days", render: (r) => r.credit_days || "0" },
    { key: "credit_limit", header: "Credit Limit", className: "text-right", render: (r) => r.credit_limit || "0" },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.issues.length ? (
          <span className="text-xs font-medium text-red-600">{r.issues.join(", ")}</span>
        ) : (
          <span className="text-xs font-medium text-green-600">Ready</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Upload Report"
        subtitle="Bulk-import customers from a CSV — preview the rows, fix issues, then insert."
        action={
          <button
            onClick={() => exportToCsv(SAMPLE_ROWS, SAMPLE_COLUMNS, "sample-customers.csv")}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted hover:bg-surface2 hover:text-ink"
          >
            Download sample CSV
          </button>
        }
      />

      <div className="mb-6 rounded-xl border border-line bg-surface p-6">
        <FormField label="Choose CSV file">
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brandink hover:file:bg-brand-dark"
          />
        </FormField>
        <p className="mt-2 text-xs text-faint">
          Expected columns: code, name, gstin, pan, contact_person, email, phone, address, credit_limit, credit_days.
        </p>
      </div>

      {parsing && <p className="text-sm text-muted">Reading {fileName}…</p>}
      {parseError && <p className="mb-4 text-sm text-red-600">{parseError}</p>}

      {insertedCount !== null && (
        <p className="mb-4 rounded-lg bg-green-500/10 px-4 py-2 text-sm text-green-600">
          Inserted {insertedCount} customer{insertedCount === 1 ? "" : "s"}.
        </p>
      )}
      {insertError && <p className="mb-4 text-sm text-red-600">{insertError}</p>}

      {!parsing && rows.length === 0 && !parseError && (
        <p className="text-sm text-faint">Choose a CSV file above to preview its rows here.</p>
      )}

      {rows.length > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-muted">
              {rows.length} row{rows.length === 1 ? "" : "s"} · {readyCount} ready · {issueCount} with issue
              {issueCount === 1 ? "" : "s"}
            </p>
            <button
              onClick={handleInsert}
              disabled={inserting || readyCount === 0}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandink hover:bg-brand-dark disabled:opacity-60"
            >
              {inserting ? "Inserting…" : `Insert ${readyCount} valid row${readyCount === 1 ? "" : "s"}`}
            </button>
          </div>

          <DataTable columns={columns} rows={rows} rowClassName={(r) => (r.issues.length ? "bg-red-500/5" : "")} />
        </>
      )}
    </>
  );
}
