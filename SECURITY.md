# Security Policy

## Scope

AnomalyMind is a pure computation package: it takes a JSON-serializable
input (a `records` array plus a few optional fields), runs deterministic
and seeded-random numeric routines over it, and returns a
JSON-serializable output. It:

- performs no network I/O,
- performs no file system I/O,
- has zero runtime dependencies,
- does not `eval()` or otherwise execute code contained in its input.

This significantly limits its attack surface, but the points below still
apply.

## Reporting a Vulnerability

If you believe you've found a security issue in this repository (for
example, a crafted input that causes unbounded memory/CPU use, or a
prototype-pollution-style issue via record keys), please open a private
security advisory on this repository (GitHub → Security → Advisories →
"Report a vulnerability") rather than a public issue.

Please include:

- the input that triggers the issue,
- the observed vs. expected behavior,
- the package version (`model.json` → `version`).

## Supported Versions

Only the latest published `1.x` release is actively supported until a
`2.0.0` is released, at which point this section will be updated.

## Known Limitations Relevant to Security

- Detection runs in roughly `O(variables × rows)` time for the baseline
  pass, and Anomaly Context Stability (ACS) adds `acsTrials` (default 30)
  further passes **per flagged anomaly** — so ACS's cost scales with how
  many anomalies the baseline pass finds, not just with dataset size. A
  very large `records` array, a large `variables` list, and a dataset with
  many baseline anomalies combined can be CPU-intensive. Callers embedding
  this package in a service that accepts untrusted input should apply
  their own timeouts, a reasonable upper bound on dataset size, and/or a
  lower `acsTrials` — this package does not impose limits on any of them
  itself.
- Record keys (variable/column names) supplied by the caller are used as
  plain object keys internally. If you accept `AnomalyMindInput` directly
  from untrusted JSON in an environment where prototype pollution via
  object keys (e.g. `"__proto__"`) is a concern for your runtime, sanitize
  keys before calling `execute()`.
- The `'rolling'` method's local-neighborhood windows near the start/end
  of a series have fewer neighbors than a full window would provide; this
  is a known accuracy limitation (see the README's "Limitations" section),
  not a security concern, but is noted here since it affects which
  observations get flagged.
