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

const vexDoom = parseCrowdControlText(
  "Passive - Doom: Periodically, Vex empowers her next basic ability to knock down and fear enemies hit for 0.75 / 1 / 1.25 / 1.5 (based on level) seconds, during which they are slowed by 60% : 99% (based on distance from Vex). If Looming Darkness triggers Doom, enemies hit will flee from the epicenter instead."
);
const vexFear = vexDoom.find(effect => effect.type === "fear");
assert.ok(vexFear, "Vex Doom must detect the bare verb 'fear'");
assert.equal(vexFear.durationMinSeconds, 0.75);
assert.equal(vexFear.durationSeconds, 1.5);
assert.equal(vexFear.tenacityAffected, true);
assert.equal(vexDoom.filter(effect => effect.hard).length, 1, "Vex fear/flee variants must represent one hard-CC event");

const threshDeathSentence = parseCrowdControlText(
  "The scythe catches the first enemy hit to deal magic damage, stun and reveal them for 1.5 seconds, and render them airborne for 0.4 seconds, as well as reduce Death Sentence's current cooldown by 2 seconds."
);
const threshHard = threshDeathSentence.filter(effect => effect.hard);
assert.equal(threshHard.length, 1, "overlapping Thresh Q stun/airborne must count as one effective hard-CC window");
assert.equal(threshHard[0].type, "stun", "Thresh Q stun should dominate its shorter airborne overlap after Mercs");
assert.equal(threshHard[0].durationSeconds, 1.5, "Thresh Q stun duration must resolve to 1.5 seconds");
assert.equal(threshHard[0].tenacityAffected, true);
assert.ok(
  threshHard[0].concurrentEffects?.some(effect => effect.type === "airborne" && effect.durationSeconds === 0.4),
  "Thresh Q should retain its 0.4s Tenacity-unaffected airborne overlap as metadata"
);
const threshSummary = summarizeChampionCc([{ effects: threshDeathSentence }]);
assert.equal(threshSummary.reducibleHardSeconds, 1.5);
assert.equal(threshSummary.reducibleHardSecondsWithMercs, 1.05);
assert.equal(threshSummary.hardSecondsSavedByMercs, 0.45);

const velkozDisruption = parseCrowdControlText(
  "Vel'Koz knocks them up and stuns them for 0.75 seconds."
);
const velkozHard = velkozDisruption.filter(effect => effect.hard);
assert.equal(velkozHard.length, 1, "overlapping equal-duration stun/airborne must not double-count");
assert.equal(velkozHard[0].type, "airborne", "equal-duration overlap should retain the Tenacity-unaffected component");
assert.equal(velkozHard[0].durationSeconds, 0.75);

const statScaledSlow = parseCrowdControlText("Xin Zhao slows the target for 1.5 (+ 0.5 per 100 AP) seconds.");
assert.equal(statScaledSlow.length, 1);
assert.equal(statScaledSlow[0].type, "slow");
assert.equal(statScaledSlow[0].durationSeconds, null, "stat-scaled duration formulas must not be flattened to their base value");

const ahriOrb = parseCrowdControlText("Ahri sends out and pulls back her orb, dealing magic damage on the way out and true damage on the way back.");
assert.equal(ahriOrb.length, 0, "pulling back an owned projectile must not count as displacement CC");

const groundNoun = parseCrowdControlText("Aatrox smashes the ground, dealing damage to the first enemy hit.");
assert.equal(groundNoun.length, 0, "the noun 'ground' must not count as the Grounded debuff");

const minionOnly = parseCrowdControlText("Aatrox fears nearby enemy minions for 3 seconds.");
assert.equal(minionOnly.length, 0, "minion-only CC must not influence champion defensive boots");

const crossReference = parseCrowdControlText("Flames prioritize enemy champions hit by Charm, then enemy champions.");
assert.equal(crossReference.length, 0, "an ability-name reference must not be treated as CC applied by this ability");

const noCc = parseCrowdControlText("Lucian fires a shot that deals physical damage.");
assert.equal(noCc.length, 0);

console.log("CC parser tests passed.");
