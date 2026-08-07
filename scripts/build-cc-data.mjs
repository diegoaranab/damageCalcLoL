import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  MERCS_TENACITY,
  parseCrowdControlText,
  stripMarkup,
  summarizeChampionCc
} from "./lib/cc-parser.mjs";

const OUTPUT_PATH = resolve("site/data/champion-cc.json");
const USER_AGENT = process.env.CC_USER_AGENT ||
  `DamageDraftPersonal/1.0 (${process.env.GITHUB_REPOSITORY || "local-personal-project"})`;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function isStandardChampion(champion) {
  return champion?.id && !champion.id.startsWith("Jade_");
}

function abilityFromSpell(slot, spell) {
  const text = [spell.description, spell.tooltip].filter(Boolean).join(" ");
  return {
    slot,
    name: spell.name,
    description: stripMarkup(spell.description || ""),
    effects: parseCrowdControlText(text)
  };
}

function abilityFromPassive(passive) {
  if (!passive) return null;
  return {
    slot: "P",
    name: passive.name,
    description: stripMarkup(passive.description || ""),
    effects: parseCrowdControlText(passive.description || "")
  };
}

async function main() {
  const versions = await fetchJson("https://ddragon.leagueoflegends.com/api/versions.json");
  const patch = versions?.[0];
  if (!patch) throw new Error("Could not determine current Data Dragon patch.");

  const rosterPayload = await fetchJson(
    `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion.json`
  );
  const rawRoster = Object.values(rosterPayload.data || {});
  const roster = rawRoster.filter(isStandardChampion).sort((a, b) => a.name.localeCompare(b.name));

  const champions = {};
  let parsedEffects = 0;
  let knownDurationEffects = 0;
  const failures = [];

  console.log(`Building crowd-control data for ${roster.length} champions on Data Dragon ${patch}.`);

  for (const [index, champion] of roster.entries()) {
    try {
      const detailPayload = await fetchJson(
        `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion/${champion.id}.json`
      );
      const detail = detailPayload.data?.[champion.id];
      if (!detail) throw new Error("Champion detail payload missing.");

      const abilities = [];
      const passive = abilityFromPassive(detail.passive);
      if (passive) abilities.push(passive);
      const slots = ["Q", "W", "E", "R"];
      for (const [spellIndex, spell] of (detail.spells || []).entries()) {
        abilities.push(abilityFromSpell(slots[spellIndex] || `S${spellIndex + 1}`, spell));
      }

      const summary = summarizeChampionCc(abilities, MERCS_TENACITY);
      parsedEffects += summary.totalEffects;
      knownDurationEffects += summary.knownDurationEffects;

      champions[champion.id] = {
        id: champion.id,
        name: champion.name,
        image: champion.image?.full || `${champion.id}.png`,
        abilities,
        summary
      };
      console.log(`[${index + 1}/${roster.length}] ${champion.name}: ${summary.totalEffects} CC effect(s), ${summary.knownDurationEffects} timed`);
    } catch (error) {
      failures.push({ id: champion.id, name: champion.name, error: error.message });
      console.log(`[${index + 1}/${roster.length}] ${champion.name}: FAILED — ${error.message}`);
    }
  }

  if (!Object.keys(champions).length) throw new Error("No champion CC data could be generated.");

  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      patch,
      source: "Riot Data Dragon champion descriptions/tooltips",
      parserVersion: 1,
      mercurysTreadsTenacity: MERCS_TENACITY,
      tenacityMinimumDurationSeconds: 0.5,
      tenacityUnaffected: ["airborne/displacements", "drowsy", "nearsight", "stasis", "suppression"],
      durationBasis: "maximum explicit duration found in the current tooltip/description",
      champions: Object.keys(champions).length,
      parsedEffects,
      knownDurationEffects,
      failures
    },
    champions
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}: ${Object.keys(champions).length} champions, ${parsedEffects} CC effects, ${failures.length} failures.`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
