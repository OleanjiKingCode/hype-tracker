import { useState, useEffect, useRef, useCallback } from 'react'
import TradeRow from './components/TradeRow'
import SettingsPanel from './components/SettingsPanel'
import MarketIntel from './components/MarketIntel'
import {
  fmtUsd, playBeep, resumeAudio, loadConfig, saveConfig,
  fetchAllCoins, sendTelegram, HL_WS_URL, DEFAULT_COINS,
} from './utils'

const MAX_TRADES = 500
const SIZE_OPTIONS = [50000, 100000, 250000, 500000, 1000000]
const SIZE_LABELS = ['$50K', '$100K', '$250K', '$500K', '$1M']

export default function App() {
  const [trades, setTrades] = useState([])
  const [stats, setStats] = useState({
    total_trades: 0, total_volume: 0, long_volume: 0, short_volume: 0,
  })
  const [connected, setConnected] = useState(false)
  const [config, setConfig] = useState(loadConfig)
  const [availableCoins, setAvailableCoins] = useState([])  // display names for settings picker
  const [spotMap, setSpotMap] = useState({})                // wsName -> displayName, e.g. "@1" -> "PURR/USDC"
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [soundOn, setSoundOn] = useState(false)
  const [localMinSize, setLocalMinSize] = useState(100000)
  const [localSideFilter, setLocalSideFilter] = useState('all')
  const [walletFilter, setWalletFilter] = useState('')
  const [intelExpanded, setIntelExpanded] = useState(true)

  const wsRef = useRef(null)
  const configRef = useRef(config)
  const statsRef = useRef(stats)
  const tradesRef = useRef(trades)
  const soundRef = useRef(soundOn)
  const spotMapRef = useRef(spotMap)

  // Track coins key to trigger WS reconnect when coins change
  const coinsKey = (config.coins || []).sort().join(',')

  // Keep refs in sync
  useEffect(() => { configRef.current = config }, [config])
  useEffect(() => { statsRef.current = stats }, [stats])
  useEffect(() => { tradesRef.current = trades }, [trades])
  useEffect(() => { soundRef.current = soundOn }, [soundOn])
  useEffect(() => { spotMapRef.current = spotMap }, [spotMap])

  // Fetch available coins on mount
  useEffect(() => {
    fetchAllCoins().then(({ perpCoins, spotCoins }) => {
      // Build spot wsName -> displayName map
      const map = {}
      spotCoins.forEach(s => { map[s.wsName] = s.displayName })
      setSpotMap(map)
      // Combine for settings picker: perps + spot display names
      const allNames = [...perpCoins, ...spotCoins.map(s => s.displayName)]
      setAvailableCoins(allNames)
    }).catch(() => {})
  }, [])

  // Process a single trade from WS
  const processTrade = useCallback((t) => {
    const rawCoin = t.coin || '???'
    // Resolve spot @index names to display names (e.g. "@1" -> "PURR/USDC")
    const coin = rawCoin.startsWith('@') ? (spotMapRef.current[rawCoin] || rawCoin) : rawCoin
    const price = parseFloat(t.px || 0)
    const qty = parseFloat(t.sz || 0)
    const side = t.side || '?'
    const sizeUsd = price * qty

    const cfg = configRef.current
    const minSize = cfg.min_trade_size_usd || 100000
    if (sizeUsd < minSize) return

    const dirFilter = cfg.direction_filter || 'all'
    if (dirFilter === 'long' && side !== 'B') return
    if (dirFilter === 'short' && side === 'B') return

    const timestamp = t.time || 0
    const timeStr = timestamp
      ? new Date(timestamp).toLocaleTimeString([], { hour12: false })
      : new Date().toLocaleTimeString([], { hour12: false })

    const users = t.users || []
    const trade = {
      id: `${timestamp}-${coin}-${price}-${qty}-${Math.random()}`,
      coin,
      side,
      price,
      qty,
      size_usd: sizeUsd,
      hash: t.hash || '',
      taker: users[0] || '',
      maker: users[1] || '',
      time: timestamp,
      time_str: timeStr,
    }

    // Update stats
    setStats(prev => ({
      total_trades: prev.total_trades + 1,
      total_volume: prev.total_volume + sizeUsd,
      long_volume: prev.long_volume + (side === 'B' ? sizeUsd : 0),
      short_volume: prev.short_volume + (side !== 'B' ? sizeUsd : 0),
    }))

    // Add trade
    setTrades(prev => {
      const next = [trade, ...prev]
      if (next.length > MAX_TRADES) next.length = MAX_TRADES
      return next
    })

    // Sound
    if (soundRef.current) {
      if (sizeUsd >= 1e6) {
        playBeep(880, 0.3)
        setTimeout(() => playBeep(1100, 0.3), 150)
      } else {
        playBeep(660, 0.15)
      }
    }

    // Telegram (fire and forget)
    if (cfg.telegram_enabled && cfg.telegram_bot_token && cfg.telegram_chat_id) {
      const watchedWallets = (cfg.watched_wallets || []).map(w => w.toLowerCase())
      const takerLower = trade.taker.toLowerCase()
      const makerLower = trade.maker.toLowerCase()
      const walletMatch = watchedWallets.length === 0 ||
        watchedWallets.some(w => takerLower.includes(w) || makerLower.includes(w))
      if (walletMatch) {
        sendTelegram(trade, cfg).catch(() => {})
      }
    }
  }, [])

  // WebSocket connection
  useEffect(() => {
    let ws = null
    let reconnectTimer = null
    let delay = 5000
    let destroyed = false

    async function connect() {
      if (destroyed) return

      // Determine which coins to subscribe to (perps + spot pairs)
      let wsCoins = []
      const cfg = configRef.current
      const userCoins = cfg.coins && cfg.coins.length > 0 ? cfg.coins : DEFAULT_COINS

      try {
        const { spotCoins } = await fetchAllCoins()
        // Build reverse map: displayName -> wsName for spot
        const reverseSpot = {}
        spotCoins.forEach(s => { reverseSpot[s.displayName] = s.wsName })
        // Resolve spot display names to ws names
        wsCoins = userCoins.map(c => reverseSpot[c] || c)
      } catch {
        wsCoins = userCoins
      }

      if (destroyed) return

      try {
        ws = new WebSocket(HL_WS_URL)
        wsRef.current = ws

        ws.onopen = () => {
          setConnected(true)
          delay = 5000

          // Subscribe in batches
          const batchSize = 50
          let i = 0
          function sendBatch() {
            if (destroyed || ws.readyState !== WebSocket.OPEN) return
            const batch = wsCoins.slice(i, i + batchSize)
            batch.forEach(coin => {
              ws.send(JSON.stringify({
                method: 'subscribe',
                subscription: { type: 'trades', coin },
              }))
            })
            i += batchSize
            if (i < wsCoins.length) setTimeout(sendBatch, 200)
          }
          sendBatch()
        }

        ws.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data)
            if (data.channel === 'trades' && data.data) {
              data.data.forEach(processTrade)
            }
          } catch { /* ignore parse errors */ }
        }

        ws.onclose = () => {
          setConnected(false)
          wsRef.current = null
          if (!destroyed) {
            reconnectTimer = setTimeout(() => {
              delay = Math.min(delay * 2, 60000)
              connect()
            }, delay)
          }
        }

        ws.onerror = () => {
          ws.close()
        }
      } catch {
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, delay)
        }
      }
    }

    connect()

    return () => {
      destroyed = true
      clearTimeout(reconnectTimer)
      if (ws) ws.close()
    }
  }, [processTrade, coinsKey])

  // Config handlers
  function handleSaveConfig(cfg) {
    setConfig(cfg)
    saveConfig(cfg)
  }

  function handleTestTelegram() {
    const testTrade = {
      coin: 'BTC',
      side: 'B',
      price: 71000.0,
      qty: 14.08,
      size_usd: 1000000,
      hash: '0xtest',
      taker: '0x1234567890abcdef1234567890abcdef12345678',
      maker: '0xabcdef1234567890abcdef1234567890abcdef12',
      time: 0,
      time_str: new Date().toLocaleTimeString([], { hour12: false }),
    }
    sendTelegram(testTrade, configRef.current).catch(() => {})
  }

  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    if (next) resumeAudio()
  }

  // Compute filtered trades for display
  const walletQuery = walletFilter.trim().toLowerCase()
  const visibleTrades = trades.filter(t => {
    if (localSideFilter === 'long' && t.side !== 'B') return false
    if (localSideFilter === 'short' && t.side === 'B') return false
    if (t.size_usd < localMinSize) return false
    if (walletQuery) {
      const taker = (t.taker || '').toLowerCase()
      const maker = (t.maker || '').toLowerCase()
      if (!taker.includes(walletQuery) && !maker.includes(walletQuery)) return false
    }
    return true
  })

  // Compute ratio
  const totalVol = stats.long_volume + stats.short_volume
  const longPct = totalVol > 0 ? Math.round(stats.long_volume / totalVol * 100) : 0
  const shortPct = totalVol > 0 ? 100 - longPct : 0

  // Active coins display
  const activeCoins = config.coins && config.coins.length > 0 ? config.coins : DEFAULT_COINS

  return (
    <div className="app">
      {/* Top Bar */}
      <div className="topbar">
        <div className="logo">
          <div className="logo-icon">W</div>
          <div>
            <h1>WHALE TRACKER</h1>
            <span>Hyperliquid Perps + Spot</span>
          </div>
        </div>
        <div className="topbar-right">
          <div className="status">
            <div className={`status-dot${connected ? ' live' : ''}`} />
            <span>{connected ? 'Live' : 'Connecting...'}</span>
          </div>
          <button
            className={`sound-toggle${soundOn ? ' on' : ''}`}
            onClick={toggleSound}
            title="Toggle sound"
            dangerouslySetInnerHTML={{ __html: soundOn ? '&#128266;' : '&#128264;' }}
          />
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            &#9881; Settings
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="stats-bar">
        <div className="stat">
          <div className="stat-label">Trades Detected</div>
          <div className="stat-value">{stats.total_trades.toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Total Volume</div>
          <div className="stat-value">{fmtUsd(stats.total_volume)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Long Volume</div>
          <div className="stat-value green">{fmtUsd(stats.long_volume)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Short Volume</div>
          <div className="stat-value red">{fmtUsd(stats.short_volume)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Long / Short</div>
          <div
            className="stat-value"
            style={{ color: totalVol > 0 ? (longPct >= 50 ? 'var(--green)' : 'var(--red)') : undefined }}
          >
            {totalVol > 0 ? `${longPct}% / ${shortPct}%` : '-'}
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="filters-bar">
        <span className="filter-label">Min Size</span>
        <div className="filter-chips">
          {SIZE_OPTIONS.map((size, i) => (
            <div
              key={size}
              className={`chip${localMinSize === size ? ' active' : ''}`}
              onClick={() => setLocalMinSize(size)}
            >
              {SIZE_LABELS[i]}
            </div>
          ))}
        </div>
        <div className="filter-divider" />
        <span className="filter-label">Side</span>
        <div className="side-filter">
          {['all', 'long', 'short'].map(s => (
            <div
              key={s}
              className={`side-btn${localSideFilter === s ? ' active' : ''}`}
              data-side={s}
              onClick={() => setLocalSideFilter(s)}
            >
              {s === 'all' ? 'All' : s === 'long' ? 'Longs' : 'Shorts'}
            </div>
          ))}
        </div>
        <div className="filter-divider" />
        <span className="filter-label">Wallet</span>
        <input
          type="text"
          className="wallet-filter-input"
          placeholder="Filter by wallet address..."
          value={walletFilter}
          onChange={e => setWalletFilter(e.target.value)}
        />
        <div className="filter-divider" />
        <span className="filter-label">Tracking</span>
        <div className="active-coins-bar">
          {activeCoins.slice(0, 8).map(c => (
            <span key={c} className="coin-tag">{c}</span>
          ))}
          {activeCoins.length > 8 && (
            <span className="coin-tag-all">+{activeCoins.length - 8}</span>
          )}
        </div>
      </div>

      {/* Market Intelligence */}
      <MarketIntel
        trades={trades}
        expanded={intelExpanded}
        onToggle={() => setIntelExpanded(e => !e)}
      />

      {/* Trade Feed */}
      <div className="feed-container">
        <div className="feed-header">
          <div>Time</div>
          <div>Coin</div>
          <div>Side</div>
          <div>Size</div>
          <div>Price</div>
          <div>Quantity</div>
          <div>Taker</div>
          <div>Maker</div>
          <div></div>
        </div>
        <div className="feed">
          {visibleTrades.length === 0 ? (
            <div className="empty-state">
              <div className="icon">&#128051;</div>
              <p>Waiting for whale trades...</p>
              <p style={{ fontSize: '12px', color: 'var(--text3)' }}>
                Large trades will appear here in real-time
              </p>
            </div>
          ) : (
            visibleTrades.map((t, i) => (
              <TradeRow key={t.id} trade={t} animate={i === 0} />
            ))
          )}
        </div>
      </div>

      {/* Settings */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        onSave={handleSaveConfig}
        availableCoins={availableCoins}
        onTestTelegram={handleTestTelegram}
      />
    </div>
  )
}
