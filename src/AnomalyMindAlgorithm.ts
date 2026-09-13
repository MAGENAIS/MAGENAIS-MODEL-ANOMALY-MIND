/**
 * AnomalyMindAlgorithm.ts
 *
 * Pure, deterministic anomaly-scoring functions: numeric-variable
 * inference, and four lightweight, explainable detection methods (MAD,
 * robust Z-score, IQR, rolling statistics) per MASTER PROMPT §10. No
 * randomness lives here; the only randomized piece (configuration sampling
 * for Anomaly Context Stability) lives in AnomalyContextStability.ts,
 * which calls back into detectAnomaliesForVariable() per trial — mirroring
 * exactly how PatternTransfer.ts calls back into PatternSenseAlgorithm.ts.
 *
 * Kept dependency-free and side-effect-free on purpose so it can later
 * become the independent MAGENAIS-MODEL-ANOMALY-MIND package without
 * needing to be rewritten (MASTER PROMPT §28).
 */

import type { AnomalyMindInput, AnomalyMindRecord, AnomalyDetectionMethod } from './types.ts';

export class AnomalyMindValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnomalyMindValidationError';
  }
}

const VALID_METHODS: AnomalyDetectionMethod[] = ['mad', 'robust-zscore', 'iqr', 'rolling'];

/** Throws AnomalyMindValidationError on any structural or data problem. Never silently repairs input. */
export function validateInput(input: AnomalyMindInput): void {
  if (!input || typeof input !== 'object') {
    throw new AnomalyMindValidationError('Input must be an object with a records array.');
  }
  if (!Array.isArray(input.records) || input.records.length === 0) {
    throw new AnomalyMindValidationError('At least one record is required.');
  }
  for (let i = 0; i < input.records.length; i++) {
    const row = input.records[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new AnomalyMindValidationError(`Record at index ${i} must be a plain object.`);
    }
  }
  if (input.variables !== undefined) {
    if (
      !Array.isArray(input.variables) ||
      input.variables.length === 0 ||
      input.variables.some((v) => typeof v !== 'string' || v.length === 0)
    ) {
      throw new AnomalyMindValidationError('variables, if provided, must be a non-empty array of non-empty strings.');
    }
  }
}

/** Throws AnomalyMindValidationError if run options reference an unknown method. Never silently repairs input. */
export function validateRunOptions(method: AnomalyDetectionMethod | undefined): void {
  if (method !== undefined && !VALID_METHODS.includes(method)) {
    throw new AnomalyMindValidationError(
      `Unknown method "${method}". Must be one of: ${VALID_METHODS.join(', ')}.`
    );
  }
}

/** Every variable name to consider: caller-supplied `variables`, or the union of keys across all records. */
export function resolveVariableNames(input: AnomalyMindInput): string[] {
  if (input.variables && input.variables.length > 0) return [...input.variables];
  const names = new Set<string>();
  for (const row of input.records) {
    for (const key of Object.keys(row)) names.add(key);
  }
  return [...names];
}

/**
 * A value counts as present for analysis purposes if it is not
 * null/undefined and not an empty string. Everything else is "missing" and
 * excluded from that variable's anomaly scoring, per MASTER PROMPT §37's
 * "missing values" test requirement.
 */
export function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

/**
 * Splits `variableNames` into numeric (every present value across the
 * records is a finite number, or a string that parses cleanly as one) and
 * skipped (everything else, including a variable with zero present
 * values). AnomalyMind only analyzes numeric variables — non-numeric
 * columns are reported back to the caller as `variablesSkipped`, never
 * silently dropped without explanation.
 */
export function inferNumericVariables(
  records: AnomalyMindRecord[],
  variableNames: string[]
): { numeric: string[]; skipped: string[] } {
  const numeric: string[] = [];
  const skipped: string[] = [];
  for (const name of variableNames) {
    let sawAny = false;
    let allNumeric = true;
    for (const row of records) {
      const value = row[name];
      if (!isPresent(value)) continue;
      sawAny = true;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) allNumeric = false;
      } else if (typeof value === 'string') {
        if (value.trim() === '' || !Number.isFinite(Number(value))) allNumeric = false;
      } else {
        allNumeric = false;
      }
      if (!allNumeric) break;
    }
    if (sawAny && allNumeric) numeric.push(name);
    else skipped.push(name);
  }
  return { numeric, skipped };
}

/** Present (non-missing) numeric values for one variable, paired with their original row index within `records`. */
export function extractPresentValues(
  records: AnomalyMindRecord[],
  variable: string
): { indices: number[]; values: number[] } {
  const indices: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < records.length; i++) {
    const raw = records[i][variable];
    if (!isPresent(raw)) continue;
    indices.push(i);
    values.push(toNumber(raw));
  }
  return { indices, values };
}

/** Median of a numeric array. NaN for an empty array. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median absolute deviation: the median of |x - median(values)| across `values`. 0 for an empty array. */
export function computeMAD(values: number[], med: number = median(values)): number {
  if (values.length === 0) return 0;
  return median(values.map((v) => Math.abs(v - med)));
}

/**
 * Quartiles via Tukey's hinges: the median of the lower half and the median
 * of the upper half (excluding the overall median itself when the array
 * has odd length). A simple, well-understood, dependency-free method —
 * not the only valid quartile convention, but a deterministic one.
 */
export function quartiles(values: number[]): { q1: number; q3: number; iqr: number } {
  if (values.length === 0) return { q1: NaN, q3: NaN, iqr: NaN };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  const lowerHalf = sorted.slice(0, mid);
  const upperHalf = n % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);
  const q1 = median(lowerHalf.length > 0 ? lowerHalf : sorted);
  const q3 = median(upperHalf.length > 0 ? upperHalf : sorted);
  return { q1, q3, iqr: q3 - q1 };
}

/** Each method's own conventional default threshold — not one shared number across methods. */
export const DEFAULT_THRESHOLDS: Record<AnomalyDetectionMethod, number> = {
  mad: 3,
  'robust-zscore': 3.5, // the standard Iglewicz & Hoaglin modified-z-score cutoff
  iqr: 1.5, // the standard Tukey fence multiplier
  rolling: 3,
};

export const DEFAULT_WINDOW = 10;
export const MODIFIED_ZSCORE_SCALE = 0.6745;

/** A tiny floor used in place of an exact-zero spread, so a perfectly flat series still yields a finite (very large, not Infinity/NaN) score for a genuinely different value, instead of dividing by zero. */
const EPSILON = 1e-9;

/**
 * A single value's deviation score under a rolling (local-neighborhood)
 * z-score: the neighborhood is every OTHER present value within `window`
 * positions of `arrayIndex` (excluding the point itself, so an anomaly
 * cannot inflate its own baseline). Returns 0 if fewer than 2 neighbors are
 * available (not enough local context to judge — never treated as
 * anomalous by default in that case).
 */
function rollingScoreAt(values: number[], arrayIndex: number, window: number): number {
  const half = Math.max(1, Math.floor(window / 2));
  const start = Math.max(0, arrayIndex - half);
  const end = Math.min(values.length - 1, arrayIndex + half);
  const neighborhood: number[] = [];
  for (let i = start; i <= end; i++) {
    if (i === arrayIndex) continue;
    neighborhood.push(values[i]);
  }
  if (neighborhood.length < 2) return 0;
  const mean = neighborhood.reduce((s, v) => s + v, 0) / neighborhood.length;
  const variance = neighborhood.reduce((s, v) => s + (v - mean) ** 2, 0) / neighborhood.length;
  const std = Math.sqrt(variance);
  return (values[arrayIndex] - mean) / Math.max(std, EPSILON);
}

export interface VariableAnomalyResult {
  /** Index within the `records` array passed to detectAnomaliesForVariable — NOT necessarily the original dataset's row index (callers map that themselves; see AnomalyMindModel.ts / AnomalyContextStability.ts). */
  index: number;
  value: number;
  score: number;
  isAnomaly: boolean;
}

/**
 * Scores every present value of `variable` within `records` under one
 * detection method, returning one entry per present value (missing values
 * are excluded entirely — never scored, never flagged). `index` in each
 * result is the position within `records`, exactly mirroring how
 * PatternSense's pairwise functions operate on whatever record array
 * they're handed (the whole dataset, or a single ACS-trial partition).
 */
export function detectAnomaliesForVariable(
  records: AnomalyMindRecord[],
  variable: string,
  method: AnomalyDetectionMethod,
  threshold: number,
  window: number
): VariableAnomalyResult[] {
  const { indices, values } = extractPresentValues(records, variable);
  if (values.length === 0) return [];

  if (method === 'rolling') {
    return indices.map((index, i) => {
      const score = rollingScoreAt(values, i, window);
      return { index, value: values[i], score, isAnomaly: Math.abs(score) > threshold };
    });
  }

  if (method === 'iqr') {
    const { q1, q3, iqr } = quartiles(values);
    const safeIqr = Math.max(iqr, EPSILON);
    return indices.map((index, i) => {
      const v = values[i];
      const beyond = v < q1 ? q1 - v : v > q3 ? v - q3 : 0;
      const score = beyond / safeIqr;
      return { index, value: v, score, isAnomaly: score > threshold };
    });
  }

  // 'mad' and 'robust-zscore' share the same underlying statistic (median + MAD),
  // differing only in the scale factor applied to the deviation.
  const med = median(values);
  const madValue = computeMAD(values, med);
  const safeMad = Math.max(madValue, EPSILON);
  const scale = method === 'robust-zscore' ? MODIFIED_ZSCORE_SCALE : 1;
  return indices.map((index, i) => {
    const v = values[i];
    const score = (scale * (v - med)) / safeMad;
    return { index, value: v, score, isAnomaly: Math.abs(score) > threshold };
  });
}

export function resolveDefaultThreshold(method: AnomalyDetectionMethod): number {
  return DEFAULT_THRESHOLDS[method];
}

export function buildFlagExplanation(
  variable: string,
  method: AnomalyDetectionMethod,
  score: number,
  threshold: number,
  acs: number,
  stability: 'stable' | 'threshold-sensitive' | 'untested'
): string {
  const methodLabel: Record<AnomalyDetectionMethod, string> = {
    mad: 'median absolute deviation (MAD)',
    'robust-zscore': 'robust (modified) Z-score',
    iqr: 'interquartile range (IQR)',
    rolling: 'rolling local neighborhood',
  };
  const parts: string[] = [
    `"${variable}" deviates by ${Math.abs(score).toFixed(2)} under the ${methodLabel[method]} method ` +
      `(threshold ${threshold}).`,
  ];
  if (stability === 'untested') {
    parts.push('Anomaly Context Stability (ACS) could not be tested — too little data.');
  } else {
    parts.push(
      `Anomaly Context Stability (ACS): ${acs.toFixed(2)} — this observation remained anomalous in ` +
        `${Math.round(acs * 100)}% of tested threshold/window/method/subset variations, so it is classified as ` +
        `${stability === 'stable' ? 'a stable anomaly' : 'a threshold-sensitive anomaly'}.`
    );
  }
  return parts.join(' ');
}
