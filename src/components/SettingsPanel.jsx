import { useState, useMemo } from 'react'

export default function SettingsPanel({
  open,
  onClose,
  config,
  onSave,
  availableCoins,
  onTestTelegram,
}) {
  const [minSize, setMinSize] = useState(config.min_trade_size_usd || 100000)
  const [dirFilter, setDirFilter] = useState(config.direction_filter || 'all')
  const [selectedCoins, setSelectedCoins] = useState(new Set(config.coins || []))
  const [tgToken, setTgToken] = useState(config.telegram_bot_token || '')
  const [tgChat, setTgChat] = useState(config.telegram_chat_id || '')
  const [tgEnabled, setTgEnabled] = useState(config.telegram_enabled || false)
  const [tokenSearch, setTokenSearch] = useState('')
  const [saveNote, setSaveNote] = useState(false)

  const filteredCoins = useMemo(() => {
    const q = tokenSearch.trim().toUpperCase()
    if (!q) return availableCoins
    return availableCoins.filter(c => c.includes(q))
  }, [availableCoins, tokenSearch])

  function toggleCoin(coin) {
    setSelectedCoins(prev => {
      const next = new Set(prev)
      if (next.has(coin)) next.delete(coin)
      else next.add(coin)
      return next
    })
  }

  function handleSave() {
    const cfg = {
      min_trade_size_usd: parseInt(minSize) || 100000,
      coins: Array.from(selectedCoins),
      direction_filter: dirFilter,
      telegram_bot_token: tgToken.trim(),
      telegram_chat_id: tgChat.trim(),
      telegram_enabled: tgEnabled,
    }
    onSave(cfg)
    setSaveNote(true)
    setTimeout(() => setSaveNote(false), 3000)
  }

  function handleTest() {
    handleSave()
    setTimeout(() => onTestTelegram(), 300)
  }

  const selectedArr = Array.from(selectedCoins)

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
          <div className="section-title">Tokens to Track</div>

          <div className="token-picker">
            <div className="selected-tokens">
              {selectedArr.length === 0 ? (
                <span className="all-tag">ALL COINS</span>
              ) : (
                <>
                  {selectedArr.slice(0, 15).map(coin => (
                    <span key={coin} className="selected-token">
                      {coin}
                      <span className="remove" onClick={() => toggleCoin(coin)}>&times;</span>
                    </span>
                  ))}
                  {selectedArr.length > 15 && (
                    <span className="all-tag">+{selectedArr.length - 15} more</span>
                  )}
                </>
              )}
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
                <button className="btn btn-sm" onClick={() => setSelectedCoins(new Set())}>All</button>
                <button className="btn btn-sm" onClick={() => setSelectedCoins(new Set())}>Clear</button>
              </div>
            </div>
            <div className="token-grid">
              {filteredCoins.map(coin => (
                <div
                  key={coin}
                  className={`token-item${selectedCoins.has(coin) ? ' selected' : ''}`}
                  onClick={() => toggleCoin(coin)}
                >
                  {coin}
                </div>
              ))}
            </div>
            <div className="hint">Click tokens to select. Empty selection = track all coins.</div>
          </div>

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
            <label>Chat ID</label>
            <input
              type="text"
              value={tgChat}
              onChange={e => setTgChat(e.target.value)}
              placeholder="123456789"
            />
            <div className="hint">Message <b>@userinfobot</b> on Telegram to get your Chat ID</div>
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
