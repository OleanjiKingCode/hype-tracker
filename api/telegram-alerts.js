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

function formatWhale(alert) {
  const t = alert.trade
  const side = t.side === 'B' ? '\uD83D\uDCC8 LONG' : '\uD83D\uDCC9 SHORT'
  const price = Number(t.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return [
    `\uD83D\uDC0B <b>WHALE ALERT</b> \u2014 ${t.coin}`,
    '',
    `${side} \u2022 <b>${fmtUsd(t.size_usd)}</b>`,
    `\uD83D\uDCB2 Price: $${price}`,
    `\uD83D\uDCE6 Qty: ${Number(t.qty).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${t.coin}`,
    `\uD83D\uDC64 Taker: <a href="${HL_EXPLORER}/address/${t.taker}">${truncAddr(t.taker)}</a>`,
    `\uD83D\uDC65 Maker: <a href="${HL_EXPLORER}/address/${t.maker}">${truncAddr(t.maker)}</a>`,
    `\u23F0 ${t.time_str} UTC`,
  ].join('\n')
}

function formatContrarian(alert) {
  const t = alert.trade
  const traderSide = t.side === 'B' ? '\uD83D\uDCC8 LONG' : '\uD83D\uDCC9 SHORT'
  const price = Number(t.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return [
    `\u26A0\uFE0F <b>CONTRARIAN ALERT</b> \u2014 ${t.coin}`,
    '',
    `${traderSide} \u2022 <b>${fmtUsd(t.size_usd)}</b> AGAINST the market`,
    `\uD83D\uDCCA ${alert.majorityPct}% of volume is ${alert.majorityDir} but this trader went opposite`,
    `\uD83D\uDCB2 Price: $${price}`,
    `\uD83D\uDC64 Taker: <a href="${HL_EXPLORER}/address/${t.taker}">${truncAddr(t.taker)}</a>`,
    `\u23F0 ${t.time_str} UTC`,
  ].join('\n')
}

function formatAccumulation(alert) {
  const side = alert.side === 'B' ? '\uD83D\uDCC8 LONG' : '\uD83D\uDCC9 SHORT'
  const avgPrice = Number(alert.avgPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const totalQty = Number(alert.totalQty).toLocaleString(undefined, { maximumFractionDigits: 4 })

  const lines = [
    `\uD83D\uDD04 <b>ACCUMULATION ALERT</b> \u2014 ${alert.coin}`,
    '',
    `${side} \u2022 <b>${fmtUsd(alert.cumulative)}</b> total`,
    '',
    `\uD83D\uDCCA <b>Breakdown:</b>`,
    `  \u2022 Trades: <b>${alert.tradeCount}</b> entries`,
    `  \u2022 Avg Price: $${avgPrice}`,
    `  \u2022 Total Qty: ${totalQty} ${alert.coin}`,
    `  \u2022 Time Span: ${alert.timeSpanMin} min${alert.timeSpanMin !== 1 ? 's' : ''}`,
    '',
  ]

  // Show individual entries (last 8 max)
  const trades = alert.trades || []
  if (trades.length > 0) {
    lines.push(`\uD83D\uDCDD <b>Individual Entries:</b>`)
    const shown = trades.slice(-8)
    for (const t of shown) {
      lines.push(`  ${t.time_str} \u2014 ${fmtUsd(t.size_usd)} @ $${Number(t.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    }
    if (trades.length > 8) {
      lines.push(`  <i>...and ${trades.length - 8} more</i>`)
    }
    lines.push('')
  }

  lines.push(`\uD83D\uDC64 Wallet: <a href="${HL_EXPLORER}/address/${alert.wallet}">${truncAddr(alert.wallet)}</a>`)
  lines.push('')
  lines.push(`\uD83D\uDD0D This wallet is splitting a large position into multiple smaller entries`)

  return lines.join('\n')
}

function formatAltVolume(alert) {
  const longPct = alert.totalVolume > 0 ? Math.round((alert.longVolume / alert.totalVolume) * 100) : 0
  const shortPct = 100 - longPct
  const biggest = alert.biggestTrade
  const bigPrice = Number(biggest.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return [
    `\uD83D\uDEA8 <b>ALT VOLUME SPIKE</b> \u2014 ${alert.coin}`,
    '',
    `\uD83D\uDCB0 <b>${fmtUsd(alert.totalVolume)}</b> volume in 5 hrs`,
    `\uD83D\uDCCA ${alert.tradeCount} trades`,
    '',
    `\uD83D\uDCC8 Long: ${fmtUsd(alert.longVolume)} (${longPct}%)`,
    `\uD83D\uDCC9 Short: ${fmtUsd(alert.shortVolume)} (${shortPct}%)`,
    '',
    `\uD83C\uDFC6 <b>Biggest Trade:</b>`,
    `  ${biggest.side === 'B' ? '\uD83D\uDCC8 LONG' : '\uD83D\uDCC9 SHORT'} \u2022 ${fmtUsd(biggest.size_usd)} @ $${bigPrice}`,
    `  \uD83D\uDC64 <a href="${HL_EXPLORER}/address/${biggest.taker}">${truncAddr(biggest.taker)}</a>`,
    '',
    `\u23F0 ${alert.latestTrade.time_str} UTC`,
    '',
    `\uD83D\uDD0D Unusual volume detected on a low-cap alt`,
  ].join('\n')
}

const FORMATTERS = {
  whale: formatWhale,
  contrarian: formatContrarian,
  accumulation: formatAccumulation,
  alt_volume: formatAltVolume,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { alert } = req.body || {}
  if (!alert) {
    return res.status(400).json({ error: 'Missing alert' })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN || ''
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID || ''

  if (!token || !chatId) {
    return res.status(400).json({ error: 'Missing Telegram credentials' })
  }

  const formatter = FORMATTERS[alert.type] || formatWhale
  const text = formatter(alert)

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
