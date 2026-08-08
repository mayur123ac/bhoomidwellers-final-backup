import PlannedSection from "@/components/Settings/PlannedSection";

export default function PlansPage() {
  return (
    <PlannedSection
      title="Plans"
      subtitle="Subscription tier and included limits."
      reason="This CRM is a single self-hosted deployment for one company, not a subscription product. There is no plan, no tier and no usage limit to display — the spec's Plans section assumes a SaaS billing model that does not exist here."
      requires={[
        "A decision that this CRM will be sold as a subscription to multiple organisations.",
        "The multi-tenant schema that implies — organization_settings is currently a single row.",
        "A billing provider, before plans mean anything.",
      ]}
    />
  );
}
