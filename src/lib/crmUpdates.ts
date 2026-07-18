import { query } from "./db";

export interface CrmUpdate {
  id: number;
  version: string;
  title: string;
  description: string | null;
  category: string | null;
  features: string[] | any;
  is_important: boolean;
  created_by: string | null;
  created_at: Date;
}

/**
 * Creates a new CRM update in the database
 */
export async function createCrmUpdate(data: {
  version: string;
  title: string;
  description?: string;
  category?: string;
  features?: any; // usually an array of strings or JSON object
  is_important?: boolean;
  created_by?: string;
}) {
  const sql = `
    INSERT INTO crm_updates 
      (version, title, description, category, features, is_important, created_by)
    VALUES 
      ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *;
  `;

  const params = [
    data.version,
    data.title,
    data.description || null,
    data.category || null,
    data.features ? JSON.stringify(data.features) : null,
    data.is_important || false,
    data.created_by || null,
  ];

  const result = await query<CrmUpdate>(sql, params);
  return result[0];
}

/**
 * Retrieves all CRM updates, ordered by newest first
 */
export async function getCrmUpdates() {
  const sql = `
    SELECT * FROM crm_updates 
    ORDER BY created_at DESC;
  `;
  return await query<CrmUpdate>(sql);
}

/**
 * Marks an update as read for a specific user
 */
export async function markUpdateAsRead(userId: number, updateId: number) {
  const sql = `
    INSERT INTO crm_update_reads (user_id, update_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, update_id) DO NOTHING
    RETURNING *;
  `;
  await query(sql, [userId, updateId]);
  return true;
}

/**
 * Retrieves all updates along with a boolean indicating if the specific user has read them
 */
export async function getUpdatesWithReadStatus(userId: number) {
  const sql = `
    SELECT 
      u.*,
      CASE WHEN r.read_at IS NOT NULL THEN true ELSE false END as has_read
    FROM crm_updates u
    LEFT JOIN crm_update_reads r 
      ON u.id = r.update_id AND r.user_id = $1
    ORDER BY u.created_at DESC;
  `;
  
  return await query<CrmUpdate & { has_read: boolean }>(sql, [userId]);
}

/**
 * Updates an existing CRM update
 */
export async function updateCrmUpdate(id: number, data: {
  version: string;
  title: string;
  description?: string;
  category?: string;
  features?: any;
  is_important?: boolean;
}) {
  const sql = `
    UPDATE crm_updates 
    SET 
      version = $1, 
      title = $2, 
      description = $3, 
      category = $4, 
      features = $5, 
      is_important = $6
    WHERE id = $7
    RETURNING *;
  `;

  const params = [
    data.version,
    data.title,
    data.description || null,
    data.category || null,
    data.features ? JSON.stringify(data.features) : null,
    data.is_important || false,
    id,
  ];

  const result = await query<CrmUpdate>(sql, params);
  return result[0];
}

/**
 * Deletes a CRM update
 */
export async function deleteCrmUpdate(id: number) {
  const sql = `DELETE FROM crm_updates WHERE id = $1 RETURNING id;`;
  const result = await query<{ id: number }>(sql, [id]);
  return result.length > 0;
}
