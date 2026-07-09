/*
  reminder_templates only has subject/body columns (never altered — see CLAUDE.md golden
  rules). The 5-section editor (Greeting/Body/Closing/Signature/Footer) is a UI-only
  structure: composeBody() joins the sections into one string for the `body` column using
  HTML-comment markers; decomposeBody() splits it back apart for editing. If a template's
  body has no markers (e.g. the original seeded plain-text template), the whole thing is
  treated as the Body section on first load — nothing is lost, it just isn't split up yet.

  The Company Header, Invoice Summary Table, Payment Instructions, and Contact blocks are
  NOT editable sections — they're auto-generated from Company Branding settings and invoice
  data (like the invoice table already was), inserted around the editable sections by
  buildEmailHtml(). Payment Instructions only renders if at least one bank/UPI field has
  been configured, so teams that don't use it don't get an empty box.
*/

export interface TemplateSections {
  greeting: string;
  body: string;
  closing: string;
  signature: string;
  footer: string;
}

const MARKERS = {
  greeting: "<!--EMAILTPL:GREETING-->",
  body: "<!--EMAILTPL:BODY-->",
  closing: "<!--EMAILTPL:CLOSING-->",
  signature: "<!--EMAILTPL:SIGNATURE-->",
  footer: "<!--EMAILTPL:FOOTER-->",
};

export function composeBody(sections: TemplateSections): string {
  return (
    MARKERS.greeting +
    sections.greeting +
    MARKERS.body +
    sections.body +
    MARKERS.closing +
    sections.closing +
    MARKERS.signature +
    sections.signature +
    MARKERS.footer +
    sections.footer
  );
}

export function decomposeBody(raw: string): TemplateSections {
  if (!raw.includes(MARKERS.greeting)) {
    return { greeting: "", body: raw, closing: "", signature: "", footer: "" };
  }
  const after = (marker: string) => raw.slice(raw.indexOf(marker) + marker.length);
  const between = (marker: string, nextMarker: string) => {
    const chunk = after(marker);
    const end = chunk.indexOf(nextMarker);
    return end === -1 ? chunk : chunk.slice(0, end);
  };
  return {
    greeting: between(MARKERS.greeting, MARKERS.body),
    body: between(MARKERS.body, MARKERS.closing),
    closing: between(MARKERS.closing, MARKERS.signature),
    signature: between(MARKERS.signature, MARKERS.footer),
    footer: after(MARKERS.footer),
  };
}

export const DEFAULT_TEMPLATE: { subject: string; sections: TemplateSections } = {
  subject: "Payment Reminder – Outstanding Invoice(s)",
  sections: {
    greeting: "Dear [CustomerName],",
    body:
      "<p>We hope you are doing well.</p>" +
      "<p>This is a friendly reminder that the following invoice(s) remain outstanding according to our records.</p>" +
      "<p>Kindly arrange payment at your earliest convenience.</p>" +
      "<p>If payment has already been made, please disregard this email or share the payment details with us for reconciliation.</p>",
    closing: "Thank you for your continued business. We appreciate your prompt attention to this matter.",
    signature: "Kind Regards,\nAccounts Receivable Team\n[CompanyName]",
    footer: "This is a system-generated email from [CompanyName]. Please do not reply directly to this email.",
  },
};

export interface PlaceholderDef {
  token: string;
  label: string;
}

export const PLACEHOLDERS: PlaceholderDef[] = [
  { token: "[CustomerName]", label: "Customer Name" },
  { token: "[CompanyName]", label: "Company Name" },
  { token: "[CompanyAddress]", label: "Company Address" },
  { token: "[CompanyWebsite]", label: "Company Website" },
  { token: "[InvoiceNumber]", label: "Invoice Number" },
  { token: "[InvoiceDate]", label: "Invoice Date" },
  { token: "[DueDate]", label: "Due Date" },
  { token: "[OutstandingAmount]", label: "Outstanding Amount" },
  { token: "[DaysOverdue]", label: "Days Overdue" },
  { token: "[Location]", label: "Location" },
  { token: "[CurrentDate]", label: "Current Date" },
  { token: "[CurrentTime]", label: "Current Time" },
  { token: "[ARExecutive]", label: "AR Executive (signed-in user)" },
  { token: "[CompanyEmail]", label: "Company Email" },
  { token: "[CompanyPhone]", label: "Company Phone" },
  { token: "[PaymentLink]", label: "Payment Link" },
  { token: "[TotalReceivables]", label: "Total Receivables (this send)" },
  { token: "[BankName]", label: "Bank Name" },
  { token: "[BankAccountName]", label: "Bank Account Name" },
  { token: "[BankAccountNumber]", label: "Bank Account Number" },
  { token: "[IFSCOrSWIFT]", label: "IFSC / SWIFT Code" },
  { token: "[UPIId]", label: "UPI ID" },
];

const PLACEHOLDER_NAMES = new Set(PLACEHOLDERS.map((p) => p.token.slice(1, -1)));

export interface FillVars {
  CustomerName: string;
  CompanyName: string;
  CompanyAddress: string;
  CompanyWebsite: string;
  InvoiceNumber: string;
  InvoiceDate: string;
  DueDate: string;
  OutstandingAmount: string;
  DaysOverdue: string;
  Location: string;
  CurrentDate: string;
  CurrentTime: string;
  ARExecutive: string;
  CompanyEmail: string;
  CompanyPhone: string;
  PaymentLink: string;
  TotalReceivables: string;
  BankName: string;
  BankAccountName: string;
  BankAccountNumber: string;
  IFSCOrSWIFT: string;
  UPIId: string;
}

/**
 * Fills the current [PascalCase] placeholders, plus two older formats still found in
 * templates saved before the syntax was simplified: {{PascalCase}} and the original
 * seeded template's {snake_case}.
 */
export function fillPlaceholders(text: string, vars: FillVars): string {
  let out = text;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`[${key}]`, value).replaceAll(`{{${key}}}`, value);
  }
  // Legacy single-brace placeholders from the original seeded template.
  out = out
    .replaceAll("{customer}", vars.CustomerName)
    .replaceAll("{invoice_no}", vars.InvoiceNumber)
    .replaceAll("{amount}", vars.OutstandingAmount)
    .replaceAll("{days_overdue}", vars.DaysOverdue);
  return out;
}

/** Finds [Tokens] (or older {{Tokens}}) in the composed template text that aren't in the known placeholder list — likely typos. */
export function findUnknownPlaceholders(text: string): string[] {
  const matches = text.match(/\[[A-Za-z0-9_]+\]|\{\{[A-Za-z0-9_]+\}\}/g) ?? [];
  const nameOf = (m: string) => (m.startsWith("[") ? m.slice(1, -1) : m.slice(2, -2));
  return [...new Set(matches.filter((m) => !PLACEHOLDER_NAMES.has(nameOf(m))))];
}

export interface InvoiceLineItem {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  daysOverdue: string;
  outstandingAmount: string;
}

const ACCENT = "#2f6bff"; // matches the app's own `brand` color, for visual continuity
const INK = "#1e293b";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const LINE = "#e2e8f0";
const SURFACE = "#f8fafc";

/**
 * The Invoice Summary Table — every overdue invoice included in this send, for one
 * customer. Pass totalReceivables (pre-formatted, e.g. "₹1,50,000.00") to append a
 * highlighted Total Receivables row at the bottom.
 */
export function buildInvoiceTableHtml(items: InvoiceLineItem[], totalReceivables?: string): string {
  if (items.length === 0) return "";
  const cell = (content: string, align: "left" | "right" = "left") =>
    `<td style="padding:10px 14px;border-bottom:1px solid ${LINE};font-size:13px;color:${INK};text-align:${align}">${content}</td>`;
  const rows = items
    .map((i) => `<tr>${cell(i.invoiceNumber)}${cell(i.invoiceDate)}${cell(i.dueDate)}${cell(i.daysOverdue, "right")}${cell(i.outstandingAmount, "right")}</tr>`)
    .join("");
  const totalRow = totalReceivables
    ? `<tr style="background:#eef4ff">` +
      `<td colspan="4" style="padding:12px 14px;font-size:13px;font-weight:700;color:${INK};text-align:right;border-top:2px solid ${ACCENT}">Total Receivables</td>` +
      `<td style="padding:12px 14px;font-size:14px;font-weight:700;color:${ACCENT};text-align:right;border-top:2px solid ${ACCENT}">${totalReceivables}</td>` +
      `</tr>`
    : "";
  const th = (label: string, align: "left" | "right" = "left") =>
    `<th style="padding:10px 14px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTED};text-align:${align};border-bottom:1px solid ${LINE}">${label}</th>`;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;width:100%;margin:20px 0;border:1px solid ${LINE};border-radius:10px;overflow:hidden">` +
    `<thead><tr style="background:${SURFACE}">${th("Invoice Number")}${th("Invoice Date")}${th("Due Date")}${th("Days Overdue", "right")}${th("Receivables Amount", "right")}</tr></thead>` +
    `<tbody>${rows}${totalRow}</tbody>` +
    `</table>`
  );
}

function paymentInstructionsHtml(vars: FillVars): string {
  const rows: [string, string][] = [
    ["Bank Name", vars.BankName],
    ["Account Name", vars.BankAccountName],
    ["Account Number", vars.BankAccountNumber],
    ["IFSC / SWIFT", vars.IFSCOrSWIFT],
    ["UPI ID", vars.UPIId],
  ].filter(([, value]) => value.trim() !== "") as [string, string][];

  if (rows.length === 0) return "";

  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr>` +
        `<td style="padding:4px 0;font-size:12px;color:${MUTED};width:140px">${label}</td>` +
        `<td style="padding:4px 0;font-size:13px;color:${INK};font-weight:600">${value}</td>` +
        `</tr>`
    )
    .join("");

  const linkRow = vars.PaymentLink
    ? `<p style="margin:12px 0 0;font-size:13px"><a href="${vars.PaymentLink}" style="color:${ACCENT};font-weight:600;text-decoration:none">Pay online →</a></p>`
    : "";

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:${SURFACE};border:1px solid ${LINE};border-radius:10px">` +
    `<tr><td style="padding:16px 20px">` +
    `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTED}">Payment Instructions</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0">${rowsHtml}</table>` +
    linkRow +
    `</td></tr>` +
    `</table>`
  );
}

function contactHtml(vars: FillVars): string {
  return (
    `<p style="margin:16px 0 0;font-size:13px;color:${MUTED}">` +
    `For any queries regarding your account, please contact the Accounts Receivable Team` +
    (vars.CompanyEmail ? ` at <a href="mailto:${vars.CompanyEmail}" style="color:${ACCENT};text-decoration:none">${vars.CompanyEmail}</a>` : "") +
    (vars.CompanyPhone ? ` or ${vars.CompanyPhone}` : "") +
    `.</p>`
  );
}

/**
 * Renders the final email HTML — company header, the 5 editable sections with placeholders
 * filled, the auto-generated invoice table / payment instructions / contact blocks, and a
 * footer band. This is what a recipient would actually see. Used identically by the real
 * send, the scheduler, and the editor's live preview, so all three always agree.
 */
export function buildEmailHtml(
  sections: TemplateSections,
  vars: FillVars,
  opts?: { invoiceTableHtml?: string; logoUrl?: string }
): string {
  const greeting = fillPlaceholders(sections.greeting, vars);
  const body = fillPlaceholders(sections.body, vars);
  const closing = fillPlaceholders(sections.closing, vars);
  const signature = fillPlaceholders(sections.signature, vars).replaceAll("\n", "<br/>");
  const footer = fillPlaceholders(sections.footer, vars);

  const logo = opts?.logoUrl
    ? `<img src="${opts.logoUrl}" alt="${vars.CompanyName}" style="max-height:36px;display:block;margin-bottom:8px" />`
    : "";
  const headerMeta = [vars.CompanyAddress, vars.CompanyWebsite, vars.CompanyPhone].filter(Boolean).join("  ·  ");

  return (
    `<div style="background:${SURFACE};padding:24px 12px;font-family:Arial,Helvetica,sans-serif">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${LINE}">` +
    // Company header band
    `<tr><td style="background:${INK};padding:24px 28px">` +
    logo +
    `<div style="font-size:18px;font-weight:700;color:#ffffff">${vars.CompanyName}</div>` +
    (headerMeta ? `<div style="margin-top:4px;font-size:11px;color:#cbd5e1">${headerMeta}</div>` : "") +
    `</td></tr>` +
    // Body
    `<tr><td style="padding:28px;font-size:14px;line-height:1.6;color:${INK}">` +
    `<p style="margin:0 0 12px">${greeting}</p>` +
    body +
    (opts?.invoiceTableHtml ?? "") +
    paymentInstructionsHtml(vars) +
    contactHtml(vars) +
    `<p style="margin:20px 0 0">${closing}</p>` +
    `<p style="margin:16px 0 0;color:${MUTED}">${signature}</p>` +
    `</td></tr>` +
    // Footer band
    `<tr><td style="background:${SURFACE};border-top:1px solid ${LINE};padding:16px 28px;text-align:center">` +
    `<p style="margin:0;font-size:11px;color:${FAINT}">${footer}</p>` +
    `</td></tr>` +
    `</table>` +
    `</div>`
  );
}
