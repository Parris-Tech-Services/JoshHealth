# Real-File Validation Report

This report summarizes the results of the Health Connect database validation performed on a real user export (`Health Connect (1).zip`).

## 1. Validation Run Success
- The script `scripts/validate-health-connect.js` successfully executed end-to-end on a 116 MB ZIP file containing a 320 MB SQLite database.
- Exit code: 0

## 2. Safe Aggregate Output
- **ZIP Size:** 115.96 MB
- **Database Size:** 320.82 MB
- **Total Rows Examined:** >4,000,000 (specifically for Heart Rate)
- **Time to Unzip & Mount:** ~2 seconds
- **Total Analysis Time:** ~19 seconds

## 3. Schema and Tables Supported
The database contained the expected standard Health Connect schema layout. Detected tables successfully parsed:
- `heart_rate_record_series_table`
- `heart_rate_record_table`
- `heart_rate_variability_rmssd_record_table`
- `respiratory_rate_record_table`
- `sleep_session_record_table`
- `steps_record_table`
- `total_calories_burned_record_table`
- `weight_record_table`
- `body_fat_record_table`
- `exercise_session_record_table`

## 4. Measurement Styles and Totals
- **HRV RMSSD Rows:** 62,654
- **Sleep Sessions:** 1,764 total (43 filtered out as daytime naps)
- **Sleep Nights Analyzed:** 625 canonical overlapping-deduplicated nights
- **Step Daily Aggregates:** 90 days retained in final trend output

## 5. Correlations Computed
The engine discovered 3 pairwise correlations:
- `sleep_vs_hrv`: 90 paired days (Weak/No correlation)
- `sleep_vs_resting_hr`: 90 paired days (Weak/No correlation)
- `weight_vs_steps`: 4 paired days (Insufficient data)

## 6. Payload Safety & Size
- **Original AI Payload Size:** 223 KB (due to redundant daily history arrays).
- **Hardened AI Payload Size:** 19.25 KB (successfully stripped daily noise, leaving only weekly/monthly trends for the AI).
- **Privacy Check:** No raw data, no client IDs, and no tokens were emitted into the AI payload stream.

## 7. Performance Bottleneck Fixed
Initially, processing `heart_rate_record_series_table` (which had over 4 million rows) exceeded the JavaScript heap and took over 10 minutes.
- The SQL query was stripped of its massive `ORDER BY` clause to avoid SQLite temp file bloat.
- Memory allocation was fixed by iterating rows lazily with `stmt.step()`.
- JavaScript `Intl.DateTimeFormat` parsing was aggressively cached, dropping the HR processing time from 10+ minutes to 17.8 seconds for all 4,000,000+ rows.
