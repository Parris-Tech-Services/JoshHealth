import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { runAnalysis } from '../src/lib/claudeApi.js'

test('AI Rate Limit: Normal Request', async (t) => {
  // Mock global fetch
  let callCount = 0;
  global.fetch = async (url, options) => {
    callCount++;
    return {
      ok: true,
      body: {
        getReader: () => {
          let readCount = 0;
          return {
            read: async () => {
              if (readCount === 0) {
                readCount++;
                return { done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"success"}}]}\n\ndata: [DONE]\n\n') };
              }
              return { done: true };
            }
          };
        }
      }
    };
  };

  let chunkResult = '';
  await runAnalysis({
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    parsedFiles: [],
    selectedModes: ['quickSummary'],
    onChunk: (text) => { chunkResult = text; },
    onComplete: (text) => { assert.equal(text, 'success') },
    onError: (err) => { assert.fail('Should not error: ' + err) }
  });

  assert.equal(callCount, 1);
})

test('AI Rate Limit: 429 Retry and Fallback', async (t) => {
  let callCount = 0;
  global.fetch = async (url, options) => {
    callCount++;
    const bodyObj = JSON.parse(options.body);
    
    // First call: Groq Llama 70b -> 429
    if (callCount === 1) {
      assert.equal(bodyObj.model, 'openai/gpt-oss-120b');
      return {
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '0' }),
        json: async () => ({ error: 'Rate limited' })
      };
    }
    // Second call: Groq Llama 70b -> 429 again
    if (callCount === 2) {
      assert.equal(bodyObj.model, 'openai/gpt-oss-120b');
      return {
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '0' }),
        json: async () => ({ error: 'Rate limited' })
      };
    }
    // Third call: Groq Llama 70b -> 429 again (max retries reached for this model)
    if (callCount === 3) {
      assert.equal(bodyObj.model, 'openai/gpt-oss-120b');
      return {
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '0' }),
        json: async () => ({ error: 'Rate limited' })
      };
    }
    // Fourth call: fallback to openai/gpt-oss-20b
    if (callCount === 4) {
      assert.equal(bodyObj.model, 'openai/gpt-oss-20b');
      return {
        ok: true,
        body: {
          getReader: () => {
            let readCount = 0;
            return {
              read: async () => {
                if (readCount === 0) {
                  readCount++;
                  return { done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"fallback_success"}}]}\n\ndata: [DONE]\n\n') };
                }
                return { done: true };
              }
            };
          }
        }
      };
    }
  };

  let chunks = [];
  await runAnalysis({
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    parsedFiles: [],
    selectedModes: ['quickSummary'],
    onChunk: (text) => { chunks.push(text) },
    onComplete: (text) => { assert.equal(text, 'fallback_success') },
    onError: (err) => { assert.fail('Should not error: ' + err) }
  });

  assert.equal(callCount, 4);
  assert.ok(chunks.some(c => c.includes('Retrying automatically')), 'Should yield retry messages');
  assert.ok(chunks.some(c => c.includes('openai/gpt-oss-120b is temporarily busy')), 'Should yield fallback message');
})

test('AI Rate Limit: Complete Outage', async (t) => {
  let callCount = 0;
  global.fetch = async (url, options) => {
    callCount++;
    return {
      ok: false,
      status: 500, // Non-429 error causes immediate fallback
      json: async () => ({ error: 'Internal Server Error' })
    };
  };

  let errorSeen = '';
  await runAnalysis({
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    parsedFiles: [],
    selectedModes: ['quickSummary'],
    onChunk: (text) => { },
    onComplete: (text) => { assert.fail('Should not complete on outage') },
    onError: (err) => { errorSeen = err; }
  });

  // It should try all 3 models in the fallback chain once (since 500 skips retries)
  assert.equal(callCount, 3);
  assert.ok(errorSeen.includes('AI analysis is temporarily unavailable'));
})
