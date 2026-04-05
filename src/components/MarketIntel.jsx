import { useState, useMemo } from "react";
import { fmtUsd, truncAddr, HL_EXPLORER } from "../utils";

const TIME_WINDOWS = [
  { label: "1H", ms: 60 * 60 * 1000 },
  { label: "4H", ms: 4 * 60 * 60 * 1000 },
  { label: "12H", ms: 12 * 60 * 60 * 1000 },
  { label: "24H", ms: 24 * 60 * 60 * 1000 },
];

const CONTRARIAN_RATIO = 0.75;
const CONTRARIAN_MIN_USD = 250_000;

// Must match alertEngine.js HEAVY_COINS
const HEAVY_COINS = [
  'BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'BNB', 'AAVE', 'LINK', 'DOGE',
  'SUI', 'AVAX', 'ONDO', 'ADA', 'DOT', 'MATIC', 'ARB', 'OP',
  'NEAR', 'APT', 'UNI', 'LTC', 'BCH', 'ATOM', 'FIL', 'ICP',
  'RENDER', 'INJ', 'TIA', 'MKR', 'CRV', 'AERO',
  'PAXG', 'GLD', 'SLV', 'UST',
];
const ALT_VOLUME_THRESHOLD = 1_000_000;
const ALT_WINDOW_MS = 5 * 60 * 60 * 1000; // 5 hours

function isSmallAlt(coin) {
  return !coin.includes('/') && !HEAVY_COINS.includes(coin);
}

export default function MarketIntel({ trades, expanded, onToggle }) {
  const [windowIdx, setWindowIdx] = useState(0);
  const [expandedWallets, setExpandedWallets] = useState(new Set());
  const windowMs = TIME_WINDOWS[windowIdx].ms;

  function toggleWallet(key) {
    setExpandedWallets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const analysis = useMemo(() => {
    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = trades.filter((t) => t.time >= cutoff);

    // Per-coin aggregation
    const coins = {};
    for (const t of recent) {
      if (!coins[t.coin]) {
        coins[t.coin] = { longVol: 0, shortVol: 0, count: 0, trades: [] };
      }
      const c = coins[t.coin];
      c.count++;
      if (t.side === "B") c.longVol += t.size_usd;
      else c.shortVol += t.size_usd;
      c.trades.push(t);
    }

    // Build sorted summary
    const summary = Object.entries(coins)
      .map(([coin, data]) => {
        const total = data.longVol + data.shortVol;
        const longPct = total > 0 ? data.longVol / total : 0.5;
        const dominant = longPct >= 0.5 ? "long" : "short";
        return { coin, ...data, total, longPct, dominant };
      })
      .sort((a, b) => b.total - a.total);

    // Detect contrarian trades and group by wallet
    const walletGroups = {};
    for (const s of summary) {
      const { longPct, trades: coinTrades, coin } = s;
      if (longPct >= CONTRARIAN_RATIO || longPct <= 1 - CONTRARIAN_RATIO) {
        const dominantDir = longPct >= CONTRARIAN_RATIO ? "B" : "A";
        const majorityPct =
          dominantDir === "B"
            ? Math.round(longPct * 100)
            : Math.round((1 - longPct) * 100);
        const majorityLabel = dominantDir === "B" ? "longed" : "shorted";

        for (const t of coinTrades) {
          if (t.side !== dominantDir && t.size_usd >= CONTRARIAN_MIN_USD) {
            const wallet = t.taker || "unknown";
            const key = `${wallet}-${coin}-${t.side}`;
            if (!walletGroups[key]) {
              walletGroups[key] = {
                wallet,
                coin,
                side: t.side,
                totalUsd: 0,
                tradeCount: 0,
                trades: [],
                majorityPct,
                majorityLabel,
              };
            }
            const g = walletGroups[key];
            g.totalUsd += t.size_usd;
            g.tradeCount++;
            g.trades.push(t);
          }
        }
      }
    }

    const walletAlerts = Object.values(walletGroups).sort(
      (a, b) => b.totalUsd - a.totalUsd,
    );

    // Alt volume spikes (5 hr window, independent of selected time window)
    const altCutoff = now - ALT_WINDOW_MS;
    const altTrades = trades.filter((t) => t.time >= altCutoff && isSmallAlt(t.coin));
    const altCoins = {};
    for (const t of altTrades) {
      if (!altCoins[t.coin]) {
        altCoins[t.coin] = { longVol: 0, shortVol: 0, count: 0, biggest: t };
      }
      const c = altCoins[t.coin];
      c.count++;
      if (t.side === "B") c.longVol += t.size_usd;
      else c.shortVol += t.size_usd;
      if (t.size_usd > c.biggest.size_usd) c.biggest = t;
    }
    const altSpikes = Object.entries(altCoins)
      .map(([coin, data]) => {
        const total = data.longVol + data.shortVol;
        const longPct = total > 0 ? Math.round((data.longVol / total) * 100) : 50;
        return { coin, ...data, total, longPct };
      })
      .filter((s) => s.total >= ALT_VOLUME_THRESHOLD)
      .sort((a, b) => b.total - a.total);

    return { summary, walletAlerts, altSpikes, totalTrades: recent.length };
  }, [trades, windowMs]);

  if (trades.length === 0) return null;

  const alertCount = analysis.walletAlerts.length;
  const altSpikeCount = analysis.altSpikes.length;

  return (
    <div className="intel-panel">
      <div className="intel-header" onClick={onToggle}>
        <div className="intel-title">
          <span className="intel-icon">&#9889;</span>
          Market Intel
          {alertCount > 0 && (
            <span className="intel-alert-badge">{alertCount} contrarian</span>
          )}
          {altSpikeCount > 0 && (
            <span className="intel-alt-badge">{altSpikeCount} alt spike{altSpikeCount !== 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="intel-header-right">
          <div
            className="intel-window-btns"
            onClick={(e) => e.stopPropagation()}
          >
            {TIME_WINDOWS.map((w, i) => (
              <button
                key={w.label}
                className={`intel-window-btn${windowIdx === i ? " active" : ""}`}
                onClick={() => setWindowIdx(i)}
              >
                {w.label}
              </button>
            ))}
          </div>
          <span className="intel-chevron">
            {expanded ? "\u25B2" : "\u25BC"}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="intel-body">
          {/* Alt Volume Spikes */}
          {altSpikeCount > 0 && (
            <div className="intel-section">
              <div className="intel-section-title">
                &#128293; Alt Volume Spikes (5hr window)
              </div>
              <div className="intel-alt-spikes">
                {analysis.altSpikes.map((s) => {
                  const shortPct = 100 - s.longPct;
                  const bigPrice = Number(s.biggest.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  return (
                    <div key={s.coin} className="intel-alt-card">
                      <div className="intel-alt-top">
                        <span className="intel-alt-coin">{s.coin}</span>
                        <span className="intel-alt-vol">{fmtUsd(s.total)}</span>
                      </div>
                      <div className="intel-alt-bar-wrap">
                        <div className="intel-coin-bar">
                          <div className="intel-bar-fill long" style={{ width: `${s.longPct}%` }} />
                          <div className="intel-bar-fill short" style={{ width: `${shortPct}%` }} />
                        </div>
                        <div className="intel-alt-pcts">
                          <span className="green">{s.longPct}%L</span>
                          <span className="red">{shortPct}%S</span>
                        </div>
                      </div>
                      <div className="intel-alt-meta">
                        <span>{s.count} trades</span>
                        <span>
                          Biggest: {s.biggest.side === 'B' ? '\u25B2' : '\u25BC'} {fmtUsd(s.biggest.size_usd)} @ ${bigPrice}
                          {' '}
                          <a
                            href={`${HL_EXPLORER}/address/${s.biggest.taker}`}
                            target="_blank"
                            rel="noreferrer"
                            className="intel-wallet-addr"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {truncAddr(s.biggest.taker)}
                          </a>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Contrarian Wallet Alerts */}
          {alertCount > 0 && (
            <div className="intel-section">
              <div className="intel-section-title">
                &#9888; Contrarian Activity (Against the Flow)
              </div>
              <div className="intel-alerts">
                {analysis.walletAlerts.slice(0, 8).map((g, i) => {
                  const sideLabel = g.side === "B" ? "LONG" : "SHORT";
                  const sideClass = g.side === "B" ? "long" : "short";
                  const key = `${g.wallet}-${g.coin}-${g.side}`;
                  const isExpanded = expandedWallets.has(key);
                  const isSameWallet = g.tradeCount > 1;

                  return (
                    <div key={i} className="intel-wallet-alert">
                      <div
                        className="intel-alert-row clickable"
                        onClick={() => isSameWallet && toggleWallet(key)}
                      >
                        <div className="intel-alert-main">
                          <a
                            href={`${HL_EXPLORER}/address/${g.wallet}`}
                            target="_blank"
                            rel="noreferrer"
                            className="intel-wallet-addr"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {truncAddr(g.wallet)}
                          </a>
                          <span className="intel-alert-text">
                            {" did "}
                            <span className={`intel-alert-size ${sideClass}`}>
                              {fmtUsd(g.totalUsd)} {sideLabel}
                            </span>
                            {" on "}
                            <b>{g.coin}</b>
                            {isSameWallet && ` in ${g.tradeCount} trades`}
                          </span>
                        </div>
                        <div className="intel-alert-context">
                          while {g.majorityPct}% of the market {g.majorityLabel}
                        </div>
                        {isSameWallet && (
                          <span className="intel-expand-btn">
                            {isExpanded
                              ? "\u25B2 hide"
                              : `\u25BC ${g.tradeCount} trades`}
                          </span>
                        )}
                      </div>

                      {/* Expanded trade details */}
                      {isExpanded && (
                        <div className="intel-trade-details">
                          {g.trades.map((t, j) => (
                            <div key={j} className="intel-trade-detail-row">
                              <span className="intel-detail-time">
                                {t.time_str}
                              </span>
                              <span
                                className={`intel-detail-size ${sideClass}`}
                              >
                                {fmtUsd(t.size_usd)}
                              </span>
                              <span className="intel-detail-price">
                                @ $
                                {Number(t.price).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                              <span className="intel-detail-qty">
                                {Number(t.qty).toLocaleString(undefined, {
                                  maximumFractionDigits: 4,
                                })}{" "}
                                {t.coin}
                              </span>
                              {t.hash && t.hash !== "0x" + "0".repeat(64) && (
                                <a
                                  href={`${HL_EXPLORER}/tx/${t.hash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="intel-detail-link"
                                >
                                  &#8599;
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Per-coin Summary */}
          <div className="intel-section">
            <div className="intel-section-title">
              Volume by Coin ({TIME_WINDOWS[windowIdx].label} window,{" "}
              {analysis.totalTrades} trades)
            </div>
            <div className="intel-coins">
              {analysis.summary.length === 0 ? (
                <div className="intel-empty">No trades in this window yet</div>
              ) : (
                analysis.summary.map((s) => {
                  const longW = Math.round(s.longPct * 100);
                  const shortW = 100 - longW;
                  return (
                    <div key={s.coin} className="intel-coin-row">
                      <div className="intel-coin-name">{s.coin}</div>
                      <div className="intel-coin-vol">{fmtUsd(s.total)}</div>
                      <div className="intel-coin-bar">
                        <div
                          className="intel-bar-fill long"
                          style={{ width: `${longW}%` }}
                        />
                        <div
                          className="intel-bar-fill short"
                          style={{ width: `${shortW}%` }}
                        />
                      </div>
                      <div className="intel-coin-pcts">
                        <span className="green">{longW}%L</span>
                        <span className="red">{shortW}%S</span>
                      </div>
                      <div className="intel-coin-counts">{s.count} trades</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
