import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const path = resolve("site/data/champion-cc.json");
const payload = JSON.parse(await readFile(path, "utf8"));
const champions = payload.champions || {};

assert.ok(Object.keys(champions).length >= 170, `Expected a near-complete champion roster, got ${Object.keys(champions).length}`);
assert.equal(payload.meta?.failures?.length || 0, 0, "CC generation must not silently ship champion failures");

const allEffects = Object.values(champions)
  .flatMap(champion => champion.abilities || [])
  .flatMap(ability => ability.effects || []);
const hardEffects = allEffects.filter(effect => effect.hard);
const timedHardEffects = hardEffects.filter(effect => Number.isFinite(effect.durationSeconds));
const hardCoverage = hardEffects.length ? timedHardEffects.length / hardEffects.length : 0;

assert.ok(hardEffects.length >= 100, `Expected at least 100 hard-CC effects, got ${hardEffects.length}`);
assert.ok(
  hardCoverage >= 0.45,
  `Known-duration hard-CC coverage is ${(hardCoverage * 100).toFixed(1)}%; expected at least 45%`
);

for (const champion of Object.values(champions)) {
  const summary = champion.summary || {};
  assert.ok(
    Number(summary.reducibleHardSecondsWithMercs || 0) <= Number(summary.reducibleHardSeconds || 0) + 1e-9,
    `${champion.name}: Mercs must not increase reducible hard-CC duration`
  );
  assert.ok(
    Number(summary.reducibleSoftSecondsWithMercs || 0) <= Number(summary.reducibleSoftSeconds || 0) + 1e-9,
    `${champion.name}: Mercs must not increase reducible soft-CC duration`
  );
  assert.ok(Number(summary.hardSecondsSavedByMercs || 0) >= -1e-9, `${champion.name}: hard-CC savings must not be negative`);
  assert.ok(Number(summary.softSecondsSavedByMercs || 0) >= -1e-9, `${champion.name}: soft-CC savings must not be negative`);
}

function effectsFor(championId, slot) {
  return (champions[championId]?.abilities || [])
    .filter(ability => ability.slot === slot || ability.slot.startsWith(slot))
    .flatMap(ability => ability.effects || []);
}

const ahriQ = effectsFor("Ahri", "Q");
assert.ok(!ahriQ.some(effect => effect.type === "airborne"), "Ahri Q must not be classified as displacement CC");
const ahriCharm = effectsFor("Ahri", "E").find(effect => effect.type === "charm");
assert.ok(ahriCharm && ahriCharm.tenacityAffected, "Ahri E must contain Tenacity-reducible charm");
assert.ok(Number.isFinite(ahriCharm.durationSeconds) && ahriCharm.durationSeconds >= 1, "Ahri charm duration must resolve");

const leona = champions.Leona?.summary;
assert.ok(leona?.reducibleHardSeconds >= 2, "Leona should expose multiple seconds of reducible hard CC");
assert.ok(leona?.hardSecondsSavedByMercs > 0, "Mercury's Treads should save hard-CC time against Leona");

const luxRoot = effectsFor("Lux", "Q").find(effect => effect.type === "root");
assert.ok(luxRoot?.tenacityAffected, "Lux Q root must be Tenacity-reducible");
assert.ok(Number.isFinite(luxRoot?.durationSeconds) && luxRoot.durationSeconds >= 1, "Lux Q root duration must resolve");

const skarnerSuppression = effectsFor("Skarner", "R").find(effect => effect.type === "suppression");
assert.ok(skarnerSuppression, "Skarner R suppression must be detected");
assert.equal(skarnerSuppression.tenacityAffected, false, "Suppression must not be reduced by Tenacity");
assert.ok(Number.isFinite(skarnerSuppression.durationSeconds) && skarnerSuppression.durationSeconds >= 1, "Skarner suppression duration must resolve");

const vexPassive = effectsFor("Vex", "P");
const vexFear = vexPassive.find(effect => effect.type === "fear");
assert.ok(vexFear?.tenacityAffected, "Vex Doom must contain Tenacity-reducible fear");
assert.equal(vexFear?.durationMinSeconds, 0.75, "Vex Doom minimum fear duration must resolve");
assert.equal(vexFear?.durationSeconds, 1.5, "Vex Doom maximum fear duration must resolve");
assert.equal(vexPassive.filter(effect => effect.hard).length, 1, "Vex Doom fear/flee wording must not double-count hard CC");
assert.ok(champions.Vex?.summary?.reducibleHardSeconds >= 1.5, "Vex must contribute her passive fear to hard-CC seconds");

const threshQ = effectsFor("Thresh", "Q");
const threshStun = threshQ.find(effect => effect.type === "stun");
assert.ok(threshStun?.tenacityAffected, "Thresh Q must expose its Tenacity-reducible stun");
assert.equal(threshStun?.durationSeconds, 1.5, "Thresh Q stun duration must resolve to 1.5 seconds");
assert.ok(
  threshStun?.concurrentEffects?.some(effect => effect.type === "airborne" && effect.durationSeconds === 0.4),
  "Thresh Q must preserve its 0.4s airborne overlap without double-counting it"
);
assert.ok(champions.Thresh?.summary?.hardSecondsSavedByMercs >= 0.45, "Mercury's Treads must save at least 0.45s against Thresh Q alone");

const braumPassive = effectsFor("Braum", "P");
const braumStun = braumPassive.find(effect => effect.type === "stun");
assert.ok(braumStun?.tenacityAffected, "Braum P must expose its Tenacity-reducible stun");
assert.equal(braumStun?.durationMinSeconds, 1.25, "Braum P minimum stun duration must resolve to 1.25 seconds");
assert.equal(braumStun?.durationSeconds, 1.75, "Braum P maximum stun duration must resolve to 1.75 seconds");
assert.ok(champions.Braum?.summary?.reducibleHardSeconds >= 1.75, "Braum must contribute Concussive Blows to hard-CC seconds");
assert.ok(champions.Braum?.summary?.hardSecondsSavedByMercs >= 0.52, "Mercury's Treads should save about 0.525s against max-duration Braum passive stun");

assert.equal(champions.Lucian?.summary?.totalEffects || 0, 0, "Lucian should not contribute crowd control");

console.log(
  `CC dataset validation passed: ${Object.keys(champions).length} champions, ` +
  `${allEffects.length} effects, ${timedHardEffects.length}/${hardEffects.length} hard CC effects timed ` +
  `(${(hardCoverage * 100).toFixed(1)}%).`
);
