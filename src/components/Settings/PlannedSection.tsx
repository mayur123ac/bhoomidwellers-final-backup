"use client";

// components/Settings/PlannedSection.tsx
//
// Sections from the spec that have no backend in this deployment.
//
// These render an honest account of what is missing and what already covers the
// need, rather than a mock-up. A page of realistic-looking API keys or invoices
// that silently does nothing is worse than no page: someone will configure it,
// believe it took, and find out later that it never did.

import { Card, EmptyState, InfoBanner, PageHeader, T } from "./ui";

export default function PlannedSection({
  title,
  subtitle,
  reason,
  alternative,
  requires,
}: {
  title: string;
  subtitle: string;
  /** Why it isn't built — the concrete missing dependency. */
  reason: string;
  /** What to use instead today, if anything. */
  alternative?: React.ReactNode;
  /** What has to exist before this section can work. */
  requires: string[];
}) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />

      <InfoBanner tone="warning">
        This section isn&apos;t built yet. {reason}
      </InfoBanner>

      {alternative && (
        <Card title="What to use instead">
          <div className="text-sm leading-relaxed" style={{ color: T.text }}>
            {alternative}
          </div>
        </Card>
      )}

      <Card title="What this section needs">
        {requires.length === 0 ? (
          <EmptyState title="Nothing recorded" />
        ) : (
          <ul className="space-y-2">
            {requires.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm" style={{ color: T.text }}>
                <span aria-hidden style={{ color: T.muted }}>
                  ○
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
