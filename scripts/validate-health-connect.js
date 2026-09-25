import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import initSqlJs from 'sql.js'

// Load analyzer directly. We will mock the environment to load it.
const analyzerCode = fs.readFileSync(path.join(process.cwd(), 'public', 'health-connect-analyzer.js'), 'utf8')
const sandbox = { globalThis: {} }
new Function('globalThis', analyzerCode)(sandbox.globalThis)
const HealthConnectAnalyzer = sandbox.globalThis.HealthConnectAnalyzer

async function run() {
  const zipPath = process.argv[2]
  if (!zipPath) {
    console.error('Usage: node validate-health-connect.js <path-to-zip>')
    process.exit(1)
  }

  if (!fs.existsSync(zipPath)) {
    console.error('File not found:', zipPath)
    process.exit(1)
  }

  console.log('Validating ZIP:', zipPath)
  const stats = fs.statSync(zipPath)
  console.log('ZIP size:', (stats.size / 1024 / 1024).toFixed(2), 'MB')

  const startTime = Date.now()
  
  let dbBuffer = null
  try {
    const zip = new AdmZip(zipPath)
    const zipEntries = zip.getEntries()
    for (const entry of zipEntries) {
      if (entry.entryName.endsWith('health_connect_export.db')) {
        dbBuffer = entry.getData()
        break
      }
    }
  } catch (err) {
    console.error('Failed to parse ZIP:', err.message)
    process.exit(1)
  }

  if (!dbBuffer) {
    console.error('health_connect_export.db not found in ZIP')
    process.exit(1)
  }

  console.log('Database extracted. Size:', (dbBuffer.length / 1024 / 1024).toFixed(2), 'MB')
  
  const SQL = await initSqlJs()
  const db = new SQL.Database(dbBuffer)
  
  const parseTime = Date.now()
  console.log('Extraction & Init took:', (parseTime - startTime), 'ms')

  // Run the analysis
  try {
    console.log('Starting analysis...')
    const analysis = HealthConnectAnalyzer.analyze(db, { timeZone: 'Australia/Sydney' })
    const analysisTime = Date.now()
    
    console.log('Analysis took:', (analysisTime - parseTime), 'ms')
    console.log('Total Time:', (analysisTime - startTime), 'ms')
    
    if (!analysis) {
      console.error('Analysis returned null (no supported schema?)')
      process.exit(1)
    }

    console.log('\n=== ANALYSIS SUMMARY ===')
    console.log('Detected tables:', analysis.detected_tables.join(', '))
    
    if (analysis.hrv_rmssd) {
      console.log('HRV RMSSD Rows:', analysis.hrv_rmssd.rows)
      console.log('HRV RMSSD Baseline Status:', analysis.hrv_rmssd.baseline?.status)
    }
    
    if (analysis.sleep) {
      console.log('Sleep Sessions:', analysis.sleep.sessions)
      console.log('Sleep Naps Filtered:', analysis.sleep.naps)
      console.log('Sleep Nights Analyzed:', analysis.sleep.nights)
    }
    
    if (analysis.steps) {
      console.log('Steps daily aggregate days:', analysis.steps.daily?.length)
    }
    
    if (analysis.correlations) {
      console.log('Correlations discovered:', Object.keys(analysis.correlations).length)
      for (const [key, corr] of Object.entries(analysis.correlations)) {
         console.log(`  - ${key}: n=${corr.n}, rho=${corr.rho} (${corr.interpretation})`)
      }
    }
    
    const payloadStr = JSON.stringify(analysis)
    console.log('Final Payload Size:', (payloadStr.length / 1024).toFixed(2), 'KB')

    console.log('Payload key sizes:')
    for (const key of Object.keys(analysis)) {
      console.log('  - ' + key + ':', (JSON.stringify(analysis[key]).length / 1024).toFixed(2), 'KB')
    }

    // Basic memory usage
    const memory = process.memoryUsage()
    console.log('Peak Heap Used:', (memory.heapUsed / 1024 / 1024).toFixed(2), 'MB')
    
  } catch (err) {
    console.error('Analysis crashed:', err)
    process.exit(1)
  }
}

run()
