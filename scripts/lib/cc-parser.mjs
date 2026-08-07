const TENACITY_UNAFFECTED = new Set([
  "airborne",
  "drowsy",
  "nearsight",
  "stasis",
  "suppression"
]);

const HARD_CC = new Set([
  "airborne",
  "charm",
  "fear",
  "flee",
  "polymorph",
  "root",
  "sleep",
  "stasis",
  "stun",
  "suppression",
  "taunt"
]);

const EFFECT_PATTERNS = [
  { type: "suppression", re: /\b(?:suppress(?:es|ed|ing)?|suppression)\b/gi },
  { type: "stasis", re: /\b(?:stasis|put(?:s|ting)? .{0,18} into stasis)\b/gi },
  { type: "nearsight", re: /\b(?:nearsight(?:ed|s|ing)?|nearsighted)\b/gi },
  { type: "drowsy", re: /\bdrows(?:y|iness)\b/gi },
  { type: "sleep", re: /\b(?:sleep|sleeps|asleep)\b/gi },
  { type: "airborne", re: /\b(?:airborne|knock(?:s|ed|ing)?\s+(?:up|back|aside)|pull(?:s|ed|ing)?\s+(?:them|the target|enemy|enemies)?|drag(?:s|ged|ging)?\s+(?:them|the target|enemy|enemies)?)\b/gi },
  { type: "polymorph", re: /\bpolymorph(?:s|ed|ing)?\b/gi },
  { type: "charm", re: /\bcharm(?:s|ed|ing)?\b/gi },
  { type: "fear", re: /\b(?:fear(?:s|ed|ing)?|terrify|terrifies|terrified)\b/gi },
  { type: "flee", re: /\b(?:flee|flees|fleeing)\b/gi },
  { type: "taunt", re: /\btaunt(?:s|ed|ing)?\b/gi },
  { type: "stun", re: /\bstun(?:s|ned|ning)?\b/gi },
  { type: "root", re: /\b(?:root(?:s|ed|ing)?|snare(?:s|d|ing)?|immobiliz(?:e|es|ed|ing))\b/gi },
  { type: "silence", re: /\bsilenc(?:e|es|ed|ing)\b/gi },
  { type: "ground", re: /\bground(?:s|ed|ing)?\b/gi },
  { type: "blind", re: /\bblind(?:s|ed|ing)?\b/gi },
  { type: "disarm", re: /\bdisarm(?:s|ed|ing)?\b/gi },
  { type: "cripple", re: /\bcrippl(?:e|es|ed|ing)\b/gi },
  { type: "slow", re: /\bslow(?:s|ed|ing)?\b/gi }
];

export const MERCS_TENACITY = 0.30;
export const TENACITY_MIN_DURATION_SECONDS = 0.5;

export function stripMarkup(value = "") {
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, ". ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceAround(text, index) {
  const before = text.slice(0, index);
  const leftMatches = [...before.matchAll(/[.!?;](?=\s|$)/g)];
  const left = leftMatches.length ? leftMatches.at(-1).index : -1;
  const after = text.slice(index);
  const rightMatch = after.match(/[.!?;](?=\s|$)/);
  const right = rightMatch ? index + rightMatch.index : text.length;
  return text.slice(Math.max(0, left + 1), Math.min(text.length, right + 1)).trim();
}

function parseNumberList(raw) {
  const values = String(raw)
    .replace(/–|—/g, "-")
    .split(/\s*(?:\/|to|-)\s*/i)
    .map(value => Number(value))
    .filter(Number.isFinite);
  return values.length ? values : null;
}

export function extractDuration(sentence, matchIndex = 0) {
  const windows = [
    sentence.slice(Math.max(0, matchIndex - 55), Math.min(sentence.length, matchIndex + 125)),
    sentence
  ];

  const patterns = [
    /(?:for|lasting|lasts|duration(?: of)?|over)\s+(\d+(?:\.\d+)?(?:\s*(?:\/|to|-)\s*\d+(?:\.\d+)?){0,5})\s*(?:seconds?|secs?|s)\b/i,
    /(\d+(?:\.\d+)?(?:\s*(?:\/|to|-)\s*\d+(?:\.\d+)?){0,5})\s*(?:seconds?|secs?|s)\s+(?:stun|root|slow|silence|fear|taunt|charm|sleep|suppression|airborne)/i
  ];

  for (const windowText of windows) {
    for (const pattern of patterns) {
      const match = windowText.match(pattern);
      if (!match) continue;
      const values = parseNumberList(match[1]);
      if (!values) continue;
      return {
        min: Math.min(...values),
        max: Math.max(...values),
        values
      };
    }
  }

  return null;
}

export function reducedDuration(seconds, tenacity = MERCS_TENACITY) {
  if (!Number.isFinite(seconds)) return null;
  return Math.max(TENACITY_MIN_DURATION_SECONDS, seconds * (1 - tenacity));
}

function isPersistent(sentence) {
  return /\b(?:zone|area|while|remains?|lingers?|continuously|continually|every \d|per second|inside|within)\b/i.test(sentence);
}

export function parseCrowdControlText(rawText, options = {}) {
  const text = stripMarkup(rawText);
  if (!text) return [];

  const effects = [];

  for (const { type, re } of EFFECT_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      const sentence = sentenceAround(text, match.index);

      // Avoid common non-enemy/self references that otherwise create false positives.
      if (/\b(?:immune to|removes? (?:all )?slows?|slow resistance|cannot be slowed|self[- ]slow)\b/i.test(sentence)) continue;

      const duration = extractDuration(sentence, Math.max(0, match.index - text.indexOf(sentence)));
      effects.push({
        type,
        hard: HARD_CC.has(type),
        tenacityAffected: !TENACITY_UNAFFECTED.has(type),
        durationSeconds: duration?.max ?? null,
        durationMinSeconds: duration?.min ?? null,
        durationValues: duration?.values ?? null,
        persistent: isPersistent(sentence),
        sourceText: sentence
      });
    }
  }

  // Airborne descriptions often also use "stun/immobilize" as explanatory wording.
  // When both are detected from the same sentence, keep the displacement because it
  // represents the actual tenacity interaction and avoids double-counting.
  const cleaned = effects.filter((effect, index, all) => {
    if (!["stun", "root"].includes(effect.type)) return true;
    return !all.some(other =>
      other.type === "airborne" &&
      other.sourceText === effect.sourceText &&
      other !== effect
    );
  });

  const seen = new Set();
  return cleaned.filter(effect => {
    const key = [effect.type, effect.durationSeconds, effect.sourceText].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function summarizeChampionCc(abilities, tenacity = MERCS_TENACITY) {
  const summary = {
    reducibleHardSeconds: 0,
    reducibleHardSecondsWithMercs: 0,
    unreducibleHardSeconds: 0,
    reducibleSoftSeconds: 0,
    reducibleSoftSecondsWithMercs: 0,
    unreducibleSoftSeconds: 0,
    knownDurationEffects: 0,
    unknownDurationEffects: 0,
    totalEffects: 0
  };

  for (const ability of abilities) {
    for (const effect of ability.effects || []) {
      summary.totalEffects += 1;
      const seconds = effect.durationSeconds;
      if (!Number.isFinite(seconds)) {
        summary.unknownDurationEffects += 1;
        continue;
      }
      summary.knownDurationEffects += 1;

      if (effect.hard && effect.tenacityAffected) {
        summary.reducibleHardSeconds += seconds;
        summary.reducibleHardSecondsWithMercs += reducedDuration(seconds, tenacity);
      } else if (effect.hard) {
        summary.unreducibleHardSeconds += seconds;
      } else if (effect.tenacityAffected) {
        summary.reducibleSoftSeconds += seconds;
        summary.reducibleSoftSecondsWithMercs += reducedDuration(seconds, tenacity);
      } else {
        summary.unreducibleSoftSeconds += seconds;
      }
    }
  }

  const round = value => Math.round(value * 100) / 100;
  for (const key of Object.keys(summary)) {
    if (typeof summary[key] === "number" && key.includes("Seconds")) summary[key] = round(summary[key]);
  }

  summary.hardSecondsSavedByMercs = round(summary.reducibleHardSeconds - summary.reducibleHardSecondsWithMercs);
  summary.softSecondsSavedByMercs = round(summary.reducibleSoftSeconds - summary.reducibleSoftSecondsWithMercs);
  return summary;
}
