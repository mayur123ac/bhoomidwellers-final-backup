# Batch 1: Users, Roles, Authentication Audit Classification

| File | Query | Table | Classification | Required Action |
|---|---|---|---|---|
| src\app\api\auth\login\route.ts | `SELECT $1, $2, $3, $4, $5, true, u.organization_id FROM users u WHERE u.id = $1 ` | users | AUTH/SYSTEM | REVIEW (Likely requires no changes or special handling) |
| src\app\api\auth\signup\route.ts | `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1` | users | AUTH/SYSTEM | REVIEW (Likely requires no changes or special handling) |
| src\app\api\roles\route.ts | `const roles = await query(` | roles | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\roles\route.ts | `SELECT id, name FROM roles ORDER BY name ASC` | roles | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\roles\route.ts | `SELECT id FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1` | roles | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\account\route.ts | `SELECT password FROM users WHERE id = $1` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\activity-logs\route.ts | `SELECT id, name FROM users WHERE deleted_at IS NULL ORDER BY name` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\deactivate\route.ts | `SELECT password, name, email, role FROM users WHERE id = $1 LIMIT 1` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\deactivate\route.ts | `SELECT COUNT(*)::text AS count FROM users` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\deactivate\route.ts | `SELECT id, name FROM users` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\email-change\route.ts | `SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2 LIMIT 1` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\email-change\route.ts | `(SELECT organization_id FROM users WHERE id = $1))` | users | ALREADY SAFE | None |
| src\app\api\settings\email-verify\route.ts | `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\employees\route.ts | `SELECT id, email, name FROM users` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\employees\route.ts | `SELECT COUNT(*)::text AS count FROM users` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\employees\route.ts | `SELECT COUNT(*)::text AS count FROM users` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\employees\route.ts | `SELECT id FROM users WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\employees\route.ts | `SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2 LIMIT 1` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\employees\route.ts | `SELECT COUNT(*)::text AS count FROM users` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\employees\route.ts | `SELECT COUNT(*)::text AS count FROM users` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\feature-prefs\route.ts | `SELECT name, feature_prefs FROM public.users WHERE id = $1 LIMIT 1` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\notification-recipients\route.ts | `(SELECT organization_id FROM users WHERE id = $1))` | users | ALREADY SAFE | None |
| src\app\api\settings\password\route.ts | `SELECT password, name, email FROM users WHERE id = $1 LIMIT 1` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\profile\route.ts | `SELECT id FROM users WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\whatsapp-integration\route.ts | `SELECT whatsapp_number, name FROM public.users WHERE id = $1 LIMIT 1` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\settings\workspace\route.ts | `SELECT COUNT(*)::text AS count FROM users WHERE deleted_at IS NULL AND is_active` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\users\site-head\route.ts | `// CHANGED: Using the "users" table and SELECT * to avoid column name mismatches` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\users\site-head\route.ts | `SELECT * FROM users` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\users\update-whatsapp\route.ts | `SELECT whatsapp_number FROM public.users WHERE name = $1 LIMIT 1` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
| src\app\api\users\update-whatsapp\route.ts | `SELECT whatsapp_number FROM public.users WHERE id = $1 LIMIT 1` | users | TENANT-SCOPED | Append `organization_id = $orgId` |
