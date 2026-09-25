import { SOURCE_PRIORITY } from '../lib/schema.js'
import { useEffect, useState } from 'react'
import db, { clearAllLocalData } from '../lib/db.js'

export default function SourceManager({ parsedFiles }) {
  const [sourcesState, setSourcesState] = useState([])
  const [clearing, setClearing] = useState(false)

  const refresh = async () => {
    try {
      const sources = await db.health_sources.toArray()
      const imports = await db.health_imports.orderBy('imported_at').reverse().toArray()
      // Map known sources list to include DB state
      const known = [
        { id: 'health_connect', name: 'Health Connect', icon: '📱' },
        { id: 'withings', name: 'Withings', icon: '⚖️', connectPath: '/api/withings/start' },
        { id: 'fitbit', name: 'Fitbit', icon: '⌚', connectPath: '/api/fitbit/start' },
        { id: 'sleep_as_android', name: 'Sleep as Android', icon: '😴' },
        { id: 'strava', name: 'Strava', icon: '🏃' },
        { id: 'welltory', name: 'Welltory', icon: '💓' },
      ]
      const merged = known.map(k => {
        const found = sources.find(s => s.type === k.id || (s.name || '').toLowerCase().includes(k.id.replace('_',' ')))
        const lastImport = imports.find(i => i.source_id === (found?.id))
        return { ...k, connected: !!found, lastImport: lastImport?.imported_at || null }
      })
      setSourcesState(merged)
    } catch (e) {
      console.warn('Failed to load sources from DB', e.message)
    }
  }

  useEffect(() => {
    refresh()
  }, [parsedFiles])

  const handleDeleteAll = async () => {
    if (!confirm('Are you sure you want to delete ALL local health data and history? This cannot be undone.')) return
    
    setClearing(true)
    try {
      await clearAllLocalData()
      await refresh()
      alert('All local data cleared.')
    } catch (e) {
      alert('Failed to clear data: ' + e.message)
    } finally {
      setClearing(false)
    }
  }

  const handleExportBackup = async () => {
    try {
      const backup = {}
      for (const table of db.tables) {
        backup[table.name] = await table.toArray()
      }
      
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `healthlens-backup-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Failed to export backup: ' + e.message)
    }
  }

  return (
    <div className="bg-ink-soft border border-slate-border rounded-2xl p-6 space-y-6 animate-slide-up">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="font-display font-semibold text-white text-base">Health Sources</h3>
          <p className="text-slate-ui text-xs">Manage your data sources and priorities</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportBackup}
            className="text-[10px] uppercase tracking-widest text-slate-ui hover:text-white border border-slate-border hover:bg-white/5 px-3 py-1.5 rounded-lg transition-all"
          >
            Export Backup
          </button>
          <button
            onClick={handleDeleteAll}
            disabled={clearing}
            className="text-[10px] uppercase tracking-widest text-crimson-health hover:text-white border border-crimson-health/30 hover:bg-crimson-health px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
          >
            {clearing ? 'Clearing...' : 'Delete All Data'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sourcesState.map(s => (
          <div key={s.id} className="bg-ink border border-slate-border rounded-xl p-4 flex items-center gap-4">
            <span className="text-2xl">{s.icon}</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-white">{s.name}</p>
              <p className={`text-[10px] font-mono uppercase ${s.connected ? 'text-jade' : 'text-slate-ui/40'}`}>
                {s.connected ? `● Connected • Last import ${s.lastImport ? new Date(s.lastImport).toLocaleString() : '—'}` : '○ Not found'}
              </p>
            </div>
            {s.connectPath && (
              <a href={s.connectPath} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-jade/30 text-jade hover:bg-jade hover:text-ink transition-colors whitespace-nowrap">
                Connect
              </a>
            )}
          </div>
        ))}
      </div>

      <div className="pt-4 border-t border-slate-border/50">
        <h4 className="text-xs text-slate-ui font-medium uppercase tracking-wider mb-3">Priority Rules</h4>
        <div className="space-y-2">
          {Object.entries(SOURCE_PRIORITY).map(([metric, priority]) => (
            <div key={metric} className="flex items-center justify-between text-xs">
              <span className="text-white capitalize">{metric}</span>
              <div className="flex gap-1.5">
                {priority.map((p, i) => (
                  <span key={p} className={`px-2 py-0.5 rounded-full border ${i === 0 ? 'bg-jade/10 border-jade/30 text-jade' : 'border-slate-border text-slate-ui'}`}>
                    {p.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
