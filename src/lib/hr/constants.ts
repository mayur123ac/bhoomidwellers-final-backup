// lib/hr/constants.ts — shared HR module constants.

/** Roles that can access the HR panel. */
export const HR_ROLES = ["hr", "admin"] as const;

/** Roles that can view salary information. */
export const SALARY_VIEW_ROLES = ["hr", "admin"] as const;

/** Roles that can verify employee documents. */
export const DOC_VERIFY_ROLES = ["hr", "admin"] as const;

/** Roles that can manage company assets. */
export const ASSET_MANAGE_ROLES = ["hr", "admin"] as const;

/** Valid document verification statuses. */
export const DOC_STATUSES = ["pending", "verified", "rejected"] as const;

/** Valid compliance task statuses. */
export const TASK_STATUSES = ["pending", "overdue", "resolved"] as const;

/** Valid asset conditions. */
export const ASSET_CONDITIONS = ["new", "good", "fair", "poor", "damaged"] as const;

/** Valid asset statuses. */
export const ASSET_STATUSES = ["available", "assigned", "maintenance", "retired"] as const;

/** Valid employment statuses. */
export const EMPLOYMENT_STATUSES = ["active", "probation", "notice_period", "resigned", "terminated"] as const;

/** Valid employment types. */
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"] as const;

/** Max file size for HR document uploads (5 MB). */
export const MAX_DOC_SIZE_BYTES = 5 * 1024 * 1024;

/** Allowed MIME types for HR documents. */
export const ALLOWED_DOC_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** Leave types (HR-configurable categories). */
export const LEAVE_TYPES = ["casual", "sick", "earned", "unpaid"] as const;

/** Leave record statuses. */
export const LEAVE_STATUSES = ["approved", "cancelled"] as const;

/** Holiday types. */
export const HOLIDAY_TYPES = ["public", "restricted", "optional"] as const;

/** Days of the week for week-off configuration. */
export const DAYS_OF_WEEK = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

/** Employee incentive statuses. */
export const INCENTIVE_STATUSES = ["pending", "approved", "paid", "reversed"] as const;

/** Employee incentive sources. */
export const INCENTIVE_SOURCES = ["manual", "rule_applied"] as const;

/** Employee code prefix for auto-generation. */
export const EMPLOYEE_CODE_PREFIX = "BD";

/** Payroll period statuses. */
export const PAYROLL_PERIOD_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;

/** Payroll record statuses (includes 'exception' for individual issues). */
export const PAYROLL_RECORD_STATUSES = ["draft", "exception", "submitted", "approved", "rejected"] as const;

/** Payroll adjustment types. */
export const PAYROLL_ADJUSTMENT_TYPES = ["addition", "deduction"] as const;

/** Payroll adjustment sources. */
export const PAYROLL_ADJUSTMENT_SOURCES = ["manual", "incentive", "system"] as const;

/** Payroll payment statuses. */
export const PAYROLL_PAYMENT_STATUSES = ["completed", "reversed"] as const;

/** Roles that can approve payroll (Admin only, not HR — separation of duties). */
export const PAYROLL_APPROVE_ROLES = ["admin"] as const;
