import { useState, useMemo } from 'react'
import { MAX_TRACKED_ALTS, DEFAULT_ALTS, ALWAYS_TRACKED } from '../utils'

export default function SettingsPanel({
  open,
  onClose,
  config,
  onSave,
  availableCoins,
  onTestTelegram,
}) {
  const alwaysSet = useMemo(() => new Set(ALWAYS_TRACKED), [])

  // Extract only alt coins from saved config (filter out always-tracked)
  const savedAlts = useMemo(() => {
    const coins = config.coins?.length ? config.coins : [...ALWAYS_TRACKED, ...DEFAULT_ALTS]
    return coins.filter(c => !alwaysSet.has(c))
  }, [config.coins, alwaysSet])

  const [minSize, setMinSize] = useState(config.min_trade_size_usd || 100000)
  const [dirFilter, setDirFilter] = useState(config.direction_filter || 'all')
  const [selectedAlts, setSelectedAlts] = useState(new Set(savedAlts))
  const [tgToken, setTgToken] = useState(config.telegram_bot_token || '')
  const [tgChat, setTgChat] = useState(config.telegram_chat_id || '')
  const [tgAlertChat, setTgAlertChat] = useState(config.telegram_alert_chat_id || '')
  const [tgEnabled, setTgEnabled] = useState(config.telegram_enabled || false)
  const [watchedWallets, setWatchedWallets] = useState(config.watched_wallets || [])
  const [walletInput, setWalletInput] = useState('')
  const [tokenSearch, setTokenSearch] = useState('')
  const [saveNote, setSaveNote] = useState(false)

  const atLimit = selectedAlts.size >= MAX_TRACKED_ALTS

  // Only show coins that aren't in ALWAYS_TRACKED and aren't spot pairs
  const filteredCoins = useMemo(() => {
    const altCoins = availableCoins.filter(c => !alwaysSet.has(c) && !c.includes('/'))
    const q = tokenSearch.trim().toUpperCase()
    if (!q) return altCoins
    return altCoins.filter(c => c.toUpperCase().includes(q))
  }, [availableCoins, tokenSearch, alwaysSet])

  function toggleCoin(coin) {
    setSelectedAlts(prev => {
      const next = new Set(prev)
      if (next.has(coin)) {
        next.delete(coin)
      } else {
        if (next.size >= MAX_TRACKED_ALTS) return prev
        next.add(coin)
      }
      return next
    })
  }

  function addWallet() {
    const addr = walletInput.trim()
    if (addr && !watchedWallets.includes(addr)) {
      setWatchedWallets(prev => [...prev, addr])
    }
    setWalletInput('')
  }

  function removeWallet(addr) {
    setWatchedWallets(prev => prev.filter(w => w !== addr))
  }

  function handleSave() {
    // Always include major coins + user-selected alts
    const alts = Array.from(selectedAlts)
    const coins = [...ALWAYS_TRACKED, ...alts]
    const cfg = {
      min_trade_size_usd: parseInt(minSize) || 100000,
      coins,
      direction_filter: dirFilter,
      telegram_bot_token: tgToken.trim(),
      telegram_chat_id: tgChat.trim(),
      telegram_alert_chat_id: tgAlertChat.trim(),
      telegram_enabled: tgEnabled,
      watched_wallets: watchedWallets,
    }
    onSave(cfg)
    setSaveNote(true)
    setTimeout(() => setSaveNote(false), 3000)
  }

  function handleTest() {
    handleSave()
    setTimeout(() => onTestTelegram(), 300)
  }

  function resetDefaults() {
    setSelectedAlts(new Set(DEFAULT_ALTS))
  }

  const selectedArr = Array.from(selectedAlts)

  return (
    <>
      <div className={`overlay${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`settings-panel${open ? ' open' : ''}`}>
        <div className="settings-header">
          <h2>&#9881; Settings</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="settings-body">
          {/* Trade Filters */}
          <div className="section-title">Trade Filters</div>

          <div className="field">
            <label>Minimum Trade Size (USD)</label>
            <input
              type="number"
              value={minSize}
              onChange={e => setMinSize(e.target.value)}
              step="10000"
              min="1000"
            />
            <div className="hint">Trades below this size are ignored</div>
          </div>

          <div className="field">
            <label>Direction Filter</label>
            <div className="direction-btns">
              {['all', 'long', 'short'].map(d => (
                <div
                  key={d}
                  className={`dir-btn${dirFilter === d ? ' active' : ''}`}
                  data-dir={d}
                  onClick={() => setDirFilter(d)}
                >
                  {d === 'all' ? 'All' : d === 'long' ? 'Longs Only' : 'Shorts Only'}
                </div>
              ))}
            </div>
            <div className="hint">Controls which trades trigger alerts and Telegram notifications</div>
          </div>

          {/* Token Picker */}
          <div className="section-title">
            Alt Tokens to Track
            <span style={{ float: 'right', fontSize: '11px', fontWeight: 400, color: atLimit ? 'var(--red)' : 'var(--text3)' }}>
              {selectedAlts.size}/{MAX_TRACKED_ALTS}
            </span>
          </div>

          <div className="token-picker">
            <div className="selected-tokens">
              {selectedArr.map(coin => (
                <span key={coin} className="selected-token">
                  {coin}
                  <span className="remove" onClick={() => toggleCoin(coin)}>&times;</span>
                </span>
              ))}
            </div>
            <div className="token-picker-header">
              <input
                type="text"
                className="token-search"
                placeholder="Search tokens..."
                value={tokenSearch}
                onChange={e => setTokenSearch(e.target.value)}
              />
              <div className="token-actions">
                <button className="btn btn-sm" onClick={resetDefaults}>Defaults</button>
                <button className="btn btn-sm" onClick={() => setSelectedAlts(new Set())}>Clear</button>
              </div>
            </div>
            <div className="token-grid">
              {filteredCoins.map(coin => (
                <div
                  key={coin}
                  className={
                    `token-item${selectedAlts.has(coin) ? ' selected' : ''}` +
                    (atLimit && !selectedAlts.has(coin) ? ' disabled' : '')
                  }
                  onClick={() => toggleCoin(coin)}
                >
                  {coin}
                </div>
              ))}
            </div>
            <div className="hint">
              Small alts for volume spike detection. Major coins (BTC, ETH, SOL, etc.) are always tracked.
              {atLimit && <b style={{ color: 'var(--yellow)' }}> Limit reached - remove one to add another.</b>}
            </div>
          </div>

          {/* Wallet Watchlist */}
          <div className="section-title">Wallet Watchlist</div>

          <div className="field">
            <label>Watch specific wallets (Telegram alerts)</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={walletInput}
                onChange={e => setWalletInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addWallet()}
                placeholder="0x... wallet address"
                style={{ flex: 1 }}
              />
              <button className="btn btn-sm" onClick={addWallet}>Add</button>
            </div>
            <div className="hint">
              Only trades involving these wallets trigger Telegram alerts. Empty = all wallets.
            </div>
          </div>

          {watchedWallets.length > 0 && (
            <div className="selected-tokens">
              {watchedWallets.map(addr => (
                <span key={addr} className="selected-token" style={{ fontSize: '11px' }}>
                  {addr.slice(0, 6)}...{addr.slice(-4)}
                  <span className="remove" onClick={() => removeWallet(addr)}>&times;</span>
                </span>
              ))}
            </div>
          )}

          {/* Telegram */}
          <div className="section-title">Telegram Notifications</div>

          <div className="field">
            <label>Bot Token</label>
            <input
              type="text"
              value={tgToken}
              onChange={e => setTgToken(e.target.value)}
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
            />
            <div className="hint">Create a bot via <b>@BotFather</b> on Telegram</div>
          </div>

          <div className="field">
            <label>Chat ID (general trade alerts)</label>
            <input
              type="text"
              value={tgChat}
              onChange={e => setTgChat(e.target.value)}
              placeholder="123456789"
            />
            <div className="hint">Message <b>@userinfobot</b> on Telegram to get your Chat ID</div>
          </div>

          <div className="field">
            <label>Alert Channel Chat ID (whale / contrarian / accumulation)</label>
            <input
              type="text"
              value={tgAlertChat}
              onChange={e => setTgAlertChat(e.target.value)}
              placeholder="@your_channel or -1001234567890"
            />
            <div className="hint">Dedicated channel for whale, contrarian, accumulation &amp; alt volume alerts. Leave empty to use the general Chat ID above.</div>
          </div>

          <div className="toggle-row">
            <span>Enable Telegram Alerts</span>
            <div
              className={`toggle${tgEnabled ? ' on' : ''}`}
              onClick={() => setTgEnabled(!tgEnabled)}
            />
          </div>

          <button className="btn" style={{ justifyContent: 'center' }} onClick={handleTest}>
            &#128276; Send Test Notification
          </button>

          <div className={`save-note${saveNote ? ' show' : ''}`}>
            Settings saved!
          </div>
        </div>
        <div className="settings-footer">
          <button className="btn btn-accent" onClick={handleSave}>Save Settings</button>
        </div>
      </div>
    </>
  )
}
