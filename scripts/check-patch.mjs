import { readFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

const CC_PATH = resolve("site/data/champion-cc.json");

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

async function storedPatch() {
  try {
    const data = JSON.parse(await readFile(CC_PATH, "utf8"));
    return data.meta?.patch || null;
  } catch {
    return null;
  }
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

const latest = await currentPatch();
const stored = await storedPatch();
const force = /^(1|true|yes)$/i.test(process.env.FORCE_CC_REFRESH || "");
const changed = force || latest !== stored;

console.log(`Stored CC patch: ${stored || "none"}`);
console.log(`Current Data Dragon patch: ${latest}`);
console.log(changed ? "Crowd-control refresh required." : "No patch change; nothing to rebuild.");

setOutput("latest_patch", latest);
setOutput("stored_patch", stored || "");
setOutput("changed", changed ? "true" : "false");
