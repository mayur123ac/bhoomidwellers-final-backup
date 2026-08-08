import { redirect } from "next/navigation";

// /dashboard/settings has no content of its own — Profile is the landing
// section, per spec.
//
// What used to be on this page has moved, not been dropped:
//   * Lead Number Sorting toggle      → ./workspace
//   * Sales Manager Bulk Upload toggle → ./workspace
//   * Bolna voice calling card        → ./workspace
//   * System update broadcaster       → ./workspace
//   * WhatsApp number field           → ./profile (as the account's phone/WhatsApp)
//   * Profile information (read-only) → ./profile, now editable
export default function SettingsIndexPage() {
  redirect("/dashboard/settings/profile");
}
