/*
  Small shared formatting helpers used across the invoice screens.
  Keep display consistent everywhere (numbers, dates, status colours).
*/

// Amount with Indian-style grouping and 2 decimals — no currency symbol.
// e.g. 1146000 -> "11,46,000.00"
export function money(n: number | null | undefined): string {
  const value = typeof n === "number" ? n : 0;
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// A yyyy-mm-dd string -> "06 Jul 2026"
export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Overdue = still owing (open/partial) and past its due date, or already flagged overdue.
export function isOverdue(status: string, dueDate: string | null): boolean {
  if (status === "overdue") return true;
  if (status !== "open" && status !== "partial") return false;
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate) < today;
}

// Whole days a due date is past (0 if not past / missing).
export function daysLate(dueDate: string | null): number {
  if (!dueDate) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - due.getTime()) / 86400000);
  return diff > 0 ? diff : 0;
}

// ---- Invoice numbering, SAC, TDS ----

export const COMPANY_ABBR = "VAPL"; // Verve Advisory Pvt Ltd
export const SERVICE_SAC = "998313"; // SAC for the firm's services
export const TDS_RATE = 0.1; // 194J professional/advisory services → 10%

// Financial-year code (India Apr–Mar) from a date, e.g. 2026-07-06 -> "26-27".
export function financialYearCode(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12
  const start = month >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

// Reformat any stored invoice number to VAPL/FY/#### (display only, no DB change).
// e.g. ("INV-0001", "2026-07-06") -> "VAPL/26-27/0001"
export function formatInvoiceNo(rawNo: string, dateStr: string | null): string {
  const digits = (rawNo.match(/(\d+)\s*$/)?.[1] ?? rawNo).padStart(4, "0");
  const fy = financialYearCode(dateStr);
  return fy ? `${COMPANY_ABBR}/${fy}/${digits}` : `${COMPANY_ABBR}/${digits}`;
}

// TDS u/s 194J @10%, computed on the taxable value (subtotal), excluding GST.
export function computeTDS(subtotal: number | null | undefined): number {
  const base = typeof subtotal === "number" ? subtotal : 0;
  return Math.round(base * TDS_RATE * 100) / 100;
}

// ---- GST helpers (all derived from real data: the two GSTINs + tax_amount) ----

// GST state codes → state name (first 2 digits of a GSTIN).
const GST_STATES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "25": "Daman & Diu", "26": "Dadra & Nagar Haveli", "27": "Maharashtra",
  "28": "Andhra Pradesh (Old)", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep",
  "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};

// Place of Supply from a GSTIN, e.g. "27..." -> "Maharashtra (27)".
export function placeOfSupply(gstin: string | null): string {
  if (!gstin || gstin.length < 2) return "—";
  const code = gstin.slice(0, 2);
  const name = GST_STATES[code];
  return name ? `${name} (${code})` : `State ${code}`;
}

export interface TaxSplit {
  intraState: boolean;
  cgst: number;
  sgst: number;
  igst: number;
}

// Split one tax_amount into CGST+SGST (same state) or IGST (different state).
// Intra-state: CGST = SGST = half. Inter-state: IGST = full. (Real GST rule.)
export function splitTax(
  sellerGstin: string | null,
  buyerGstin: string | null,
  taxAmount: number
): TaxSplit {
  const sellerState = sellerGstin?.slice(0, 2);
  const buyerState = buyerGstin?.slice(0, 2);
  const intraState = Boolean(sellerState && buyerState && sellerState === buyerState);
  if (intraState) {
    const half = Math.round((taxAmount / 2) * 100) / 100;
    return { intraState: true, cgst: half, sgst: taxAmount - half, igst: 0 };
  }
  return { intraState: false, cgst: 0, sgst: 0, igst: taxAmount };
}

// Amount in Indian words, e.g. 83583 -> "Indian Rupee Eighty-Three Thousand Five Hundred Eighty-Three Only".
export function amountInWords(n: number | null | undefined): string {
  const value = typeof n === "number" ? n : 0;
  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);

  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
    "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const twoDigit = (num: number): string => {
    if (num < 20) return ones[num];
    const t = Math.floor(num / 10);
    const o = num % 10;
    return o ? `${tens[t]}-${ones[o]}` : tens[t];
  };

  const threeDigit = (num: number): string => {
    const h = Math.floor(num / 100);
    const rest = num % 100;
    let out = "";
    if (h) out += `${ones[h]} Hundred`;
    if (rest) out += `${out ? " " : ""}${twoDigit(rest)}`;
    return out;
  };

  const inWords = (num: number): string => {
    if (num === 0) return "Zero";
    const crore = Math.floor(num / 10000000);
    num %= 10000000;
    const lakh = Math.floor(num / 100000);
    num %= 100000;
    const thousand = Math.floor(num / 1000);
    num %= 1000;
    const hundred = num;
    const parts: string[] = [];
    if (crore) parts.push(`${inWords(crore)} Crore`);
    if (lakh) parts.push(`${twoDigit(lakh)} Lakh`);
    if (thousand) parts.push(`${twoDigit(thousand)} Thousand`);
    if (hundred) parts.push(threeDigit(hundred));
    return parts.join(" ");
  };

  let result = `Indian Rupee ${inWords(rupees)}`;
  if (paise > 0) result += ` and ${twoDigit(paise)} Paise`;
  return `${result} Only`;
}

// Tailwind classes for a coloured status pill.
export function statusPill(status: string): string {
  switch (status) {
    case "paid":
      return "bg-green-100 text-green-700";
    case "overdue":
      return "bg-red-100 text-red-700";
    case "partial":
      return "bg-amber-100 text-amber-700";
    default: // open
      return "bg-slate-100 text-slate-600";
  }
}
