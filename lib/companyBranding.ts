/*
  The `company` table has no logo/website/payment-info columns and can't be altered
  (never alter tables). These are branding/payment config with no real backend need,
  so they're kept client-side in localStorage — same front-end-only pattern this app
  already uses for Sign In. Per-browser, not synced across the team.

  Note: bank account details are meaningfully more sensitive than a logo URL. Storing
  them in plaintext localStorage is fine for this demo but is NOT how real banking
  details should be handled in a production system.
*/

const KEY = "ar-manager-branding";

export interface CompanyBranding {
  logoUrl: string;
  website: string;
  paymentLink: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  ifscOrSwift: string;
  upiId: string;
}

const EMPTY: CompanyBranding = {
  logoUrl: "",
  website: "",
  paymentLink: "",
  bankName: "",
  bankAccountName: "",
  bankAccountNumber: "",
  ifscOrSwift: "",
  upiId: "",
};

export function getBranding(): CompanyBranding {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function setBranding(branding: CompanyBranding) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(branding));
}

export function getSignedInUser(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("ar-manager-auth") ?? "";
}
