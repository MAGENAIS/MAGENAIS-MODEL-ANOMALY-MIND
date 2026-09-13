// Runnable example — no MAGENAIS installation required.
//
// Usage:
//   node --experimental-strip-types examples/basic-usage.mjs
// (or: npm run example)

import { AnomalyMindModel } from '../src/index.ts';

const model = new AnomalyMindModel();

// A small, made-up sensor-reading dataset that oscillates gently around
// 100, with two deliberately injected extreme anomalies.
const records = Array.from({ length: 30 }, (_, i) => ({
  t: i,
  sensor: 100 + Math.sin(i / 3) * 2,
}));
records[10].sensor = 250; // injected spike
records[20].sensor = -50; // injected drop

const response = await model.execute({
  input: { records },
  options: { seed: 42 },
});

console.log(
  `Evaluated ${response.output.variablesConsidered.length} numeric variable(s) across ${response.output.rowCount} rows ` +
    `using the ${response.output.method} method.\n`
);

for (const a of response.output.anomalies) {
  console.log(`row ${a.index} — ${a.variable} = ${a.value}`);
  console.log(`  score: ${a.score.toFixed(2)}  threshold: ${a.threshold}`);
  console.log(`  Anomaly Context Stability (ACS): ${a.acs.toFixed(2)} (${a.stability})`);
  console.log(`  ${a.explanation}\n`);
}

console.log(response.explanation);
