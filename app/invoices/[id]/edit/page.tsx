"use client";

import { useParams } from "next/navigation";
import { InvoiceForm } from "../../InvoiceForm";

export default function EditInvoicePage() {
  const params = useParams();
  return <InvoiceForm invoiceId={params.id as string} />;
}
