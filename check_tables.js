const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:8369787919@localhost:5432/bhoomi_crm' });
client.connect().then(() => {
  client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';").then(r => {
    console.log(r.rows);
    client.end();
  });
});
