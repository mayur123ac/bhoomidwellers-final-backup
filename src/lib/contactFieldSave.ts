// lib/contactFieldSave.ts
// Shared utility called by every InlineContactField onSave handler across all CRM panels.

export interface ContactFieldSaveResult {
  success: boolean;
  data?: any;
  message?: string;
}

/**
 * Save a single contact field for a lead.
 *
 * @param leadId   - The numeric lead ID
 * @param field    - "email" | "phone" | "location"
 * @param value    - The new value (empty string = clear the field)
 * @param apiBase  - "walkin_enquiries" (PUT) or "caller_leads" (PATCH).
 *                   Defaults to "walkin_enquiries".
 *
 * MT-03: the third mode used to be `"leads"`, pointing at `/api/leads/[id]` →
 * `UPDATE leads`. Every caller of it was the caller panel, which loads its rows
 * from `/api/caller-leads` — so it was writing to the dead `leads` table using an
 * id from `caller_leads`. An UPDATE matching zero rows is a success, so the UI
 * reported "updated successfully" while nothing was written. `leads` is slated
 * for DROP; this mode now targets the table the ids actually come from.
 *
 * `alt_phone` was also dropped from the accepted fields: it exists on neither
 * `leads` nor `caller_leads`, so that editor could never have worked on either.
 */
export async function contactFieldSave(
  leadId: number | string,
  field: "email" | "phone" | "alt_phone" | "location",
  value: string,
  apiBase: "walkin_enquiries" | "caller_leads" = "walkin_enquiries"
): Promise<ContactFieldSaveResult> {
  let endpoint: string;
  let method: string;
  let body: Record<string, any>;

  if (apiBase === "walkin_enquiries") {
    endpoint = `/api/walkin_enquiries/${leadId}`;
    method = "PUT";
    body = { [field]: value || null };
  } else {
    // /api/caller-leads/[id] PATCH uses contact_no instead of phone, and has no
    // alt_phone column — guard rather than send a field the route will reject.
    const fieldMap: Record<string, string> = {
      phone: "contact_no",
      email: "email",
      location: "location",
    };
    const column = fieldMap[field];
    if (!column) {
      return {
        success: false,
        message: `caller_leads has no "${field}" field.`,
      };
    }
    endpoint = `/api/caller-leads/${leadId}`;
    method = "PATCH";
    body = { [column]: value || null };
  }

  try {
    const res = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json.success === false) {
      const msg = json.message || json.error || `HTTP ${res.status}: Update failed`;
      return { success: false, message: msg };
    }

    const updatedRecord = json.data ?? json.lead ?? null;
    return { success: true, data: updatedRecord };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || "Network error. Please try again.",
    };
  }
}
