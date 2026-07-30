export const adminAiTools = [
  {
    type: "function" as const,
    function: {
      name: "getRevenueSummary",
      description: "Get a high-level summary of all revenue metrics including total agreement value, OCR collected, SDR collected, loan disbursements, and balance receivable.",
      parameters: {
        type: "object",
        properties: {
          month: {
            type: "string",
            description: "Optional month filter (e.g., '2023-10'). If omitted, returns all-time data."
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "getLoanSummary",
      description: "Get the loan pipeline summary including total applied, sanctioned, pending, rejected, and disbursed amounts.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "getSalesManagerPerformance",
      description: "Get revenue and booking performance grouped by sales manager.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "getRegistrationSummary",
      description: "Get a summary of property registrations, including a list of customers who are awaiting registration.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "getInventorySummary",
      description: "Get a summary of inventory/configurations sold and available, grouped by property type (e.g., 2BHK, 3BHK).",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  }
];
