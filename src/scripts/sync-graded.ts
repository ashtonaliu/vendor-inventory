import { pgClient } from "@/db";
import { syncGradedPrices } from "@/lib/graded-sync";

syncGradedPrices()
  .then((summary) => {
    console.log(
      `\n${summary.status.toUpperCase()}: ${summary.valued}/${summary.certs} certs valued, ` +
        `${summary.snapshotsWritten} graded prices saved, ${summary.creditsUsed} credits used`,
    );
    if (summary.failures.length) {
      console.log(`Problems:\n  ${summary.failures.join("\n  ")}`);
      process.exitCode = 1;
    }
  })
  .catch((err) => {
    console.error(`Card Ladder sync failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
