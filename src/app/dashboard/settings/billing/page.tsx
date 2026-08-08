import PlannedSection from "@/components/Settings/PlannedSection";

export default function BillingPage() {
  return (
    <PlannedSection
      title="Billing"
      subtitle="Payment method, invoices and billing history."
      reason="There is no payment integration in this project — no Stripe, no Razorpay, no billing records. Nothing charges this workspace, so there is no history to show."
      requires={[
        "A payment provider integration and its webhook handler.",
        "A billing_records table (schema drafted in the spec).",
        "The same subscription decision that Plans depends on.",
      ]}
    />
  );
}
