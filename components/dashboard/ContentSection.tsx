"use client";
import ApprovalsSection from "@/components/dashboard/ApprovalsSection";

/** /dashboard/content — the same list UI as Approvals (owner, 2026-09-05: "content page ka ui
 *  change karo and approval jaisa kardo"). ApprovalsSection already loads every status with the
 *  stat strip, filters, per-row actions and the detail drawer, and each row opens the article
 *  reviewer at /dashboard/content/[id] — so Content is that screen with its own heading and a
 *  Create new button, rather than a second, drifting design of the same data.
 *
 *  Same real data as the old table here: GET /api/content, nothing mocked. */
export default function ContentSection() {
  return (
    <ApprovalsSection
      heading="Content"
      subtitle="Everything your team has written — drafts, published and rejected"
      createHref="/dashboard"
    />
  );
}
