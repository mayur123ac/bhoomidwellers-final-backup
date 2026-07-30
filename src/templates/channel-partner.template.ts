// templates/channel-partner.template.ts — message bodies, and nothing else.
//
// The service never constructs a Meta payload by hand. It picks a TemplateKey,
// hands over a typed input object, and gets back a TemplateMessage. That
// separation is what lets a new notification type ship as one entry in
// TEMPLATE_REGISTRY instead of a change to the dispatch code.
//
// ── Positional parameters are frozen at approval ─────────────────────────────
// Meta approves a template as literal text with {{1}}…{{n}} placeholders. The
// order below IS the contract: swapping two fields here silently sends the city
// where the pincode should be, and fixing it means submitting a new template and
// waiting another 24-48h for approval. The exact text to submit is reproduced in
// TEMPLATE_APPROVAL_TEXT at the bottom of this file — keep the two in step.

import type { TemplateKey, TemplateMessage, TemplateTextParameter } from "@/types/whatsapp.types";

export const CP_REGISTRATION_TEMPLATE_NAME = "cp_registration_alert";
export const CP_LEAD_ASSIGNED_TEMPLATE_NAME = "cp_lead_assigned_alert";

// ─────────────────────────────────────────────────────────────────────────────
// Parameter sanitising
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Meta rejects a body parameter that contains a newline, a tab, or four or more
 * consecutive spaces, and rejects an empty one — with error 132000 at SEND time,
 * not at approval time. So a template that passed review will still fail on the
 * first real record whose address happens to wrap onto two lines.
 *
 * channel_partners.office_address is free text typed into a multi-line box and
 * will absolutely contain newlines in production, which makes this function
 * load-bearing rather than defensive.
 *
 * The fallback matters too: "N/A" is not decoration. GST and pincode are
 * genuinely optional on the registration form, and an empty string would fail
 * the send outright.
 */
export function sanitizeParam(value: unknown, fallback = "N/A", maxLen = 180): string {
  const s = String(value ?? "")
    .replace(/[\r\n\t]+/g, ", ")
    .replace(/\s{2,}/g, " ")
    // A line that already ended in a comma would otherwise become "Road,, Malad".
    // Addresses are typed one line per component, so this is the common case,
    // not an edge case.
    .replace(/,\s*(?=,)/g, "")
    .trim()
    // Trailing separators left by the newline collapse, e.g. an address that
    // ends with a blank line.
    .replace(/(,\s*)+$/, "");

  if (!s) return fallback;
  // Meta's total body limit is 1024 characters. Ten fields at 180 plus the
  // static copy stays comfortably under it.
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}

/**
 * Formats a timestamp for a human in India.
 *
 * Pinned to Asia/Kolkata rather than server-local: the CRM may be deployed to a
 * UTC host, and a manager who reads "2:24 pm" for a 7:54 pm registration stops
 * trusting the notification feed entirely.
 */
export function formatIst(value: Date | string | null | undefined): string {
  if (!value) return "N/A";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "N/A";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

const text = (v: string): TemplateTextParameter => ({ type: "text", text: v });

function body(params: string[]): TemplateMessage["components"] {
  return [{ type: "body", parameters: params.map(text) }];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Channel Partner registered
// ─────────────────────────────────────────────────────────────────────────────

export interface CpRegistrationTemplateInput {
  /** channel_partners.company_name */
  companyName: string | null;
  /** channel_partners.name — the Channel Partner's own person, not our staff. */
  contactPerson: string | null;
  /** channel_partners.phone */
  phone: string | null;
  /** channel_partners.office_address */
  address: string | null;
  city: string | null;
  pincode: string | null;
  /** channel_partners.gst_number */
  gst: string | null;
  /**
   * channel_partners.owner_contact_person.
   *
   * The column name predates the form. Its label is "Attendee" and its helper
   * text is "Who received this partner at the front desk" — renaming the column
   * would break the CP enquiry table and overview, which read that key.
   */
  attendee: string | null;
  /** users.name of the assigned Sourcing Manager. */
  sourcingManager: string | null;
  createdAt: Date | string | null;
  /** session.name of whoever submitted the form. Often, but not always, the attendee. */
  registeredBy: string | null;
}

/** Parameter count must match TEMPLATE_APPROVAL_TEXT below. */
export const CP_REGISTRATION_PARAM_COUNT = 11;

export function buildCpRegistrationTemplate(
  input: CpRegistrationTemplateInput,
  languageCode: string
): TemplateMessage {
  return {
    name: CP_REGISTRATION_TEMPLATE_NAME,
    language: { code: languageCode },
    components: body([
      sanitizeParam(input.companyName), //          {{1}}  Company
      sanitizeParam(input.contactPerson), //        {{2}}  Contact Person
      sanitizeParam(input.phone), //                {{3}}  Phone
      sanitizeParam(input.address, "N/A", 220), //  {{4}}  Address (longest field)
      sanitizeParam(input.city), //                 {{5}}  City
      sanitizeParam(input.pincode), //              {{6}}  Pincode
      sanitizeParam(input.gst, "Not provided"), //  {{7}}  GST
      sanitizeParam(input.attendee), //             {{8}}  Attendee
      sanitizeParam(input.sourcingManager), //      {{9}}  Sourcing Manager
      formatIst(input.createdAt), //                {{10}} Registered On
      sanitizeParam(input.registeredBy), //         {{11}} Registered By
    ]),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Channel Partner lead assigned
// ─────────────────────────────────────────────────────────────────────────────

export interface CpLeadAssignedTemplateInput {
  /** walkin_enquiries.name — the buyer. */
  clientName: string | null;
  clientPhone: string | null;
  configuration: string | null;
  budget: string | number | null;
  /** The Channel Partner who brought the lead: cp_company, else cp_name. */
  partnerName: string | null;
  /** Receptionist who logged the enquiry. */
  loggedBy: string | null;
  createdAt: Date | string | null;
}

export const CP_LEAD_ASSIGNED_PARAM_COUNT = 7;

export function buildCpLeadAssignedTemplate(
  input: CpLeadAssignedTemplateInput,
  languageCode: string
): TemplateMessage {
  return {
    name: CP_LEAD_ASSIGNED_TEMPLATE_NAME,
    language: { code: languageCode },
    components: body([
      sanitizeParam(input.clientName), //                  {{1}} Client
      sanitizeParam(input.clientPhone), //                 {{2}} Phone
      sanitizeParam(input.configuration, "Not stated"), // {{3}} Configuration
      sanitizeParam(input.budget, "Not stated"), //        {{4}} Budget
      sanitizeParam(input.partnerName), //                 {{5}} Channel Partner
      sanitizeParam(input.loggedBy), //                    {{6}} Logged By
      formatIst(input.createdAt), //                       {{7}} Received On
    ]),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export interface TemplateDefinition {
  name: string;
  paramCount: number;
  build: (input: any, languageCode: string) => TemplateMessage;
}

/**
 * Dispatch table. The service resolves a TemplateKey through this rather than
 * importing the builders directly, and GET /api/notifications reports it as
 * "the names and parameter counts this code expects" — the exact checklist to
 * tick off against WhatsApp Manager when the templates come back approved.
 */
export const TEMPLATE_REGISTRY: Record<TemplateKey, TemplateDefinition> = {
  cp_registration: {
    name: CP_REGISTRATION_TEMPLATE_NAME,
    paramCount: CP_REGISTRATION_PARAM_COUNT,
    build: buildCpRegistrationTemplate,
  },
  cp_lead_assigned: {
    name: CP_LEAD_ASSIGNED_TEMPLATE_NAME,
    paramCount: CP_LEAD_ASSIGNED_PARAM_COUNT,
    build: buildCpLeadAssignedTemplate,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// What to submit to Meta
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paste these into WhatsApp Manager → Message Templates → Create.
 *
 * Category must be UTILITY, not MARKETING. These are post-transaction alerts to
 * our own staff: UTILITY is cheaper per conversation, is not subject to
 * marketing pacing and quality throttles, and is not suppressed by a recipient's
 * marketing opt-out.
 *
 * Language must match cfg.templateLanguage exactly (WHATSAPP_TEMPLATE_LANG,
 * default en_US). A locale mismatch returns error 132001, "template name does
 * not exist in the translation", and is the single most likely go-live failure.
 *
 * Kept in this file, beside the builders, so that changing a parameter order
 * without updating the approval text requires ignoring the diff sitting
 * directly underneath.
 */
export const TEMPLATE_APPROVAL_TEXT = {
  [CP_REGISTRATION_TEMPLATE_NAME]: {
    category: "UTILITY",
    header: null,
    body: [
      "New Channel Partner registered on Bhoomi Dwellers CRM.",
      "",
      "Company: {{1}}",
      "Contact Person: {{2}}",
      "Phone: {{3}}",
      "Address: {{4}}",
      "City: {{5}}",
      "Pincode: {{6}}",
      "GST: {{7}}",
      "Attendee: {{8}}",
      "Assigned Sourcing Manager: {{9}}",
      "Registered On: {{10}}",
      "Registered By: {{11}}",
      "",
      "Please review this partner in your Sourcing panel.",
    ].join("\n"),
    footer: "Bhoomi Dwellers CRM",
    buttons: null,
    /** Meta requires one sample per placeholder before it will accept the template. */
    samples: [
      "Shree Realty LLP",
      "Rakesh Shah",
      "+919876543210",
      "12 Link Road, Malad West",
      "Mumbai",
      "400064",
      "27AAAAA0000A1Z5",
      "Priya",
      "Amit Desai",
      "29 Jul 2026, 7:54 pm",
      "Priya Sharma",
    ],
  },
  [CP_LEAD_ASSIGNED_TEMPLATE_NAME]: {
    category: "UTILITY",
    header: null,
    body: [
      "New Channel Partner lead assigned to you.",
      "",
      "Client: {{1}}",
      "Phone: {{2}}",
      "Configuration: {{3}}",
      "Budget: {{4}}",
      "Channel Partner: {{5}}",
      "Logged By: {{6}}",
      "Received On: {{7}}",
      "",
      "Open your Sourcing panel to follow up.",
    ].join("\n"),
    footer: "Bhoomi Dwellers CRM",
    buttons: null,
    samples: [
      "Ramesh Iyer",
      "+919812345678",
      "2 BHK",
      "85 Lakh - 1 Cr",
      "Shree Realty LLP",
      "Priya Sharma",
      "29 Jul 2026, 7:54 pm",
    ],
  },
} as const;
