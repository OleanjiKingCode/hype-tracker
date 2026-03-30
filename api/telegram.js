const HL_EXPLORER = 'https://app.hyperliquid.xyz/explorer'

function fmtUsd(v) {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K'
  return '$' + v.toFixed(2)
}

function truncAddr(a) {
  if (!a || a.length < 12) return a || ''
  return a.slice(0, 6) + '...' + a.slice(-4)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { trade } = req.body || {}

  if (!trade) {
    return res.status(400).json({ error: 'Missing trade' })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN || ''
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID || process.env.TELEGRAM_CHAT_ID || ''

  if (!token || !chatId) {
    return res.status(400).json({ error: 'Missing Telegram credentials' })
  }

  const isLong = trade.side === 'B'
  const sideEmoji = isLong ? '\uD83D\uDCC8' : '\uD83D\uDCC9'
  const sideText = isLong ? 'LONG (Buy)' : 'SHORT (Sell)'
  const sizeStr = fmtUsd(trade.size_usd)
  const isWhale = trade.size_usd >= 1_000_000

  const taker = trade.taker || ''
  const maker = trade.maker || ''
  const takerLink = taker
    ? `<a href="${HL_EXPLORER}/address/${taker}">${truncAddr(taker)}</a>`
    : 'N/A'
  const makerLink = maker
    ? `<a href="${HL_EXPLORER}/address/${maker}">${truncAddr(maker)}</a>`
    : 'N/A'

  const hashVal = trade.hash || ''
  const isZeroHash = hashVal === '0x' + '0'.repeat(64)
  const txLink = hashVal && !isZeroHash
    ? `\n\uD83D\uDD17 <a href="${HL_EXPLORER}/tx/${hashVal}">View Transaction</a>`
    : ''

  const icon = isWhale ? '\uD83D\uDC0B' : '\uD83D\uDD14'
  const label = isWhale ? 'WHALE ALERT' : 'BIG TRADE'

  const text = [
    `${icon} <b>${label}</b> \u2014 ${trade.coin}`,
    '',
    `${sideEmoji} <b>Direction:</b> ${sideText}`,
    `\uD83D\uDCB0 <b>Size:</b> ${sizeStr}`,
    `\uD83D\uDCB2 <b>Price:</b> $${Number(trade.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `\uD83D\uDCE6 <b>Quantity:</b> ${Number(trade.qty).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${trade.coin}`,
    `\u23F0 <b>Time:</b> ${trade.time_str} UTC`,
    '',
    `\uD83D\uDC64 <b>Taker:</b> ${takerLink}`,
    `\uD83D\uDC65 <b>Maker:</b> ${makerLink}${txLink}`,
  ].join('\n')

  const url = `https://api.telegram.org/bot${token}/sendMessage`

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })

    if (!resp.ok) {
      const body = await resp.text()
      return res.status(resp.status).json({ error: body })
    }

    return res.status(200).json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
