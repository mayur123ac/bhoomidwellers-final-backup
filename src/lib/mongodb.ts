// src/lib/mongodb.ts  — safe stub, MongoDB fully removed
import { Pool } from "pg";

// Legacy exports kept so any remaining imports don't break
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

export const connectMongoDB = async () => {
  // no-op — MongoDB removed, using PostgreSQL via lib/db.ts
};

export default pool;