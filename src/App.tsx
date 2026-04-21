import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { fetchQuote } from './lib/quotes'
import type { Holding } from './types'
import './App.css'

const STORAGE_KEY = 'holdings-viewer-data-v2'

const CHART_COLORS = [
  '#6366f1',
  '#22c55e',
  '#f59e0b',
  '#ec4899',
  '#14b8a6',
  '#8b5cf6',
  '#ef4444',
  '#0ea5e9',
  '#84cc16',
  '#f97316',
]

function moneyFmt(currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  })
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `h-${Date.now()}-${Math.random()}`
}

function normalizeRaw(h: Partial<Holding>): Holding {
  const rawShares = Number(h.shares)
  const shares =
    Number.isFinite(rawShares) && rawShares > 0 ? rawShares : NaN
  return {
    id: h.id ?? makeId(),
    symbol: String(h.symbol ?? '').trim().toUpperCase() || '?',
    shares: Number.isFinite(shares) ? shares : 1,
  }
}

export default function App() {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [ready, setReady] = useState(false)
  const [symbol, setSymbol] = useState('')
  const [sharesStr, setSharesStr] = useState('')
  const [quoteBySymbol, setQuoteBySymbol] = useState(
    () => new Map<string, { price: number; currency: string }>(),
  )
  const [quoteErrors, setQuoteErrors] = useState<string[]>([])
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setHoldings(parsed.map((x) => normalizeRaw(x as Holding)))
          setReady(true)
          return
        }
      } catch {
        /* fall through */
      }
    }

    fetch('/holdings.json')
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setHoldings(data.map((x) => normalizeRaw(x as Holding)))
        }
      })
      .catch(() => setHoldings([]))
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!ready) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings))
  }, [holdings, ready])

  const quoteKey = useMemo(
    () =>
      [...new Set(holdings.map((h) => h.symbol.trim().toUpperCase()))]
        .filter(Boolean)
        .sort()
        .join(','),
    [holdings],
  )

  const refreshQuotes = useCallback(async () => {
    const syms = quoteKey.split(',').filter(Boolean)
    if (syms.length === 0) return

    setRefreshing(true)
    const errs: string[] = []

    const results = await Promise.all(
      syms.map(async (sym) => {
        try {
          const q = await fetchQuote(sym)
          return { sym, ok: true as const, q }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return { sym, ok: false as const, msg }
        }
      }),
    )

    setQuoteBySymbol((prev) => {
      const next = new Map(prev)
      for (const r of results) {
        if (r.ok) next.set(r.sym, r.q)
        else errs.push(`${r.sym}: ${r.msg}`)
      }
      return next
    })
    setQuoteErrors(errs)
    setRefreshing(false)
  }, [quoteKey])

  useEffect(() => {
    if (!ready || holdings.length === 0) return
    void refreshQuotes()
  }, [ready, quoteKey, refreshQuotes])

  const holdingValue = useCallback(
    (h: Holding) => {
      const sym = h.symbol.trim().toUpperCase()
      const q = quoteBySymbol.get(sym)
      if (!q) return null
      return h.shares * q.price
    },
    [quoteBySymbol],
  )

  const currencyMix = useMemo(() => {
    const cur = new Set<string>()
    for (const h of holdings) {
      const sym = h.symbol.trim().toUpperCase()
      const q = quoteBySymbol.get(sym)
      if (q?.currency) cur.add(q.currency)
    }
    return cur
  }, [holdings, quoteBySymbol])

  const primaryCurrency =
    currencyMix.size === 1 ? [...currencyMix][0]! : 'USD'

  const totalFmt = moneyFmt(primaryCurrency)

  const total = useMemo(() => {
    if (currencyMix.size > 1) return null
    let sum = 0
    let any = false
    for (const h of holdings) {
      const v = holdingValue(h)
      if (v != null) {
        sum += v
        any = true
      }
    }
    return any ? sum : null
  }, [holdings, holdingValue, currencyMix.size])

  const chartData = useMemo(() => {
    if (currencyMix.size > 1) return []
    return holdings
      .map((h) => {
        const v = holdingValue(h)
        if (v == null || v <= 0) return null
        return {
          key: h.id,
          name: h.symbol,
          fullLabel: h.symbol,
          value: v,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
  }, [holdings, holdingValue, currencyMix.size])

  const addHolding = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const shares = Number.parseFloat(sharesStr.replace(/,/g, ''))
      if (!Number.isFinite(shares) || shares <= 0) return
      setHoldings((prev) => [
        ...prev,
        normalizeRaw({
          symbol: symbol.trim() || '?',
          shares,
        }),
      ])
      setSymbol('')
      setSharesStr('')
    },
    [symbol, sharesStr],
  )

  const removeHolding = useCallback((id: string) => {
    setHoldings((prev) => prev.filter((h) => h.id !== id))
  }, [])

  const pieTooltip = useCallback(
    ({
      active,
      payload,
    }: {
      active?: boolean
      payload?: ReadonlyArray<{ payload?: { fullLabel?: string; value?: number } }>
    }) => {
      if (!active || !payload?.length) return null
      const p = payload[0].payload
      if (!p?.value) return null
      const denom = total ?? 0
      const pct = denom > 0 ? ((p.value / denom) * 100).toFixed(1) : '0'
      return (
        <div className="chart-tooltip">
          <div className="chart-tooltip-title">{p.fullLabel}</div>
          <div className="chart-tooltip-row">
            <span>Value</span>
            <strong>{totalFmt.format(p.value)}</strong>
          </div>
          <div className="chart-tooltip-row">
            <span>Share</span>
            <strong>{pct}%</strong>
          </div>
        </div>
      )
    },
    [total, totalFmt],
  )

  if (!ready) {
    return (
      <div className="app shell">
        <p className="muted">Loading holdings…</p>
      </div>
    )
  }

  const finnhubConfigured = Boolean(import.meta.env.VITE_FINNHUB_API_KEY)

  return (
    <div className="app">
      <header className="header">
        <h1>Portfolio holdings</h1>
        <p className="lede">
          Enter symbols and share counts; values use live quotes when you refresh.
          Quotes may be delayed (free data). Your list stays in this browser.
        </p>
        {!finnhubConfigured && (
          <p className="callout">
            For deployed sites, add a free{' '}
            <a href="https://finnhub.io/register" target="_blank" rel="noreferrer">
              Finnhub API key
            </a>{' '}
            as <code className="inline-code">VITE_FINNHUB_API_KEY</code> in your host
            env (local dev uses a Yahoo proxy automatically).
          </p>
        )}
      </header>

      {quoteErrors.length > 0 && (
        <div className="banner warn" role="alert">
          <strong>Some quotes failed:</strong>
          <ul>
            {quoteErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="layout">
        <section className="panel chart-panel" aria-labelledby="chart-heading">
          <h2 id="chart-heading">Allocation</h2>
          {currencyMix.size > 1 ? (
            <p className="muted empty-chart">
              Pie chart needs a single currency — your quotes returned{' '}
              {[...currencyMix].join(', ')}.
            </p>
          ) : chartData.length === 0 ? (
            <p className="muted empty-chart">
              Add holdings and refresh prices to see allocation (needs valid quotes).
            </p>
          ) : (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={112}
                    paddingAngle={2}
                    label={({ name, percent }) => {
                      const pct =
                        typeof percent === 'number'
                          ? (percent * 100).toFixed(0)
                          : '0'
                      return `${name} ${pct}%`
                    }}
                  >
                    {chartData.map((entry, i) => (
                      <Cell
                        key={entry.key}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={pieTooltip} />
                  <Legend
                    formatter={(value) => <span className="legend-text">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="total-bar">
            <span>Total</span>
            <strong>
              {total != null ? totalFmt.format(total) : '—'}
            </strong>
          </div>
          {currencyMix.size > 1 && (
            <p className="muted footnote">
              Totals mix {currencyMix.size} currencies — shown using {primaryCurrency}{' '}
              only when a single currency applies.
            </p>
          )}
        </section>

        <section className="panel" aria-labelledby="list-heading">
          <div className="panel-head">
            <h2 id="list-heading">Positions</h2>
            <button
              type="button"
              className="btn primary sm"
              onClick={() => void refreshQuotes()}
              disabled={refreshing || holdings.length === 0}
            >
              {refreshing ? 'Refreshing…' : 'Refresh prices'}
            </button>
          </div>

          <div className="table-wrap">
            <table className="holdings-table">
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col" className="num">
                    Shares
                  </th>
                  <th scope="col" className="num">
                    Price
                  </th>
                  <th scope="col" className="num">
                    Value
                  </th>
                  <th scope="col" className="num">
                    %
                  </th>
                  <th scope="col"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {holdings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No positions yet. Add one below.
                    </td>
                  </tr>
                ) : (
                  holdings.map((h) => {
                    const sym = h.symbol.trim().toUpperCase()
                    const q = quoteBySymbol.get(sym)
                    const rowVal = holdingValue(h)
                    const pct =
                      total != null && rowVal != null && total > 0
                        ? ((rowVal / total) * 100).toFixed(1)
                        : '—'
                    const rowMoney = q ? moneyFmt(q.currency) : totalFmt
                    return (
                      <tr key={h.id}>
                        <td className="sym">{h.symbol}</td>
                        <td className="num shares-cell">
                          {h.shares.toLocaleString(undefined, {
                            maximumFractionDigits: 6,
                          })}
                        </td>
                        <td className="num">
                          {q ? rowMoney.format(q.price) : '—'}
                        </td>
                        <td className="num">
                          {rowVal != null ? rowMoney.format(rowVal) : '—'}
                        </td>
                        <td className="num">{pct}%</td>
                        <td>
                          <button
                            type="button"
                            className="btn ghost danger"
                            onClick={() => removeHolding(h.id)}
                            aria-label={`Remove ${h.symbol}`}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <form className="add-form" onSubmit={addHolding}>
            <div className="form-row">
              <label className="flex-symbol">
                Symbol
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="e.g. VTI"
                  autoComplete="off"
                />
              </label>
              <label>
                Shares
                <input
                  inputMode="decimal"
                  value={sharesStr}
                  onChange={(e) => setSharesStr(e.target.value)}
                  placeholder="0"
                />
              </label>
              <button type="submit" className="btn primary">
                Add
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
