import { SOURCE_PRIORITY } from './schema.js'
import { buildStructuredDataPack } from './dataPackBuilder.js'
import { buildSupabaseDataPack, isSupabaseConfigured } from './healthDataApi.js'
import { getAnalysisHistory } from './db.js'

const ENDPOINTS = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages'
}

export async function checkHealth({ apiKey, provider, model }) {
  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: provider,
        model,
        apiKey,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1
      })
    })

    if (response.ok) {
      return { ok: true, message: 'Connection successful.' }
    }

    let errorBody = { error: { message: response.statusText } }
    try {
      errorBody = await response.json()
    } catch (parseError) {}

    return {
      ok: false,
      message: errorBody.error?.message || errorBody.message || errorBody.details || `API request failed with status ${response.status}`
    }
  } catch (e) {
    return { ok: false, message: e.message || 'Network error' }
  }
}

const FALLBACK_CHAIN = {
  'openai/gpt-oss-120b': ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']
}

export const ANALYSIS_MODES = {
  quickSummary: {
    label: 'Quick Summary',
    icon: '⚡',
    prompt: 'Provide a concise summary of the last 7-14 days. Highlight the most significant change in sleep, activity, or recovery.'
  },
  deepPattern: {
    label: 'Deep Pattern Analysis',
    icon: '🔍',
    prompt: 'Look for hidden correlations. Does sleep quality impact the next day’s HRV? Does exercise volume correlate with resting HR? Be specific with dates and values.'
  },
  clinicalReview: {
    label: 'Clinical Marker Review',
    icon: '🩺',
    prompt: 'Analyse blood test results and clinical biometrics (weight, BP, respiration). Compare them against standard reference ranges. Flag any markers that are trending towards the edges of normal ranges.'
  },
  sleepExpert: {
    label: 'Sleep & Circadian',
    icon: '🌙',
    prompt: 'Focus entirely on sleep cycles, efficiency, and timing. Look for consistency in wake times and sleep onset. Identify "good" vs "bad" sleep patterns.'
  },
  movement: {
    label: 'Movement & Load',
    icon: '🏃',
    prompt: 'Review exercise sessions and daily steps. Assess training load and recovery balance. Suggest if the user should push harder or take a rest day.'
  },
  recovery: {
    label: 'HRV & Recovery',
    icon: '🔋',
    prompt: 'Deep dive into HRV (RMSSD) and Resting Heart Rate. What are the recovery baselines? Are there signs of systemic stress or overtraining?'
  },
  nutrition: {
    label: 'Nutrition & Metabolic',
    icon: '🥗',
    prompt: 'If data is present, review calories, macros, and weight trends. How does nutrition timing or volume seem to affect energy or sleep?'
  },
  actionPlan: {
    label: '90-Day Action Plan',
    icon: '📅',
    prompt: 'Based on all data, suggest 3 small, sustainable changes the user could make over the next 90 days. Focus on the "lowest hanging fruit" for health improvement.'
  },
  comparePeriods: {
    label: 'Compare Time Periods',
    icon: '📊',
    prompt: 'Compare health metrics across different time periods in the data. Look for what has improved, what has stayed flat, and what may have declined. Frame improvements as encouragement.'
  },
  gpSummary: {
    label: 'GP Summary Report',
    icon: '🏥',
    prompt: 'Generate a concise summary specifically for a GP discussion. Focus on clinical documents, pathology markers, symptoms, and significant wearable trends. Separate user-reported symptoms from measured biometrics. Include a section for "Questions to ask my GP". Keep it professional and factual.'
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function streamResponse({ apiKey, provider, model, systemPrompt, messages, maxTokens = 1500, onChunk }) {
  let attempt = 0;
  let currentModel = model;
  const isAnthropic = provider === 'anthropic';
  
  // Create model fallback chain if starting with the default Groq model
  const modelsToTry = (provider === 'groq' && FALLBACK_CHAIN[model]) 
    ? [...FALLBACK_CHAIN[model]] 
    : [model];

  while (modelsToTry.length > 0) {
    currentModel = modelsToTry.shift();
    let retryCount = 0;
    const maxRetries = 2; // For 429s on the SAME model
    
    while (retryCount <= maxRetries) {
      if (attempt > 0) {
        onChunk(`\n\n_Retrying with model ${currentModel}..._\n\n`);
      }

      const body = {
        providerId: provider,
        model: currentModel,
        apiKey,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        max_tokens: maxTokens
      }

      try {
        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })

        if (!response.ok) {
          if (response.status === 429) {
            const errData = await response.json().catch(() => ({}));
            let retryAfterHeader = errData.retryAfter || response.headers.get('retry-after');
            let waitSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : (2 ** retryCount);
            if (isNaN(waitSeconds)) waitSeconds = 5;
            
            // Add jitter (0 to 1000ms)
            const jitterMs = Math.floor(Math.random() * 1000);
            const totalWaitMs = (waitSeconds * 1000) + jitterMs;

            if (retryCount < maxRetries && totalWaitMs < 30000) { // Don't wait more than 30s for a single model
              onChunk(`\n\n_Provider is briefly busy (Rate Limited). Retrying automatically in ${Math.ceil(totalWaitMs/1000)} seconds..._\n\n`);
              await sleep(totalWaitMs);
              retryCount++;
              attempt++;
              continue; // Retry same model
            } else {
              // Exceeded retries or wait time for this model, break out to try next model
              if (modelsToTry.length > 0) {
                onChunk(`\n\n_${currentModel} is temporarily busy. Continuing with next available model..._\n\n`);
              }
              break; 
            }
          }
          
          // Non-429 error, don't retry same model
          const err = await response.json().catch(() => ({ error: { message: response.statusText } }))
          throw new Error(err.error?.message || err.error || err.details || 'API request failed')
        }

        // Success!
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let fullText = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n').filter(l => l.trim() !== '')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue
              try {
                const json = JSON.parse(data)
                const content = isAnthropic 
                  ? json.delta?.text || '' 
                  : json.choices?.[0]?.delta?.content || ''
                
                if (content) {
                  fullText += content
                  onChunk(fullText)
                }
              } catch (e) {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }
        return fullText;
      } catch (err) {
        // Log the error but don't rethrow it yet, so we continue to the next model
        console.warn(`Model ${currentModel} failed:`, err.message);
        break;
      }
    } // End inner retry loop
    attempt++;
  } // End outer model loop
  
  throw new Error('AI analysis is temporarily unavailable. Your imported health data is safe and has not been lost. Try again shortly.');
}

export async function runAnalysis({ apiKey, provider = 'anthropic', model = 'claude-opus-4-5', parsedFiles, selectedModes, customQuestion, onChunk, onComplete, onError }) {
  let dataPack = buildStructuredDataPack(parsedFiles)

  // Append synced Supabase data if available
  if (isSupabaseConfigured) {
    try {
      const supabasePack = await buildSupabaseDataPack({ days: 30 })
      dataPack += `\n\n${supabasePack}`
    } catch (e) {
      console.warn('Could not fetch Supabase data for analysis', e)
    }
  }

  // Fetch analysis history for longitudinal context
  let historyContext = ''
  try {
    const history = await getAnalysisHistory()
    if (history && history.length > 0) {
      historyContext = '\n\n=== ANALYSIS HISTORY (Longitudinal Context) ===\n'
      // Include up to 3 most recent analyses
      history.slice(0, 3).forEach((item, idx) => {
        historyContext += `\n--- Historical Analysis ${idx + 1} (${new Date(item.date).toLocaleDateString()}) ---\n`
        historyContext += `Modes: ${item.modes.join(', ')}\n`
        if (item.question) historyContext += `Question: ${item.question}\n`
        historyContext += `Result Summary: ${item.result.slice(0, 500)}...\n`
      })
    }
  } catch (e) {
    console.warn('Failed to fetch analysis history for context', e)
  }

  const modeInstructions = selectedModes
    .map(m => `### MODE: ${ANALYSIS_MODES[m].label}\n${ANALYSIS_MODES[m].prompt}`)
    .join('\n\n')

  const systemPrompt = `You are HealthLens AI, a clinical health data analyst. 
You are grounded, evidence-based, and Australian-English speaking.
You are talking to Josh, who is busy with work/family and has ADHD.
Be direct, encouraging, and highly specific about data points.

RULES:
1. CITATION: Always cite the source file/date for any metric you mention.
2. HONESTY: If data is missing or ambiguous, say so. Do not hallucinate.
3. ADVICE: You are NOT a doctor. This is for reflection only.
4. STRUCTURE: Use Markdown. Lead with a "Data Inventory" summary.

ANALYSIS MODES REQUESTED:
${modeInstructions}

${customQuestion ? `CUSTOM USER QUESTION:\n${customQuestion}` : ''}
`

  const userPrompt = `Please perform a deep clinical and pattern analysis on this Health Data Pack.

HEALTH DATA PACK:
${dataPack}
${historyContext}

---

Begin your structured analysis now. Lead with the Data Inventory.`

  try {
    const fullText = await streamResponse({
      apiKey,
      provider,
      model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 2500,
      onChunk
    })
    onComplete(fullText)
  } catch (e) {
    onError(e.message)
  }
}

export async function runChat({ apiKey, provider, model, systemPrompt, history, onChunk, onComplete, onError }) {
  try {
    const fullText = await streamResponse({
      apiKey,
      provider,
      model,
      systemPrompt,
      messages: history,
      onChunk
    })
    onComplete(fullText)
  } catch (e) {
    onError(e.message)
  }
}
