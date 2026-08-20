// components/superadmin/mockData.ts
//
// ⚠ PHASE 1 PLACEHOLDER DATA — NOT REAL, AND NOT READ FROM ANY DATABASE.
//
// Phase 1 is explicitly UI-only: no API routes, no schema, no tenant reads. Every
// value below is invented so the layouts can be judged with realistic shapes —
// long organization names, an inactive tenant, a suspended one, a tenant with
// zero activity — rather than with three tidy rows that make any table look good.
//
// Phase 2 replaces this file's *consumers*, not this file: each view already
// reads through the `SuperAdminData` shape below, so wiring the real endpoints
// means swapping the source, not rewriting the components.
//
// The single real value here is the Bhoomi organization id, which is public in
// this codebase already and makes the list recognisable during review. No tenant
// records, user records, or counts are real.

export interface OrgRow {
  id: string;
  name: string;
  status: "active" | "inactive" | "suspended";
  users: number;
  admins: number;
  createdOn: string;
  lastActivity: string | null;
  /** Detail-drawer figures. */
  leads: number;
  bookings: number;
  projects: number;
}

export interface PlatformUser {
  id: number;
  name: string;
  email: string;
  role: string;
  organization: string;
  status: "active" | "inactive";
  createdOn: string;
}

export interface ActivityEntry {
  id: string;
  at: string;
  actor: string;
  actorRole: string;
  organization: string | null;
  action: string;
  detail: string;
  severity: "info" | "notice" | "warning";
}

export const MOCK_ORGS: OrgRow[] = [
  {
    id: "d2f5f87d-1e53-4970-9961-e27dbe94fc9c",
    name: "Bhoomi Dwellers",
    status: "active",
    users: 11, admins: 1,
    createdOn: "2026-05-02T09:15:00+05:30",
    lastActivity: "2026-08-20T18:42:00+05:30",
    leads: 314, bookings: 10, projects: 6,
  },
  {
    id: "7c103a2b-f139-46bc-bd27-a3a8f8fc0062",
    name: "Viraj Constructions & Developers LLP",
    status: "active",
    users: 24, admins: 2,
    createdOn: "2026-06-18T11:40:00+05:30",
    lastActivity: "2026-08-20T16:05:00+05:30",
    leads: 892, bookings: 41, projects: 12,
  },
  {
    id: "32bed33e-1da5-4c54-826f-a7bce62c28a6",
    name: "Precise Homes",
    status: "active",
    users: 7, admins: 1,
    createdOn: "2026-07-01T14:22:00+05:30",
    lastActivity: "2026-08-19T10:12:00+05:30",
    leads: 128, bookings: 3, projects: 2,
  },
  {
    id: "b41f0c77-2c8e-4d31-90a5-11d9f2c4a7e3",
    name: "Ghar Junction Realty",
    status: "inactive",
    users: 3, admins: 1,
    createdOn: "2026-07-14T08:05:00+05:30",
    lastActivity: "2026-07-29T13:47:00+05:30",
    leads: 22, bookings: 0, projects: 1,
  },
  {
    id: "e90a5d18-6b74-4e02-a3cc-5f2b8e14d6aa",
    name: "Corizon Infra",
    status: "suspended",
    users: 5, admins: 1,
    createdOn: "2026-06-30T17:30:00+05:30",
    lastActivity: "2026-08-02T09:00:00+05:30",
    leads: 64, bookings: 2, projects: 3,
  },
  {
    id: "1a7c4e93-88d0-42b6-9f1e-c3d05a7b2f44",
    name: "K.R Reality",
    status: "active",
    users: 2, admins: 1,
    createdOn: "2026-08-16T12:00:00+05:30",
    lastActivity: null,
    leads: 0, bookings: 0, projects: 0,
  },
];

export const MOCK_USERS: PlatformUser[] = [
  { id: 1, name: "Admin", email: "admin@bhoomi.com", role: "Admin", organization: "Bhoomi Dwellers", status: "active", createdOn: "2026-05-02T09:15:00+05:30" },
  { id: 4, name: "Neha Burman", email: "asknehaburman@bhoomidwellers.in", role: "Site Head", organization: "Bhoomi Dwellers", status: "active", createdOn: "2026-05-11T10:02:00+05:30" },
  { id: 8, name: "Tanya Kushwaha", email: "receptionist@bhoomidwellers.in", role: "Receptionist", organization: "Bhoomi Dwellers", status: "active", createdOn: "2026-05-19T15:31:00+05:30" },
  { id: 61, name: "Ashish Singh", email: "ashish@bhoomidwellers.in", role: "Sourcing Manager", organization: "Bhoomi Dwellers", status: "active", createdOn: "2026-07-26T09:44:00+05:30" },
  { id: 102, name: "Rohit Deshpande", email: "rohit@virajdevelopers.in", role: "Admin", organization: "Viraj Constructions & Developers LLP", status: "active", createdOn: "2026-06-18T11:41:00+05:30" },
  { id: 118, name: "Sneha Kulkarni", email: "sneha@virajdevelopers.in", role: "Sales Manager", organization: "Viraj Constructions & Developers LLP", status: "active", createdOn: "2026-06-25T13:20:00+05:30" },
  { id: 140, name: "Imran Shaikh", email: "imran@precisehomes.in", role: "Admin", organization: "Precise Homes", status: "active", createdOn: "2026-07-01T14:23:00+05:30" },
  { id: 155, name: "Deepa Rane", email: "deepa@gharjunction.in", role: "Admin", organization: "Ghar Junction Realty", status: "inactive", createdOn: "2026-07-14T08:06:00+05:30" },
  { id: 166, name: "Sameer Patil", email: "sameer@corizoninfra.in", role: "Admin", organization: "Corizon Infra", status: "inactive", createdOn: "2026-06-30T17:31:00+05:30" },
];

export const MOCK_ACTIVITY: ActivityEntry[] = [
  { id: "a1", at: "2026-08-20T18:42:00+05:30", actor: "Admin", actorRole: "Admin", organization: "Bhoomi Dwellers", action: "Booking confirmed", detail: "BK-2026-08-15-00023", severity: "info" },
  { id: "a2", at: "2026-08-20T16:05:00+05:30", actor: "Sneha Kulkarni", actorRole: "Sales Manager", organization: "Viraj Constructions & Developers LLP", action: "Lead assigned", detail: "42 leads bulk-assigned", severity: "info" },
  { id: "a3", at: "2026-08-20T12:18:00+05:30", actor: "Platform", actorRole: "System", organization: null, action: "Migration applied", detail: "cp_visits, cp_chat_messages", severity: "notice" },
  { id: "a4", at: "2026-08-19T21:07:00+05:30", actor: "Sameer Patil", actorRole: "Admin", organization: "Corizon Infra", action: "Repeated failed sign-in", detail: "5 attempts in 4 minutes", severity: "warning" },
  { id: "a5", at: "2026-08-19T10:12:00+05:30", actor: "Imran Shaikh", actorRole: "Admin", organization: "Precise Homes", action: "User invited", detail: "2 invitations sent", severity: "info" },
  { id: "a6", at: "2026-08-18T15:55:00+05:30", actor: "Platform", actorRole: "System", organization: "Ghar Junction Realty", action: "Organization deactivated", detail: "No activity for 21 days", severity: "notice" },
];

/** The shape every view reads. Phase 2 fills this from the platform APIs. */
export interface SuperAdminData {
  orgs: OrgRow[];
  users: PlatformUser[];
  activity: ActivityEntry[];
}

export const MOCK_DATA: SuperAdminData = {
  orgs: MOCK_ORGS,
  users: MOCK_USERS,
  activity: MOCK_ACTIVITY,
};
