import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import initSqlJs from 'sql.js'

function extractGetDailyAggregate() {
  const source = fs.readFileSync(new URL('../public/sqlite-worker.js', import.meta.url), 'utf8')
  // We extract the function definitions from sqlite-worker.js
  const preamble = `
    const self = {};
    const importScripts = () => {};
    var METRICS = {
      steps: {
        label: 'Steps',
        patterns: ['step'],
        values: ['steps', 'step_count', 'count', 'value', 'delta'],
        aggregate: 'sum',
      }
    };
    function quoteIdent(name) { return '"' + String(name).replace(/"/g, '""') + '"' }
    function lower(value) { return String(value || '').toLowerCase() }
    function execFirstValue(db, sql) {
      var result = db.exec(sql)
      return result[0] && result[0].values[0] ? result[0].values[0][0] : null
    }
    function looksNumericColumn(c) { return true; } // mock
  `
  
  return new Function('db', `${preamble}\n${source}\n
    return getDailyAggregate(
      db, 
      'steps_record_table', 
      'steps', 
      { dateExpr: "date(CAST(start_time_epoch_millis AS REAL)/1000, 'unixepoch')", bucketExpr: "CAST(CAST(start_time_epoch_millis AS REAL) / 900000 AS INTEGER)" }, 
      { name: 'value' }, 
      [{ name: 'value' }, { name: 'start_time_epoch_millis' }, { name: 'package_name' }]
    );
  `)
}

test('Deduplication correctly sums non-overlapping sessions and maxes overlapping sessions', async () => {
  const SQL = await initSqlJs()
  const db = new SQL.Database()

  db.run(`
    CREATE TABLE steps_record_table (
      value INTEGER,
      start_time_epoch_millis INTEGER,
      package_name TEXT
    );
  `)

  const steps = db.prepare('INSERT INTO steps_record_table VALUES (?, ?, ?)')
  
  // 1. Two sources OVERLAPPING in the same 15-minute window
  // App A logs 500 steps, App B logs 600 steps.
  // The system should take MAX(500, 600) = 600 for this bucket.
  const baseDay1 = Date.parse('2026-05-01T10:00:00Z')
  steps.run([500, baseDay1, 'com.google.android.apps.fitness'])
  steps.run([600, baseDay1 + 1000, 'com.strava'])

  // 2. Two sources SEPARATE (non-overlapping) on the same day
  // App A logs 1000 steps at 12:00
  // App B logs 2000 steps at 14:00
  // The system should take 1000 + 2000 = 3000 for this day.
  const baseDay2 = Date.parse('2026-05-02T12:00:00Z')
  steps.run([1000, baseDay2, 'com.google.android.apps.fitness'])
  steps.run([2000, baseDay2 + 7200000, 'com.strava']) // 2 hours later

  steps.free()

  const result = extractGetDailyAggregate()(db)

  // Verify result
  assert.ok(result, 'Daily aggregate should not be null')
  
  // We can just assert the result of getDailyAggregate since we changed it to JS.
  // Day 1 has overlap maxing out at 600.
  // Day 2 has separate windows summing to 3000.
  
  // To test the boundary edge case (sliding window):
  // Let's add Day 3: A continuous session from source A that crosses an arbitrary 15-minute clock boundary.
  // Clock buckets (00, 15, 30) would split 10:14-10:16.
  // Sliding window aligned to 10:14 should keep them in one window.
  // Actually, we already passed the test data above, let's verify it first.
  
  const day2Res = result.values ? result.values.find(v => v.day.indexOf('2026-05-02') !== -1) : null
  const day1Res = result.values ? result.values.find(v => v.day.indexOf('2026-05-01') !== -1) : null
  
  // Note: getDailyAggregate returns { column, method, recentDays, latestDay, latestValue, averageRecentValue, values }
  // Oh wait, my getDailyAggregate doesn't return 'values' array explicitly in the return object!
  // It returns: { column, method, recentDays, latestDay, latestValue, averageRecentValue }
  
  assert.equal(result.averageRecentValue, 1800)
  assert.equal(result.latestValue, 3000)

  db.close()
})

test('Deduplication correctly handles bucket boundary sliding windows', async () => {
  const SQL = await initSqlJs()
  const db = new SQL.Database()

  db.run(`
    CREATE TABLE steps_record_table (
      value INTEGER,
      start_time_epoch_millis INTEGER,
      package_name TEXT
    );
  `)
  const steps = db.prepare('INSERT INTO steps_record_table VALUES (?, ?, ?)')
  
  // App A logs a continuous session in 1-minute increments spanning a 15-minute clock boundary (e.g. 10:14 and 10:15)
  const baseDay = Date.parse('2026-05-03T10:14:00Z')
  steps.run([50, baseDay, 'com.app.A'])
  steps.run([50, baseDay + 60000, 'com.app.A']) // 10:15
  
  // App B logs the same session as a single 2-minute record at 10:14
  steps.run([100, baseDay, 'com.app.B'])
  
  steps.free()
  
  const result = extractGetDailyAggregate()(db)
  
  // If clock buckets were used (10:00-10:15 and 10:15-10:30):
  // Bucket 1 (10:14): App A=50, App B=100. Max=100
  // Bucket 2 (10:15): App A=50, App B=0. Max=50
  // Total = 150 (WRONG)
  
  // If sliding windows aligned to session start (10:14-10:29):
  // Window (10:14-10:29): App A=100, App B=100. Max=100
  // Total = 100 (CORRECT)
  
  assert.equal(result.latestValue, 100, 'Sliding window should prevent continuous sessions from splitting and inflating totals')
  
  db.close()
})
