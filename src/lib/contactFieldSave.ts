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
 * @param field    - "email" | "phone" | "alt_phone" | "location"
 * @param value    - The new value (empty string = clear the field)
 * @param apiBase  - "walkin_enquiries" (PUT) or "leads" (PATCH). Defaults to "walkin_enquiries".
 */
export async function contactFieldSave(
  leadId: number | string,
  field: "email" | "phone" | "alt_phone" | "location",
  value: string,
  apiBase: "walkin_enquiries" | "leads" = "walkin_enquiries"
): Promise<ContactFieldSaveResult> {
  let endpoint: string;
  let method: string;
  let body: Record<string, any>;

  if (apiBase === "walkin_enquiries") {
    endpoint = `/api/walkin_enquiries/${leadId}`;
    method = "PUT";
    body = { [field]: value || null };
  } else {
    // /api/leads/[id] PATCH uses contact_no instead of phone
    endpoint = `/api/leads/${leadId}`;
    method = "PATCH";
    const fieldMap: Record<string, string> = {
      phone: "contact_no",
      email: "email",
      alt_phone: "alt_phone",
    };
    body = { [fieldMap[field]]: value || null };
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
