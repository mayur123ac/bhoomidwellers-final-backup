// admin-ai/tools.ts — the schemas the model chooses from.
//
// These are the ONLY operations the assistant can perform. There is no
// "run this SQL" tool and there will not be one: the model writes tool
// arguments, arguments are attacker-influenced by way of the user's question,
// and a SQL string assembled from them is arbitrary code execution against the
// CRM. Every entry below maps to a fixed, parameterised query in services.ts.
//
// All read-only. Adding a write tool later means adding an explicit confirmation
// step in the route, not just a new schema here.
//
// Note there is no parameter anywhere for a user, employee or manager identity.
// That is deliberate: the caller's identity comes from the signed session and is
// passed to handlers out of band, so no phrasing of a question can make the model
// ask for someone else's scope.

export const adminAiTools = [
  {
    type: "function" as const,
    function: {
      name: "getRevenueSummary",
      description:
        "Total agreement value, amounts collected (OCR, cash, loan disbursed), and balance receivable across bookings. Use for questions about revenue, collections, or how much money has come in. Optionally filtered to one month.",
      parameters: {
        type: "object",
        properties: {
          month: {
            type: "string",
            description: "Optional month as YYYY-MM, e.g. '2026-07'. Omit for all time.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getLoanSummary",
      description:
        "Loan pipeline grouped by status: number of cases, amounts requested, sanctioned and disbursed, plus total pending disbursement. Use for questions about the loan book overall.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getPendingDisbursements",
      description:
        "The specific customers whose sanctioned loan amount exceeds what has been disbursed, with the outstanding amount and expected date. Use when asked WHICH customers are awaiting disbursement.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getSalesManagerPerformance",
      description:
        "Bookings, agreement value and OCR collected per sales manager, best first. Use for questions about who is performing best or comparing managers.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getLeadsSummary",
      description:
        "Walk-in enquiry counts: total, lost, in closing, and a breakdown by source. Optionally filtered to one month. Use for lead volume and lead-source questions, including month-on-month comparisons (call once per month).",
      parameters: {
        type: "object",
        properties: {
          month: {
            type: "string",
            description: "Optional month as YYYY-MM, e.g. '2026-07'. Omit for all time.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getInventorySummary",
      description:
        "Unit counts from the inventory master, grouped by project, unit type and status (available, held, sold). Use for availability questions such as how many units are left in a project.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getRegistrationSummary",
      description:
        "How many bookings are registered versus pending, and which customers are still awaiting registration.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "searchKnowledgeBase",
      description:
        "Full-text search across follow-up notes written by staff about leads. Use for qualitative questions — what was discussed, why a deal stalled, what a customer asked for — that structured totals cannot answer.",
      parameters: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "Search phrase, e.g. 'loan rejected' or 'price negotiation'.",
          },
        },
        required: ["q"],
        additionalProperties: false,
      },
    },
  },
];
