import start from '../../src/apiHandlers/fitbit-start.js'
import callback from '../../src/apiHandlers/fitbit-callback.js'
import webhook from '../../src/apiHandlers/fitbit-webhook.js'

const handlers = { start, callback, webhook }

export default async function handler(req, res) {
  const routeHandler = handlers[req.query.action]
  if (!routeHandler) {
    return res.status(404).json({ error: 'Not found' })
  }
  return routeHandler(req, res)
}
