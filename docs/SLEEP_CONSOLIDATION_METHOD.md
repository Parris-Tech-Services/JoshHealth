# Sleep Consolidation Method

The engine analyzes `sleep_session_record_table` and `sleep_stage_record_table`.

## Naps vs Main Sleep
- Sessions that are under 2 hours (120 minutes) AND commence during typical local daylight hours (6:00 AM to 8:00 PM) are classified as `isNap: true`.
- Naps are explicitly excluded from the nightly baseline calculation to prevent them from diluting the "average nightly sleep duration". 
- They are, however, preserved in the dataset so AI analysis can still acknowledge daytime resting habits.

## Overlap Deduplication & Stages
If two different health trackers (e.g., a Garmin watch and a Google Pixel) log overlapping sleep sessions for the same local night:
1. The engine checks both sessions for `sleep_stage` associations (Deep, REM, Light, Awake).
2. It prioritizes the session with the **most complete stage data** (highest total stage minutes).
3. If both have equal stage data, it defaults to the session with the longest overall duration.

## Stage Visualization
The Trends UI computes a 14-day trailing average of these canonical sleep stages and renders an inline proportional graph. Unstaged time is ignored for percentage calculation, focusing only on categorized sleep periods.
