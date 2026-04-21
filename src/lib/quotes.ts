export type QuoteResult = {
  price: number
  currency: string
}

function parseYahooChart(json: unknown): QuoteResult {
  const root = json as {
    chart?: {
      error?: { description?: string }
      result?: Array<{ meta?: Record<string, unknown> }>
    }
  }
  const err = root.chart?.error?.description
  if (err) throw new Error(err)

  const meta = root.chart?.result?.[0]?.meta
  if (!meta) throw new Error('Unexpected quote response')

  const rm = meta.regularMarketPrice
  const pc = meta.chartPreviousClose ?? meta.previousClose
  let price = 0
  if (typeof rm === 'number' && rm > 0) price = rm
  else if (typeof pc === 'number' && pc > 0) price = pc

  if (!(price > 0)) throw new Error('No price in quote data')

  const currency =
    typeof meta.currency === 'string' && meta.currency.length > 0
      ? meta.currency
      : 'USD'

  return { price, currency }
}

/** Dev-only: same-origin proxy (see vite.config.ts). */
function yahooUrl(symbol: string): string {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`
  if (import.meta.env.DEV) return `/yahoo-proxy${path}`
  return `https://query1.finance.yahoo.com${path}`
}

async function fetchYahoo(symbol: string): Promise<QuoteResult> {
  const res = await fetch(yahooUrl(symbol))
  if (!res.ok) throw new Error(`Quote HTTP ${res.status}`)
  const json: unknown = await res.json()
  return parseYahooChart(json)
}

async function fetchFinnhub(symbol: string, token: string): Promise<QuoteResult> {
  const u = new URL('https://finnhub.io/api/v1/quote')
  u.searchParams.set('symbol', symbol)
  u.searchParams.set('token', token)
  const res = await fetch(u.toString())
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`)
  const j = (await res.json()) as { c?: number; d?: number }
  const c = j.c
  if (typeof c !== 'number' || !(c > 0)) {
    throw new Error('Finnhub returned no current price (market closed or bad symbol?)')
  }
  return { price: c, currency: 'USD' }
}

/**
 * Best-effort live quote. Prefer Finnhub when `VITE_FINNHUB_API_KEY` is set
 * (works in production without CORS issues). Otherwise Yahoo (dev proxy works;
 * production browser requests to Yahoo often fail — use Finnhub on the deployed site).
 */
export async function fetchQuote(symbol: string): Promise<QuoteResult> {
  const sym = symbol.trim().toUpperCase()
  if (!sym) throw new Error('Missing symbol')

  const finnhubKey = import.meta.env.VITE_FINNHUB_API_KEY as string | undefined
  if (finnhubKey) {
    return fetchFinnhub(sym, finnhubKey)
  }

  return fetchYahoo(sym)
}
