# Step Deduplication Method

Because Health Connect frequently aggregates data from multiple apps (e.g., Strava and Samsung Health) writing steps for the exact same physical activity, naive summation results in massive over-reporting.

## Sliding-Window Algorithm
To prevent duplicate intervals, the `sqlite-worker.js` implements a purely JavaScript-based sliding window deduplication process:
1. Records are sorted strictly by `start_time`.
2. As records are processed, a 15-minute bucket is opened. 
3. If a new record falls within the 15-minute window of the CURRENT bucket's start time, its step count is compared to the bucket's maximum. The bucket only retains the `MAX()` value, assuming overlapping apps are reporting the same underlying steps.
4. If a record falls outside the 15-minute window, the current bucket is finalized and added to the daily total, and a new bucket is opened.

## Clock-Boundary Fix
Originally, buckets were grouped by static SQL math (e.g., `/ 900000`), which caused continuous activities crossing an arbitrary clock boundary (e.g., 10:14 to 10:16) to be split into two separate buckets. The JavaScript sliding window is anchored dynamically to the *first event's timestamp*, eliminating boundary artifacts.
