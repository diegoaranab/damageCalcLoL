# Damage Draft — League defensive boot assistant

Damage Draft is a personal-use GitHub Pages application that combines two kinds of enemy-team threat data:

1. **Recent damage composition** from Lolalytics: physical, magic, and true damage dealt by each champion.
2. **Crowd-control composition** from Riot Data Dragon champion ability text: which effects are potentially reduced by Tenacity and how much hard-CC time Mercury's Treads can save.

The browser itself stays static. GitHub Actions refreshes the JSON data used by the UI.

## Repository structure

```text
.github/workflows/update-and-deploy.yml  Daily damage refresh + Pages deployment
.github/workflows/check-champion-data.yml Daily patch check; rebuilds CC only on a new Riot patch
.github/workflows/deploy-pages.yml        Fast Pages deployment for normal site changes
scripts/scrape-lolalytics.mjs             Refreshes recent champion damage statistics
scripts/lib/parse-stats.mjs               Parses visible Lolalytics damage values
scripts/lib/cc-parser.mjs                  Classifies CC from champion ability text
scripts/build-cc-data.mjs                  Builds the per-champion CC dataset
scripts/check-patch.mjs                    Cheap Data Dragon version check
scripts/test-parser.mjs                    Damage parser regression test
scripts/test-cc-parser.mjs                 CC/Tenacity regression tests
site/index.html                            Static application
site/data/champion-damage.json             Generated damage dataset
site/data/champion-cc.json                 Generated crowd-control dataset
```

## Workflows

### Daily damage refresh

`Update champion damage and deploy Pages` runs every day at **05:17 America/Mexico_City** and can also be started manually. It:

1. Runs parser tests.
2. Fetches the current standard champion roster.
3. Reads each champion's visible Lolalytics stats for D2+, global, last 7 days.
4. Writes `site/data/champion-damage.json`.
5. Commits changed data to `main`.
6. Deploys `site/` to GitHub Pages.

Normal code pushes do **not** trigger this expensive scrape. They use the separate fast Pages deployment workflow.

### Champion ability / CC patch check

`Check champion ability data` runs every day at **06:07 America/Mexico_City**. Its normal daily path is deliberately cheap: it downloads Riot's current Data Dragon version list and compares the newest patch with the patch recorded in `site/data/champion-cc.json`.

If the patch has **not** changed, the workflow stops after the check.

If Riot publishes a new patch, it:

1. Downloads current champion ability descriptions/tooltips from Data Dragon.
2. Detects and classifies crowd-control effects.
3. Writes `site/data/champion-cc.json`.
4. Commits the refreshed dataset.
5. Deploys the updated site.

A manual workflow run can force a rebuild even when the patch number is unchanged.

### Fast Pages deployment

`Deploy Pages` runs when `site/**` changes on `main`. It publishes the current site without running the 173-page damage scraper.

## Crowd-control model

The UI calls this a **potential CC budget**, not a prediction of a perfect in-game CC chain. Ability effects can overlap, miss, require conditions, or be mutually exclusive.

The generated dataset separates:

- hard vs. soft CC;
- effects affected by Tenacity vs. effects unaffected by Tenacity;
- known-duration effects vs. effects whose duration could not be safely inferred from Riot's text;
- raw duration vs. duration after Mercury's Treads.

The model currently treats **displacements/airborne, drowsy, nearsight, stasis, and suppression** as unaffected by Tenacity. Other timed CC classes are treated as Tenacity-reducible unless a special case is added to the parser.

For Mercury's Treads, the calculation uses **30% Tenacity** and applies a **0.5-second minimum duration per reducible CC instance**.

Unknown-duration effects are displayed but deliberately excluded from the numeric seconds total rather than guessed.

### Data-quality limitation

Riot Data Dragon is current and official, but champion tooltips are written for players rather than as a normalized CC database. The CC parser therefore uses transparent heuristics and regression tests. Special-case champion interactions may need curated overrides over time. The application should be treated as a practical decision aid, not a frame-perfect combat simulator.

## Local checks

```bash
npm ci
npm test
```

Run a damage refresh for one champion:

```bash
CHAMPIONS=Aurora REQUEST_DELAY_MS=0 npm run scrape
```

Check whether Riot has published a new patch:

```bash
npm run cc:check
```

Force-build the current CC dataset locally:

```bash
npm run cc:build
```

Serve the static site:

```bash
npx serve site
```

## Data-source notes

The damage scraper intentionally reads the publicly rendered Lolalytics champion page rather than its private API. Verify the target site's current terms and automated-access rules before relying on recurring collection.

Champion ability text is sourced from Riot Data Dragon. The CC JSON is cached in this repository so the static Pages site does not need to fetch or parse all champion abilities at runtime.
