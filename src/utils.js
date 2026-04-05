export const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws'
export const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
export const HL_EXPLORER = 'https://app.hyperliquid.xyz/explorer'
export const MAX_TRACKED_ALTS = 50

// Always subscribed — major coins + spot pairs for whale/contrarian/accumulation alerts
export const ALWAYS_TRACKED = [
  'BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'SUI', 'DOGE', 'LINK',
  'ONDO', 'ARB', 'PAXG', 'OP', 'AVAX', 'NEAR', 'APT', 'INJ',
  'RENDER', 'TIA', 'MKR', 'CRV', 'AERO', 'UNI', 'LTC', 'BCH',
  'ATOM', 'FIL', 'ICP', 'ADA', 'DOT', 'MATIC', 'BNB', 'AAVE',
  // Spot pairs
  'HYPE/USDC', 'BTC/USDC', 'ETH/USDC', 'SOL/USDC', 'PURR/USDC',
  'GLD/USDC', 'SUI/USDC', 'XRP/USDC', 'LINK/USDC', 'DOGE/USDC',
]

// Default small alts to track for alt volume detection (~40)
export const DEFAULT_ALTS = [
  // Meme / micro-cap
  'kPEPE', 'kSHIB', 'kBONK', 'kFLOKI', 'kNEIRO', 'kLUNC', 'kDOGS',
  'WIF', 'PENGU', 'PNUT', 'BRETT', 'POPCAT', 'TURBO', 'MEW',
  'FARTCOIN', 'BOME', 'MYRO', 'NOT', 'MOODENG', 'TRUMP',
  // AI / narrative
  'AI16Z', 'AIXBT', 'GRIFFAIN', 'ZEREBRO', 'VIRTUAL', 'GOAT',
  // Small-cap / newer listings
  'SEI', 'PURR', 'SPX', 'ANIME', 'DOOD', 'CHILLGUY',
  'HPOS', 'MELANIA', 'VINE', 'KAITO', 'LAUNCHCOIN',
  'BABY', 'JELLY', 'MON', 'HYPER', 'INIT', 'PUMP',
]

// Combined for backwards compat
export const DEFAULT_COINS = [...ALWAYS_TRACKED, ...DEFAULT_ALTS]

export function fmtUsd(v) {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K'
  return '$' + v.toFixed(2)
}

export function truncAddr(a) {
  if (!a || a.length < 12) return a || ''
  return a.slice(0, 6) + '...' + a.slice(-4)
}

export function isZeroHash(h) {
  return !h || h === '0x' + '0'.repeat(64)
}

let audioCtx = null
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  return audioCtx
}

export function resumeAudio() {
  getAudioCtx().resume()
}

export function playBeep(freq, dur) {
  try {
    const ctx = getAudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    gain.gain.value = 0.08
    osc.start()
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    osc.stop(ctx.currentTime + dur)
  } catch (e) { /* ignore */ }
}

export function loadConfig() {
  const defaults = {
    min_trade_size_usd: 100000,
    coins: [...DEFAULT_COINS],
    direction_filter: 'all',
    telegram_bot_token: '',
    telegram_chat_id: '',
    telegram_alert_chat_id: '',
    telegram_enabled: true,
    watched_wallets: [],
  }
  try {
    const saved = localStorage.getItem('hype-tracker-config')
    if (saved) {
      const cfg = JSON.parse(saved)
      // Always ensure ALWAYS_TRACKED coins are subscribed
      const coinSet = new Set(cfg.coins || [])
      for (const c of ALWAYS_TRACKED) coinSet.add(c)
      // Add default alts if user has none
      const hasAlts = [...coinSet].some(c => !c.includes('/') && !new Set(ALWAYS_TRACKED).has(c))
      if (!hasAlts) {
        for (const c of DEFAULT_ALTS) coinSet.add(c)
      }
      cfg.coins = [...coinSet]
      return { ...defaults, ...cfg }
    }
  } catch (e) { /* ignore */ }
  return defaults
}

export function saveConfig(cfg) {
  localStorage.setItem('hype-tracker-config', JSON.stringify(cfg))
}

export async function fetchAllCoins() {
  const [perpResp, spotResp] = await Promise.all([
    fetch(HL_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'meta' }),
    }),
    fetch(HL_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'spotMeta' }),
    }),
  ])

  const perpData = await perpResp.json()
  const spotData = await spotResp.json()

  // Perp coins: plain names like "BTC", "ETH"
  const perpCoins = (perpData.universe || []).map(a => a.name)

  // Spot/HIP3 coins: subscribed via @{index} format
  // We store them as { name: "PURR/USDC", wsName: "@1" } style
  const spotUniverse = spotData.universe || []
  const spotTokens = spotData.tokens || []
  const spotCoins = spotUniverse.map((pair) => {
    const tokens = pair.tokens || []
    const base = spotTokens[tokens[0]]?.name || `T${tokens[0]}`
    const quote = spotTokens[tokens[1]]?.name || 'USDC'
    const idx = pair.index ?? pair.name?.replace('@', '')
    return {
      displayName: (pair.name && !pair.name.startsWith('@')) ? pair.name : `${base}/${quote}`,
      wsName: `@${idx}`,
    }
  })

  return { perpCoins, spotCoins }
}

export async function sendTelegram(trade) {
  const resp = await fetch('/api/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trade }),
  })
  return resp.ok
}

export async function sendAlertTelegram(alert) {
  const resp = await fetch('/api/telegram-alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alert }),
  })
  return resp.ok
}
