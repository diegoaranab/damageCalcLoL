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

// These expressions intentionally prefer verbs/effect wording over bare nouns. That
// avoids treating references such as "champions hit by Charm" as if the current
// ability itself applied a charm. Bare "fear" and "stun" are accepted only when
// they are clearly used as verbs against a target.
const EFFECT_PATTERNS = [
  { type: "suppression", re: /\b(?:suppress(?:es|ed|ing)?|suppression)\b/gi },
  { type: "stasis", re: /\b(?:stasis|put(?:s|ting)?\s+[^.!?;]{0,30}\s+into stasis)\b/gi },
  { type: "nearsight", re: /\b(?:nearsight(?:ed|s|ing)?|nearsighted)\b/gi },
  { type: "drowsy", re: /\bdrows(?:y|iness)\b/gi },
  { type: "sleep", re: /\b(?:puts?\s+[^.!?;]{0,35}\s+to sleep|falls? asleep|asleep|sleeping)\b/gi },
  {
    type: "airborne",
    re: /\b(?:airborne|knock(?:s|ed|ing)?\s+(?:(?:the\s+)?target|them|an?\s+enemy|enemies|champions?|units?)?\s*(?:up|back|aside)|knock[- ]?(?:up|back)|toss(?:es|ed|ing)?\s+[^.!?;]{0,30}\s+(?:into the air|upward)|launch(?:es|ed|ing)?\s+[^.!?;]{0,30}\s+(?:into the air|upward)|pull(?:s|ed|ing)?\s+(?:(?:the\s+)?target|them|an?\s+enemy|enemies|champions?|units?)\b|drag(?:s|ged|ging)?\s+(?:(?:the\s+)?target|them|an?\s+enemy|enemies|champions?|units?)\b|fling(?:s|ing)?\s+(?:(?:the\s+)?target|them|an?\s+enemy|enemies|champions?|units?)\b|displac(?:e|es|ed|ing)\s+(?:(?:the\s+)?target|them|an?\s+enemy|enemies|champions?|units?))\b/gi
  },
  { type: "polymorph", re: /\b(?:polymorph(?:s|ed|ing)?|turn(?:s|ed|ing)?\s+[^.!?;]{0,25}\s+into a harmless)\b/gi },
  { type: "charm", re: /\b(?:charm(?:s|ed|ing)|to charm)\b/gi },
  {
    type: "fear",
    re: /\b(?:fear(?:s|ed|ing)|fear(?=\s+(?:(?:the\s+)?target|them|an?\s+enemy|enemies|champions?|units?)\b)|terrify|terrifies|terrified|terrifying)\b/gi
  },
  { type: "flee", re: /\b(?:flee|flees|fleeing)\b/gi },
  { type: "taunt", re: /\b(?:taunt(?:s|ed|ing)|to taunt)\b/gi },
  {
    type: "stun",
    re: /\b(?:stun(?:s|ned|ning)|to stun|stun(?=\s+(?:(?:the\s+)?target|them|an?\s+enemy|enemies|champions?|units?)\b)|stun(?=\s+and\s+[^.!?;]{0,35}\b(?:(?:the\s+)?target|them|an?\s+enemy|enemies|champions?|units?)\b))\b/gi
  },
  { type: "root", re: /\b(?:root(?:s|ed|ing)|to root|snare(?:s|d|ing)|to snare)\b/gi },
  { type: "silence", re: /\b(?:silenc(?:e|es|ed|ing)|to silence)\b/gi },
  { type: "ground", re: /\b(?:ground(?:s|ed|ing)|to ground)\b/gi },
  { type: "blind", re: /\b(?:blind(?:s|ed|ing)|to blind)\b/gi },
  { type: "disarm", re: /\b(?:disarm(?:s|ed|ing)|to disarm)\b/gi },
  { type: "cripple", re: /\b(?:crippl(?:e|es|ed|ing)|to cripple)\b/gi },
  { type: "slow", re: /\b(?:slow(?:s|ed|ing)|to slow)\b/gi }
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
  // League Wiki frequently inserts metadata such as "(based on level)" between a
  // duration value list and "seconds". Accept those annotations, but deliberately
  // reject scaling expressions such as "(+ 0.5 per 100 AP)" rather than pretending
  // their base value is the complete duration.
  const qualifier = String.raw`(?:\s*\(based on [^)]{1,65}\))?`;
  const numberList = String.raw`(\d+(?:\.\d+)?(?:\s*(?:\/|to|-)\s*\d+(?:\.\d+)?){0,5})`;
  const patternSources = [
    String.raw`(?:for|lasting|lasts|duration(?: of)?|over)\s+${numberList}${qualifier}\s*(?:seconds?|secs?|s)\b`,
    String.raw`${numberList}${qualifier}\s*(?:seconds?|secs?|s)\s+(?:stun|root|slow|silence|fear|taunt|charm|sleep|suppression|airborne)`
  ];

  const candidates = [];
  for (const source of patternSources) {
    const pattern = new RegExp(source, "gi");
    let match;
    while ((match = pattern.exec(sentence)) !== null) {
      const values = parseNumberList(match[1]);
      if (!values) continue;
      const start = match.index;
      const end = match.index + match[0].length;
      const distance = matchIndex < start
        ? start - matchIndex
        : matchIndex > end
          ? matchIndex - end
          : 0;
      candidates.push({
        min: Math.min(...values),
        max: Math.max(...values),
        values,
        distance,
        start
      });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.distance - b.distance || a.start - b.start);
  const { min, max, values } = candidates[0];
  return { min, max, values };
}

export function reducedDuration(seconds, tenacity = MERCS_TENACITY) {
  if (!Number.isFinite(seconds)) return null;
  return Math.max(TENACITY_MIN_DURATION_SECONDS, seconds * (1 - tenacity));
}

function isPersistent(sentence) {
  return /\b(?:zone|area|while|remains?|lingers?|continuously|continually|every \d|per second|inside|within)\b/i.test(sentence);
}

function isNonChampionOnly(sentence) {
  // The common example is Aatrox R fearing nearby enemy minions. Do not make that
  // count toward a champion-vs-champion Tenacity decision.
  return /\b(?:enemy\s+)?minions?\b/i.test(sentence) &&
    !/\bchampions?\b/i.test(sentence) &&
    !/\b(?:all|nearby|hit|affected)\s+enemies\b/i.test(sentence);
}

function effectFamily(type) {
  // Fear and flee are direction variants of the same forced-movement CC family for
  // this model. An ability such as Vex P can describe both, but only one happens per
  // proc, so retaining both would double-count the same hard-CC event.
  return type === "flee" ? "fear" : type;
}

function postTenacityDuration(effect) {
  if (!Number.isFinite(effect.durationSeconds)) return null;
  return effect.tenacityAffected
    ? reducedDuration(effect.durationSeconds)
    : effect.durationSeconds;
}

function concurrentEffectSnapshot(effect) {
  return {
    type: effect.type,
    durationSeconds: effect.durationSeconds,
    tenacityAffected: effect.tenacityAffected
  };
}

function collapseAirborneOverlap(effects) {
  const kept = new Set(effects);
  const bySentence = new Map();

  for (const effect of effects) {
    if (!effect.hard || !effect.sourceText) continue;
    if (!bySentence.has(effect.sourceText)) bySentence.set(effect.sourceText, []);
    bySentence.get(effect.sourceText).push(effect);
  }

  for (const group of bySentence.values()) {
    const airborne = group.find(effect => effect.type === "airborne");
    const timedReducible = group.filter(effect =>
      ["stun", "root"].includes(effect.type) &&
      Number.isFinite(effect.durationSeconds)
    );
    if (!airborne || !Number.isFinite(airborne.durationSeconds) || !timedReducible.length) continue;

    for (const reducible of timedReducible) {
      const airborneAfter = postTenacityDuration(airborne);
      const reducibleAfter = postTenacityDuration(reducible);
      if (!Number.isFinite(airborneAfter) || !Number.isFinite(reducibleAfter)) continue;

      // These effects describe the same lockout window. Keep whichever still lasts
      // longer after Mercury's Treads rather than summing simultaneous CC twice.
      // Example: Thresh Q is a 1.5s stun with a 0.4s airborne overlap, so the stun
      // remains the effective window after 30% Tenacity (1.05s > 0.4s). Vel'Koz E
      // has equal 0.75s stun/airborne, so the unaffected airborne component dominates.
      const reducibleDominates = reducibleAfter > airborneAfter;
      const winner = reducibleDominates ? reducible : airborne;
      const loser = reducibleDominates ? airborne : reducible;
      if (!kept.has(winner) || !kept.has(loser)) continue;

      winner.concurrentEffects = [
        ...(winner.concurrentEffects || []),
        concurrentEffectSnapshot(loser)
      ];
      kept.delete(loser);
    }
  }

  return effects.filter(effect => kept.has(effect));
}

export function parseCrowdControlText(rawText) {
  const text = stripMarkup(rawText);
  if (!text) return [];

  const effects = [];

  for (const { type, re } of EFFECT_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      const sentence = sentenceAround(text, match.index);

      if (/\b(?:immune to|removes? (?:all )?slows?|slow resistance|cannot be slowed|self[- ]slow)\b/i.test(sentence)) continue;
      if (isNonChampionOnly(sentence)) continue;

      const duration = extractDuration(sentence, Math.max(0, match.index - text.indexOf(sentence)));
      effects.push({
        type,
        hard: HARD_CC.has(type),
        tenacityAffected: !TENACITY_UNAFFECTED.has(type),
        durationSeconds: duration?.max ?? null,
        durationMinSeconds: duration?.min ?? null,
        durationValues: duration?.values ?? null,
        durationSource: duration ? "description" : null,
        persistent: isPersistent(sentence),
        sourceText: sentence
      });
    }
  }

  // One ability should expose one entry per semantic CC family in the final model.
  // Prefer the occurrence with a known duration over a duplicate prose mention.
  const byType = new Map();
  for (const effect of effects) {
    const key = effectFamily(effect.type);
    const current = byType.get(key);
    if (!current || (!Number.isFinite(current.durationSeconds) && Number.isFinite(effect.durationSeconds))) {
      byType.set(key, effect);
    }
  }

  return collapseAirborneOverlap([...byType.values()]);
}

export function isHardCrowdControl(type) {
  return HARD_CC.has(type);
}

export function isTenacityAffected(type) {
  return !TENACITY_UNAFFECTED.has(type);
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
