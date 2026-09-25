export default async function handler(req, res) {
  // Endpoint for Android companion apps to POST daily summaries
  // Expected JSON shape: { date: 'YYYY-MM-DD', summary: {...}, source: 'health_connect' }
  try {
    const payload = req.body
    console.log('Health Connect ingest received', payload?.date)
    
    if (!payload || !payload.date || !payload.summary || !payload.source) {
      return res.status(400).json({ error: 'Invalid payload structure. Expected date, summary, and source.' })
    }

    // TODO: Authenticate and persist to actual DB (blocked on external infrastructure setup). For now, returning success for valid payload.
    res.status(200).json({ message: 'Received valid payload, persistence pending infrastructure', received: payload })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
