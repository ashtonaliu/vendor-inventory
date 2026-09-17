import { parseArgs } from "node:util";
import { pgClient } from "@/db";
import { syncPrices } from "@/lib/price-sync";

const { values } = parseArgs({
  options: { only: { type: "string" } },
});

syncPrices({ onlyGroups: values.only })
  .then((summary) => {
    console.log(
      `\n${summary.status.toUpperCase()}: ${summary.productsSeen} products from ${summary.groupsTotal - summary.groupsFailed}/${summary.groupsTotal} sets, ` +
        `${summary.itemsLinked} items linked, ${summary.snapshotsWritten} price history rows (data as of ${summary.dataAsOf})`,
    );
    if (summary.failures.length) {
      console.log(`Failed sets:\n  ${summary.failures.join("\n  ")}`);
      process.exitCode = 1;
    }
  })
  .catch((err) => {
    console.error(`Price sync failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
