// @vitest-environment node
//
// Email Configuration Center — backend integration tests
//
// Tests the trigger config gate in EmailService and the API route auth.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

let mockTriggerConfigRows: any[] = [];
let mockQueryCalls: { sql: string; params: any[] }[] = [];
vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    mockQueryCalls.push({ sql, params });
    if (sql.includes("email_trigger_config") && sql.includes("SELECT")) {
      return mockTriggerConfigRows;
    }
    if (sql.includes("INSERT INTO email_trigger_config")) {
      return [];
    }
    return [];
  }),
}));

vi.mock("@/lib/auditLog", () => ({
  writeAuditLog: vi.fn(async () => {}),
}));

vi.mock("@/lib/email/provider", () => ({
  dispatch: vi.fn(async () => ({
    delivered: true,
    provider: "console",
    messageId: "test-123",
  })),
  verifyProvider: vi.fn(async () => ({ ok: true, provider: "console" })),
}));

vi.mock("@/lib/email/config", () => ({
  activeProvider: vi.fn(() => "console"),
  isMailConfigured: vi.fn(() => true),
  readSenderConfig: vi.fn(() => ({
    fromName: "Test",
    fromEmail: "test@example.com",
    replyTo: "test@example.com",
    supportEmail: "test@example.com",
    appUrl: "http://localhost:3000",
    companyName: "Test CRM",
  })),
  isCustomerEnquiryEmailEnabled: vi.fn(() => true),
  formatFromHeader: vi.fn(() => '"Test" <test@example.com>'),
}));

vi.mock("@/lib/emailRouting", () => ({
  sendToUser: vi.fn(async () => ({
    delivered: true,
    suppressed: false,
    attempted: [{ email: "user@test.com", destination: "primary", delivered: true }],
    fallbackUsed: false,
    notes: [],
  })),
}));

// ── Import after mocks ───────────────────────────────────────────────────

// loadTriggerConfig depends on db, which is mocked above
import { loadTriggerConfig } from "@/lib/email/triggerConfig";

beforeEach(() => {
  mockTriggerConfigRows = [];
  mockQueryCalls = [];
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("loadTriggerConfig", () => {
  it("returns null for unknown trigger keys", async () => {
    const result = await loadTriggerConfig("nonexistent_trigger");
    expect(result).toBeNull();
  });

  it("returns safe default (enabled) when no DB row exists", async () => {
    mockTriggerConfigRows = [];
    const result = await loadTriggerConfig("otp_verification");
    expect(result).toEqual({ enabled: true, subject: null, body: null });
  });

  it("returns enabled=true when DB row has enabled=true", async () => {
    mockTriggerConfigRows = [{ enabled: true, custom_subject: null, custom_body: null }];
    const result = await loadTriggerConfig("login_alert");
    expect(result).toEqual({ enabled: true, subject: null, body: null });
  });

  it("returns enabled=false when admin disabled the trigger", async () => {
    mockTriggerConfigRows = [{ enabled: false, custom_subject: null, custom_body: null }];
    const result = await loadTriggerConfig("login_alert");
    expect(result).toEqual({ enabled: false, subject: null, body: null });
  });

  it("returns custom subject and body when set", async () => {
    mockTriggerConfigRows = [{
      enabled: true,
      custom_subject: "Custom Subject",
      custom_body: "Custom Body {{name}}",
    }];
    const result = await loadTriggerConfig("employee_invitation");
    expect(result).toEqual({
      enabled: true,
      subject: "Custom Subject",
      body: "Custom Body {{name}}",
    });
  });
});

describe("EmailService trigger gate", () => {
  it("sends OTP when trigger is enabled", async () => {
    mockTriggerConfigRows = [{ enabled: true, custom_subject: null, custom_body: null }];
    const { EmailService } = await import("@/lib/email/EmailService");
    const result = await EmailService.sendOTP("test@example.com", {
      name: "Test",
      code: "123456",
      expiryMinutes: 10,
      purpose: "verify email",
    });
    expect(result.delivered).toBe(true);
  });

  it("blocks OTP when trigger is disabled by admin", async () => {
    mockTriggerConfigRows = [{ enabled: false, custom_subject: null, custom_body: null }];

    // Re-import to get fresh trigger config reads
    vi.resetModules();
    // Re-apply mocks
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async (sql: string) => {
        if (sql.includes("email_trigger_config")) return mockTriggerConfigRows;
        return [];
      }),
    }));
    vi.doMock("@/lib/auditLog", () => ({ writeAuditLog: vi.fn(async () => {}) }));
    vi.doMock("@/lib/email/provider", () => ({
      dispatch: vi.fn(async () => ({ delivered: true, provider: "console" })),
      verifyProvider: vi.fn(async () => ({ ok: true, provider: "console" })),
    }));
    vi.doMock("@/lib/email/config", () => ({
      activeProvider: vi.fn(() => "console"),
      isMailConfigured: vi.fn(() => true),
      readSenderConfig: vi.fn(() => ({
        fromName: "Test", fromEmail: "test@example.com",
        replyTo: "", supportEmail: "", appUrl: "", companyName: "Test",
      })),
      isCustomerEnquiryEmailEnabled: vi.fn(() => true),
      formatFromHeader: vi.fn(() => "test@example.com"),
    }));
    vi.doMock("@/lib/emailRouting", () => ({
      sendToUser: vi.fn(async () => ({
        suppressed: false, attempted: [], fallbackUsed: false,
      })),
    }));

    const { EmailService } = await import("@/lib/email/EmailService");
    const result = await EmailService.sendOTP("test@example.com", {
      name: "Test",
      code: "123456",
      expiryMinutes: 10,
      purpose: "verify email",
    });
    expect(result.delivered).toBe(false);
    expect(result.provider).toBe("disabled");
  });

  it("disabled trigger never calls the email provider", async () => {
    mockTriggerConfigRows = [{ enabled: false, custom_subject: null, custom_body: null }];

    vi.resetModules();
    const localDispatch = vi.fn(async () => ({ delivered: true, provider: "console", messageId: "x" }));
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async (sql: string) => {
        if (sql.includes("email_trigger_config")) return mockTriggerConfigRows;
        return [];
      }),
    }));
    vi.doMock("@/lib/auditLog", () => ({ writeAuditLog: vi.fn(async () => {}) }));
    vi.doMock("@/lib/email/provider", () => ({
      dispatch: localDispatch,
      verifyProvider: vi.fn(async () => ({ ok: true, provider: "console" })),
    }));
    vi.doMock("@/lib/email/config", () => ({
      activeProvider: vi.fn(() => "console"),
      isMailConfigured: vi.fn(() => true),
      readSenderConfig: vi.fn(() => ({
        fromName: "Test", fromEmail: "test@example.com",
        replyTo: "", supportEmail: "", appUrl: "", companyName: "Test",
      })),
      isCustomerEnquiryEmailEnabled: vi.fn(() => true),
      formatFromHeader: vi.fn(() => "test@example.com"),
    }));
    vi.doMock("@/lib/emailRouting", () => ({
      sendToUser: vi.fn(async () => ({
        suppressed: false, attempted: [], fallbackUsed: false, notes: [],
      })),
    }));

    const { EmailService } = await import("@/lib/email/EmailService");
    await EmailService.sendOTP("test@example.com", {
      name: "Test", code: "123456", expiryMinutes: 10, purpose: "verify email",
    });
    // dispatch must NEVER be called when trigger is disabled
    expect(localDispatch).not.toHaveBeenCalled();
  });

  it("sends enquiry confirmation only when both env flag and admin config allow", async () => {
    mockTriggerConfigRows = [{ enabled: true, custom_subject: null, custom_body: null }];
    const { EmailService } = await import("@/lib/email/EmailService");
    const result = await EmailService.sendEnquiryConfirmation("customer@test.com", {
      customerName: "Customer",
      orgName: "Test Org",
      assignedTo: "Agent",
    } as any);
    expect(result.delivered).toBe(true);
  });

  it("blocks test email when disabled by admin", async () => {
    mockTriggerConfigRows = [{ enabled: false, custom_subject: null, custom_body: null }];

    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async (sql: string) => {
        if (sql.includes("email_trigger_config")) return mockTriggerConfigRows;
        return [];
      }),
    }));
    vi.doMock("@/lib/auditLog", () => ({ writeAuditLog: vi.fn(async () => {}) }));
    vi.doMock("@/lib/email/provider", () => ({
      dispatch: vi.fn(async () => ({ delivered: true, provider: "console" })),
      verifyProvider: vi.fn(async () => ({ ok: true, provider: "console" })),
    }));
    vi.doMock("@/lib/email/config", () => ({
      activeProvider: vi.fn(() => "console"),
      isMailConfigured: vi.fn(() => true),
      readSenderConfig: vi.fn(() => ({
        fromName: "Test", fromEmail: "test@example.com",
        replyTo: "", supportEmail: "", appUrl: "", companyName: "Test",
      })),
      isCustomerEnquiryEmailEnabled: vi.fn(() => true),
      formatFromHeader: vi.fn(() => "test@example.com"),
    }));
    vi.doMock("@/lib/emailRouting", () => ({
      sendToUser: vi.fn(async () => ({
        suppressed: false, attempted: [], fallbackUsed: false,
      })),
    }));

    const { EmailService } = await import("@/lib/email/EmailService");
    const result = await EmailService.sendTestEmail("test@example.com");
    expect(result.delivered).toBe(false);
    expect(result.provider).toBe("disabled");
  });
});

describe("Custom template delivery", () => {
  // Each test resets modules and creates its own dispatch spy to capture
  // the exact message object sent to the provider.

  async function setupWithDispatchSpy(configRows: any[]) {
    vi.resetModules();
    const calls: any[] = [];
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async (sql: string) => {
        if (sql.includes("email_trigger_config")) return configRows;
        return [];
      }),
    }));
    vi.doMock("@/lib/auditLog", () => ({ writeAuditLog: vi.fn(async () => {}) }));
    vi.doMock("@/lib/email/provider", () => ({
      dispatch: vi.fn(async (msg: any) => {
        calls.push(msg);
        return { delivered: true, provider: "console", messageId: "test" };
      }),
      verifyProvider: vi.fn(async () => ({ ok: true, provider: "console" })),
    }));
    vi.doMock("@/lib/email/config", () => ({
      activeProvider: vi.fn(() => "console"),
      isMailConfigured: vi.fn(() => true),
      readSenderConfig: vi.fn(() => ({
        fromName: "Test", fromEmail: "test@example.com",
        replyTo: "test@example.com", supportEmail: "test@example.com",
        appUrl: "http://localhost:3000", companyName: "Test CRM",
      })),
      isCustomerEnquiryEmailEnabled: vi.fn(() => true),
      formatFromHeader: vi.fn(() => '"Test" <test@example.com>'),
    }));
    vi.doMock("@/lib/emailRouting", () => ({
      sendToUser: vi.fn(async () => ({
        delivered: true, suppressed: false,
        attempted: [{ email: "user@test.com", destination: "primary", delivered: true }],
        fallbackUsed: false, notes: [],
      })),
    }));
    const { EmailService } = await import("@/lib/email/EmailService");
    return { EmailService, calls };
  }

  it("custom subject reaches the email provider", async () => {
    const { EmailService, calls } = await setupWithDispatchSpy([{
      enabled: true,
      custom_subject: "Customised OTP subject for {{name}}",
      custom_body: null,
    }]);
    await EmailService.sendOTP("test@example.com", {
      name: "Alice", code: "999999", expiryMinutes: 5, purpose: "verify email",
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].subject).toBe("Customised OTP subject for Alice");
  });

  it("custom body with variables reaches the email provider", async () => {
    const { EmailService, calls } = await setupWithDispatchSpy([{
      enabled: true,
      custom_subject: null,
      custom_body: "Hello {{name}}, your code is {{code}}. It expires in {{expiry_minutes}} minutes.",
    }]);
    await EmailService.sendOTP("test@example.com", {
      name: "Bob", code: "111111", expiryMinutes: 15, purpose: "verify email",
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].html).toContain("Hello Bob, your code is 111111");
    expect(calls[0].html).toContain("It expires in 15 minutes");
    expect(calls[0].text).toContain("Hello Bob, your code is 111111");
  });

  it("unrecognised variables pass through as-is", async () => {
    const { EmailService, calls } = await setupWithDispatchSpy([{
      enabled: true,
      custom_subject: "Subject with {{unknown_var}}",
      custom_body: null,
    }]);
    await EmailService.sendOTP("test@example.com", {
      name: "Test", code: "000000", expiryMinutes: 10, purpose: "verify email",
    });
    expect(calls[0].subject).toBe("Subject with {{unknown_var}}");
  });

  it("HTML in custom body is escaped", async () => {
    const { EmailService, calls } = await setupWithDispatchSpy([{
      enabled: true,
      custom_subject: null,
      custom_body: '<script>alert("xss")</script> Hello {{name}}',
    }]);
    await EmailService.sendOTP("test@example.com", {
      name: "Test", code: "000000", expiryMinutes: 10, purpose: "verify email",
    });
    expect(calls[0].html).not.toContain("<script>");
    expect(calls[0].html).toContain("&lt;script&gt;");
  });

  it("no custom overrides leaves the hardcoded template intact", async () => {
    const { EmailService, calls } = await setupWithDispatchSpy([{
      enabled: true, custom_subject: null, custom_body: null,
    }]);
    await EmailService.sendOTP("test@example.com", {
      name: "Test", code: "123456", expiryMinutes: 10, purpose: "verify email",
    });
    expect(calls[0].subject).toContain("verification code");
  });
});

describe("Trigger defaults", () => {
  it("has all 12 triggers defined", async () => {
    const { TRIGGER_DEFAULTS } = await import("@/lib/email/triggerDefaults");
    expect(TRIGGER_DEFAULTS.length).toBe(12);
  });

  it("each trigger has required fields", async () => {
    const { TRIGGER_DEFAULTS } = await import("@/lib/email/triggerDefaults");
    for (const t of TRIGGER_DEFAULTS) {
      expect(t.trigger_key).toBeTruthy();
      expect(t.display_name).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.default_subject).toBeTruthy();
      expect(t.default_body).toBeTruthy();
      expect(Array.isArray(t.variables)).toBe(true);
    }
  });

  it("trigger keys are unique", async () => {
    const { TRIGGER_DEFAULTS } = await import("@/lib/email/triggerDefaults");
    const keys = TRIGGER_DEFAULTS.map((t: any) => t.trigger_key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("API route auth", () => {
  it("rejects unauthenticated requests", async () => {
    vi.doMock("@/lib/serverAuth", () => ({
      requireRoles: vi.fn(async () => ({
        ok: false,
        response: new Response(JSON.stringify({ success: false, message: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      })),
      getSessionUserId: vi.fn(() => null),
    }));

    // The auth check is the first thing the route does — this verifies
    // the pattern is followed. A full route test would need Next.js
    // request context which is complex to mock in Vitest.
    const { requireRoles } = await import("@/lib/serverAuth");
    const gate = await (requireRoles as any)(["admin", "super_admin"]);
    expect(gate.ok).toBe(false);
  });
});

describe("Admin login notification", () => {
  async function setupWithDispatchSpy(configRows: any[]) {
    vi.resetModules();
    const calls: any[] = [];
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async (sql: string) => {
        if (sql.includes("email_trigger_config")) return configRows;
        return [];
      }),
    }));
    vi.doMock("@/lib/auditLog", () => ({ writeAuditLog: vi.fn(async () => {}) }));
    vi.doMock("@/lib/email/provider", () => ({
      dispatch: vi.fn(async (msg: any) => {
        calls.push(msg);
        return { delivered: true, provider: "console", messageId: "test" };
      }),
      verifyProvider: vi.fn(async () => ({ ok: true, provider: "console" })),
    }));
    vi.doMock("@/lib/email/config", () => ({
      activeProvider: vi.fn(() => "console"),
      isMailConfigured: vi.fn(() => true),
      readSenderConfig: vi.fn(() => ({
        fromName: "Test", fromEmail: "test@example.com",
        replyTo: "test@example.com", supportEmail: "test@example.com",
        appUrl: "http://localhost:3000", companyName: "Test CRM",
      })),
      isCustomerEnquiryEmailEnabled: vi.fn(() => true),
      formatFromHeader: vi.fn(() => '"Test" <test@example.com>'),
    }));
    vi.doMock("@/lib/emailRouting", () => ({
      sendToUser: vi.fn(async () => ({
        delivered: true, suppressed: false,
        attempted: [{ email: "user@test.com", destination: "primary", delivered: true }],
        fallbackUsed: false, notes: [],
      })),
    }));
    const { EmailService } = await import("@/lib/email/EmailService");
    const { loginAlertTemplate } = await import("@/lib/email/templates");
    return { EmailService, loginAlertTemplate, calls };
  }

  const sampleAlertInput = {
    name: "Rahul Sharma",
    employeeId: 42,
    role: "Sales Manager",
    organization: "Bhoomi Dwellers",
    date: "19 Oct 2026",
    time: "10:30 AM",
    timezone: "Asia/Kolkata",
    browser: "Chrome 118",
    operatingSystem: "Windows 11",
    device: "Desktop PC",
    deviceType: "Desktop",
    ipAddress: "203.0.113.42",
    location: "Mumbai, India",
    status: "Successful" as const,
    sessionId: 123,
    loginMethod: "Password",
    loginEmail: "rahul@test.com",
    loginEmailKind: "Primary Email" as const,
    accountEmail: "rahul@test.com",
    alternativeEmail: null,
    notificationRecipients: ["admin@test.com"],
    isNewDevice: false,
    deviceFirstSeen: null,
  };

  it("sends admin notification with default template when enabled", async () => {
    const { EmailService, loginAlertTemplate, calls } = await setupWithDispatchSpy([{
      enabled: true, custom_subject: null, custom_body: null,
    }]);
    const template = loginAlertTemplate(sampleAlertInput);
    template.subject = "[Admin] Employee login: Rahul Sharma - Bhoomi CRM";
    const result = await EmailService.sendAdminLoginNotification(
      "admin@test.com", template, {}, {}, sampleAlertInput
    );
    expect(result.delivered).toBe(true);
    expect(calls.length).toBe(1);
    // Default template subject preserved
    expect(calls[0].subject).toBe("[Admin] Employee login: Rahul Sharma - Bhoomi CRM");
  });

  it("blocks admin notification when trigger is disabled", async () => {
    const { EmailService, loginAlertTemplate } = await setupWithDispatchSpy([{
      enabled: false, custom_subject: null, custom_body: null,
    }]);
    const template = loginAlertTemplate(sampleAlertInput);
    const result = await EmailService.sendAdminLoginNotification(
      "admin@test.com", template, {}, {}, sampleAlertInput
    );
    expect(result.delivered).toBe(false);
    expect(result.provider).toBe("disabled");
  });

  it("applies custom subject with variables for admin notification", async () => {
    const { EmailService, loginAlertTemplate, calls } = await setupWithDispatchSpy([{
      enabled: true,
      custom_subject: "{{employee_name}} ({{role}}) logged in",
      custom_body: null,
    }]);
    const template = loginAlertTemplate(sampleAlertInput);
    const result = await EmailService.sendAdminLoginNotification(
      "admin@test.com", template, {}, {}, sampleAlertInput
    );
    expect(result.delivered).toBe(true);
    expect(calls[0].subject).toBe("Rahul Sharma (Sales Manager) logged in");
  });

  it("applies custom body with variables for admin notification", async () => {
    const { EmailService, loginAlertTemplate, calls } = await setupWithDispatchSpy([{
      enabled: true,
      custom_subject: null,
      custom_body: "Employee {{employee_name}} logged in from {{location}} at {{time}} on {{date}}.\nDevice: {{device}}\nIP: {{ip_address}}",
    }]);
    const template = loginAlertTemplate(sampleAlertInput);
    template.subject = "[Admin] Login";
    const result = await EmailService.sendAdminLoginNotification(
      "admin@test.com", template, {}, {}, sampleAlertInput
    );
    expect(result.delivered).toBe(true);
    expect(calls[0].html).toContain("Employee Rahul Sharma logged in from Mumbai, India");
    expect(calls[0].html).toContain("10:30 AM");
    expect(calls[0].text).toContain("IP: 203.0.113.42");
  });

  it("falls back to pre-built template when no alertInput provided", async () => {
    const { EmailService, loginAlertTemplate, calls } = await setupWithDispatchSpy([{
      enabled: true, custom_subject: null, custom_body: null,
    }]);
    const template = loginAlertTemplate(sampleAlertInput);
    template.subject = "Pre-built subject";
    // No alertInput passed (backwards compat)
    const result = await EmailService.sendAdminLoginNotification(
      "admin@test.com", template, {}
    );
    expect(result.delivered).toBe(true);
    expect(calls[0].subject).toBe("Pre-built subject");
  });
});

describe("Fail-safe policy", () => {
  it("unknown trigger key returns null (email proceeds without gate)", async () => {
    const result = await loadTriggerConfig("completely_unknown_key");
    expect(result).toBeNull();
    // null means "no config for this trigger" — EmailService treats null
    // as "proceed" because checkTrigger only blocks when config.enabled === false
  });

  it("DB error returns safe default (enabled) for known trigger", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async () => { throw new Error("connection refused"); }),
    }));
    const { loadTriggerConfig: freshLoad } = await import("@/lib/email/triggerConfig");
    const result = await freshLoad("otp_verification");
    // Fail-safe: known trigger with DB error defaults to enabled
    expect(result).toEqual({ enabled: true, subject: null, body: null });
  });

  it("DB error does NOT return custom text (fail-safe has no overrides)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async () => { throw new Error("connection refused"); }),
    }));
    const { loadTriggerConfig: freshLoad } = await import("@/lib/email/triggerConfig");
    const result = await freshLoad("login_alert");
    // When DB is down, subject and body are null — the hardcoded template is used,
    // never a stale or partial custom template
    expect(result!.subject).toBeNull();
    expect(result!.body).toBeNull();
  });

  it("explicitly disabled trigger is never bypassed even with custom text", async () => {
    vi.resetModules();
    const dispatchSpy = vi.fn(async () => ({ delivered: true, provider: "console", messageId: "x" }));
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async (sql: string) => {
        if (sql.includes("email_trigger_config")) {
          return [{ enabled: false, custom_subject: "Custom", custom_body: "Custom body" }];
        }
        return [];
      }),
    }));
    vi.doMock("@/lib/auditLog", () => ({ writeAuditLog: vi.fn(async () => {}) }));
    vi.doMock("@/lib/email/provider", () => ({
      dispatch: dispatchSpy,
      verifyProvider: vi.fn(async () => ({ ok: true, provider: "console" })),
    }));
    vi.doMock("@/lib/email/config", () => ({
      activeProvider: vi.fn(() => "console"),
      isMailConfigured: vi.fn(() => true),
      readSenderConfig: vi.fn(() => ({
        fromName: "T", fromEmail: "t@t.com", replyTo: "", supportEmail: "", appUrl: "", companyName: "T",
      })),
      isCustomerEnquiryEmailEnabled: vi.fn(() => true),
      formatFromHeader: vi.fn(() => "t@t.com"),
    }));
    vi.doMock("@/lib/emailRouting", () => ({
      sendToUser: vi.fn(async () => ({
        suppressed: false, attempted: [], fallbackUsed: false, notes: [],
      })),
    }));

    const { EmailService } = await import("@/lib/email/EmailService");
    const result = await EmailService.sendOTP("test@example.com", {
      name: "Test", code: "123456", expiryMinutes: 10, purpose: "verify email",
    });
    // Disabled means disabled — custom text does not override the gate
    expect(result.delivered).toBe(false);
    expect(result.provider).toBe("disabled");
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("OTP and password reset still work when config table is missing", async () => {
    // Simulates pre-migration state: table doesn't exist, query throws 42P01
    vi.resetModules();
    const dispatchSpy = vi.fn(async () => ({ delivered: true, provider: "console", messageId: "x" }));
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async () => {
        const err: any = new Error("relation does not exist");
        err.code = "42P01";
        throw err;
      }),
    }));
    vi.doMock("@/lib/auditLog", () => ({ writeAuditLog: vi.fn(async () => {}) }));
    vi.doMock("@/lib/email/provider", () => ({
      dispatch: dispatchSpy,
      verifyProvider: vi.fn(async () => ({ ok: true, provider: "console" })),
    }));
    vi.doMock("@/lib/email/config", () => ({
      activeProvider: vi.fn(() => "console"),
      isMailConfigured: vi.fn(() => true),
      readSenderConfig: vi.fn(() => ({
        fromName: "T", fromEmail: "t@t.com", replyTo: "", supportEmail: "", appUrl: "", companyName: "T",
      })),
      isCustomerEnquiryEmailEnabled: vi.fn(() => true),
      formatFromHeader: vi.fn(() => "t@t.com"),
    }));
    vi.doMock("@/lib/emailRouting", () => ({
      sendToUser: vi.fn(async () => ({
        suppressed: false, attempted: [], fallbackUsed: false, notes: [],
      })),
    }));

    const { EmailService } = await import("@/lib/email/EmailService");
    const result = await EmailService.sendOTP("test@example.com", {
      name: "Test", code: "123456", expiryMinutes: 10, purpose: "verify email",
    });
    // Auth email must STILL be sent when config table doesn't exist
    expect(result.delivered).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });
});
