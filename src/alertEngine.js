// Alert Engine — monitors trades for 3 alert types on 5 key coins
// Fires callbacks when alert conditions are met

const ALERT_COINS = ['BTC', 'ETH', 'HYPE', 'SOL', 'GOVE']
const WHALE_THRESHOLD = 700_000          // single trade $700K+
const CONTRARIAN_THRESHOLD = 600_000     // $600K+ against the flow
const CONTRARIAN_RATIO = 0.75            // 75%+ of volume one direction
const ACCUMULATION_WINDOW_MS = 30 * 60 * 1000  // 30 min rolling window
const ACCUMULATION_THRESHOLD = 500_000   // cumulative $ in window
const ACCUMULATION_MIN_TRADES = 3        // at least 3 separate entries
const DEDUP_COOLDOWN_MS = 5 * 60 * 1000  // don't repeat same alert within 5 min

// Rolling state (in-memory)
const recentTrades = []
const walletHistory = {}
const sentAlerts = new Map()

function isDuplicate(key) {
  const last = sentAlerts.get(key)
  if (last && Date.now() - last < DEDUP_COOLDOWN_MS) return true
  sentAlerts.set(key, Date.now())
  return false
}

function pruneOldData() {
  const cutoff = Date.now() - ACCUMULATION_WINDOW_MS
  while (recentTrades.length > 0 && recentTrades[0].time < cutoff) {
    recentTrades.shift()
  }
  for (const wallet of Object.keys(walletHistory)) {
    walletHistory[wallet] = walletHistory[wallet].filter(t => t.time >= cutoff)
    if (walletHistory[wallet].length === 0) delete walletHistory[wallet]
  }
  for (const [key, ts] of sentAlerts) {
    if (Date.now() - ts > DEDUP_COOLDOWN_MS) sentAlerts.delete(key)
  }
}

export function checkAlerts(trade, sendFn) {
  if (!ALERT_COINS.includes(trade.coin)) return

  pruneOldData()

  // Store trade in rolling window
  recentTrades.push(trade)
  const wallet = trade.taker || ''
  if (wallet) {
    if (!walletHistory[wallet]) walletHistory[wallet] = []
    walletHistory[wallet].push(trade)
  }

  // --- ALERT 1: Whale ($700K+ single trade) ---
  if (trade.size_usd >= WHALE_THRESHOLD) {
    const key = `whale-${trade.coin}-${wallet}-${trade.side}`
    if (!isDuplicate(key)) {
      sendFn({ type: 'whale', trade })
    }
  }

  // --- ALERT 2: Contrarian ($600K+ against the flow) ---
  if (trade.size_usd >= CONTRARIAN_THRESHOLD) {
    const coinTrades = recentTrades.filter(t => t.coin === trade.coin)
    const longVol = coinTrades.reduce((s, t) => s + (t.side === 'B' ? t.size_usd : 0), 0)
    const totalVol = coinTrades.reduce((s, t) => s + t.size_usd, 0)
    const longRatio = totalVol > 0 ? longVol / totalVol : 0.5

    const marketIsLong = longRatio >= CONTRARIAN_RATIO
    const marketIsShort = longRatio <= (1 - CONTRARIAN_RATIO)

    if ((marketIsLong && trade.side !== 'B') || (marketIsShort && trade.side === 'B')) {
      const majorityPct = marketIsLong
        ? Math.round(longRatio * 100)
        : Math.round((1 - longRatio) * 100)
      const majorityDir = marketIsLong ? 'LONG' : 'SHORT'
      const key = `contrarian-${trade.coin}-${wallet}-${trade.side}`
      if (!isDuplicate(key)) {
        sendFn({ type: 'contrarian', trade, majorityPct, majorityDir })
      }
    }
  }

  // --- ALERT 3: Accumulation (same wallet, multiple entries in 5-30 min) ---
  if (wallet) {
    const walletTrades = walletHistory[wallet]
      .filter(t => t.coin === trade.coin && t.side === trade.side)
    const cumulative = walletTrades.reduce((s, t) => s + t.size_usd, 0)
    const count = walletTrades.length

    if (count >= ACCUMULATION_MIN_TRADES && cumulative >= ACCUMULATION_THRESHOLD) {
      const key = `accum-${wallet}-${trade.coin}-${trade.side}`
      if (!isDuplicate(key)) {
        const timeSpanMin = Math.round(
          (walletTrades[walletTrades.length - 1].time - walletTrades[0].time) / 60000
        )
        sendFn({
          type: 'accumulation',
          trade,
          wallet,
          cumulative,
          tradeCount: count,
          timeSpanMin,
          coin: trade.coin,
          side: trade.side,
        })
      }
    }
  }
}
