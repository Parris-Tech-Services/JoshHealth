import { useState } from 'react'
import { checkHealth } from '../lib/claudeApi.js'

const PROVIDERS = [
  {
    id: 'groq',
    name: 'Groq',
    badge: 'Free tier',
    badgeClass: 'text-jade',
    placeholder: 'gsk_...',
    keyUrl: 'https://console.groq.com/keys',
    note: 'Free tier available with fast open-weight models.',
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (recommended)' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (fastest)' },
      { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    badge: 'Free models',
    badgeClass: 'text-jade',
    placeholder: 'sk-or-...',
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Many free models available. Paid models depend on account credits.',
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)' },
      { id: 'qwen/qwen3-next-80b-a3b-instruct:free', label: 'Qwen 3 Next 80B (free)' },
      { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (free)' },
      { id: 'anthropic/claude-3-5-sonnet', label: 'Claude 3.5 Sonnet (paid)' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    badge: 'Paid',
    badgeClass: 'text-slate-ui',
    placeholder: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    note: 'Requires a paid Anthropic account.',
    models: [
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (balanced)' },
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5 (best quality)' },
      { id: 'claude-haiku-3-5', label: 'Claude Haiku 3.5 (fastest/cheapest)' },
    ],
  },
]

export default function ProviderSelector({ onSubmit }) {
  const [provider, setProvider] = useState(PROVIDERS[0])
  const [model, setModel] = useState(() => localStorage.getItem(`jha_model_${PROVIDERS[0].id}`) || PROVIDERS[0].models[0].id)
  const [key, setKey] = useState(() => localStorage.getItem(`jha_key_${PROVIDERS[0].id}`) || '')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const handleProviderChange = (p) => {
    setProvider(p)
    setModel(localStorage.getItem(`jha_model_${p.id}`) || p.models[0].id)
    setKey(localStorage.getItem(`jha_key_${p.id}`) || '')
    setError('')
    setTestResult(null)
  }

  const validate = (k) => {
    if (!k.trim()) return 'Please enter your API key.'
    if (provider.id === 'anthropic' && !k.startsWith('sk-ant-')) return 'Anthropic keys start with sk-ant-'
    if (provider.id === 'groq' && !k.startsWith('gsk_')) return 'Groq keys start with gsk_'
    if (provider.id === 'openrouter' && !k.startsWith('sk-or-')) return 'OpenRouter keys start with sk-or-'
    return ''
  }

  const handleTest = async () => {
    const err = validate(key.trim())
    if (err) {
      setError(err)
      return
    }

    setTesting(true)
    setTestResult(null)
    setError('')
    const res = await checkHealth({ provider: provider.id, model, apiKey: key.trim() })
    setTesting(false)
    setTestResult(res)
    if (!res.ok) setError(res.message)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const err = validate(key.trim())
    if (err) {
      setError(err)
      return
    }
    localStorage.setItem(`jha_key_${provider.id}`, key.trim())
    localStorage.setItem(`jha_model_${provider.id}`, model)
    if (typeof onSubmit === 'function') {
      onSubmit({ provider: provider.id, model, apiKey: key.trim() })
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-ink-soft border border-slate-border rounded-2xl p-8 space-y-6">
        <div className="space-y-1">
          <h2 className="font-display font-semibold text-white text-lg">Connect an AI provider</h2>
          <p className="text-slate-ui text-sm leading-relaxed">
            Your API key is stored locally in your browser only and sent directly to the selected provider.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {PROVIDERS.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleProviderChange(p)}
              className={`flex flex-col items-center gap-1 rounded-xl py-3 px-2 border text-sm font-medium transition-all ${
                provider.id === p.id
                  ? 'bg-jade/10 border-jade/40 text-white'
                  : 'bg-ink border-slate-border text-slate-ui hover:border-slate-ui hover:text-white'
              }`}
            >
              <span>{p.name}</span>
              <span className={`text-[10px] font-normal ${p.badgeClass}`}>{p.badge}</span>
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-ui bg-ink rounded-lg px-3 py-2">
          {provider.note}{' '}
          <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="text-jade hover:underline">
            Get API key
          </a>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-slate-ui font-medium uppercase tracking-wider">Model</label>
            <select
              value={model}
              onChange={e => {
                setModel(e.target.value)
                setTestResult(null)
                setError('')
              }}
              className="w-full bg-ink border border-slate-border focus:border-jade/60 rounded-xl px-4 py-3 text-white text-sm outline-none transition-colors appearance-none"
            >
              {provider.models.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-ui font-medium uppercase tracking-wider">API Key</label>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={key}
                onChange={e => {
                  setKey(e.target.value)
                  setError('')
                  setTestResult(null)
                }}
                placeholder={provider.placeholder}
                className="w-full bg-ink border border-slate-border focus:border-jade/60 rounded-xl px-4 py-3 text-white font-mono text-sm outline-none transition-colors pr-12 placeholder:text-slate-border"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-ui hover:text-white text-xs transition-colors"
              >
                {show ? 'hide' : 'show'}
              </button>
            </div>
            {error && <p className="text-xs text-crimson-health whitespace-pre-wrap">{error}</p>}
            {testResult?.ok && <p className="text-xs text-jade">{testResult.message || 'Connection successful.'}</p>}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={!key.trim() || testing}
              className="flex-1 bg-ink border border-slate-border hover:border-slate-ui text-white font-medium py-3 rounded-xl transition-colors text-sm disabled:opacity-40"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              type="submit"
              disabled={!key.trim() || testing}
              className="flex-[2] bg-jade hover:bg-jade-dark disabled:opacity-40 disabled:cursor-not-allowed text-ink-DEFAULT font-display font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Continue
            </button>
          </div>
        </form>

        <div className="grid grid-cols-3 gap-3 pt-2">
          {['CSV', 'PDF', 'SQLite .db', 'ZIP archives', 'JSON', 'Text files'].map(f => (
            <div key={f} className="text-center p-2 bg-ink rounded-lg border border-slate-border/50">
              <span className="text-slate-ui text-xs">{f}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-ui/60 text-center">
          Key stays in your browser. Not medical advice. Plain English output.
        </p>
      </div>
    </div>
  )
}
