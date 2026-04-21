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
const CASH_STORAGE_KEY = 'holdings-viewer-cash-v1'

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
  const shares = Number.isFinite(rawShares) && rawShares > 0 ? rawShares : NaN
  const rawAverageCost = Number(h.averageCost)
  const averageCost =
    Number.isFinite(rawAverageCost) && rawAverageCost >= 0 ? rawAverageCost : 0
  return {
    id: h.id ?? makeId(),
    symbol: String(h.symbol ?? '').trim().toUpperCase() || '?',
    shares: Number.isFinite(shares) ? shares : 1,
    averageCost,
  }
}

export default function App() {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [ready, setReady] = useState(false)
  const [symbol, setSymbol] = useState('')
  const [sharesStr, setSharesStr] = useState('')
  const [avgCostStr, setAvgCostStr] = useState('')
  const [cashStr, setCashStr] = useState('')
  const [cashValue, setCashValue] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSharesStr, setEditSharesStr] = useState('')
  const [editAvgCostStr, setEditAvgCostStr] = useState('')
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

    const loadCash = localStorage.getItem(CASH_STORAGE_KEY)
    if (loadCash) {
      const parsedCash = Number(loadCash)
      if (Number.isFinite(parsedCash) && parsedCash >= 0) {
        setCashValue(parsedCash)
        setCashStr(
          parsedCash > 0
            ? parsedCash.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : '',
        )
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

  useEffect(() => {
    if (!ready) return
    localStorage.setItem(CASH_STORAGE_KEY, String(cashValue))
  }, [cashValue, ready])

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
  }, [ready, quoteKey, refreshQuotes, holdings.length])

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

  const primaryCurrency = currencyMix.size === 1 ? [...currencyMix][0]! : 'USD'

  const totalFmt = moneyFmt(primaryCurrency)

  const total = useMemo(() => {
    if (currencyMix.size > 1) return null
    let sum = 0
    let any = cashValue > 0
    for (const h of holdings) {
      const v = holdingValue(h)
      if (v != null) {
        sum += v
        any = true
      }
    }
    if (cashValue > 0) sum += cashValue
    return any ? sum : null
  }, [holdings, holdingValue, currencyMix.size, cashValue])

  const chartData = useMemo(() => {
    if (currencyMix.size > 1) return []
    const rows = holdings
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
    if (cashValue > 0) {
      rows.push({
        key: 'cash',
        name: 'Cash',
        fullLabel: 'Cash',
        value: cashValue,
      })
    }
    return rows
  }, [holdings, holdingValue, currencyMix.size, cashValue])

  const addHolding = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const nextSymbol = symbol.trim()
      const shares = Number.parseFloat(sharesStr.replace(/,/g, ''))
      const averageCost = Number.parseFloat(avgCostStr.replace(/,/g, ''))
      if (!nextSymbol || !Number.isFinite(shares) || shares <= 0) return
      if (!Number.isFinite(averageCost) || averageCost < 0) return
      setHoldings((prev) => [
        ...prev,
        normalizeRaw({
          symbol: nextSymbol,
          shares,
          averageCost,
        }),
      ])
      setSymbol('')
      setSharesStr('')
      setAvgCostStr('')
    },
    [symbol, sharesStr, avgCostStr],
  )

  const saveCash = useCallback(() => {
    if (cashStr.trim() === '') return
    const parsedCash = Number.parseFloat(cashStr.replace(/,/g, ''))
    if (!Number.isFinite(parsedCash) || parsedCash < 0) {
      setCashValue(0)
      setCashStr('')
      return
    }
    setCashValue(parsedCash)
    setCashStr(parsedCash.toLocaleString(undefined, { maximumFractionDigits: 2 }))
  }, [cashStr])

  const startEdit = useCallback((h: Holding) => {
    setEditingId(h.id)
    setEditSharesStr(String(h.shares))
    setEditAvgCostStr(String(h.averageCost))
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditSharesStr('')
    setEditAvgCostStr('')
  }, [])

  const saveEdit = useCallback(
    (id: string) => {
      const shares = Number.parseFloat(editSharesStr.replace(/,/g, ''))
      const averageCost = Number.parseFloat(editAvgCostStr.replace(/,/g, ''))
      if (!Number.isFinite(shares) || shares <= 0) return
      if (!Number.isFinite(averageCost) || averageCost < 0) return
      setHoldings((prev) =>
        prev.map((h) => (h.id === id ? { ...h, shares, averageCost } : h)),
      )
      cancelEdit()
    },
    [editSharesStr, editAvgCostStr, cancelEdit],
  )

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

  return (
    <div className="app">
      <header className="header">
        <h1>Portfolio holdings</h1>
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
                        typeof percent === 'number' ? (percent * 100).toFixed(0) : '0'
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
            <strong>{total != null ? totalFmt.format(total) : '—'}</strong>
          </div>
          {currencyMix.size > 1 && (
            <p className="muted footnote">
              Totals mix {currencyMix.size} currencies — shown using {primaryCurrency}{' '}
              only when a single currency applies.
            </p>
          )}
        </section>

        <section className="panel positions-panel" aria-labelledby="list-heading">
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
                    Avg cost
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
                  <th scope="col">Quote</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {cashValue > 0 && (
                  <tr>
                    <td className="sym">CASH</td>
                    <td className="num shares-cell">—</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                    <td className="num">{totalFmt.format(cashValue)}</td>
                    <td className="num">
                      {total != null && total > 0
                        ? ((cashValue / total) * 100).toFixed(1)
                        : '—'}
                      %
                    </td>
                    <td className="status-cell">
                      <span className="pill ok">Cash</span>
                    </td>
                    <td></td>
                  </tr>
                )}
                {holdings.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      No positions yet. Add one below.
                    </td>
                  </tr>
                ) : (
                  holdings.map((h) => {
                    const isEditing = editingId === h.id
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
                          {isEditing ? (
                            <input
                              className="inline-input"
                              inputMode="decimal"
                              value={editSharesStr}
                              onChange={(e) => setEditSharesStr(e.target.value)}
                              aria-label={`Edit shares for ${h.symbol}`}
                            />
                          ) : (
                            h.shares.toLocaleString(undefined, {
                              maximumFractionDigits: 6,
                            })
                          )}
                        </td>
                        <td className="num">
                          {isEditing ? (
                            <input
                              className="inline-input"
                              inputMode="decimal"
                              value={editAvgCostStr}
                              onChange={(e) => setEditAvgCostStr(e.target.value)}
                              aria-label={`Edit average cost for ${h.symbol}`}
                            />
                          ) : (
                            rowMoney.format(h.averageCost)
                          )}
                        </td>
                        <td className="num">{q ? rowMoney.format(q.price) : '—'}</td>
                        <td className="num">
                          {rowVal != null ? rowMoney.format(rowVal) : '—'}
                        </td>
                        <td className="num">{pct}%</td>
                        <td className="status-cell">
                          {q ? (
                            <span className="pill ok">Live</span>
                          ) : (
                            <span className="pill">No quote</span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  className="btn ghost"
                                  onClick={() => saveEdit(h.id)}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="btn ghost"
                                  onClick={cancelEdit}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="btn ghost"
                                  onClick={() => startEdit(h)}
                                  aria-label={`Edit ${h.symbol}`}
                                >
                                  Edit
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <form className="add-form" onSubmit={addHolding}>
            <div className="form-row form-row-stock">
              <label className="flex-symbol">
                Symbol
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="e.g. VTI"
                  autoComplete="off"
                />
              </label>
              <label className="flex-compact">
                Shares
                <input
                  inputMode="decimal"
                  value={sharesStr}
                  onChange={(e) => setSharesStr(e.target.value)}
                  placeholder="0"
                />
              </label>
              <label className="flex-compact">
                Avg cost
                <input
                  inputMode="decimal"
                  value={avgCostStr}
                  onChange={(e) => setAvgCostStr(e.target.value)}
                  placeholder="0"
                />
              </label>
              <button type="submit" className="btn primary">
                Add stock
              </button>
            </div>
            <div className="form-row form-row-cash">
              <label className="flex-symbol">
                Cash
                <input
                  inputMode="decimal"
                  value={cashStr}
                  onChange={(e) => setCashStr(e.target.value)}
                  placeholder="0"
                />
              </label>
              <button type="button" className="btn primary" onClick={saveCash}>
                Save cash
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}

