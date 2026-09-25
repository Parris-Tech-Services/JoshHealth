# Health Connect Schema Support

Based on real-file validation, the following structures map cleanly from the Android Health Connect SQLite export.

## Supported Tables
- `heart_rate_record_series_table` (Continuous readings, ~1-5 min intervals)
- `heart_rate_record_table` (Parent keys for the series)
- `heart_rate_variability_rmssd_record_table` (Typically nightly values or repeated spot checks)
- `sleep_session_record_table` (High-level duration blocks)
- `sleep_stage_record_table` (Granular Light/Deep/REM intervals linked to sessions)
- `steps_record_table` (Overlapping cumulative and interval counts)
- `total_calories_burned_record_table`
- `respiratory_rate_record_table`
- `weight_record_table`
- `body_fat_record_table`
- `exercise_session_record_table`

## Key Characteristics
- **Time Representation:** The schema primarily relies on `epoch_millis` for spot readings and a pair of `start_time_epoch_millis` / `end_time_epoch_millis` for intervals.
- **Timezones:** The local time is critical for deduplication. The application extracts the offset or forces local time mapping to prevent a single physical day from spanning two arbitrary UTC boundaries.
- **Data Granularity:** Some tables contain hundreds of rows per day (HR), while others contain one (Weight). The generic SQL querying logic avoids full table mapping by leveraging `stmt.step()` streaming directly into aggregations.
