const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:8369787919@localhost:5432/bhoomiBackup_crm',
});

async function checkDb() {
  try {
    await client.connect();
    
    // Check tables
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('--- TABLES ---');
    console.log(tablesRes.rows.map(r => r.table_name).join('\n'));

    // Check employee_activity_logs columns
    const columnsRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'employee_activity_logs'
    `);
    console.log('\n--- COLUMNS in employee_activity_logs ---');
    console.log(columnsRes.rows.map(r => `${r.column_name}: ${r.data_type}`).join('\n'));

  } catch (err) {
    console.error('Error connecting or querying', err);
  } finally {
    await client.end();
  }
}

checkDb();
