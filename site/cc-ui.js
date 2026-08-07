(() => {
  const MERCS_TENACITY = 0.30;
  const MIN_CC_DURATION = 0.5;
  let ccProfiles = {};
  let ccMeta = {};

  function pct(value) { return `${(value || 0).toFixed(1)}%`; }
  function setText(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }

  function injectUi() {
    const subtitle = document.querySelector(".subtitle");
    if (subtitle) subtitle.textContent = "Select the five enemy champions and compare their combined damage profile, Tenacity-reducible crowd control, and defensive boot tradeoffs.";

    const summary = document.querySelector(".summary-wrap");
    const recommendation = summary?.querySelector(".recommendation");
    if (!summary || !recommendation || document.getElementById("cc-title")) return;

    const section = document.createElement("section");
    section.className = "cc-section";
    section.setAttribute("aria-labelledby", "cc-title");
    section.innerHTML = `
      <div class="cc-heading">
        <strong id="cc-title">Crowd control</strong>
        <span id="cc-coverage">CC data loading…</span>
      </div>
      <div class="cc-grid">
        <div class="cc-metric">
          <div class="cc-metric-label">Known hard CC</div>
          <div class="cc-metric-value" id="cc-hard-total">0.0s</div>
          <div class="cc-metric-sub">Potential effective hard-CC budget</div>
        </div>
        <div class="cc-metric">
          <div class="cc-metric-label">Tenacity-reducible</div>
          <div class="cc-metric-value" id="cc-reducible-hard">0.0s</div>
          <div class="cc-metric-sub">This portion is shortened, not removed</div>
        </div>
        <div class="cc-metric">
          <div class="cc-metric-label">After Mercury's Treads</div>
          <div class="cc-metric-value" id="cc-with-mercs">0.0s</div>
          <div class="cc-metric-sub" id="cc-after-mercs-label">Known hard CC after 30% Tenacity</div>
        </div>
        <div class="cc-metric">
          <div class="cc-metric-label">Mercs time saved</div>
          <div class="cc-metric-value" id="cc-time-saved">0.0s</div>
          <div class="cc-metric-sub" id="cc-unaffected-label">0.0s known hard CC unaffected</div>
        </div>
      </div>
      <p class="cc-note" id="cc-note">This is a potential CC budget, not a prediction of one perfect chain.</p>
      <div class="cc-breakdown" id="cc-breakdown"></div>`;
    summary.insertBefore(section, recommendation);

    const kicker = recommendation.querySelector(".recommendation-kicker");
    if (kicker) kicker.textContent = "Boot verdict";
    if (!document.getElementById("recommendation-signals")) {
      const signals = document.createElement("div");
      signals.className = "recommendation-signals";
      signals.id = "recommendation-signals";
      recommendation.append(signals);
    }
  }

  function selectedChampions() {
    try {
      return team.map(id => id ? getChampion(id) : null).filter(Boolean);
    } catch {
      return [];
    }
  }

  function calculateCrowdControl(selected) {
    const total = {
      coveredChampions: 0,
      selectedChampions: selected.length,
      reducibleHardSeconds: 0,
      reducibleHardSecondsWithMercs: 0,
      unreducibleHardSeconds: 0,
      reducibleSoftSeconds: 0,
      reducibleSoftSecondsWithMercs: 0,
      unreducibleSoftSeconds: 0,
      knownDurationEffects: 0,
      unknownDurationEffects: 0,
      totalEffects: 0,
      hardSecondsSavedByMercs: 0,
      softSecondsSavedByMercs: 0
    };

    for (const champion of selected) {
      const profile = ccProfiles[champion.id];
      if (!profile) continue;
      total.coveredChampions += 1;
      const summary = profile.summary || {};
      for (const key of Object.keys(total)) {
        if (["coveredChampions", "selectedChampions", "hardSecondsSavedByMercs", "softSecondsSavedByMercs"].includes(key)) continue;
        total[key] += Number(summary[key] || 0);
      }
    }

    total.hardSecondsSavedByMercs = Math.max(0, total.reducibleHardSeconds - total.reducibleHardSecondsWithMercs);
    total.softSecondsSavedByMercs = Math.max(0, total.reducibleSoftSeconds - total.reducibleSoftSecondsWithMercs);
    return total;
  }

  function renderCrowdControl(cc, selected) {
    const hardTotal = cc.reducibleHardSeconds + cc.unreducibleHardSeconds;
    const hardWithMercs = cc.reducibleHardSecondsWithMercs + cc.unreducibleHardSeconds;
    const hardSaved = Math.max(0, hardTotal - hardWithMercs);
    setText("cc-hard-total", `${hardTotal.toFixed(1)}s`);
    setText("cc-reducible-hard", `${cc.reducibleHardSeconds.toFixed(1)}s`);
    setText("cc-with-mercs", `${hardWithMercs.toFixed(1)}s`);
    setText("cc-time-saved", `${hardSaved.toFixed(1)}s`);
    setText("cc-after-mercs-label", `${hardTotal.toFixed(1)}s − ${hardSaved.toFixed(1)}s saved = ${hardWithMercs.toFixed(1)}s`);
    setText("cc-unaffected-label", `${cc.unreducibleHardSeconds.toFixed(1)}s known hard CC unaffected`);
    setText("cc-coverage", `${cc.coveredChampions}/${selected.length || 5} selected${ccMeta.patch ? ` · patch ${ccMeta.patch}` : ""}`);

    const unknown = cc.unknownDurationEffects;
    setText("cc-note",
      `Tenacity-reducible means the listed ${cc.reducibleHardSeconds.toFixed(1)}s can be shortened; it is not removed outright. Mercs save ${hardSaved.toFixed(1)}s of known hard CC and ${cc.softSecondsSavedByMercs.toFixed(1)}s across known reducible soft CC.` +
      (unknown ? ` ${unknown} detected CC effect${unknown === 1 ? " has" : "s have"} no explicit duration and are not added to the seconds total.` : "") +
      " Overlapping simultaneous hard CC is counted as one effective lockout window. Displacements, drowsy, nearsight, stasis, and suppression are not shortened by Tenacity."
    );

    const container = document.getElementById("cc-breakdown");
    if (!container) return;
    container.innerHTML = "";
    for (const champion of selected) {
      const profile = ccProfiles[champion.id];
      const row = document.createElement("div");
      row.className = "cc-champion";
      if (!profile) {
        row.innerHTML = `<div class="cc-champion-head"><span>${champion.name}</span><span>CC data unavailable</span></div>`;
        container.append(row);
        continue;
      }

      const effects = (profile.abilities || []).flatMap(ability =>
        (ability.effects || []).map(effect => ({ ...effect, slot: ability.slot, abilityName: ability.name }))
      );
      const timed = effects.filter(effect => Number.isFinite(effect.durationSeconds)).length;
      row.innerHTML = `<div class="cc-champion-head"><span>${champion.name}</span><span>${effects.length} effect${effects.length === 1 ? "" : "s"} · ${timed} timed</span></div>`;
      const chips = document.createElement("div");
      chips.className = "cc-effects";
      if (!effects.length) {
        chips.innerHTML = `<span class="cc-effect">No CC detected</span>`;
      } else {
        for (const effect of effects) {
          const chip = document.createElement("span");
          chip.className = `cc-effect ${effect.tenacityAffected ? "reducible" : "unaffected"}`;
          const type = effect.type.charAt(0).toUpperCase() + effect.type.slice(1);
          let duration = "duration not explicit";
          if (Number.isFinite(effect.durationSeconds)) {
            const reduced = effect.tenacityAffected
              ? Math.max(MIN_CC_DURATION, effect.durationSeconds * (1 - MERCS_TENACITY))
              : effect.durationSeconds;
            duration = effect.tenacityAffected
              ? `${effect.durationSeconds.toFixed(1)}s → ${reduced.toFixed(1)}s`
              : `${effect.durationSeconds.toFixed(1)}s unchanged`;
          }
          const overlap = (effect.concurrentEffects || [])
            .filter(item => Number.isFinite(item.durationSeconds))
            .map(item => `${item.durationSeconds.toFixed(1)}s ${item.type}`)
            .join(", ");
          if (overlap) duration += ` · overlaps ${overlap}`;
          chip.innerHTML = `<strong>${effect.slot}</strong> ${type} · ${duration}`;
          chip.title = `${effect.abilityName}: ${effect.sourceText || ""}`;
          chips.append(chip);
        }
      }
      row.append(chips);
      container.append(row);
    }
  }

  function enhanceRecommendation(shares, selectedCount, readyCount, cc) {
    if (!selectedCount || readyCount < selectedCount) return;
    const title = document.getElementById("recommendation-title");
    const copy = document.getElementById("recommendation-copy");
    const signals = document.getElementById("recommendation-signals");
    if (!title || !copy || !signals) return;

    const gap = shares.physical - shares.magic;
    const ccSavings = cc.hardSecondsSavedByMercs || 0;
    const reducibleHard = cc.reducibleHardSeconds || 0;
    const ccComplete = cc.coveredChampions === selectedCount;
    const damageSignal = gap >= 10
      ? `Damage favors Steelcaps: ${pct(shares.physical)} physical vs ${pct(shares.magic)} magic.`
      : gap <= -10
        ? `Damage favors Mercs: ${pct(shares.magic)} magic vs ${pct(shares.physical)} physical.`
        : `Damage is mixed: ${pct(shares.physical)} physical / ${pct(shares.magic)} magic.`;
    const ccSignal = ccComplete
      ? reducibleHard > 0
        ? `Tenacity case: ${reducibleHard.toFixed(1)}s known reducible hard CC; Mercs save about ${ccSavings.toFixed(1)}s.`
        : "Tenacity case: no timed reducible hard CC was detected."
      : "Tenacity case: CC coverage is incomplete, so treat the CC recommendation as provisional.";
    signals.innerHTML = `<span>${damageSignal}</span><span>${ccSignal}</span>`;

    if (gap <= -15) {
      title.textContent = "Mercury's Treads are the stronger baseline";
      copy.textContent = "Magic damage already favors magic resistance, and any reducible crowd control adds additional value to Mercury's Treads.";
    } else if (gap >= 15 && ccComplete && reducibleHard >= 3 && ccSavings >= 1) {
      title.textContent = "Close call: crowd control makes Mercs competitive";
      copy.textContent = "The damage profile favors Plated Steelcaps, but the enemy team also carries enough Tenacity-reducible hard CC that Mercury's Treads can still be the better practical purchase.";
    } else if (gap >= 15) {
      title.textContent = "Plated Steelcaps are the stronger baseline";
      copy.textContent = "The enemy team is meaningfully physical-damage heavy, and the measured Tenacity savings are not large enough to overturn the armor case.";
    } else if (ccComplete && ccSavings >= 0.75) {
      title.textContent = "Mercury's Treads have the stronger utility case";
      copy.textContent = "Damage is relatively mixed, so the additional time recovered from reducible hard crowd control gives Mercury's Treads the more useful defensive profile.";
    } else {
      title.textContent = "Mixed matchup — choose for the main threat";
      copy.textContent = "Neither damage type dominates enough to decide the boots alone. Repeated basic attacks favor Steelcaps; meaningful magic damage or reducible CC favors Mercs.";
    }
  }

  injectUi();

  if (typeof updateRecommendation === "function") {
    const originalUpdateRecommendation = updateRecommendation;
    updateRecommendation = function(shares, selectedCount, readyCount) {
      originalUpdateRecommendation(shares, selectedCount, readyCount);
      const selected = selectedChampions();
      const cc = calculateCrowdControl(selected);
      renderCrowdControl(cc, selected);
      enhanceRecommendation(shares, selectedCount, readyCount, cc);
    };
  }

  fetch(`./data/champion-cc.json?ts=${Date.now()}`, { cache: "no-store" })
    .then(response => {
      if (!response.ok) throw new Error(`CC data request failed: ${response.status}`);
      return response.json();
    })
    .then(payload => {
      ccProfiles = payload.champions || {};
      ccMeta = payload.meta || {};
      if (typeof calculate === "function") calculate();
    })
    .catch(error => {
      console.warn("Could not load crowd-control data.", error);
      setText("cc-coverage", "CC data unavailable");
    });
})();
