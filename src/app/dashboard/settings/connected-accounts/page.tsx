import PlannedSection from "@/components/Settings/PlannedSection";

export default function ConnectedAccountsPage() {
  return (
    <PlannedSection
      title="Connected Accounts"
      subtitle="Third-party accounts linked to your CRM profile."
      reason="There is no OAuth client in this project — no Google, Gmail or Salesforce integration exists to connect to or disconnect from."
      requires={[
        "An OAuth client and callback route per provider.",
        "A table for per-user provider tokens, with refresh handling.",
        "A decision on which providers are actually wanted — the spec's list (Google Drive, Gmail, Salesforce) does not match anything this CRM currently talks to.",
      ]}
    />
  );
}
