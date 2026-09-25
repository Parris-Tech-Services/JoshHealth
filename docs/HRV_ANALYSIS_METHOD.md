# HRV Analysis Method

The Health Connect HRV (Heart Rate Variability) analysis engine processes the `heart_rate_variability_rmssd_record_table`.

## Baseline Methodology
The application computes a deterministic 30-day rolling baseline for HRV.
- **Recent Window**: The latest 7 valid nights are averaged (median).
- **Baseline Window**: The 30 valid nights preceding the recent 7-day window.
- **Comparison**: The 7-day median is compared against the 30-day baseline median.

## Sparse Data Handling
To prevent mathematically chaotic baselines, the engine enforces a strict floor. If there are fewer than 10 valid recorded nights in the 30-day baseline window, the status is flagged as `insufficient_data`, and percentage changes are safely omitted from the AI payload.

## Measurement Styles
The engine supports RMSSD records stored as:
1. Canonical nightly summaries (single value per night).
2. Spot readings (multiple values per day).
When multiple readings exist for a single local day, the engine averages them into a canonical daily value before appending them to the trend array to prevent a dense day of manual spot readings from outweighing sparse automated nightly readings.
