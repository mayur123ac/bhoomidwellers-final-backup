import PlannedSection from "@/components/Settings/PlannedSection";

export default function MembersTeamPage() {
  return (
    <PlannedSection
      title="Members & Team"
      subtitle="Per-member permissions beyond their role."
      reason="The spec splits this from Employee Management, but in this CRM they are the same list of people — users. What is genuinely missing is the granular permission model: access is decided purely by a role string in middleware.ts, with no per-user permission grants to edit."
      alternative={
        <>
          Adding, editing, removing and reassigning team members all work today under{" "}
          <strong>Employee Management</strong>, including role changes, departments and reporting
          lines. This section would only add per-member permission overrides on top of that.
        </>
      }
      requires={[
        "A role_permissions table and per-user overrides (schema drafted in the spec).",
        "Replacing the role-string checks in middleware.ts and requireRoles() with permission checks.",
        "An audit of the ~110 API routes to map each onto a named permission.",
      ]}
    />
  );
}
