import React, { useMemo } from 'react'

export default function TrendsView({ parsedFiles }) {
  const data = useMemo(() => {
    for (const file of (parsedFiles || [])) {
      if (!file.summary) continue
      const match = file.summary.match(/HEALTH_CONNECT_DEEP_ANALYSIS_JSON_START\n([\s\S]*?)\nHEALTH_CONNECT_DEEP_ANALYSIS_JSON_END/)
      if (match) {
        try {
          return JSON.parse(match[1])
        } catch(e) {}
      }
    }
    return null
  }, [parsedFiles])

  if (!data) {
    return (
      <div className="rounded-xl border border-slate-border bg-ink-soft p-6 text-center animate-fade-in">
        <p className="text-slate-ui">No deep analysis data available. Upload a Health Connect export first.</p>
      </div>
    )
  }

  const renderTrend = (title, monthlyData, formatValue, invertGood = false) => {
    if (!monthlyData || monthlyData.length < 2) return null
    const current = monthlyData[monthlyData.length - 1]
    const previous = monthlyData[monthlyData.length - 2]
    
    if (!current || !previous || current.avg == null || previous.avg == null) return null
    
    const diff = current.avg - previous.avg
    const percentChange = previous.avg !== 0 ? (diff / previous.avg) * 100 : 0
    
    let direction = 'Flat'
    let color = 'text-slate-ui'
    let arrow = '→'
    
    if (Math.abs(percentChange) > 2) {
      const isUp = diff > 0
      direction = isUp ? 'Up' : 'Down'
      arrow = isUp ? '↑' : '↓'
      
      const isGood = invertGood ? !isUp : isUp
      color = isGood ? 'text-jade' : 'text-crimson-health'
    }
  const renderBaselineTrend = (title, baselineData, formatValue, invertGood = false) => {
    if (!baselineData) return null
    if (baselineData.status === 'insufficient_data') {
      return (
        <div className="rounded-xl border border-slate-border bg-ink-soft p-5 animate-slide-up">
          <h4 className="text-xs uppercase tracking-widest text-slate-ui mb-3">{title}</h4>
          <p className="text-slate-ui text-sm">Insufficient data (needs 10+ days)</p>
        </div>
      )
    }

    const { current, baseline, changePercent, trend } = baselineData
    
    let color = 'text-slate-ui'
    let arrow = '→'
    
    if (Math.abs(changePercent) > 2) {
      const isUp = changePercent > 0
      arrow = isUp ? '↑' : '↓'
      const isGood = invertGood ? !isUp : isUp
      color = isGood ? 'text-jade' : 'text-crimson-health'
    }

    return (
      <div className="rounded-xl border border-slate-border bg-ink-soft p-5 animate-slide-up">
        <h4 className="text-xs uppercase tracking-widest text-slate-ui mb-3">{title} (Rolling Baseline)</h4>
        <div className="flex items-baseline justify-between mb-4">
          <span className="text-3xl font-display font-bold text-white">{formatValue(current)}</span>
          <span className={`text-sm font-bold flex items-center gap-1 ${color}`}>
            {arrow} {Math.abs(changePercent).toFixed(1)}%
          </span>
        </div>
        <div className="text-xs text-slate-ui flex justify-between">
          <span>7-Day: {formatValue(current)}</span>
          <span>30-Day: {formatValue(baseline)}</span>
        </div>
        <div className="mt-2 text-xs text-slate-ui">
          {title} {Math.abs(changePercent).toFixed(0)}% {changePercent > 0 ? 'above' : 'below'} your 30-day baseline
        </div>
      </div>
    )
  }
    return (
      <div className="rounded-xl border border-slate-border bg-ink-soft p-5 animate-slide-up">
        <h4 className="text-xs uppercase tracking-widest text-slate-ui mb-3">{title}</h4>
        <div className="flex items-baseline justify-between mb-4">
          <span className="text-3xl font-display font-bold text-white">{formatValue(current.avg)}</span>
          <span className={`text-sm font-bold flex items-center gap-1 ${color}`}>
            {arrow} {Math.abs(percentChange).toFixed(1)}%
          </span>
        </div>
        <div className="text-xs text-slate-ui flex justify-between">
          <span>{current.period}: {formatValue(current.avg)}</span>
          <span>{previous.period}: {formatValue(previous.avg)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm uppercase tracking-widest text-jade">Month-Over-Month Trends</h3>
        <span className="text-xs text-slate-ui">Latest available months</span>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.weight && renderTrend('Weight', data.weight.monthly, v => `${(v/1000).toFixed(1)} kg`, true)}
        {data.resting_hr_estimate_weekly && renderTrend('Resting HR (Weekly Avg)', data.resting_hr_estimate_weekly, v => `${Math.round(v)} bpm`, true)}
        {data.hrv_rmssd?.baseline ? renderBaselineTrend('HRV RMSSD', data.hrv_rmssd.baseline, v => `${Math.round(v)} ms`, false) : (data.hrv_rmssd && renderTrend('HRV RMSSD', data.hrv_rmssd.monthly, v => `${Math.round(v)} ms`, false))}
        {data.sleep && renderTrend('Sleep Duration', data.sleep.monthly, v => `${Math.round(v/60)}h ${Math.round(v%60)}m`, false)}
        {data.steps && renderTrend('Daily Steps', data.steps.monthly, v => Math.round(v).toLocaleString(), false)}
        {data.calories && renderTrend('Calories Burned', data.calories.monthly, v => Math.round(v).toLocaleString(), false)}
        {data.exercise_sessions?.monthly && renderTrend('Exercise Sessions', data.exercise_sessions.monthly, v => Math.round(v).toString() + ' sessions', false)}
      </div>

      {data.sleep?.nightly && data.sleep.nightly.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm uppercase tracking-widest text-jade mb-4">Sleep Stages (Recent Avg)</h3>
          {(() => {
            const recent = data.sleep.nightly.slice(-14)
            let total = 0, deep = 0, rem = 0, light = 0, awake = 0
            recent.forEach(n => {
              total += n.asleep_min + (n.awake_min || 0)
              deep += (n.deep_min || 0)
              rem += (n.rem_min || 0)
              light += (n.light_min || 0)
              awake += (n.awake_min || 0)
            })
            if (deep === 0 && rem === 0 && light === 0) return <p className="text-sm text-slate-ui">No stage data available</p>
            const pct = (val) => Math.round((val / total) * 100) || 0
            return (
              <div className="flex w-full h-8 rounded-full overflow-hidden">
                {deep > 0 && <div style={{width: `${pct(deep)}%`}} className="bg-indigo-600 flex items-center justify-center text-[10px] text-white font-bold" title={`Deep: ${pct(deep)}%`}>Deep</div>}
                {rem > 0 && <div style={{width: `${pct(rem)}%`}} className="bg-blue-500 flex items-center justify-center text-[10px] text-white font-bold" title={`REM: ${pct(rem)}%`}>REM</div>}
                {light > 0 && <div style={{width: `${pct(light)}%`}} className="bg-sky-400 flex items-center justify-center text-[10px] text-white font-bold" title={`Light: ${pct(light)}%`}>Light</div>}
                {awake > 0 && <div style={{width: `${pct(awake)}%`}} className="bg-amber-500 flex items-center justify-center text-[10px] text-white font-bold" title={`Awake: ${pct(awake)}%`}>Awk</div>}
              </div>
            )
          })()}
        </div>
      )}

      {data.correlations && Object.keys(data.correlations).length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm uppercase tracking-widest text-jade mb-4">Cross-Metric Correlations</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.keys(data.correlations).map(key => {
              const corr = data.correlations[key]
              const title = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
              
              if (!corr.rho && corr.n < 14) {
                return (
                  <div key={key} className="rounded-xl border border-slate-border bg-ink-soft p-5">
                    <h4 className="text-xs uppercase tracking-widest text-slate-ui mb-2">{title}</h4>
                    <p className="text-sm text-slate-ui">Not enough data yet (needs 14+ paired days)</p>
                  </div>
                )
              }
              
              return (
                <div key={key} className="rounded-xl border border-slate-border bg-ink-soft p-5">
                  <h4 className="text-xs uppercase tracking-widest text-slate-ui mb-2">{title}</h4>
                  <div className="text-xl font-bold text-white mb-1">{corr.interpretation}</div>
                  <div className="text-xs text-slate-ui">
                    Spearman ρ: {corr.rho.toFixed(2)} ({corr.n} days)
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
