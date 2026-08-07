import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  MERCS_TENACITY,
  parseCrowdControlText,
  stripMarkup,
  summarizeChampionCc
} from "./lib/cc-parser.mjs";

const OUTPUT_PATH = resolve("site/data/champion-cc.json");
const MERAKI_CHAMPIONS_PATH = process.env.MERAKI_CHAMPIONS_PATH
  ? resolve(process.env.MERAKI_CHAMPIONS_PATH)
  : null;
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

async function loadMerakiChampions() {
  if (!MERAKI_CHAMPIONS_PATH) return null;
  const payload = JSON.parse(await readFile(MERAKI_CHAMPIONS_PATH, "utf8"));
  console.log(`Loaded League Wiki/Meraki ability data from ${MERAKI_CHAMPIONS_PATH}.`);
  return payload;
}

function isStandardChampion(champion) {
  return champion?.id && !champion.id.startsWith("Jade_");
}

function abilityTargetsEnemies(ability) {
  const affects = String(ability?.affects || "").toLowerCase();
  if (!affects) return true;
  return affects.includes("enem");
}

function numericValues(modifiers = []) {
  return modifiers
    .flatMap(modifier => modifier?.values || [])
    .map(Number)
    .filter(Number.isFinite);
}

function durationHint(attribute = "") {
  const value = attribute.toLowerCase().replace(/[-_]/g, " ");
  if (!value.includes("duration") && !value.includes("time")) return null;
  if (/stun/.test(value)) return "stun";
  if (/root|snare/.test(value)) return "root";
  if (/slow/.test(value)) return "slow";
  if (/charm/.test(value)) return "charm";
  if (/fear|terrify/.test(value)) return "fear";
  if (/taunt/.test(value)) return "taunt";
  if (/sleep/.test(value)) return "sleep";
  if (/drows/.test(value)) return "drowsy";
  if (/silence/.test(value)) return "silence";
  if (/blind/.test(value)) return "blind";
  if (/disarm/.test(value)) return "disarm";
  if (/ground/.test(value)) return "ground";
  if (/suppress/.test(value)) return "suppression";
  if (/knock|airborne|displace|pull|fling/.test(value)) return "airborne";
  if (/disable|immobili|crowd control|\bcc\b/.test(value)) return "hard";
  if (/^duration$|^effect duration$/.test(value.trim())) return "generic";
  return null;
}

function levelingDurationCandidates(leveling = []) {
  const candidates = [];
  for (const row of leveling || []) {
    const hint = durationHint(row?.attribute || "");
    if (!hint) continue;
    const values = numericValues(row?.modifiers || []);
    if (!values.length) continue;
    candidates.push({
      hint,
      attribute: row.attribute,
      values,
      min: Math.min(...values),
      max: Math.max(...values)
    });
  }
  return candidates;
}

function enrichEffectDurations(effects, candidates) {
  const hardUnknown = effects.filter(effect => effect.hard && !Number.isFinite(effect.durationSeconds));
  const allUnknown = effects.filter(effect => !Number.isFinite(effect.durationSeconds));

  for (const effect of effects) {
    if (Number.isFinite(effect.durationSeconds)) continue;
    let candidate = candidates.find(item => item.hint === effect.type);
    if (!candidate && effect.hard && hardUnknown.length === 1) {
      candidate = candidates.find(item => item.hint === "hard");
    }
    if (!candidate && allUnknown.length === 1) {
      candidate = candidates.find(item => item.hint === "generic");
    }
    if (!candidate) continue;

    effect.durationSeconds = candidate.max;
    effect.durationMinSeconds = candidate.min;
    effect.durationValues = candidate.values;
    effect.durationSource = `league-wiki:${candidate.attribute}`;
  }
  return effects;
}

function mergeEffectsByType(effects) {
  const byType = new Map();
  for (const effect of effects) {
    const current = byType.get(effect.type);
    if (!current || (!Number.isFinite(current.durationSeconds) && Number.isFinite(effect.durationSeconds))) {
      byType.set(effect.type, effect);
    }
  }
  return [...byType.values()];
}

function abilityFromMeraki(slot, ability, variantIndex) {
  if (!abilityTargetsEnemies(ability)) return null;

  const collected = [];
  for (const semanticEffect of ability.effects || []) {
    const parsed = parseCrowdControlText(semanticEffect.description || "");
    enrichEffectDurations(parsed, levelingDurationCandidates(semanticEffect.leveling || []));
    collected.push(...parsed);
  }

  const effects = mergeEffectsByType(collected);
  if (!effects.length) return {
    slot: variantIndex ? `${slot}${variantIndex + 1}` : slot,
    name: ability.name,
    description: stripMarkup(ability.effects?.[0]?.description || ability.blurb || ""),
    affects: ability.affects || null,
    source: "league-wiki-meraki",
    effects: []
  };

  return {
    slot: variantIndex ? `${slot}${variantIndex + 1}` : slot,
    name: ability.name,
    description: stripMarkup(ability.effects?.[0]?.description || ability.blurb || ""),
    affects: ability.affects || null,
    source: "league-wiki-meraki",
    effects
  };
}

function abilitiesFromMeraki(champion) {
  const abilities = [];
  for (const slot of ["P", "Q", "W", "E", "R"]) {
    for (const [index, ability] of (champion?.abilities?.[slot] || []).entries()) {
      const normalized = abilityFromMeraki(slot, ability, index);
      if (normalized) abilities.push(normalized);
    }
  }
  return abilities;
}

function abilityFromDataDragon(slot, spell) {
  // Prefer the detailed tooltip over concatenating tooltip + summary description so
  // one CC event is not counted twice.
  const text = spell.tooltip || spell.description || "";
  return {
    slot,
    name: spell.name,
    description: stripMarkup(spell.description || ""),
    source: "riot-data-dragon-fallback",
    effects: parseCrowdControlText(text)
  };
}

async function abilitiesFromDataDragon(champion, patch) {
  const detailPayload = await fetchJson(
    `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion/${champion.id}.json`
  );
  const detail = detailPayload.data?.[champion.id];
  if (!detail) throw new Error("Champion detail payload missing.");

  const abilities = [];
  // Data Dragon passive prose is particularly prone to describing trigger conditions
  // rather than effects. Use it only as a fallback and only when it targets enemies.
  if (detail.passive?.description) {
    const passiveEffects = parseCrowdControlText(detail.passive.description);
    if (passiveEffects.length) {
      abilities.push({
        slot: "P",
        name: detail.passive.name,
        description: stripMarkup(detail.passive.description),
        source: "riot-data-dragon-fallback",
        effects: passiveEffects
      });
    }
  }
  const slots = ["Q", "W", "E", "R"];
  for (const [spellIndex, spell] of (detail.spells || []).entries()) {
    abilities.push(abilityFromDataDragon(slots[spellIndex] || `S${spellIndex + 1}`, spell));
  }
  return abilities;
}

function findMerakiChampion(payload, champion) {
  if (!payload) return null;
  return payload[champion.id] ||
    Object.values(payload).find(entry =>
      entry?.key === champion.id || entry?.name?.toLowerCase() === champion.name.toLowerCase()
    ) || null;
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
  const merakiChampions = await loadMerakiChampions();

  const champions = {};
  let parsedEffects = 0;
  let knownDurationEffects = 0;
  let wikiChampions = 0;
  let fallbackChampions = 0;
  const failures = [];

  console.log(`Building crowd-control data for ${roster.length} champions on Data Dragon ${patch}.`);

  for (const [index, champion] of roster.entries()) {
    try {
      const merakiChampion = findMerakiChampion(merakiChampions, champion);
      let abilities;
      if (merakiChampion) {
        abilities = abilitiesFromMeraki(merakiChampion);
        wikiChampions += 1;
      } else {
        abilities = await abilitiesFromDataDragon(champion, patch);
        fallbackChampions += 1;
      }

      const summary = summarizeChampionCc(abilities, MERCS_TENACITY);
      parsedEffects += summary.totalEffects;
      knownDurationEffects += summary.knownDurationEffects;

      champions[champion.id] = {
        id: champion.id,
        name: champion.name,
        image: champion.image?.full || `${champion.id}.png`,
        source: merakiChampion ? "League Wiki via Meraki lolstaticdata" : "Riot Data Dragon fallback",
        abilities,
        summary
      };
      console.log(`[${index + 1}/${roster.length}] ${champion.name}: ${summary.totalEffects} CC effect(s), ${summary.knownDurationEffects} timed${merakiChampion ? "" : " (Data Dragon fallback)"}`);
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
      source: merakiChampions
        ? "League Wiki ability data parsed by Meraki lolstaticdata; Riot Data Dragon for current patch/roster"
        : "Riot Data Dragon fallback only",
      parserVersion: 2,
      mercurysTreadsTenacity: MERCS_TENACITY,
      tenacityMinimumDurationSeconds: 0.5,
      tenacityUnaffected: ["airborne/displacements", "drowsy", "nearsight", "stasis", "suppression"],
      durationBasis: "maximum explicit current ability duration; League Wiki leveling values used when descriptions say only 'for a duration'",
      champions: Object.keys(champions).length,
      wikiChampions,
      fallbackChampions,
      parsedEffects,
      knownDurationEffects,
      timedCoveragePercent: parsedEffects ? Math.round(knownDurationEffects / parsedEffects * 1000) / 10 : 0,
      failures
    },
    champions
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}: ${Object.keys(champions).length} champions, ${parsedEffects} CC effects, ${knownDurationEffects} timed, ${failures.length} failures.`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
