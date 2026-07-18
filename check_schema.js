const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:8369787919@localhost:5432/bhoomi_crm' });
client.connect().then(() => {
  client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'lead_assignment_logs';").then(r => {
    console.log(r.rows);
    client.end();
  });
});
