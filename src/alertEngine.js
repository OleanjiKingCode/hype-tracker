// Alert Engine — monitors trades for 4 alert types
// Fires callbacks when alert conditions are met

const ALERT_COINS = ['BTC', 'ETH', 'HYPE', 'SOL', 'PAXG', 'GLD/USDC']
const WHALE_THRESHOLD = 700_000          // single trade $700K+
const CONTRARIAN_THRESHOLD = 600_000     // $600K+ against the flow
const CONTRARIAN_RATIO = 0.75            // 75%+ of volume one direction
const ACCUMULATION_WINDOW_MS = 30 * 60 * 1000  // 30 min rolling window
const ACCUMULATION_THRESHOLD = 500_000   // cumulative $ in window
const ACCUMULATION_MIN_TRADES = 3        // at least 3 separate entries
const DEDUP_COOLDOWN_MS = 5 * 60 * 1000  // don't repeat same alert within 5 min
const MIN_MAJOR_TRADE = 50_000           // only track $50K+ trades for major coin alerts

// Heavy/major coins excluded from alt volume detection
const HEAVY_COINS = [
  'BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'BNB', 'AAVE', 'LINK', 'DOGE',
  'SUI', 'AVAX', 'ONDO', 'ADA', 'DOT', 'MATIC', 'ARB', 'OP',
  'NEAR', 'APT', 'UNI', 'LTC', 'BCH', 'ATOM', 'FIL', 'ICP',
  'RENDER', 'INJ', 'TIA', 'MKR', 'CRV', 'AERO',
  // TradFi / commodities
  'PAXG', 'GLD', 'SLV', 'UST',
]
const ALT_VOLUME_WINDOW_MS = 5 * 60 * 60 * 1000  // 5 hour rolling window
const ALT_VOLUME_THRESHOLD = 1_000_000   // $1M cumulative in 5 hr window

// Rolling state (in-memory)
const recentTrades = []        // 30 min window (whale/contrarian/accumulation)
const altRecentTrades = []     // 5 hr window (alt volume detection)
const walletHistory = {}
const sentAlerts = new Map()

function isSpotPair(coin) {
  return coin.includes('/')
}

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
  const altCutoff = Date.now() - ALT_VOLUME_WINDOW_MS
  while (altRecentTrades.length > 0 && altRecentTrades[0].time < altCutoff) {
    altRecentTrades.shift()
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
  pruneOldData()

  // Store trade in 30 min window (whale/contrarian/accumulation) — only $100K+ for majors
  const wallet = trade.taker || ''
  if (trade.size_usd >= MIN_MAJOR_TRADE) {
    recentTrades.push(trade)
    if (wallet) {
      if (!walletHistory[wallet]) walletHistory[wallet] = []
      walletHistory[wallet].push(trade)
    }
  }

  // --- ALERT 4: Alt Volume Spike ($1M+ on small alts in 5 hr window) ---
  // Skip spot/HIP3 pairs, TradFi, and known heavy coins — only real small-cap perp alts
  if (!isSpotPair(trade.coin) && !HEAVY_COINS.includes(trade.coin)) {
    altRecentTrades.push(trade)
    const coinTrades = altRecentTrades.filter(t => t.coin === trade.coin)
    const totalVol = coinTrades.reduce((s, t) => s + t.size_usd, 0)

    if (totalVol >= ALT_VOLUME_THRESHOLD) {
      const key = `alt-volume-${trade.coin}`
      if (!isDuplicate(key)) {
        const longVol = coinTrades.reduce((s, t) => s + (t.side === 'B' ? t.size_usd : 0), 0)
        const shortVol = totalVol - longVol
        const tradeCount = coinTrades.length
        const biggest = coinTrades.reduce((max, t) => t.size_usd > max.size_usd ? t : max, coinTrades[0])
        sendFn({
          type: 'alt_volume',
          coin: trade.coin,
          totalVolume: totalVol,
          longVolume: longVol,
          shortVolume: shortVol,
          tradeCount,
          biggestTrade: biggest,
          latestTrade: trade,
        })
      }
    }
  }

  // Alerts 1-3 only apply to major coins
  if (!ALERT_COINS.includes(trade.coin)) return

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
        // Include individual trade details for the message
        const trades = walletTrades.map(t => ({
          size_usd: t.size_usd,
          price: t.price,
          qty: t.qty,
          time_str: t.time_str,
        }))
        const avgPrice = walletTrades.reduce((s, t) => s + t.price, 0) / count
        const totalQty = walletTrades.reduce((s, t) => s + t.qty, 0)
        sendFn({
          type: 'accumulation',
          trade,
          wallet,
          cumulative,
          tradeCount: count,
          timeSpanMin,
          coin: trade.coin,
          side: trade.side,
          trades,
          avgPrice,
          totalQty,
        })
      }
    }
  }
}
