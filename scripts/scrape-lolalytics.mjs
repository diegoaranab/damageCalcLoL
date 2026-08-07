import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseChampionStats } from "./lib/parse-stats.mjs";

const OUTPUT_PATH = resolve("site/data/champion-damage.json");
const TIER = process.env.LOLALYTICS_TIER || "d2_plus";
const PATCH_WINDOW = process.env.LOLALYTICS_PATCH || "7";
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 1500);
const ONLY_CHAMPIONS = new Set(
  String(process.env.CHAMPIONS || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
);

const USER_AGENT = process.env.SCRAPER_USER_AGENT ||
  `DamageDraftPersonal/1.0 (${process.env.GITHUB_REPOSITORY || "local-personal-project"})`;

const sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(45_000)
      });

      if (response.ok) return response;

      const retryable = response.status === 429 || response.status >= 500;
      const message = `${response.status} ${response.statusText}`;
      if (!retryable || attempt === attempts) {
        throw new Error(`Request failed for ${url}: ${message}`);
      }

      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : attempt * 3000);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(attempt * 3000);
    }
  }

  throw lastError || new Error(`Request failed for ${url}`);
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
  });
  return response.json();
}

async function fetchHtml(url) {
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  return response.text();
}

async function loadChampionRoster() {
  const versions = await fetchJson("https://ddragon.leagueoflegends.com/api/versions.json");
  if (!Array.isArray(versions) || !versions[0]) {
    throw new Error("Riot Data Dragon returned no current version.");
  }

  const version = versions[0];
  const payload = await fetchJson(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`
  );

  const entries = Object.values(payload.data || {});

  // Data Dragon can include special game-mode variants (currently `Jade_*`)
  // alongside the standard Summoner's Rift champion records. Those variants
  // reuse champion display names but do not have corresponding Lolalytics
  // champion pages, so exclude them before building the scrape roster.
  const supportedEntries = entries.filter(champion => !/^Jade_/i.test(champion.id));

  const champions = supportedEntries.map(champion => ({
    id: champion.id,
    name: champion.name,
    slug: champion.id.toLowerCase() === "monkeyking" ? "wukong" : champion.id.toLowerCase(),
    image: champion.image?.full || `${champion.id}.png`
  }));

  return {
    version,
    dataDragonEntries: entries.length,
    filteredVariants: entries.length - supportedEntries.length,
    champions: champions.sort((a, b) => a.name.localeCompare(b.name))
  };
}

async function loadExistingOutput() {
  try {
    return JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
  } catch {
    return { meta: {}, champions: {} };
  }
}

function shouldInclude(champion) {
  if (ONLY_CHAMPIONS.size === 0) return true;
  return [champion.id, champion.name, champion.slug]
    .map(value => value.toLowerCase())
    .some(value => ONLY_CHAMPIONS.has(value));
}

function buildSourceUrl(slug) {
  const parameters = new URLSearchParams({ tier: TIER, patch: PATCH_WINDOW });
  return `https://lolalytics.com/lol/${slug}/build/?${parameters}`;
}

async function main() {
  const startedAt = new Date();
  const existing = await loadExistingOutput();
  const roster = await loadChampionRoster();
  const requested = roster.champions.filter(shouldInclude);

  if (requested.length === 0) {
    throw new Error(`No champions matched CHAMPIONS=${[...ONLY_CHAMPIONS].join(",")}`);
  }

  const currentChampionIds = new Set(roster.champions.map(champion => champion.id));
  const champions = Object.fromEntries(
    Object.entries(existing.champions || {}).filter(([id]) => currentChampionIds.has(id))
  );
  const failures = [];
  let updated = 0;
  let retained = 0;

  if (roster.filteredVariants > 0) {
    console.log(`Ignored ${roster.filteredVariants} non-standard Data Dragon variant record(s).`);
  }
  console.log(`Fetching ${requested.length} champion page(s) with a ${REQUEST_DELAY_MS}ms delay.`);

  for (const [index, champion] of requested.entries()) {
    const sourceUrl = buildSourceUrl(champion.slug);
    process.stdout.write(`[${index + 1}/${requested.length}] ${champion.name}: `);

    try {
      const html = await fetchHtml(sourceUrl);
      const stats = parseChampionStats(html, champion.name);
      const fetchedAt = new Date().toISOString();

      champions[champion.id] = {
        id: champion.id,
        name: champion.name,
        slug: champion.slug,
        image: champion.image,
        physical: stats.physical,
        magic: stats.magic,
        true: stats.true,
        reportedTotal: stats.reportedTotal,
        componentTotal: stats.componentTotal,
        percentages: stats.percentages,
        source: "Lolalytics visible champion stats",
        sourceUrl,
        scope: `${TIER} · ${PATCH_WINDOW === "7" ? "last 7 days" : `patch ${PATCH_WINDOW}`} · global`,
        fetchedAt,
        updated: fetchedAt.slice(0, 10)
      };

      updated += 1;
      console.log(`OK (${stats.physical}/${stats.magic}/${stats.true})`);
    } catch (error) {
      const previous = champions[champion.id];
      if (previous) retained += 1;
      failures.push({ id: champion.id, name: champion.name, error: error.message, retainedPrevious: Boolean(previous) });
      console.log(`FAILED — ${error.message}${previous ? " (retained previous value)" : ""}`);
    }

    if (index < requested.length - 1 && REQUEST_DELAY_MS > 0) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  if (updated === 0) {
    throw new Error(
      "No champion pages were parsed successfully. The page may have changed, blocked GitHub-hosted runners, or stopped including the stats in server HTML."
    );
  }

  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      startedAt: startedAt.toISOString(),
      source: "Lolalytics public champion build pages",
      tier: TIER,
      patch: PATCH_WINDOW,
      region: "global",
      dataDragonVersion: roster.version,
      dataDragonEntries: roster.dataDragonEntries,
      filteredVariants: roster.filteredVariants,
      championsRequested: requested.length,
      championsUpdated: updated,
      championsRetained: retained,
      failures
    },
    champions
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Wrote ${OUTPUT_PATH}: ${updated} updated, ${retained} retained, ${failures.length} failures.`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
