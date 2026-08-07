# Damage Draft — daily data on GitHub Pages

This repository template separates the system into two parts:

1. **GitHub Actions** runs a Node.js script each day and writes `site/data/champion-damage.json`.
2. **GitHub Pages** serves the static UI in `site/`, which reads that JSON file.

GitHub Pages itself cannot execute Node.js, scrape another website, keep a secret, or run a cron job. The scheduled Action is the backend-like part.

## Repository structure

```text
.github/workflows/update-and-deploy.yml  Daily schedule and Pages deployment
scripts/scrape-lolalytics.mjs            Fetches champion pages
scripts/lib/parse-stats.mjs              Extracts values by visible labels
scripts/test-parser.mjs                   Parser regression test
fixtures/aurora-stats.html                Test fixture based on the supplied snippet
site/index.html                           Static app
site/data/champion-damage.json            Generated data consumed by the app
```

## Set up on GitHub

1. Create a repository and upload all files in this folder.
2. Make sure the default branch is named `main`.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **GitHub Actions**.
5. Open the **Actions** tab.
6. Select **Update champion damage and deploy Pages**.
7. Run it manually first with `champions` set to `Aurora`.
8. Confirm that the parser test, scrape, commit, and deployment succeed.
9. Run it again with the field blank to process the full roster.

The scheduled workflow runs daily at **05:17 America/Mexico_City**. The non-round minute reduces the chance of GitHub's start-of-hour congestion.

## Local test

```bash
npm ci
npm test
CHAMPIONS=Aurora REQUEST_DELAY_MS=0 npm run scrape
```

Then serve the static folder:

```bash
npx serve site
```

## How the parser works

It does **not** depend on values such as `q:key="TA_15"`, generated Qwik IDs, or the complete Tailwind class string. Those are implementation details that can change at any time.

Instead, it locates these visible labels and reads the numeric value from the neighboring bar:

- `Physical Damage:`
- `Magic Damage:`
- `True Damage:`
- `Total Damage:`

The included test verifies the supplied Aurora values:

- Physical: `1,720`
- Magic: `25,181`
- True: `1,443`
- Reported total: `28,345`

The component total is `28,344`; a one-point difference is normal when independently rounded averages are displayed.

## Important limitations

- A remote website can change its markup or block GitHub-hosted runner IP addresses. If that happens, the workflow fails rather than silently publishing incorrect zeroes.
- The script waits 1.5 seconds between champion pages and retries temporary failures. Do not remove the delay merely to make the workflow faster.
- If one champion fails but an older value exists, the script retains the previous value and records the failure in `meta.failures`.
- A public GitHub repository makes the generated JSON public. For truly private use, use a private repository and a GitHub plan that supports private Pages, or host the UI locally.
- Before operating a recurring scraper, verify that the target site's current terms and automated-access rules permit your intended use. Lolalytics describes its underlying API as private and restricts third-party use; this template reads public page HTML, not that API, but automated reuse can still raise permission and copyright concerns.

## Preferable long-term data source

For a durable application, use Riot's official APIs and aggregate match participant fields such as physical, magic, and true damage dealt to champions. That avoids coupling your application to another analytics site's HTML and gives you control over rank, region, role, sample size, and refresh logic.
