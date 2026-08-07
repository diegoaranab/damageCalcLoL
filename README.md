# Damage Draft — League defensive boot assistant

Damage Draft is a personal-use GitHub Pages application that combines two kinds of enemy-team threat data:

1. **Recent damage composition** from Lolalytics: physical, magic, and true damage dealt by each champion.
2. **Crowd-control composition** from current League Wiki ability data: which effects are potentially reduced by Tenacity and how much hard-CC time Mercury's Treads can save.

The browser remains a static site. GitHub Actions refreshes the JSON data consumed by the UI.

## Repository structure

```text
.github/workflows/update-and-deploy.yml   Daily damage refresh + Pages deployment
.github/workflows/check-champion-data.yml Cheap daily patch check; full CC build only when needed
.github/workflows/deploy-pages.yml        Fast Pages deployment for ordinary site changes
scripts/scrape-lolalytics.mjs              Refreshes recent champion damage statistics
scripts/lib/parse-stats.mjs                Parses visible Lolalytics damage values
scripts/lib/cc-parser.mjs                   Classifies CC and Tenacity behavior
scripts/build-cc-data.mjs                   Builds the per-champion CC dataset
scripts/check-patch.mjs                     Checks Riot patch + CC parser version
scripts/validate-cc-data.mjs                Validates generated CC semantics/coverage
scripts/test-parser.mjs                     Damage parser regression test
scripts/test-cc-parser.mjs                  CC/Tenacity regression tests
site/index.html                             Static application
site/data/champion-damage.json              Generated damage dataset
site/data/champion-cc.json                  Generated crowd-control dataset
```

## Workflows

### Daily damage refresh

`Update champion damage and deploy Pages` runs every day at **05:17 America/Mexico_City** and can also be started manually. It tests the parsers, refreshes D2+ / global / last-7-days Lolalytics damage for the standard champion roster, commits `site/data/champion-damage.json` when it changes, and deploys `site/`.

Normal code pushes do **not** run the 173-page damage scrape. They use the separate fast Pages deployment workflow.

### Champion ability / CC patch check

`Check champion ability data` runs every day at **06:07 America/Mexico_City**. Its normal no-change path is deliberately lightweight: it requests Riot's Data Dragon version list and compares the current patch and stored semantic-parser version with `site/data/champion-cc.json`.

If neither changed, the workflow stops there.

When Riot publishes a new patch—or when the semantic parser version changes—the workflow:

1. Uses Riot Data Dragon as the current patch and champion-roster authority.
2. Checks out the MIT-licensed `meraki-analytics/lolstaticdata` parser.
3. Generates current League Wiki champion ability data at workflow runtime.
4. Builds the smaller Damage Draft CC model from those normalized descriptions/leveling values.
5. Validates duration coverage and key champion semantics before publishing anything.
6. Commits `site/data/champion-cc.json` and deploys the updated site.

A manual workflow run can force a rebuild. CC-related pull requests also run the full current-Wiki build as validation, but do not commit or deploy generated PR data.

### Fast Pages deployment

`Deploy Pages` publishes `site/` when site files change on `main`, without running the Lolalytics scraper.

## Crowd-control model

The UI calls the result a **potential CC budget**, not a prediction of a perfect in-game CC chain. Abilities can overlap, miss, require conditions, or be mutually exclusive.

The generated dataset separates hard vs. soft CC, Tenacity-reducible vs. unaffected effects, known vs. unresolved durations, and raw vs. post-Mercury's-Treads duration.

The model treats **displacements/airborne, drowsy, nearsight, stasis, and suppression** as unaffected by Tenacity. Other timed CC classes are treated as Tenacity-reducible unless a documented special case requires an override.

Mercury's Treads are modeled with **30% Tenacity** and a **0.5-second minimum duration per reducible CC instance**. Unknown-duration effects stay visible but are excluded from seconds totals instead of being guessed.

### Data-quality safeguards

League ability semantics are complex, so generated CC data is not accepted merely because parsing completed. The validation step requires a near-complete roster, zero champion-generation failures, meaningful hard-CC duration coverage, and regression checks for representative kits including Ahri, Leona, Lux, Skarner, and Lucian.

The application is a practical defensive-item decision aid, not a frame-perfect combat simulator.

## Local checks

```bash
npm ci
npm test
```

Run a damage refresh for one champion:

```bash
CHAMPIONS=Aurora REQUEST_DELAY_MS=0 npm run scrape
```

Check whether a CC refresh is needed:

```bash
npm run cc:check
```

`npm run cc:build` can run with Riot Data Dragon alone as a fallback smoke test. The authoritative patch workflow passes a freshly generated League Wiki/Meraki `champions.json` through `MERAKI_CHAMPIONS_PATH` before running the builder.

Serve the static site:

```bash
npx serve site
```

## Data-source notes

The damage scraper reads the publicly rendered Lolalytics champion page rather than its private API. Verify the target site's current terms and automated-access rules before relying on recurring collection.

For CC, Riot Data Dragon determines the live patch/roster while current ability semantics are generated from the League Wiki through the MIT-licensed Meraki Analytics `lolstaticdata` project. Only the resulting compact CC JSON is cached in this repository.
