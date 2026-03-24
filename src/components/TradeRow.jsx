import { fmtUsd, truncAddr, isZeroHash, HL_EXPLORER } from '../utils'

export default function TradeRow({ trade, animate }) {
  const isLong = trade.side === 'B'
  const isWhale = trade.size_usd >= 1_000_000
  const hash = trade.hash || ''
  const ta = trade.taker || ''
  const ma = trade.maker || ''

  let className = 'trade-row ' + (isLong ? 'long-row' : 'short-row')
  if (isWhale) className += ' whale'
  if (animate) className += isLong ? ' flash-long' : ' flash-short'

  return (
    <div className={className}>
      <div className="trade-time mono">{trade.time_str || ''}</div>
      <div className="trade-coin">
        {trade.coin}
        {isWhale && <span className="whale-badge">WHALE</span>}
      </div>
      <div>
        <span className={`trade-side ${isLong ? 'long' : 'short'}`}>
          {isLong ? '\u25B2 LONG' : '\u25BC SHORT'}
        </span>
      </div>
      <div className={`trade-size ${isLong ? 'long' : 'short'} mono`}>
        {fmtUsd(trade.size_usd)}
      </div>
      <div className="trade-price mono">
        ${Number(trade.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div className="trade-qty mono">
        {Number(trade.qty).toLocaleString(undefined, { maximumFractionDigits: 4 })}
      </div>
      <div className="trade-addr">
        {ta ? (
          <a href={`${HL_EXPLORER}/address/${ta}`} target="_blank" rel="noreferrer" title={ta}>
            {truncAddr(ta)}
          </a>
        ) : '-'}
      </div>
      <div className="trade-addr">
        {ma ? (
          <a href={`${HL_EXPLORER}/address/${ma}`} target="_blank" rel="noreferrer" title={ma}>
            {truncAddr(ma)}
          </a>
        ) : '-'}
      </div>
      <div className="trade-link">
        {!isZeroHash(hash) && (
          <a href={`${HL_EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer" title="View tx">
            &#8599;
          </a>
        )}
      </div>
    </div>
  )
}
