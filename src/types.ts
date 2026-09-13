/**
 * types.ts (AnomalyMind)
 *
 * Input/output shapes specific to the AnomalyMind model. Distinct from the
 * generic ModelRequest<T>/ModelResponse<T> envelopes in ../types/ —
 * AnomalyMindInput is the `T` that fills ModelRequest.input, and
 * AnomalyMindOutput is the `T` that fills ModelResponse.output.
 *
 * Per MASTER PROMPT §10: lightweight, local, explainable anomaly detection
 * over numeric tabular/time-series/sensor data. No large neural network —
 * only simple, explainable statistical methods (MAD, robust Z-score, IQR,
 * rolling statistics).
 */

export type AnomalyMindCellValue = number | string | boolean | null | undefined;

export type AnomalyMindRecord = Record<string, AnomalyMindCellValue>;

/**
 * The four lightweight, explainable methods MASTER PROMPT §10 calls out by
 * name. 'mad' and 'robust-zscore' are both derived from the median absolute
 * deviation but are two distinct, separately named rules of thumb (see
 * AnomalyMindAlgorithm.ts): 'mad' is the raw "> N median-absolute-deviations
 * from the median" rule; 'robust-zscore' is the standard Iglewicz & Hoaglin
 * modified z-score (scaled by 0.6745), which has its own conventional
 * threshold (3.5). Keeping them as separate methods lets ACS (§10) treat
 * "changing the normalization" as a real, distinct variation to test.
 */
export type AnomalyDetectionMethod = 'mad' | 'robust-zscore' | 'iqr' | 'rolling';

export interface AnomalyMindInput {
  records: AnomalyMindRecord[];
  /** Restrict analysis to these variables (column/key names). Default: every numeric variable present across the records. */
  variables?: string[];
}

export interface AnomalyMindRunOptions {
  /** Which detection method to use as the primary/baseline method. Default 'mad'. */
  method?: AnomalyDetectionMethod;
  /**
   * Deviation threshold for the chosen method. Default depends on `method`
   * (see DEFAULT_THRESHOLDS in AnomalyMindAlgorithm.ts) — each method's own
   * conventional default, not one shared number.
   */
  threshold?: number;
  /** Neighborhood size used by the 'rolling' method. Ignored by the other three methods. Default 10 (or fewer, for small datasets). */
  window?: number;
  /** Number of tested configurations used to compute Anomaly Context Stability (ACS) per flagged observation. Default 30. */
  acsTrials?: number;
  /**
   * Deterministic seed for ACS's configuration sampling (threshold/window
   * jitter, method choice, row subset). Same input + same seed always
   * yields the same ACS (MASTER PROMPT §37's "deterministic output"
   * requirement). Default 42.
   */
  seed?: number;
}

export interface AnomalyFlag {
  /** Row index within the original `records` array. */
  index: number;
  variable: string;
  value: number;
  /** The method actually used to flag this observation (the run's baseline method — see AnomalyMindRunOptions.method). */
  method: AnomalyDetectionMethod;
  /** Method-specific deviation score. Larger magnitude = more extreme. Not comparable across methods. */
  score: number;
  threshold: number;
  isAnomaly: boolean;
  /**
   * Anomaly Context Stability (MASTER PROMPT §10): the proportion of tested
   * configurations (varying threshold, window, normalization method, and
   * row subset) under which this same observation remained anomalous.
   */
  acs: number;
  /** Whether ACS distinguishes this as holding up broadly ('stable') or only under the exact baseline configuration ('threshold-sensitive'). 'untested' means too few valid ACS trials were evaluable (e.g. an extremely small dataset). */
  stability: 'stable' | 'threshold-sensitive' | 'untested';
  explanation: string;
}

export interface AnomalyMindOutput {
  anomalies: AnomalyFlag[];
  variablesConsidered: string[];
  /** Variables present in the input but excluded because they were not numeric across present values. */
  variablesSkipped: string[];
  rowCount: number;
  method: AnomalyDetectionMethod;
}
