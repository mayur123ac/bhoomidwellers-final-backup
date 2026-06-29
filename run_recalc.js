const path = require("path");
require("ts-node").register({ transpileOnly: true });
const { recalculateSrNos } = require("./src/lib/db.ts");

async function run() {
  await recalculateSrNos();
  console.log("Recalculation complete");
  process.exit(0);
}
run();
