import { readFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

const CC_PATH = resolve("site/data/champion-cc.json");
const EXPECTED_PARSER_VERSION = 3;

async function currentPatch() {
  const response = await fetch("https://ddragon.leagueoflegends.com/api/versions.json", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Could not check Data Dragon version: ${response.status}`);
  const versions = await response.json();
  if (!versions?.[0]) throw new Error("Data Dragon version list was empty.");
  return versions[0];
}

async function storedSnapshot() {
  try {
    const data = JSON.parse(await readFile(CC_PATH, "utf8"));
    return {
      patch: data.meta?.patch || null,
      parserVersion: Number(data.meta?.parserVersion || 0)
    };
  } catch {
    return { patch: null, parserVersion: 0 };
  }
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

const latest = await currentPatch();
const stored = await storedSnapshot();
const force = /^(1|true|yes)$/i.test(process.env.FORCE_CC_REFRESH || "");
const patchChanged = latest !== stored.patch;
const parserChanged = stored.parserVersion !== EXPECTED_PARSER_VERSION;
const changed = force || patchChanged || parserChanged;

console.log(`Stored CC patch: ${stored.patch || "none"}`);
console.log(`Current Data Dragon patch: ${latest}`);
console.log(`Stored CC parser version: ${stored.parserVersion || "none"}`);
console.log(`Expected CC parser version: ${EXPECTED_PARSER_VERSION}`);
if (force) console.log("Crowd-control refresh forced by workflow input/event.");
else if (patchChanged) console.log("Crowd-control refresh required because Riot's patch changed.");
else if (parserChanged) console.log("Crowd-control refresh required because the semantic parser changed.");
else console.log("Patch and parser are current; nothing to rebuild.");

setOutput("latest_patch", latest);
setOutput("stored_patch", stored.patch || "");
setOutput("stored_parser_version", String(stored.parserVersion || 0));
setOutput("expected_parser_version", String(EXPECTED_PARSER_VERSION));
setOutput("changed", changed ? "true" : "false");
