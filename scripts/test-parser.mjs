import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseChampionStats } from "./lib/parse-stats.mjs";

const fixture = await readFile(new URL("../fixtures/aurora-stats.html", import.meta.url), "utf8");
const result = parseChampionStats(fixture, "Aurora");

assert.deepEqual(
  {
    physical: result.physical,
    magic: result.magic,
    true: result.true,
    reportedTotal: result.reportedTotal,
    componentTotal: result.componentTotal
  },
  {
    physical: 1720,
    magic: 25181,
    true: 1443,
    reportedTotal: 28345,
    componentTotal: 28344
  }
);

assert.equal(result.percentages.physical, 6.07);
assert.equal(result.percentages.magic, 88.84);
assert.equal(result.percentages.true, 5.09);

console.log("Parser test passed.");
