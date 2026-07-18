const { Pool } = require('pg');
const fs = require('fs');

const envLocal = fs.readFileSync('.env.local', 'utf8');
const dbUrlMatch = envLocal.match(/DATABASE_URL=(.+)/);
const dbUrl = dbUrlMatch ? dbUrlMatch[1].trim() : process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: dbUrl,
});

async function getSchema() {
  const client = await pool.connect();
  try {
    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    `);
    
    let schemaStr = "";
    for (let row of tablesRes.rows) {
      const tableName = row.table_name;
      schemaStr += "\\nTable: " + tableName + "\\n----------------------\\n";
      
      const columnsRes = await client.query(`
        SELECT column_name, data_type, character_maximum_length, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);
      
      for (let col of columnsRes.rows) {
        schemaStr += "- " + col.column_name + ": " + col.data_type + " (Max: " + col.character_maximum_length + ", Default: " + col.column_default + ", Nullable: " + col.is_nullable + ")\\n";
      }
      
      const fksRes = await client.query(`
        SELECT
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM 
          information_schema.table_constraints AS tc 
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1
      `, [tableName]);
      
      if (fksRes.rows.length > 0) {
        schemaStr += "Foreign Keys:\\n";
        for (let fk of fksRes.rows) {
          schemaStr += "  " + fk.column_name + " -> " + fk.foreign_table_name + "(" + fk.foreign_column_name + ")\\n";
        }
      }
    }
    
    fs.writeFileSync('db_schema_dump.txt', schemaStr);
    console.log("Schema dumped to db_schema_dump.txt");
  } finally {
    client.release();
    pool.end();
  }
}

getSchema().catch(console.error);
