import assert from "node:assert/strict";
import {
  parseCrowdControlText,
  reducedDuration,
  summarizeChampionCc
} from "./lib/cc-parser.mjs";

const lux = parseCrowdControlText("Lux roots them for 2 seconds.");
assert.equal(lux.length, 1);
assert.equal(lux[0].type, "root");
assert.equal(lux[0].durationSeconds, 2);
assert.equal(lux[0].tenacityAffected, true);
assert.equal(reducedDuration(2), 1.4);

const skarner = parseCrowdControlText("Skarner suppresses enemy champions for 1.5 seconds and pulls them with him.");
assert.ok(skarner.some(effect => effect.type === "suppression" && effect.tenacityAffected === false));
assert.ok(skarner.some(effect => effect.type === "airborne" && effect.tenacityAffected === false));

const leonaAbilities = [
  { effects: parseCrowdControlText("stuns the target for 1 second") },
  { effects: parseCrowdControlText("roots the target for 0.5 seconds") },
  { effects: parseCrowdControlText("stuns enemies for 1.5 seconds") }
];
const summary = summarizeChampionCc(leonaAbilities);
assert.equal(summary.reducibleHardSeconds, 3);
assert.equal(summary.reducibleHardSecondsWithMercs, 2.25); // 0.7 + 0.5 floor + 1.05
assert.equal(summary.hardSecondsSavedByMercs, 0.75);

const noCc = parseCrowdControlText("Lucian fires a shot that deals physical damage.");
assert.equal(noCc.length, 0);

console.log("CC parser tests passed.");
