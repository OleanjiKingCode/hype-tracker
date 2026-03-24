import { useState, useMemo } from 'react'
import { fmtUsd } from '../utils'

const TIME_WINDOWS = [
  { label: '1H', ms: 60 * 60 * 1000 },
  { label: '4H', ms: 4 * 60 * 60 * 1000 },
  { label: '12H', ms: 12 * 60 * 60 * 1000 },
  { label: '24H', ms: 24 * 60 * 60 * 1000 },
]

// A trade is "contrarian" if 75%+ of recent volume was one direction
// and this trade goes the opposite way with significant size
const CONTRARIAN_RATIO = 0.75
const CONTRARIAN_MIN_USD = 250_000

export default function MarketIntel({ trades, expanded, onToggle }) {
  const [windowIdx, setWindowIdx] = useState(0)
  const windowMs = TIME_WINDOWS[windowIdx].ms

  const analysis = useMemo(() => {
    const now = Date.now()
    const cutoff = now - windowMs
    const recent = trades.filter(t => t.time >= cutoff)

    // Per-coin aggregation
    const coins = {}
    for (const t of recent) {
      if (!coins[t.coin]) {
        coins[t.coin] = { longVol: 0, shortVol: 0, count: 0, trades: [] }
      }
      const c = coins[t.coin]
      c.count++
      if (t.side === 'B') c.longVol += t.size_usd
      else c.shortVol += t.size_usd
      c.trades.push(t)
    }

    // Build sorted summary
    const summary = Object.entries(coins).map(([coin, data]) => {
      const total = data.longVol + data.shortVol
      const longPct = total > 0 ? data.longVol / total : 0.5
      const dominant = longPct >= 0.5 ? 'long' : 'short'
      return { coin, ...data, total, longPct, dominant }
    }).sort((a, b) => b.total - a.total)

    // Detect contrarian trades
    const contrarian = []
    for (const s of summary) {
      const { longPct, trades: coinTrades } = s
      // Check if there's a dominant direction
      if (longPct >= CONTRARIAN_RATIO || longPct <= (1 - CONTRARIAN_RATIO)) {
        const dominantDir = longPct >= CONTRARIAN_RATIO ? 'B' : 'A'
        // Find big trades going AGAINST the dominant direction
        for (const t of coinTrades) {
          if (t.side !== dominantDir && t.size_usd >= CONTRARIAN_MIN_USD) {
            contrarian.push({
              ...t,
              context: dominantDir === 'B'
                ? `${Math.round(longPct * 100)}% of ${s.coin} volume is longs, but this trade is a ${fmtUsd(t.size_usd)} SHORT`
                : `${Math.round((1 - longPct) * 100)}% of ${s.coin} volume is shorts, but this trade is a ${fmtUsd(t.size_usd)} LONG`,
            })
          }
        }
      }
    }
    contrarian.sort((a, b) => b.size_usd - a.size_usd)

    return { summary, contrarian, totalTrades: recent.length }
  }, [trades, windowMs])

  if (trades.length === 0) return null

  return (
    <div className="intel-panel">
      <div className="intel-header" onClick={onToggle}>
        <div className="intel-title">
          <span className="intel-icon">&#9889;</span>
          Market Intel
          {analysis.contrarian.length > 0 && (
            <span className="intel-alert-badge">{analysis.contrarian.length} contrarian</span>
          )}
        </div>
        <div className="intel-header-right">
          <div className="intel-window-btns" onClick={e => e.stopPropagation()}>
            {TIME_WINDOWS.map((w, i) => (
              <button
                key={w.label}
                className={`intel-window-btn${windowIdx === i ? ' active' : ''}`}
                onClick={() => setWindowIdx(i)}
              >
                {w.label}
              </button>
            ))}
          </div>
          <span className="intel-chevron">{expanded ? '\u25B2' : '\u25BC'}</span>
        </div>
      </div>

      {expanded && (
        <div className="intel-body">
          {/* Contrarian Alerts */}
          {analysis.contrarian.length > 0 && (
            <div className="intel-section">
              <div className="intel-section-title">&#9888; Contrarian Trades (Against the Flow)</div>
              <div className="intel-alerts">
                {analysis.contrarian.slice(0, 5).map((t, i) => (
                  <div key={i} className="intel-alert-row">
                    <span className={`intel-alert-side ${t.side === 'B' ? 'long' : 'short'}`}>
                      {t.side === 'B' ? '\u25B2' : '\u25BC'} {t.coin}
                    </span>
                    <span className="intel-alert-size">{fmtUsd(t.size_usd)}</span>
                    <span className="intel-alert-context">{t.context}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-coin Summary */}
          <div className="intel-section">
            <div className="intel-section-title">
              Volume by Coin ({TIME_WINDOWS[windowIdx].label} window, {analysis.totalTrades} trades)
            </div>
            <div className="intel-coins">
              {analysis.summary.length === 0 ? (
                <div className="intel-empty">No trades in this window yet</div>
              ) : (
                analysis.summary.map(s => {
                  const longW = Math.round(s.longPct * 100)
                  const shortW = 100 - longW
                  return (
                    <div key={s.coin} className="intel-coin-row">
                      <div className="intel-coin-name">{s.coin}</div>
                      <div className="intel-coin-vol">{fmtUsd(s.total)}</div>
                      <div className="intel-coin-bar">
                        <div className="intel-bar-fill long" style={{ width: `${longW}%` }} />
                        <div className="intel-bar-fill short" style={{ width: `${shortW}%` }} />
                      </div>
                      <div className="intel-coin-pcts">
                        <span className="green">{longW}%L</span>
                        <span className="red">{shortW}%S</span>
                      </div>
                      <div className="intel-coin-counts">{s.count} trades</div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
