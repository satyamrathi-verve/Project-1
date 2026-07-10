import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import { AuthGate } from "@/components/AuthGate";
import { ReminderSchedulerRunner } from "@/components/ReminderSchedulerRunner";
import { Toaster } from "@/components/Toast";
import { CommandPalette } from "@/components/CommandPalette";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const poppins = Poppins({ subsets: ["latin"], variable: "--font-poppins", display: "swap", weight: ["500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "AR Manager — Verve",
  description: "Accounts Receivable manager",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="normal" className={`${inter.variable} ${poppins.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('ar-theme');if(t){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans">
        <ReminderSchedulerRunner />
        <Toaster />
        <CommandPalette />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
