const REQUIRED_LABELS = {
  physical: "Physical Damage:",
  magic: "Magic Damage:",
  true: "True Damage:",
  total: "Total Damage:"
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseNumericText(value) {
  const normalized = String(value).replace(/,/g, "").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid numeric value: ${value}`);
  }
  return parsed;
}

function extractValueNearLabel(html, label) {
  const escapedLabel = escapeRegExp(label);

  // Primary parser: label div followed by the visual bar div and its numeric child.
  const siblingPattern = new RegExp(
    `${escapedLabel}\\s*<\\/div>\\s*<div\\b[^>]*>\\s*<div\\b[^>]*>\\s*([0-9][0-9,.]*)\\s*<\\/div>`,
    "i"
  );
  const siblingMatch = html.match(siblingPattern);
  if (siblingMatch) return parseNumericText(siblingMatch[1]);

  // Fallback: only inspect a small window after the label and choose the next
  // bold numeric div. This avoids accidentally reading the rank value (e.g. 67 / 108).
  const labelIndex = html.toLowerCase().indexOf(label.toLowerCase());
  if (labelIndex === -1) {
    throw new Error(`Could not find label: ${label}`);
  }

  const nearbyHtml = html.slice(labelIndex, labelIndex + 1400);
  const boldValuePattern = /<div\b[^>]*class=["'][^"']*font-bold[^"']*["'][^>]*>\s*([0-9][0-9,.]*)\s*<\/div>/i;
  const boldMatch = nearbyHtml.match(boldValuePattern);
  if (boldMatch) return parseNumericText(boldMatch[1]);

  throw new Error(`Could not find a numeric value after: ${label}`);
}

export function parseChampionStats(html, expectedChampionName = "") {
  if (typeof html !== "string" || html.length < 100) {
    throw new Error("The received HTML is empty or unexpectedly short.");
  }

  let scopedHtml = html;
  if (expectedChampionName) {
    const headingNeedle = `${expectedChampionName} Stats`;
    const headingIndex = html.toLowerCase().indexOf(headingNeedle.toLowerCase());
    if (headingIndex !== -1) {
      // The stats card is much smaller than this. Scoping reduces the chance that
      // another part of the page with a similar label is parsed by mistake.
      scopedHtml = html.slice(headingIndex, headingIndex + 35_000);
    }
  }

  const physical = extractValueNearLabel(scopedHtml, REQUIRED_LABELS.physical);
  const magic = extractValueNearLabel(scopedHtml, REQUIRED_LABELS.magic);
  const trueDamage = extractValueNearLabel(scopedHtml, REQUIRED_LABELS.true);
  const reportedTotal = extractValueNearLabel(scopedHtml, REQUIRED_LABELS.total);
  const componentTotal = physical + magic + trueDamage;

  if (componentTotal <= 0) {
    throw new Error("The parsed component damage total is zero.");
  }

  return {
    physical,
    magic,
    true: trueDamage,
    reportedTotal,
    componentTotal,
    percentages: {
      physical: Number(((physical / componentTotal) * 100).toFixed(2)),
      magic: Number(((magic / componentTotal) * 100).toFixed(2)),
      true: Number(((trueDamage / componentTotal) * 100).toFixed(2))
    }
  };
}
