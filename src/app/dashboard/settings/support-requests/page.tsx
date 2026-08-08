import PlannedSection from "@/components/Settings/PlannedSection";

export default function SupportRequestsPage() {
  return (
    <PlannedSection
      title="Support Requests"
      subtitle="Tickets raised with the CRM vendor."
      reason="No ticketing backend is connected. The CRM has internal messaging for its own users, but no channel to a support desk."
      requires={[
        "A support_tickets table, or an integration with an existing helpdesk.",
        "A route for replies to reach the person who opened the ticket — which needs the mail transport that Email Senders describes.",
      ]}
    />
  );
}
