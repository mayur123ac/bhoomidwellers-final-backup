"use client";

// Settings route kept for backwards compatibility.
// The canonical home is now the employees page (?tab=creative_studio).
// This thin wrapper renders the same component inside the Settings shell.

import CreativeStudioPanel from "@/components/creative-studio/CreativeStudioPanel";

export default function CreativeStudioSettingsPage() {
  return <CreativeStudioPanel />;
}
