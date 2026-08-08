import PlannedSection from "@/components/Settings/PlannedSection";

export default function IntegrationsHubPage() {
  return (
    <PlannedSection
      title="Integrations Hub"
      subtitle="Zapier, Make, and outbound webhooks."
      reason="No outbound webhook dispatcher exists — the CRM receives webhooks (Bolna call events, WhatsApp delivery receipts) but never sends them, so there is nothing for Zapier or Make to subscribe to."
      alternative={
        <>
          Inbound webhooks are live and handled under
          <code className="mx-1 rounded bg-black/5 px-1">/api/webhooks</code>. Outbound events are
          the missing half.
        </>
      }
      requires={[
        "An event bus emitting domain events (lead created, booking confirmed, commission calculated) — lib/eventBus.ts is in-process only.",
        "A webhook subscription table plus a delivery worker with retries.",
        "Signed payloads, so a receiver can verify the call came from this CRM.",
      ]}
    />
  );
}
