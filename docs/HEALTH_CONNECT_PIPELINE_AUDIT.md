# Health Connect Pipeline Audit

## Phase 1 Findings

1. **Where ZIP files are uploaded**: ZIP files are handled in the browser via `src/components/UploadZone.jsx` and read completely in memory using a `FileReader` (`readArrayBufferWithProgress`).
2. **How the ZIP is extracted**: The `JSZip` library is used inside `src/lib/fileParser.js` to decompress the archive entirely in the browser. It lists the directory contents and extracts nested `.db` files (like `health_connect_export.db`).
3. **How SQLite is opened**: If a `.db` file is found, it is passed to a web worker (`public/sqlite-worker.js`). The worker uses `sql.js` (a WASM compile of SQLite) to load the database in-memory and perform queries on the client side without needing a backend.
4. **Which tables are currently parsed**: The generic audit queries `sqlite_master` and then iteratively checks up to 75 tables. A dedicated `HealthConnectAnalyzer` (`public/health-connect-analyzer.js`) parses `heart_rate_record_series_table`, `heart_rate_record_table`, `heart_rate_variability_rmssd_record_table`, `respiratory_rate_record_table`, `sleep_session_record_table`, `sleep_stage_record_table`, `steps_record_table`, `total_calories_burned_record_table`, `weight_record_table`, `body_fat_record_table`, and `exercise_session_record_table`.
5. **Where parsing happens**: Fully client-side in the browser.
6. **How records are normalised**: Time values (Unix epoch variants) are normalised using `toMillis()`. Timezones are handled via `Intl.DateTimeFormat`.
7. **Duplicate Records**: In `health-connect-analyzer.js`, steps and calories use a `max()` daily value deduplication. Sleep takes the longest non-overlapping session. In `sqlite-worker.js`, I have just updated the `getDailyAggregate` to group by `source` first and then take the `MAX(source_total)` to solve inflated aggregate sums for steps across different apps.
8. **Source Preservation**: Sources are listed (via hints in `package` or `client` columns), but deep tracing of individual apps for priority overrides is currently only implemented manually in `SourceManager.jsx`.
9. **Data sent to AI**: The raw DB is *never* sent to the AI. Only the `DATA PACK: STRUCTURED HEALTH INVENTORY` string, containing table metadata, row counts, and deduplicated daily summary objects, is passed to the LLM context.
10. **Memory and Timeout Risks**: Very large `.zip` or `.db` exports can crash `sql.js` due to WASM memory limits, but progress tracking allows for early termination.
