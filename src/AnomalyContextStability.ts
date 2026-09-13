/**
 * AnomalyContextStability.ts
 *
 * Anomaly Context Stability (ACS), per MASTER PROMPT §10: the proportion
 * of tested configurations under which a given observation remains
 * anomalous. Tested variations cover exactly the four the master prompt
 * names: threshold, window, normalization (method), and subset (of rows).
 * This is a sensitivity estimate under tested assumptions, not a
 * guarantee — every caller-facing output must carry that caveat
 * (CONTEXT_STABILITY_DISCLAIMER, re-exported from AnomalyMindModel.ts).
 *
 * ACS needs randomized configuration/subset sampling; to keep results
 * reproducible (MASTER PROMPT §37's "deterministic output" requirement),
 * it uses a small seeded PRNG rather than Math.random() — the same
 * mulberry32 implementation as DecisionStability.ts and PatternTransfer.ts,
 * defined locally here per the project's standing "no shared PRNG module"
 * precedent (each model's randomized metric owns its own copy).
 */

import { detectAnomaliesForVariable } from './AnomalyMindAlgorithm.ts';
import type { AnomalyMindRecord, AnomalyDetectionMethod } from './types.ts';

export const DEFAULT_ACS_TRIALS = 30;
export const DEFAULT_SEED = 42;
export const DEFAULT_STABLE_THRESHOLD = 0.7;
export const DEFAULT_THRESHOLD_JITTER = 0.3; // ±30% relative threshold perturbation per trial
export const DEFAULT_WINDOW_JITTER = 0.3; // ±30% relative window perturbation per trial ('rolling' trials only)
export const DEFAULT_SUBSET_FRACTION = 0.8; // each trial re-evaluates on ~80% of rows
export const MIN_EVALUATED_TRIALS = 5; // fewer valid trials than this and ACS is reported as untested, not confirmed

/** The four methods ACS cycles through as its "normalization" variation, per MASTER PROMPT §10. */
export const ACS_METHODS: AnomalyDetectionMethod[] = ['mad', 'robust-zscore', 'iqr', 'rolling'];

export const CONTEXT_STABILITY_DISCLAIMER =
  'Anomaly Context Stability (ACS) reflects how often an observation stayed anomalous under tested variations ' +
  'in threshold, window, normalization method, and row subset. It is a sensitivity estimate under tested ' +
  'assumptions, not a guarantee.';

/** mulberry32 — small, fast, deterministic PRNG. Same seed always produces the same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically samples a subset of row indices (Fisher–Yates with a
 * seeded PRNG, then take the first `size`), always force-including
 * `mustInclude` (the observation ACS is testing) even if the shuffle
 * didn't naturally pick it — otherwise most trials would simply have
 * nothing to evaluate. Returned in ascending order so relative row order
 * (relevant to the 'rolling' method) is preserved within the subset.
 */
function sampleSubsetIncluding(rowCount: number, fraction: number, mustInclude: number, rng: () => number): number[] {
  const targetSize = Math.max(4, Math.round(rowCount * fraction));
  const size = Math.min(rowCount, targetSize);
  const indices = Array.from({ length: rowCount }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const chosen = indices.slice(0, size);
  if (!chosen.includes(mustInclude)) chosen[0] = mustInclude;
  return chosen.sort((a, b) => a - b);
}

export interface AnomalyContextStabilityResult {
  acs: number;
  trialsEvaluated: number;
  /** True if fewer than MIN_EVALUATED_TRIALS trials could actually be evaluated (e.g. a very small dataset) — acs defaults to 1 and should be read as untested, not confirmed stable. */
  untested: boolean;
}

/**
 * Anomaly Context Stability for one specific observation (`targetIndex`
 * within `records`, for `variable`): the proportion of `trials` tested
 * configurations — each independently varying method (normalization),
 * threshold, window, and row subset — under which the observation is
 * still flagged anomalous. Deterministic for a given
 * (records, variable, targetIndex, baseline, options.seed) tuple.
 *
 * A trial is excluded from both the numerator and denominator (not
 * counted as "not anomalous") whenever the target observation's value
 * isn't present in that trial's random subset — it carries no evidence
 * either way, exactly mirroring how PatternTransfer.ts's PTS excludes
 * partitions that lack enough data for a pair.
 */
export function computeACS(
  records: AnomalyMindRecord[],
  variable: string,
  targetIndex: number,
  baseline: { threshold: number; window: number },
  opts: {
    trials?: number;
    seed?: number;
    thresholdJitter?: number;
    windowJitter?: number;
    subsetFraction?: number;
  } = {}
): AnomalyContextStabilityResult {
  const trials = opts.trials ?? DEFAULT_ACS_TRIALS;
  const rng = mulberry32(opts.seed ?? DEFAULT_SEED);
  const thresholdJitter = opts.thresholdJitter ?? DEFAULT_THRESHOLD_JITTER;
  const windowJitter = opts.windowJitter ?? DEFAULT_WINDOW_JITTER;
  const subsetFraction = opts.subsetFraction ?? DEFAULT_SUBSET_FRACTION;

  if (records.length < 2) {
    return { acs: 1, trialsEvaluated: 0, untested: true };
  }

  let evaluated = 0;
  let stillAnomalous = 0;

  for (let t = 0; t < trials; t++) {
    const method = ACS_METHODS[Math.floor(rng() * ACS_METHODS.length)];
    const thresholdFactor = 1 + (rng() * 2 - 1) * thresholdJitter;
    const windowFactor = 1 + (rng() * 2 - 1) * windowJitter;
    const perturbedThreshold = Math.max(0.1, baseline.threshold * thresholdFactor);
    const perturbedWindow = Math.max(3, Math.round(baseline.window * windowFactor));

    const subsetIndices = sampleSubsetIncluding(records.length, subsetFraction, targetIndex, rng);
    const positionInSubset = subsetIndices.indexOf(targetIndex);
    if (positionInSubset === -1) continue; // should not happen (force-included above), guarded anyway
    const subsetRecords = subsetIndices.map((i) => records[i]);

    const results = detectAnomaliesForVariable(subsetRecords, variable, method, perturbedThreshold, perturbedWindow);
    const flagged = results.find((r) => r.index === positionInSubset);
    if (!flagged) continue; // the target's value was missing in this subset (shouldn't happen since it was force-included, but the value itself could still be non-present upstream)

    evaluated++;
    if (flagged.isAnomaly) stillAnomalous++;
  }

  if (evaluated < MIN_EVALUATED_TRIALS) {
    return { acs: 1, trialsEvaluated: evaluated, untested: true };
  }
  return { acs: stillAnomalous / evaluated, trialsEvaluated: evaluated, untested: false };
}

/** Classifies an ACS value as 'stable' (holds up broadly) vs 'threshold-sensitive' (only under the exact baseline configuration), or 'untested' when too little data supported computing it at all. */
export function classifyStability(result: AnomalyContextStabilityResult): 'stable' | 'threshold-sensitive' | 'untested' {
  if (result.untested) return 'untested';
  return result.acs >= DEFAULT_STABLE_THRESHOLD ? 'stable' : 'threshold-sensitive';
}
