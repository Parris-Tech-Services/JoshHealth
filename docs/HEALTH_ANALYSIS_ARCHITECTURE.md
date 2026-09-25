# Health Analysis Architecture

The Health Connect analyzer is designed to parse raw exported SQLite databases directly in the client to ensure complete privacy.

## Monolithic Worker Pipeline
Currently, the analysis runs primarily in two locations:
1. `sqlite-worker.js` - Handles Web Worker messaging, unzipping the archive in memory, and initializing `sql.js`.
2. `health-connect-analyzer.js` - A single robust file that receives the SQLite DB instance and performs all schema detection, deduplication, and statistical analysis.

## Future Modularization
While the current implementation has been hardened for performance (e.g. streaming millions of rows via `stmt.step()`), future iterations should migrate from the `public/` directory into a modular `src/health-analysis/` structure:

```text
src/health-analysis/
  schema/
    discoverSchema.js
    schemaAdapters.js
  metrics/
    hrvAnalysis.js
    sleepAnalysis.js
    heartRateAnalysis.js
  deduplication/
    intervalDeduplication.js
  statistics/
    correlations.js
```

This would require adapting the Vite worker build process to allow `importScripts` or ES module loading inside the WASM environment, which is currently bypassed by serving them statically.
