import { useState, useCallback, useEffect } from 'react'
import UploadZone from './components/UploadZone.jsx'
import ModeSelector from './components/ModeSelector.jsx'
import AnalysisView from './components/AnalysisView.jsx'
import ChatPanel from './components/ChatPanel.jsx'
import ProviderSelector from './components/ProviderSelector.jsx'
import Header from './components/Header.jsx'
import DailyCheckIn from './components/DailyCheckIn.jsx'
import SourceManager from './components/SourceManager.jsx'
import Dashboard from './components/Dashboard.jsx'
import HrvDashboard from './components/HrvDashboard.jsx'
import SupabaseStatus from './components/SupabaseStatus.jsx'
import SyncStatus from './components/SyncStatus.jsx'
import SupabaseDashboard from './components/SupabaseDashboard.jsx'
import HistoryView from './components/HistoryView.jsx'
import DataAuditView from './components/DataAuditView.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import StravaPanel from './components/StravaPanel.jsx'
import TrendsView from './components/TrendsView.jsx'
import { parseFile } from './lib/fileParser.js'
import { runAnalysis } from './lib/claudeApi.js'
import { isSupabaseConfigured, getDailySummaries, getLatestSyncStatus, getSyncImports, getMetricAvailability, getStravaStatus } from './lib/healthDataApi.js'
import { buildSyncedDataPack } from './lib/syncedDataPack.js'
import { saveAnalysis } from './lib/db.js'

const STAGES = { SETUP: 'setup', UPLOAD: 'upload', ANALYSE: 'analyse', RESULT: 'result' }

// Restore connection from localStorage if available
function restoreConnection() {
  for (const id of ['groq', 'openrouter', 'anthropic']) {
    const key = localStorage.getItem(`jha_key_${id}`)
    const model = localStorage.getItem(`jha_model_${id}`)
    if (key) return { provider: id, apiKey: key, model: model || '' }
  }
  return null
}

export default function App() {
  const [connection, setConnection] = useState(() => restoreConnection())
  const [files, setFiles] = useState([])
  const [parsedFiles, setParsedFiles] = useState([])
  const [parsing, setParsing] = useState(false)
  const [parseLog, setParseLog] = useState([])
  const [selectedModes, setSelectedModes] = useState(['quickSummary', 'deepPattern'])
  const [stage, setStage] = useState(connection ? STAGES.UPLOAD : STAGES.SETUP)
  const [analysisResult, setAnalysisResult] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [chatHistory, setChatHistory] = useState([])
  const [showChat, setShowChat] = useState(false)
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [activeTab, setActiveTab] = useState('upload') // upload, trends, sources, checkin, history, audit, settings

  const [supabaseLoading, setSupabaseLoading] = useState(false)
  const [supabaseError, setSupabaseError] = useState('')
  const [supabaseSummaries, setSupabaseSummaries] = useState([])
  const [latestSyncImport, setLatestSyncImport] = useState(null)
  const [recentImports, setRecentImports] = useState([])
  const [metricAvailability, setMetricAvailability] = useState(null)
  const [selectedDays, setSelectedDays] = useState(7)
  const [customQuestion, setCustomQuestion] = useState('')

  const refreshSupabaseData = useCallback(async (days = selectedDays) => {
    if (!isSupabaseConfigured) return
    setSupabaseLoading(true)
    setSupabaseError('')

    try {
      const [summariesResult, latestImportResult, importsResult, availabilityResult] = await Promise.all([
        getDailySummaries({ days }),
        getLatestSyncStatus(),
        getSyncImports(),
        getMetricAvailability({ days }),
      ])

      if (summariesResult.error) throw summariesResult.error
      if (latestImportResult.error) throw latestImportResult.error
      if (importsResult.error) throw importsResult.error
      if (availabilityResult.error) throw availabilityResult.error

      setSupabaseSummaries(summariesResult.data ?? [])
      setLatestSyncImport(latestImportResult.data ?? null)
      setRecentImports(importsResult.data ?? [])
      setMetricAvailability(availabilityResult.data ?? null)
    } catch (err) {
      setSupabaseError(err?.message || String(err))
    } finally {
      setSupabaseLoading(false)
    }
  }, [selectedDays])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    refreshSupabaseData(selectedDays)
  }, [refreshSupabaseData, selectedDays])

  const handleConnect = useCallback((conn) => {
    setConnection(conn)
    localStorage.setItem(`jha_model_${conn.provider}`, conn.model)
    setStage(STAGES.UPLOAD)
  }, [])

  const handleClearSession = useCallback(() => {
    setFiles([])
    setParsedFiles([])
    setError('')
    setStage(connection ? STAGES.UPLOAD : STAGES.SETUP)
  }, [connection])

  const handleClearProviderKeys = useCallback(() => {
    setConnection(null)
    setError('')
    setStage(STAGES.SETUP)
  }, [])

  const handleFiles = useCallback(async (newFiles) => {
    if (!newFiles.length) return
    setParsing(true)
    setParseLog([])
    setError('')
    const parsed = []
    for (const f of newFiles) {
      const result = await parseFile(f, (entry) => {
        setParseLog(prev => {
          if (entry.id) {
            const idx = prev.findIndex(e => e.id === entry.id && e.file === entry.file)
            if (idx !== -1) {
              const next = [...prev]
              next[idx] = entry
              return next
            }
          }
          return [...prev, entry]
        })
      })
      parsed.push(result)
    }
    setFiles(prev => [...prev, ...newFiles])
    setParsedFiles(prev => [...prev, ...parsed])
    setParsing(false)
    setStage(STAGES.ANALYSE)
  }, [])

  const showAnalysisControls = stage === STAGES.ANALYSE || stage === STAGES.RESULT

  const handleCheckIn = useCallback((data) => {
    const virtualFile = {
      name: `Check-in ${data.date}`,
      type: 'manual',
      size: 0,
      content: JSON.stringify(data),
      summary: `DAILY CHECK-IN: ${data.date}\n` +
        Object.entries(data)
          .filter(([k]) => k !== 'type' && k !== 'date')
          .map(([k, v]) => `  - ${k.replace(/_/g, ' ')}: ${v}`)
          .join('\n')
    }
    setParsedFiles(prev => [...prev, virtualFile])
    setFiles(prev => [...prev, { name: virtualFile.name, size: 0 }])
    setActiveTab('upload')
    setStage(STAGES.ANALYSE)
  }, [])

  const handleUseSyncedDataForAnalysis = useCallback(async () => {
    if (!supabaseSummaries.length) return
    const stravaResult = await getStravaStatus({ days: selectedDays })
    const virtualFile = buildSyncedDataPack(supabaseSummaries, {
      selectedDays,
      stravaStatus: stravaResult.data,
    })
    setParsedFiles(prev => {
      const withoutPrevious = prev.filter(file => file.type !== 'supabase')
      return [...withoutPrevious, virtualFile]
    })
    setFiles(prev => {
      const withoutPrevious = prev.filter(file => file.type !== 'supabase')
      return [...withoutPrevious, { name: virtualFile.name, size: virtualFile.size, type: 'supabase' }]
    })
    setActiveTab('upload')
    setStage(STAGES.ANALYSE)
  }, [selectedDays, supabaseSummaries])

  const removeFile = useCallback((idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
    setParsedFiles(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const handleAnalyse = useCallback(async () => {
    if (!connection) { setError('Please connect an AI provider first.'); return }
    if (!parsedFiles.length) { setError('Please upload at least one file.'); return }
    if (!selectedModes.length && !customQuestion.trim()) { setError('Select at least one analysis mode or ask a question.'); return }

    setError('')
    setStreaming(true)
    setAnalysisResult('')
    setStage(STAGES.RESULT)
    setChatHistory([])
    setShowChat(false)

    await runAnalysis({
      apiKey: connection.apiKey,
      provider: connection.provider,
      model: connection.model,
      parsedFiles,
      selectedModes,
      customQuestion: customQuestion.trim(),
      onChunk: (text) => setAnalysisResult(text),
      onComplete: (text) => {
        setAnalysisResult(text)
        setStreaming(false)
        setShowChat(true)
        // Save to history
        saveAnalysis({
          result: text,
          model: connection.model,
          modes: selectedModes,
          question: customQuestion.trim()
        }).catch(err => console.warn('Failed to save analysis history', err))
      },
      onError: (msg) => {
        setError(msg)
        setStreaming(false)
        setStage(STAGES.ANALYSE)
      }
    })
  }, [connection, parsedFiles, selectedModes, customQuestion])

  return (
    <div className="min-h-screen bg-ink text-white selection:bg-jade/30">
      <Header 
        onSettings={() => setActiveTab('settings')} 
        isConfigured={!!connection} 
      />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Sidebar */}
          <div className="lg:col-span-4 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-border/50 pb-2">
              <div className="flex gap-4 overflow-x-auto no-scrollbar pb-1">
                {['upload', 'hrv', 'trends', 'sources', 'checkin', 'history', 'audit', 'settings'].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`text-xs font-mono uppercase tracking-widest pb-2 transition-all flex-shrink-0 ${
                      activeTab === tab 
                        ? 'text-jade border-b-2 border-jade' 
                        : 'text-slate-ui hover:text-white'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {activeTab === 'settings' && (
              <SettingsPanel 
                connection={connection}
                onClearSession={handleClearSession}
                onClearProviderKeys={handleClearProviderKeys}
              />
            )}

            {activeTab === 'history' && (
              <HistoryView />
            )}

            {activeTab === 'audit' && (
              <DataAuditView summaries={supabaseSummaries} />
            )}

            {activeTab === 'hrv' && (
              <HrvDashboard />
            )}

            {activeTab === 'trends' && (
              <TrendsView parsedFiles={parsedFiles} summaries={supabaseSummaries} />
            )}

            {activeTab === 'checkin' && (
              <DailyCheckIn onCheckIn={handleCheckIn} />
            )}

            {activeTab === 'sources' && (
              <>
                <StravaPanel />
                <SupabaseStatus 
                  loading={supabaseLoading}
                  error={supabaseError}
                  latestSync={latestSyncImport}
                  onRefresh={() => refreshSupabaseData(selectedDays)}
                />
                <SourceManager parsedFiles={parsedFiles} />
                <SyncStatus imports={recentImports} />
              </>
            )}

            {activeTab === 'upload' && (
              <div className="space-y-6 animate-slide-up">
                <UploadZone
                  files={files}
                  parsedFiles={parsedFiles}
                  parsing={parsing}
                  parseLog={parseLog}
                  onFiles={handleFiles}
                  onRemove={removeFile}
                />
                
                {parsedFiles.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                      <h3 className="text-xs uppercase tracking-[0.35em] text-slate-ui">Ready for Analysis</h3>
                      <button 
                        onClick={() => {setFiles([]); setParsedFiles([]); setStage(STAGES.UPLOAD)}}
                        className="text-[10px] text-slate-ui hover:text-crimson-health transition-colors"
                      >
                        Clear All
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {parsedFiles.map((file, i) => (
                        <div key={i} className="group flex items-center justify-between rounded-xl border border-slate-border bg-ink-soft p-3 hover:border-jade/30 transition-all">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <span className="text-lg flex-shrink-0">
                              {file.type === 'pdf' ? '📄' : file.type === 'csv' ? '📊' : file.type === 'zip' ? '📦' : file.type === 'db' ? '💾' : '📝'}
                            </span>
                            <div className="overflow-hidden">
                              <p className="truncate text-sm font-medium text-white">{file.name}</p>
                              <p className="text-[10px] uppercase tracking-wider text-slate-ui">{file.type} · {(file.size / 1024).toFixed(1)} KB</p>
                            </div>
                          </div>
                          <button onClick={() => removeFile(i)} className="text-slate-ui opacity-0 group-hover:opacity-100 hover:text-crimson-health p-1 transition-all">
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => setStage(STAGES.ANALYSE)}
                      className="w-full rounded-xl bg-jade px-4 py-3 text-sm font-bold text-ink transition-all hover:bg-jade-dark"
                    >
                      Continue to Analyse
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-8 space-y-8">
            {stage === STAGES.SETUP && activeTab !== 'settings' && (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-slate-border bg-ink-soft p-12 text-center animate-fade-in">
                <div className="text-5xl mb-6">🛰️</div>
                <h2 className="text-2xl font-display font-bold text-white mb-4">Welcome to HealthLens</h2>
                <p className="text-slate-ui max-w-md mb-8">
                  Connect an AI provider to start analysing your health data with evidence-grounded insights.
                </p>
                <button 
                  onClick={() => setActiveTab('settings')}
                  className="bg-jade hover:bg-jade-dark text-ink font-bold px-8 py-3 rounded-xl transition-all glow-active"
                >
                  Configure AI Provider
                </button>
              </div>
            )}

            {isSupabaseConfigured && !showAnalysisControls && (
              <SupabaseDashboard 
                summaries={supabaseSummaries} 
                selectedDays={selectedDays}
                onSelectDays={setSelectedDays}
                onUseForAnalysis={handleUseSyncedDataForAnalysis}
              />
            )}

            {stage === STAGES.UPLOAD && !isSupabaseConfigured && (
              <Dashboard />
            )}

            {showAnalysisControls && (
              <div className="space-y-6 animate-slide-up">
                <ModeSelector
                  selected={selectedModes}
                  onChange={setSelectedModes}
                  onAnalyse={handleAnalyse}
                  disabled={!parsedFiles.length || !connection}
                  customQuestion={customQuestion}
                  onCustomQuestionChange={setCustomQuestion}
                />
                
                {error && (
                  <div className="rounded-xl border border-crimson-health/20 bg-crimson-health/5 p-4 text-sm text-crimson-health">
                    ⚠️ {error}
                  </div>
                )}

                {(analysisResult || streaming) && (
                  <AnalysisView 
                    result={analysisResult} 
                    streaming={streaming} 
                  />
                )}

                {showChat && (
                  <ChatPanel 
                    history={chatHistory}
                    onUpdateHistory={setChatHistory}
                    dataContext={parsedFiles.map(f => f.summary).join('\n\n')}
                    connection={connection}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
