/**
 * Independent-package copy of MAGENAIS's tests/unit/anomalyMind.test.ts,
 * kept in sync manually per MASTER PROMPT §28 (same relationship
 * DecisionScore's and PatternSense's two test copies have — see
 * MAGENAIS-MODEL-DECISION-SCORE's CONTRIBUTING.md). Covers MASTER PROMPT
 * §37's exact list for AnomalyMind (normal data, known injected anomalies,
 * MAD test, IQR test, stability test, missing values) plus the universal
 * cases every model must cover (empty input, invalid input, missing
 * values, single-row data, small datasets, a larger synthetic dataset,
 * deterministic output). 39 tests — same coverage as MAGENAIS's copy.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateInput,
  validateRunOptions,
  AnomalyMindValidationError,
  resolveVariableNames,
  inferNumericVariables,
  median,
  computeMAD,
  quartiles,
  detectAnomaliesForVariable,
  DEFAULT_THRESHOLDS,
} from '../src/AnomalyMindAlgorithm.ts';
import { computeACS, classifyStability } from '../src/AnomalyContextStability.ts';
import { AnomalyMindModel } from '../src/AnomalyMindModel.ts';
import type { AnomalyMindInput, AnomalyMindRecord } from '../src/types.ts';

/** 30 rows of "normal" data (small deterministic oscillation around 100), with two extreme injected anomalies. */
function normalWithInjectedAnomalies(n = 30): AnomalyMindRecord[] {
  const records: AnomalyMindRecord[] = Array.from({ length: n }, (_, i) => ({
    t: i,
    sensor: 100 + ((i % 5) - 2), // oscillates 98..102, deterministic (no Math.random)
  }));
  records[10].sensor = 250; // extreme high outlier
  records[20].sensor = -50; // extreme low outlier
  return records;
}

/** Small deterministic integer spread (-3..3) used to probe MAD/robust-zscore threshold behavior precisely. */
function smallSpreadFixture(n = 40): AnomalyMindRecord[] {
  return Array.from({ length: n }, (_, i) => ({ v: (i % 7) - 3 }));
}

describe('AnomalyMindAlgorithm — validation', () => {
  test('rejects empty records array', () => {
    assert.throws(() => validateInput({ records: [] }), AnomalyMindValidationError);
  });

  test('rejects completely empty input object', () => {
    // @ts-expect-error — deliberately malformed for the test
    assert.throws(() => validateInput({}), AnomalyMindValidationError);
  });

  test('rejects a non-array records field', () => {
    // @ts-expect-error — deliberately malformed for the test
    assert.throws(() => validateInput({ records: 'nope' }), AnomalyMindValidationError);
  });

  test('rejects a non-object record', () => {
    const input = { records: [{ v: 1 }, 'bad'] } as unknown as AnomalyMindInput;
    assert.throws(() => validateInput(input), AnomalyMindValidationError);
  });

  test('rejects an empty variables array', () => {
    assert.throws(() => validateInput({ records: [{ v: 1 }], variables: [] }), AnomalyMindValidationError);
  });

  test('accepts minimal valid input', () => {
    assert.doesNotThrow(() => validateInput({ records: [{ v: 1 }] }));
  });

  test('validateRunOptions rejects an unknown method', () => {
    // @ts-expect-error — deliberately invalid for the test
    assert.throws(() => validateRunOptions('not-a-method'), AnomalyMindValidationError);
  });

  test('validateRunOptions accepts every documented method and undefined', () => {
    assert.doesNotThrow(() => validateRunOptions(undefined));
    assert.doesNotThrow(() => validateRunOptions('mad'));
    assert.doesNotThrow(() => validateRunOptions('robust-zscore'));
    assert.doesNotThrow(() => validateRunOptions('iqr'));
    assert.doesNotThrow(() => validateRunOptions('rolling'));
  });
});

describe('AnomalyMindAlgorithm — variable resolution', () => {
  test('resolveVariableNames defaults to the union of all record keys', () => {
    const names = resolveVariableNames({ records: [{ a: 1, b: 2 }, { a: 3, c: 4 }] });
    assert.deepEqual(new Set(names), new Set(['a', 'b', 'c']));
  });

  test('resolveVariableNames respects a caller-supplied variables list', () => {
    const names = resolveVariableNames({ records: [{ a: 1, b: 2 }], variables: ['a'] });
    assert.deepEqual(names, ['a']);
  });

  test('inferNumericVariables separates numeric from non-numeric columns', () => {
    const records = [{ n: 1, cat: 'x' }, { n: 2, cat: 'y' }, { n: 3, cat: 'z' }];
    const { numeric, skipped } = inferNumericVariables(records, ['n', 'cat']);
    assert.deepEqual(numeric, ['n']);
    assert.deepEqual(skipped, ['cat']);
  });

  test('inferNumericVariables treats a variable with zero present values as skipped', () => {
    const records = [{ n: null }, { n: undefined }];
    const { numeric, skipped } = inferNumericVariables(records, ['n']);
    assert.deepEqual(numeric, []);
    assert.deepEqual(skipped, ['n']);
  });

  test('inferNumericVariables accepts numeric strings', () => {
    const records = [{ n: '1' }, { n: '2.5' }, { n: '3' }];
    const { numeric } = inferNumericVariables(records, ['n']);
    assert.deepEqual(numeric, ['n']);
  });
});

describe('AnomalyMindAlgorithm — median / MAD / quartiles', () => {
  test('median of an odd-length array', () => {
    assert.equal(median([3, 1, 2]), 2);
  });

  test('median of an even-length array averages the two middle values', () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });

  test('computeMAD is zero for a constant array', () => {
    assert.equal(computeMAD([5, 5, 5, 5]), 0);
  });

  test('computeMAD matches a hand-computed example', () => {
    // values: 1,2,3,4,100 -> median 3 -> deviations 2,1,0,1,97 -> median of deviations = 1
    assert.equal(computeMAD([1, 2, 3, 4, 100]), 1);
  });

  test('quartiles produce iqr = q3 - q1 and are order-independent', () => {
    const a = quartiles([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = quartiles([8, 6, 2, 4, 7, 1, 5, 3]);
    assert.equal(a.iqr, b.iqr);
    assert.ok(a.q3 > a.q1);
  });
});

describe('AnomalyMindAlgorithm — detectAnomaliesForVariable (known injected anomalies)', () => {
  test('MAD test: flags both extreme injected anomalies and nothing else, on normal-ish data', () => {
    const records = normalWithInjectedAnomalies();
    const results = detectAnomaliesForVariable(records, 'sensor', 'mad', DEFAULT_THRESHOLDS.mad, 10);
    const flaggedIndices = results.filter((r) => r.isAnomaly).map((r) => r.index).sort((a, b) => a - b);
    assert.deepEqual(flaggedIndices, [10, 20]);
  });

  test('robust-zscore test: flags both extreme injected anomalies and nothing else', () => {
    const records = normalWithInjectedAnomalies();
    const results = detectAnomaliesForVariable(records, 'sensor', 'robust-zscore', DEFAULT_THRESHOLDS['robust-zscore'], 10);
    const flaggedIndices = results.filter((r) => r.isAnomaly).map((r) => r.index).sort((a, b) => a - b);
    assert.deepEqual(flaggedIndices, [10, 20]);
  });

  test('IQR test: flags both extreme injected anomalies and nothing else', () => {
    const records = normalWithInjectedAnomalies();
    const results = detectAnomaliesForVariable(records, 'sensor', 'iqr', DEFAULT_THRESHOLDS.iqr, 10);
    const flaggedIndices = results.filter((r) => r.isAnomaly).map((r) => r.index).sort((a, b) => a - b);
    assert.deepEqual(flaggedIndices, [10, 20]);
  });

  test('rolling test: flags the injected spike using only its local neighborhood', () => {
    const series = Array.from({ length: 25 }, (_, i) => ({ x: Math.sin(i / 2) * 5 + 50 }));
    series[12].x = 90;
    const results = detectAnomaliesForVariable(series, 'x', 'rolling', DEFAULT_THRESHOLDS.rolling, 6);
    const flagged = results.find((r) => r.index === 12);
    assert.ok(flagged);
    assert.equal(flagged?.isAnomaly, true);
  });

  test('a flat (zero-variance) series flags nothing and never divides by exact zero (no Infinity/NaN scores)', () => {
    const records = Array.from({ length: 10 }, () => ({ v: 42 }));
    for (const method of ['mad', 'robust-zscore', 'iqr'] as const) {
      const results = detectAnomaliesForVariable(records, 'v', method, DEFAULT_THRESHOLDS[method], 10);
      for (const r of results) {
        assert.ok(Number.isFinite(r.score));
        assert.equal(r.isAnomaly, false);
      }
    }
  });

  test('missing values are excluded entirely — never scored, never flagged', () => {
    const records = [{ v: 1 }, { v: null }, { v: 2 }, { v: undefined }, { v: 3 }, { v: 100 }, { v: 2 }, { v: 3 }];
    const results = detectAnomaliesForVariable(records, 'v', 'mad', DEFAULT_THRESHOLDS.mad, 10);
    // Only the 6 present values are scored; missing rows (1, 3) never appear.
    assert.equal(results.length, 6);
    assert.ok(!results.some((r) => r.index === 1 || r.index === 3));
    assert.deepEqual(results.filter((r) => r.isAnomaly).map((r) => r.index), [5]);
  });
});

describe('AnomalyContextStability (ACS) — stability test', () => {
  test('an extreme, unambiguous anomaly has high ACS and is classified stable', () => {
    const records = normalWithInjectedAnomalies();
    const result = computeACS(records, 'sensor', 10, { threshold: DEFAULT_THRESHOLDS.mad, window: 10 }, { seed: 42 });
    assert.equal(result.untested, false);
    assert.ok(result.acs >= 0.7);
    assert.equal(classifyStability(result), 'stable');
  });

  test('a borderline anomaly (score just past the threshold) is classified threshold-sensitive', () => {
    const records = smallSpreadFixture();
    records[20].v = 7; // score ≈ 3.5 under 'mad' — just past DEFAULT_THRESHOLDS.mad (3)
    const result = computeACS(records, 'v', 20, { threshold: DEFAULT_THRESHOLDS.mad, window: 10 }, { seed: 42 });
    assert.equal(result.untested, false);
    assert.ok(result.acs > 0 && result.acs < 0.7, `expected a mid-range ACS, got ${result.acs}`);
    assert.equal(classifyStability(result), 'threshold-sensitive');
  });

  test('ACS is deterministic for a fixed seed', () => {
    const records = normalWithInjectedAnomalies();
    const a = computeACS(records, 'sensor', 10, { threshold: DEFAULT_THRESHOLDS.mad, window: 10 }, { seed: 99 });
    const b = computeACS(records, 'sensor', 10, { threshold: DEFAULT_THRESHOLDS.mad, window: 10 }, { seed: 99 });
    assert.deepEqual(a, b);
  });

  test('ACS on a dataset too small to subset meaningfully is reported as untested', () => {
    const result = computeACS([{ v: 1 }], 'v', 0, { threshold: 3, window: 3 });
    assert.equal(result.untested, true);
    assert.equal(result.acs, 1);
  });
});

describe('AnomalyMindModel — Model interface', () => {
  test('execute() returns a normalized, successful ModelResponse for valid input', async () => {
    const model = new AnomalyMindModel();
    const response = await model.execute({ input: { records: normalWithInjectedAnomalies() }, options: { seed: 42 } });
    assert.equal(response.success, true);
    assert.equal(response.modelId, 'magenais.anomaly-mind');
    assert.equal(response.modelVersion, '1.0.0');
    assert.ok(typeof response.confidence === 'number');
    assert.ok(Array.isArray(response.warnings));
    assert.ok(response.explanation?.length && response.explanation.length > 0);
  });

  test('execute() flags exactly the two known injected anomalies (known injected anomalies test)', async () => {
    const model = new AnomalyMindModel();
    const response = await model.execute({ input: { records: normalWithInjectedAnomalies() }, options: { seed: 42 } });
    const flaggedIndices = response.output.anomalies.map((a) => a.index).sort((a, b) => a - b);
    assert.deepEqual(flaggedIndices, [10, 20]);
    for (const a of response.output.anomalies) {
      assert.equal(a.stability, 'stable');
    }
  });

  test('execute() throws AnomalyMindValidationError (not a rejected success:false) on invalid input', async () => {
    const model = new AnomalyMindModel();
    await assert.rejects(
      () => model.execute({ input: { records: [] } }),
      AnomalyMindValidationError
    );
  });

  test('execute() rejects empty input the same way as a direct validateInput() call', async () => {
    const model = new AnomalyMindModel();
    await assert.rejects(() => model.execute({ input: {} as AnomalyMindInput }), AnomalyMindValidationError);
  });

  test('execute() is deterministic for a fixed seed', async () => {
    const model = new AnomalyMindModel();
    const input = { records: normalWithInjectedAnomalies() };
    const a = await model.execute({ input, options: { seed: 123 } });
    const b = await model.execute({ input, options: { seed: 123 } });
    assert.deepEqual(a.output, b.output);
  });

  test('execute() on a single-row dataset finds no anomalies and warns about ACS reliability', async () => {
    const model = new AnomalyMindModel();
    const response = await model.execute({ input: { records: [{ v: 5 }] } });
    assert.equal(response.output.anomalies.length, 0);
    assert.ok(response.warnings?.some((w) => w.includes('Fewer than 5 rows')));
  });

  test('execute() on a small dataset (2 rows) does not throw and returns a normalized response', async () => {
    const model = new AnomalyMindModel();
    const response = await model.execute({ input: { records: [{ v: 1 }, { v: 2 }] } });
    assert.equal(response.success, true);
    assert.equal(response.output.rowCount, 2);
  });

  test('execute() skips non-numeric variables and reports them in variablesSkipped', async () => {
    const model = new AnomalyMindModel();
    const records = Array.from({ length: 10 }, (_, i) => ({ category: i % 2 ? 'a' : 'b', reading: i }));
    const response = await model.execute({ input: { records } });
    assert.deepEqual(response.output.variablesConsidered, ['reading']);
    assert.deepEqual(response.output.variablesSkipped, ['category']);
  });

  test('execute() respects an explicit method/threshold/window run option', async () => {
    const model = new AnomalyMindModel();
    const records = Array.from({ length: 25 }, (_, i) => ({ x: Math.sin(i / 2) * 5 + 50 }));
    records[12].x = 90;
    const response = await model.execute({ input: { records }, options: { method: 'rolling', window: 6, threshold: 3 } });
    assert.equal(response.output.method, 'rolling');
    assert.ok(response.output.anomalies.some((a) => a.index === 12));
  });

  test('execute() rejects an unknown method the same way validateRunOptions does', async () => {
    const model = new AnomalyMindModel();
    await assert.rejects(
      () => model.execute({ input: { records: [{ v: 1 }, { v: 2 }] }, options: { method: 'not-a-method' as never } }),
      AnomalyMindValidationError
    );
  });

  test('execute() on a larger synthetic dataset (300 rows, 3 variables) completes and stays internally consistent', async () => {
    const model = new AnomalyMindModel();
    const records: AnomalyMindRecord[] = Array.from({ length: 300 }, (_, i) => ({
      a: 50 + ((i * 13) % 9) - 4,
      b: Math.sin(i / 10) * 10 + 100,
      c: i % 4 === 0 ? 'x' : 'y', // non-numeric, should be skipped
    }));
    records[150].a = 500;
    records[200].b = -500;
    const response = await model.execute({ input: { records }, options: { seed: 42 } });
    assert.equal(response.output.rowCount, 300);
    assert.deepEqual(response.output.variablesConsidered.sort(), ['a', 'b']);
    assert.deepEqual(response.output.variablesSkipped, ['c']);
    const flaggedIndices = response.output.anomalies.map((a) => a.index);
    assert.ok(flaggedIndices.includes(150));
    assert.ok(flaggedIndices.includes(200));
    for (const a of response.output.anomalies) {
      assert.ok(a.acs >= 0 && a.acs <= 1);
    }
  });
});
