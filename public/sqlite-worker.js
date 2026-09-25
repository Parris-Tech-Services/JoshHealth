// SQLite Web Worker - runs sql.js off the main thread.
// Receives: { buffer: ArrayBuffer, fileName: string, fileSize: number }
// Posts:    { type: 'progress', msg, status, pct, id }
//           { type: 'done', content }
//           { type: 'error', message }

try {
  importScripts('/health-connect-analyzer.js')
} catch (e) {
  // The generic SQLite audit still works if the deep analyzer cannot be loaded.
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function log(msg, status, pct, id) {
  self.postMessage({ type: 'progress', msg: msg, status: status || 'info', pct: pct != null ? pct : null, id: id })
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"'
}

function lower(value) {
  return String(value || '').toLowerCase()
}

function execFirstValue(db, sql) {
  var result = db.exec(sql)
  return result[0] && result[0].values[0] ? result[0].values[0][0] : null
}

function getColumns(db, table) {
  var schema = db.exec('PRAGMA table_info(' + quoteIdent(table) + ')')
  if (!schema[0]) return []
  return schema[0].values.map(function(row) {
    return { name: row[1], type: row[2] || '' }
  })
}

function getCount(db, table) {
  return Number(execFirstValue(db, 'SELECT COUNT(*) FROM ' + quoteIdent(table)) || 0)
}

var EXERCISE_TYPES = {
  2: 'Badminton', 4: 'Baseball', 5: 'Basketball', 8: 'Biking', 13: 'Cricket',
  14: 'Dancing', 16: 'Elliptical', 24: 'Golf', 25: 'Guided Breathing',
  32: 'Gymnastics', 33: 'HIIT', 34: 'Hiking', 37: 'Martial Arts', 44: 'Pilates',
  56: 'Running', 66: 'Stair Climbing', 69: 'Strength Training', 73: 'Swimming',
  74: 'Swimming (Open Water)', 78: 'Tennis', 79: 'Walking', 82: 'Wheelchair', 83: 'Yoga'
}

function getExerciseType(code) {
  return EXERCISE_TYPES[code] || 'Other (type ' + code + ')'
}

var METRICS = {
  steps: {
    label: 'Steps',
    patterns: ['step'],
    values: ['steps', 'step_count', 'count', 'value', 'delta'],
    aggregate: 'sum',
  },
  sleep: {
    label: 'Sleep',
    patterns: ['sleep'],
    values: ['duration', 'duration_minutes', 'minutes', 'seconds', 'asleep', 'sleep'],
    aggregate: 'sum',
  },
  hrv: {
    label: 'HRV / RMSSD',
    patterns: ['hrv', 'variability', 'rmssd'],
    values: ['rmssd', 'hrv', 'value'],
    aggregate: 'avg',
  },
  restingHeartRate: {
    label: 'Resting Heart Rate',
    patterns: ['resting_heart', 'restingheart', 'resting_hr', 'rhr'],
    values: ['resting_hr', 'bpm', 'beats_per_minute', 'value'],
    aggregate: 'avg',
  },
  heartRate: {
    label: 'Heart Rate',
    patterns: ['heart_rate', 'heartrate', 'heart rate', 'pulse', 'bpm'],
    values: ['heart_rate', 'bpm', 'beats_per_minute', 'value'],
    aggregate: 'avg',
  },
  respiratory: {
    label: 'Respiratory Rate',
    patterns: ['respiratory', 'breath', 'breathing'],
    values: ['respiratory_rate', 'breaths_per_minute', 'rate', 'value'],
    aggregate: 'avg',
  },
  weight: {
    label: 'Weight / Body',
    patterns: ['weight', 'body_mass', 'bodymass', 'mass', 'body_fat', 'bodyfat'],
    values: ['weight', 'mass', 'kg', 'body_fat', 'percent', 'value'],
    aggregate: 'avg',
  },
  exercise: {
    label: 'Exercise Sessions',
    patterns: ['exercise', 'workout', 'activity_session', 'activityrecord', 'activity_record'],
    values: ['duration', 'duration_minutes', 'distance', 'calories', 'steps'],
    aggregate: 'sum',
  },
  nutrition: {
    label: 'Nutrition',
    patterns: ['nutrition', 'food', 'meal', 'diet'],
    values: ['calories', 'energy', 'protein', 'carbohydrate', 'fat', 'value'],
    aggregate: 'sum',
  },
  hydration: {
    label: 'Hydration',
    patterns: ['hydration', 'water'],
    values: ['volume', 'milliliters', 'liters', 'value'],
    aggregate: 'sum',
  },
  bloodPressure: {
    label: 'Blood Pressure',
    patterns: ['blood_pressure', 'bloodpressure', 'bp'],
    values: ['systolic', 'diastolic', 'value'],
    aggregate: 'avg',
  },
  bloodGlucose: {
    label: 'Blood Glucose',
    patterns: ['blood_glucose', 'bloodglucose', 'glucose'],
    values: ['glucose', 'value'],
    aggregate: 'avg',
  },
  vo2: {
    label: 'VO2 Max',
    patterns: ['vo2', 'oxygen_uptake'],
    values: ['vo2', 'value'],
    aggregate: 'avg',
  },
  oxygen: {
    label: 'Oxygen Saturation',
    patterns: ['oxygen', 'spo2', 'saturation'],
    values: ['spo2', 'saturation', 'percentage', 'value'],
    aggregate: 'avg',
  },
}

function classifyMetric(table, columns) {
  var haystack = lower(table + ' ' + columns.map(function(c) { return c.name }).join(' '))
  var order = [
    'hrv',
    'restingHeartRate',
    'respiratory',
    'bloodPressure',
    'bloodGlucose',
    'vo2',
    'oxygen',
    'steps',
    'sleep',
    'weight',
    'exercise',
    'nutrition',
    'hydration',
    'heartRate',
  ]
  for (var i = 0; i < order.length; i++) {
    var key = order[i]
    if (METRICS[key].patterns.some(function(pattern) { return haystack.indexOf(pattern) !== -1 })) return key
  }
  return 'other'
}

function looksNumericColumn(column) {
  var n = lower(column.name)
  var t = lower(column.type)
  if (/id|uuid|hash|source|package|device|time|date|zone|offset/.test(n)) return false
  if (/int|real|float|double|numeric|decimal/.test(t)) return true
  return /value|count|steps|bpm|rmssd|rate|weight|mass|duration|minutes|seconds|distance|calories|percent|systolic|diastolic/.test(n)
}

function findDateColumn(columns) {
  var preferred = ['start_time', 'starttime', 'start', 'timestamp', 'time', 'date', 'end_time', 'endtime', 'created_at']
  for (var p = 0; p < preferred.length; p++) {
    var found = columns.find(function(c) { return lower(c.name) === preferred[p] })
    if (found) return found
  }
  return columns.find(function(c) {
    var n = lower(c.name)
    return /(^|_)(date|time|timestamp|instant|epoch|millis|seconds)(_|$)/.test(n) && n.indexOf('timezone') === -1 && n.indexOf('duration') === -1
  }) || null
}

function getSampleValue(db, table, column) {
  try {
    return execFirstValue(
      db,
      'SELECT ' + quoteIdent(column) + ' FROM ' + quoteIdent(table) + ' WHERE ' + quoteIdent(column) + ' IS NOT NULL LIMIT 1'
    )
  } catch (e) {
    return null
  }
}

function buildDateExpr(sample, columnName) {
  var col = quoteIdent(columnName)
  if (sample == null) return null
  var asNumber = Number(sample)
  if (!Number.isNaN(asNumber) && String(sample).trim() !== '') {
    if (asNumber > 100000000000000000) return 'date(CAST(' + col + ' AS REAL) / 1000000000, "unixepoch")'
    if (asNumber > 100000000000000) return 'date(CAST(' + col + ' AS REAL) / 1000000, "unixepoch")'
    if (asNumber > 100000000000) return 'date(CAST(' + col + ' AS REAL) / 1000, "unixepoch")'
    if (asNumber > 1000000000) return 'date(CAST(' + col + ' AS REAL), "unixepoch")'
    return null
  }
  return 'date(' + col + ')'
}

function buildBucketExpr(sample, columnName) {
  var col = quoteIdent(columnName)
  if (sample == null) return null
  var asNumber = Number(sample)
  if (!Number.isNaN(asNumber) && String(sample).trim() !== '') {
    if (asNumber > 100000000000000000) return 'CAST(CAST(' + col + ' AS REAL) / 900000000000 AS INTEGER)' // 15 mins
    if (asNumber > 100000000000000) return 'CAST(CAST(' + col + ' AS REAL) / 900000000 AS INTEGER)'
    if (asNumber > 100000000000) return 'CAST(CAST(' + col + ' AS REAL) / 900000 AS INTEGER)'
    if (asNumber > 1000000000) return 'CAST(CAST(' + col + ' AS REAL) / 900 AS INTEGER)'
    return null
  }
  // ISO string 2026-01-01T10:14:00Z -> bucket by 10 minutes: substr to '2026-01-01T10:1'
  return 'substr(' + col + ', 1, 15)'
}

function getDateSummary(db, table, dateColumn) {
  if (!dateColumn) return null
  var qcol = quoteIdent(dateColumn.name)
  var summary = { column: dateColumn.name, rawRange: null, normalRange: null, daysCovered: null, recentMonths: [] }
  try {
    var raw = db.exec('SELECT MIN(' + qcol + '), MAX(' + qcol + ') FROM ' + quoteIdent(table) + ' WHERE ' + qcol + ' IS NOT NULL')
    if (raw[0]) summary.rawRange = [raw[0].values[0][0], raw[0].values[0][1]]
  } catch (e) {}

  var sample = getSampleValue(db, table, dateColumn.name)
  var dateExpr = buildDateExpr(sample, dateColumn.name)
  if (!dateExpr) return summary

  try {
    var normalized = db.exec(
      'SELECT MIN(' + dateExpr + '), MAX(' + dateExpr + '), COUNT(DISTINCT ' + dateExpr + ') FROM ' +
      quoteIdent(table) + ' WHERE ' + dateExpr + ' IS NOT NULL'
    )
    if (normalized[0]) {
      summary.normalRange = [normalized[0].values[0][0], normalized[0].values[0][1]]
      summary.daysCovered = normalized[0].values[0][2]
    }
  } catch (e) {}

  try {
    var months = db.exec(
      'SELECT substr(' + dateExpr + ', 1, 7) AS month, COUNT(*) AS rows FROM ' + quoteIdent(table) +
      ' WHERE ' + dateExpr + ' IS NOT NULL GROUP BY month ORDER BY month DESC LIMIT 6'
    )
    if (months[0]) summary.recentMonths = months[0].values.map(function(row) {
      return { month: row[0], rows: row[1] }
    })
  } catch (e) {}

  summary.dateExpr = dateExpr
  summary.bucketExpr = buildBucketExpr(sample, dateColumn.name)
  return summary
}

function getSources(db, table, columns) {
  var sourceCol = columns.find(function(c) {
    var n = lower(c.name)
    return n.indexOf('source') !== -1 || n.indexOf('package') !== -1 || n.indexOf('app') !== -1 || n.indexOf('device') !== -1 || n.indexOf('client') !== -1
  })
  if (!sourceCol) return []
  try {
    var res = db.exec(
      'SELECT DISTINCT ' + quoteIdent(sourceCol.name) + ' FROM ' + quoteIdent(table) +
      ' WHERE ' + quoteIdent(sourceCol.name) + ' IS NOT NULL LIMIT 12'
    )
    if (!res[0]) return []
    return res[0].values.map(function(row) { return row[0] }).filter(Boolean)
  } catch (e) {
    return []
  }
}

function getNumericStats(db, table, columns) {
  var numeric = columns.filter(looksNumericColumn).slice(0, 6)
  var stats = []
  numeric.forEach(function(column) {
    try {
      var col = quoteIdent(column.name)
      var filter = getOutlierFilter(null, column.name) // Fallback for fat columns
      if (lower(column.name).indexOf('fat') !== -1 || lower(column.name).indexOf('percent') !== -1) {
         filter = ' AND CAST(' + col + ' AS REAL) > 0'
      }
      var res = db.exec(
        'SELECT COUNT(' + col + '), MIN(CAST(' + col + ' AS REAL)), AVG(CAST(' + col + ' AS REAL)), MAX(CAST(' + col + ' AS REAL)) FROM ' +
        quoteIdent(table) + ' WHERE ' + col + ' IS NOT NULL' + filter
      )
      if (res[0]) {
        var row = res[0].values[0]
        if (Number(row[0]) > 0) {
          stats.push({
            column: column.name,
            count: Number(row[0]),
            min: Number(row[1]),
            avg: Number(row[2]),
            max: Number(row[3]),
          })
        }
      }
    } catch (e) {}
  })
  return stats
}

function findValueColumn(metricKey, columns) {
  var def = METRICS[metricKey]
  if (!def) return null
  var numeric = columns.filter(looksNumericColumn)
  for (var i = 0; i < def.values.length; i++) {
    var candidate = def.values[i]
    var exact = numeric.find(function(c) { return lower(c.name) === candidate })
    if (exact) return exact
    var partial = numeric.find(function(c) { return lower(c.name).indexOf(candidate) !== -1 })
    if (partial) return partial
  }
  return numeric[0] || null
}

function getOutlierFilter(metricKey, column) {
  var col = quoteIdent(column)
  if (metricKey === 'weight' && (lower(column).indexOf('fat') !== -1 || lower(column).indexOf('percent') !== -1)) {
    return ' AND CAST(' + col + ' AS REAL) > 0'
  }
  if (metricKey === 'heartRate' || metricKey === 'restingHeartRate') {
    return ' AND CAST(' + col + ' AS REAL) >= 35 AND CAST(' + col + ' AS REAL) <= 210'
  }
  if (metricKey === 'respiratory') {
    return ' AND CAST(' + col + ' AS REAL) >= 8 AND CAST(' + col + ' AS REAL) <= 40'
  }
  return ''
}

function getDailyAggregate(db, table, metricKey, dateSummary, valueColumn, columns) {
  if (!dateSummary || !dateSummary.dateExpr || !valueColumn) return null
  var def = METRICS[metricKey] || { aggregate: 'avg' }
  var sourceCol = columns.find(function(c) {
    var n = lower(c.name)
    return n.indexOf('source') !== -1 || n.indexOf('package') !== -1 || n.indexOf('app') !== -1 || n.indexOf('device') !== -1 || n.indexOf('client') !== -1
  })
  var dateCol = columns.find(function(c) {
    var n = lower(c.name)
    return n.indexOf('start_time') !== -1 || n === 'time_epoch_millis' || n === 'time'
  }) || columns.find(function(c) { return lower(c.name).indexOf('date') !== -1 })

  var qTable = quoteIdent(table)
  var qValue = quoteIdent(valueColumn.name)
  var valueExpr = 'CAST(' + qValue + ' AS REAL)'
  var outlierFilter = getOutlierFilter(metricKey, valueColumn.name)
  
  try {
    var values = []
    
    if (def.aggregate === 'sum' && sourceCol && dateCol) {
      // JS-based sliding window deduplication to avoid arbitrary clock boundaries
      var qSource = quoteIdent(sourceCol.name)
      var qDate = quoteIdent(dateCol.name)
      var query = 'SELECT ' + dateSummary.dateExpr + ' AS day, CAST(' + qDate + ' AS REAL) AS time, ' + qSource + ' AS source, ' + valueExpr + ' AS value ' +
                  'FROM ' + qTable + ' WHERE ' + dateSummary.dateExpr + ' IS NOT NULL AND ' + qDate + ' IS NOT NULL AND ' + qValue + ' IS NOT NULL' + outlierFilter +
                  ' ORDER BY day DESC, time ASC'
      var res = db.exec(query)
      if (!res[0] || !res[0].values.length) return null
      
      var rows = res[0].values
      var byDay = {}
      for (var i = 0; i < rows.length; i++) {
        var day = rows[i][0]
        var time = rows[i][1]
        var source = rows[i][2] || 'unknown'
        var val = Number(rows[i][3])
        if (!day || Number.isNaN(val)) continue
        if (!byDay[day]) byDay[day] = []
        byDay[day].push({ time: time, source: source, val: val })
      }
      
      var windowMs = 900000 // 15 mins
      if (typeof rows[0][1] === 'number' && rows[0][1] < 10000000000) {
        windowMs = 900 // unix epoch seconds
      }
      
      for (var dayKey in byDay) {
        var dayRows = byDay[dayKey]
        var dailyTotal = 0
        var windowStart = 0
        var currentWindow = {}
        
        for (var j = 0; j < dayRows.length; j++) {
          var r = dayRows[j]
          if (windowStart === 0 || r.time > windowStart + windowMs) {
            // Commit previous window
            var maxVal = 0
            for (var s in currentWindow) {
              if (currentWindow[s] > maxVal) maxVal = currentWindow[s]
            }
            dailyTotal += maxVal
            // Start new window aligned to this record's start time
            windowStart = r.time
            currentWindow = {}
          }
          currentWindow[r.source] = (currentWindow[r.source] || 0) + r.val
        }
        // Commit last window
        var maxVal2 = 0
        for (var s2 in currentWindow) {
          if (currentWindow[s2] > maxVal2) maxVal2 = currentWindow[s2]
        }
        dailyTotal += maxVal2
        
        values.push({ day: dayKey, value: dailyTotal })
      }
      
      values.sort(function(a, b) { return a.day > b.day ? -1 : 1 })
      values = values.slice(0, 30) // Only keep recent 30 days
      
    } else {
      var aggregateExpr = def.aggregate === 'sum' ? 'SUM(' + valueExpr + ')' : 'AVG(' + valueExpr + ')'
      var query2 = 'SELECT ' + dateSummary.dateExpr + ' AS day, ' + aggregateExpr + ' AS value FROM ' + qTable +
              ' WHERE ' + dateSummary.dateExpr + ' IS NOT NULL AND ' + qValue + ' IS NOT NULL' + outlierFilter +
              ' GROUP BY day ORDER BY day DESC LIMIT 30'
      var res2 = db.exec(query2)
      if (!res2[0] || !res2[0].values.length) return null
      values = res2[0].values
        .map(function(row) { return { day: row[0], value: Number(row[1]) } })
        .filter(function(row) { return row.day && !Number.isNaN(row.value) })
    }

    if (!values.length) return null
    var avgRecent = values.reduce(function(sum, row) { return sum + row.value }, 0) / values.length
    return {
      column: valueColumn.name,
      method: def.aggregate,
      recentDays: values.length,
      latestDay: values[0].day,
      latestValue: values[0].value,
      averageRecentValue: avgRecent,
    }
  } catch (e) {
    return null
  }
}

function round(value, digits) {
  if (value == null || Number.isNaN(value)) return 'n/a'
  var factor = Math.pow(10, digits || 1)
  return String(Math.round(value * factor) / factor)
}

function addWarning(target, message) {
  if (target.indexOf(message) === -1) target.push(message)
}

self.onmessage = async function(e) {
  var buffer = e.data.buffer
  var fileName = e.data.fileName
  var fileSize = e.data.fileSize

  try {
    log('Step 2/4 - Loading sql.js library...', 'info', 26, 'wasm-load')

    var wasmPct = 26
    var wasmTimer = setInterval(function() {
      if (wasmPct < 43) {
        wasmPct += 1
        log('Step 2/4 - Fetching WASM binary...', 'info', wasmPct, 'wasm-load')
      }
    }, 180)

    var startWasm = Date.now()
    importScripts('https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/sql-wasm.js')
    var sql = await initSqlJs({
      locateFile: function() { return 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/sql-wasm.wasm' }
    })

    clearInterval(wasmTimer)
    var wasmMs = Date.now() - startWasm
    log('Step 2/4 - WASM loaded in ' + (wasmMs / 1000).toFixed(1) + 's', 'info', 45, 'wasm-load')

    log('Step 3/4 - Opening SQLite database...', 'info', 46, 'db-open')
    var startOpen = Date.now()
    var db = new sql.Database(new Uint8Array(buffer))
    var openMs = Date.now() - startOpen
    log('Step 3/4 - Database opened in ' + (openMs / 1000).toFixed(1) + 's', 'info', 65, 'db-open')

    log('Step 4/4 - Building structured health inventory...', 'info', 66)
    var tablesResult = db.exec("SELECT name FROM sqlite_master WHERE type='table'")
    var tables = tablesResult[0] ? tablesResult[0].values.map(function(r) { return r[0] }) : []
    var summaries = []
    var grouped = {}
    var warnings = []
    var tableErrors = []
    var nonEmptyTables = 0
    var deepAnalysis = null

    Object.keys(METRICS).forEach(function(key) { grouped[key] = [] })
    grouped.other = []

    for (var i = 0; i < tables.length; i++) {
      var table = tables[i]
      var pct = 66 + Math.round((i / Math.max(1, tables.length)) * 30)
      log('Step 4/4 - Auditing table [' + (i + 1) + '/' + tables.length + ']: ' + table, 'info', pct)

      try {
        var columns = getColumns(db, table)
        var count = getCount(db, table)
        if (count > 0) nonEmptyTables += 1
        var metricKey = classifyMetric(table, columns)
        var dateColumn = findDateColumn(columns)
        var dateSummary = getDateSummary(db, table, dateColumn)
        var sources = count > 0 ? getSources(db, table, columns) : []
        var numericStats = count > 0 ? getNumericStats(db, table, columns) : []
        var valueColumn = count > 0 ? findValueColumn(metricKey, columns) : null
        var dailyAggregate = count > 0 ? getDailyAggregate(db, table, metricKey, dateSummary, valueColumn, columns) : null
        var tableWarnings = []

        if (sources.length > 1) {
          addWarning(tableWarnings, 'Multiple source/app/device values detected; raw totals may be duplicated.')
          if (metricKey === 'steps') addWarning(warnings, 'Steps have multiple source hints in at least one table. Use source-prioritised totals before making claims.')
        }
        if ((metricKey === 'heartRate' || metricKey === 'restingHeartRate') && dateSummary && dateSummary.daysCovered) {
          addWarning(tableWarnings, 'Values outside 35-210 BPM were ignored as likely sensor artifacts.')
          var rowsPerDay = count / Math.max(1, Number(dateSummary.daysCovered))
          if (rowsPerDay > 48) {
            addWarning(tableWarnings, 'High row density suggests sample-level heart data, not one clean daily resting value.')
            addWarning(warnings, 'Heart/resting-HR tables may need daily aggregation before interpretation.')
          }
        }
        if (metricKey === 'respiratory') {
          addWarning(tableWarnings, 'Values outside 8-40 breaths/min were ignored as likely sensor artifacts.')
        }
        if (metricKey === 'sleep') {
          addWarning(tableWarnings, 'Sleep stages are device estimates; unusual deep/REM proportions should be treated as data-quality questions.')
        }
        if (metricKey === 'weight') {
          addWarning(tableWarnings, 'Body fat percentages ≤0% were ignored as missing data placeholders.')
        }
        if (dateSummary && dateSummary.recentMonths) {
          var lowMonths = dateSummary.recentMonths.filter(function(m) { return m.rows < 10 })
          if (lowMonths.length > 0) addWarning(tableWarnings, 'Monthly summary includes months with <10 data points. Averages may be unrepresentative.')
        }

        var summary = {
          tableName: table,
          metricKey: metricKey,
          rows: count,
          status: count > 0 ? 'present' : 'empty',
          columns: columns.map(function(c) { return c.name }),
          date: dateSummary,
          sources: sources,
          numericStats: numericStats,
          dailyAggregate: dailyAggregate,
          warnings: tableWarnings,
        }

        if (metricKey === 'exercise' && count > 0 && columns.some(function(c) { return c.name === 'exercise_type' })) {
          try {
            var typeRes = db.exec('SELECT exercise_type, COUNT(*) FROM ' + quoteIdent(table) + ' GROUP BY exercise_type')
            if (typeRes[0]) {
              summary.exerciseTypes = typeRes[0].values.map(function(r) { return getExerciseType(r[0]) + ': ' + r[1] })
            }
          } catch(e) {}
        }

        summaries.push(summary)
        grouped[metricKey].push(summary)
      } catch (err) {
        tableErrors.push(table + ': ' + err.message)
      }
    }

    if (self.HealthConnectAnalyzer && typeof self.HealthConnectAnalyzer.analyze === 'function') {
      try {
        deepAnalysis = self.HealthConnectAnalyzer.analyze(db, { timeZone: 'Australia/Sydney' })
        if (deepAnalysis) {
          addWarning(warnings, 'Health Connect Deep Analysis is available below and should be preferred over generic daily aggregates for Health Connect tables.')
        }
      } catch (err) {
        addWarning(warnings, 'Health Connect Deep Analysis failed: ' + err.message)
      }
    }

    db.close()

    var important = ['steps', 'sleep', 'hrv', 'restingHeartRate', 'respiratory', 'weight', 'exercise', 'nutrition', 'hydration', 'bloodPressure', 'bloodGlucose', 'vo2']
    important.forEach(function(metricKey) {
      var rows = (grouped[metricKey] || []).reduce(function(sum, item) { return sum + item.rows }, 0)
      if (rows === 0) {
        addWarning(warnings, METRICS[metricKey].label + ' is not safely available from this file (no rows found in matched tables).')
      }
    })

    var report = 'DATA PACK: STRUCTURED HEALTH INVENTORY\n'
    report += 'File: ' + fileName + ' (' + formatFileSize(fileSize) + ')\n'
    report += 'Parser: SQLite worker aggregate audit\n'
    report += 'Tables Found: ' + tables.length + '\n'
    report += 'Tables With Data: ' + nonEmptyTables + '\n'
    report += 'Tables Empty: ' + (tables.length - nonEmptyTables) + '\n\n'

    report += 'INTERPRETATION RULES FOR AI\n'
    report += '- Treat row counts, date ranges, source hints, and warnings as evidence.\n'
    report += '- Do not claim a metric is absent if this Data Pack says rows are present.\n'
    report += '- If a metric has matched tables but 0 rows, say the table exists but contains no records.\n'
    report += '- Do not diagnose. Use medical-boundary language for pathology, ECG, symptoms, medications, or abnormal clinical findings.\n'
    report += '- If source overlap is flagged, avoid raw totals until a priority source is chosen.\n\n'

    report += 'DATA QUALITY WARNINGS\n'
    if (warnings.length) {
      warnings.forEach(function(w) { report += '- ' + w + '\n' })
    } else {
      report += '- No broad warnings found by the deterministic parser.\n'
    }
    if (tableErrors.length) {
      report += '- Parser errors in ' + tableErrors.length + ' table(s): ' + tableErrors.slice(0, 6).join('; ') + '\n'
    }
    report += '\n'

    important.concat(['oxygen', 'heartRate', 'other']).forEach(function(metricKey) {
      var entries = grouped[metricKey] || []
      if (!entries.length) return
      var label = METRICS[metricKey] ? METRICS[metricKey].label : 'Other Tables'
      var totalRows = entries.reduce(function(sum, item) { return sum + item.rows }, 0)
      report += '=== METRIC: ' + label.toUpperCase() + ' ===\n'
      report += 'Matched tables: ' + entries.length + ' | Total rows: ' + totalRows.toLocaleString() + '\n'

      entries
        .sort(function(a, b) { return b.rows - a.rows })
        .slice(0, 10)
        .forEach(function(s) {
          report += '- Table: ' + s.tableName + ' | Rows: ' + s.rows.toLocaleString() + ' | Status: ' + s.status + '\n'
          if (s.date) {
            report += '  Date column: ' + s.date.column + '\n'
            if (s.date.normalRange && s.date.normalRange[0]) {
              report += '  Normalized range: ' + s.date.normalRange[0] + ' to ' + s.date.normalRange[1] + ' | Days covered: ' + (s.date.daysCovered || 'n/a') + '\n'
            } else if (s.date.rawRange) {
              report += '  Raw range: ' + s.date.rawRange[0] + ' to ' + s.date.rawRange[1] + '\n'
            }
            if (s.date.recentMonths && s.date.recentMonths.length) {
              report += '  Recent row density by month: ' + s.date.recentMonths.map(function(m) { return m.month + '=' + m.rows }).join(', ') + '\n'
            }
          }
          if (s.sources && s.sources.length) report += '  Source hints: ' + s.sources.join(', ') + '\n'
          if (s.dailyAggregate) {
            report += '  Recent daily aggregate: ' + s.dailyAggregate.method + '(' + s.dailyAggregate.column + ') over ' + s.dailyAggregate.recentDays + ' recent days; latest ' + s.dailyAggregate.latestDay + '=' + round(s.dailyAggregate.latestValue, 1) + '; recent avg=' + round(s.dailyAggregate.averageRecentValue, 1) + '\n'
          }
          if (s.numericStats && s.numericStats.length) {
            report += '  Numeric summaries: ' + s.numericStats.slice(0, 4).map(function(stat) {
              return stat.column + ' n=' + stat.count + ' min=' + round(stat.min, 1) + ' avg=' + round(stat.avg, 1) + ' max=' + round(stat.max, 1)
            }).join(' | ') + '\n'
          }
          if (s.exerciseTypes) {
            report += '  Exercise breakdown: ' + s.exerciseTypes.join(', ') + '\n'
          }
          if (s.columns && s.columns.length) report += '  Columns: ' + s.columns.slice(0, 18).join(', ') + (s.columns.length > 18 ? ', ...' : '') + '\n'
          if (s.warnings && s.warnings.length) s.warnings.forEach(function(w) { report += '  Warning: ' + w + '\n' })
        })
      report += '\n'
    })

    if (deepAnalysis && deepAnalysis.text) {
      report += deepAnalysis.text + '\n\n'
    }

    report += 'PARSER LIMITATIONS\n'
    report += '- This is a deterministic SQLite inventory, not a clinical analysis.\n'
    report += '- Date conversion is best-effort for ISO strings and Unix seconds/milliseconds/microseconds/nanoseconds.\n'
    report += '- Daily aggregates are candidate summaries based on likely value columns; source-prioritised deduplication still needs the normalisation layer.\n'
    report += '- Raw sample rows are intentionally not included to avoid sending binary/noisy personal data to the AI.\n'

    log('Done - structured health inventory complete', 'success', 100)
    self.postMessage({ type: 'done', content: report })
  } catch (err) {
    log('Audit failed: ' + err.message, 'error', 100)
    self.postMessage({ type: 'error', message: err.message })
  }
}
