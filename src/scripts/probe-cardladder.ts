// Makes one real get_cert_values_bulk call (3 credits) and prints the raw response next to
// what the parser understood, so the response format and value units can be confirmed.
import { parseArgs } from "node:util";
import { pgClient } from "@/db";
import { fetchCertValuesRaw, getApiKey, parseCertValues } from "@/lib/cardladder";
import { heldSlabCerts } from "@/lib/graded-sync";

const { values } = parseArgs({ options: { cert: { type: "string" }, grader: { type: "string", default: "PSA" } } });

async function main() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Set PARSE_API_KEY in .env.local first.");

  let request = values.cert ? { certNumber: values.cert, gradingCompany: values.grader!.toUpperCase() } : null;
  if (!request) {
    const [slab] = await heldSlabCerts();
    if (!slab) throw new Error("No slabs with cert numbers yet. Add one on the Inventory page, or pass --cert 12345678 --grader PSA.");
    request = { certNumber: slab.certNumber!, gradingCompany: slab.grader! };
  }

  console.log(`Requesting ${request.gradingCompany} ${request.certNumber} (3 credits)\n`);
  const raw = await fetchCertValuesRaw([request], apiKey);
  console.log("Raw response:\n" + JSON.stringify(raw, null, 2).slice(0, 6000));
  console.log("\nParsed:", JSON.stringify(parseCertValues(raw, [request]), null, 2));
  console.log("\nCompare the parsed valueCents with the value Card Ladder's site shows for this slab.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
