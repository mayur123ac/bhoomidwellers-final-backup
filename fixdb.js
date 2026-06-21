const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:8369787919@localhost:5432/bhoomi_crm' });

async function fix() {
  await client.connect();
  try {
    await client.query("ALTER TABLE public.site_visits DROP CONSTRAINT IF EXISTS site_visits_status_check;");
    await client.query("ALTER TABLE public.site_visits ADD CONSTRAINT site_visits_status_check CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled'));");
    console.log("DB constraint updated!");
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
fix();
