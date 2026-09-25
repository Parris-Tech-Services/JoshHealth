# Cross-Metric Correlation Method

The SQLite worker computes simple pairwise correlations locally to identify linked trends without shipping raw daily pairs to an external LLM.

## Mathematical Approach
The engine utilizes **Spearman Rank Correlation** (`rho`). This is preferred over Pearson because health data is rarely perfectly linear and contains intense outliers (e.g., a marathon day inflating steps). Spearman ranks the values, naturally muting the impact of single-day anomalies.

## Computed Pairs
1. **Sleep Duration vs Next-Day HRV** (Tests recovery responsiveness)
2. **Weight vs Daily Steps** (Tests long-term activity impact)
3. **Sleep Duration vs Next-Day Resting Heart Rate**

## Minimum Thresholds
A hard floor of `14` paired observations is required. If a user has 30 days of HRV but only 5 days of Sleep data, the correlation matrix will abort and flag the pair as "Insufficient Data".

## Output
The result is categorized purely on magnitude:
- < 0.2: Weak/No correlation
- 0.2 - 0.4: Moderate
- 0.4 - 0.6: Strong
- > 0.6: Very Strong

The raw coefficients and string interpretations are embedded into the AI payload.
