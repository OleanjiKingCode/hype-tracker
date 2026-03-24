#!/usr/bin/env python3
"""
Hyperliquid Whale Trade Tracker
Web dashboard + Telegram notifications for massive longs & shorts.
No API key required — 100% free Hyperliquid public API.
"""

import asyncio
import json
import sys
from datetime import datetime, timezone
from typing import List, Dict, Set
from pathlib import Path

import aiohttp
from aiohttp import web
import websockets

# ────────────────────────────────────────────────────────
# Configuration
# ────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"

DEFAULT_CONFIG = {
    "min_trade_size_usd": 100_000,
    "coins": [],
    "direction_filter": "all",  # "all", "long", "short"
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    "telegram_enabled": False,
}

HL_WS_URL = "wss://api.hyperliquid.xyz/ws"
HL_INFO_URL = "https://api.hyperliquid.xyz/info"
HL_EXPLORER = "https://app.hyperliquid.xyz/explorer"


def load_config() -> dict:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            saved = json.load(f)
        return {**DEFAULT_CONFIG, **saved}
    return DEFAULT_CONFIG.copy()


def save_config(cfg: dict):
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)


# ────────────────────────────────────────────────────────
# Global State
# ────────────────────────────────────────────────────────

config = load_config()
available_coins: List[str] = []  # populated on startup
browser_clients: Set[web.WebSocketResponse] = set()
trade_history: List[Dict] = []
stats = {
    "total_trades": 0,
    "total_volume": 0.0,
    "long_volume": 0.0,
    "short_volume": 0.0,
    "connected": False,
}


# ────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────

def fmt_usd(v: float) -> str:
    if v >= 1_000_000:
        return f"${v / 1_000_000:,.2f}M"
    if v >= 1_000:
        return f"${v / 1_000:,.1f}K"
    return f"${v:,.2f}"


def truncate_addr(addr: str) -> str:
    if len(addr) > 12:
        return addr[:6] + "..." + addr[-4:]
    return addr


# ────────────────────────────────────────────────────────
# Telegram
# ────────────────────────────────────────────────────────

async def send_telegram(trade: Dict):
    if not config.get("telegram_enabled"):
        return
    token = config.get("telegram_bot_token", "").strip()
    chat_id = config.get("telegram_chat_id", "").strip()
    if not token or not chat_id:
        return

    side_emoji = "\U0001f4c8" if trade["side"] == "B" else "\U0001f4c9"
    side_text = "LONG (Buy)" if trade["side"] == "B" else "SHORT (Sell)"
    size_str = fmt_usd(trade["size_usd"])
    whale = trade["size_usd"] >= 1_000_000

    taker = trade.get("taker", "")
    maker = trade.get("maker", "")
    taker_link = f'<a href="{HL_EXPLORER}/address/{taker}">{truncate_addr(taker)}</a>' if taker else "N/A"
    maker_link = f'<a href="{HL_EXPLORER}/address/{maker}">{truncate_addr(maker)}</a>' if maker else "N/A"

    hash_val = trade.get("hash", "")
    is_zero_hash = hash_val == "0x" + "0" * 64
    tx_link = ""
    if hash_val and not is_zero_hash:
        tx_link = f'\n\U0001f517 <a href="{HL_EXPLORER}/tx/{hash_val}">View Transaction</a>'

    icon = "\U0001f40b" if whale else "\U0001f514"
    label = "WHALE ALERT" if whale else "BIG TRADE"
    text = (
        f"{icon} "
        f"<b>{label}</b> — {trade['coin']}\n\n"
        f"{side_emoji} <b>Direction:</b> {side_text}\n"
        f"\U0001f4b0 <b>Size:</b> {size_str}\n"
        f"\U0001f4b2 <b>Price:</b> ${trade['price']:,.2f}\n"
        f"\U0001f4e6 <b>Quantity:</b> {trade['qty']:,.4f} {trade['coin']}\n"
        f"\u23f0 <b>Time:</b> {trade['time_str']} UTC\n\n"
        f"\U0001f464 <b>Taker:</b> {taker_link}\n"
        f"\U0001f465 <b>Maker:</b> {maker_link}"
        f"{tx_link}"
    )

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    print(f"  [TG] Error {resp.status}: {body}")
    except Exception as e:
        print(f"  [TG] Send failed: {e}")


# ────────────────────────────────────────────────────────
# Browser WebSocket broadcasting
# ────────────────────────────────────────────────────────

async def broadcast(msg_type: str, data):
    payload = json.dumps({"type": msg_type, "data": data})
    dead = set()
    for ws in browser_clients:
        try:
            await ws.send_str(payload)
        except Exception:
            dead.add(ws)
    browser_clients.difference_update(dead)


# ────────────────────────────────────────────────────────
# Trade processing
# ────────────────────────────────────────────────────────

async def process_trade_message(data: dict):
    if data.get("channel") != "trades":
        return

    min_size = config.get("min_trade_size_usd", 100_000)

    for t in data.get("data", []):
        coin = t.get("coin", "???")
        price = float(t.get("px", 0))
        qty = float(t.get("sz", 0))
        side = t.get("side", "?")
        size_usd = price * qty

        if size_usd < min_size:
            continue

        # Direction filter (server-side — controls what triggers TG alerts)
        dir_filter = config.get("direction_filter", "all")
        if dir_filter == "long" and side != "B":
            continue
        if dir_filter == "short" and side == "B":
            continue

        timestamp = t.get("time", 0)
        time_str = (
            datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).strftime("%H:%M:%S")
            if timestamp
            else datetime.now(timezone.utc).strftime("%H:%M:%S")
        )

        users = t.get("users", [])
        taker = users[0] if len(users) > 0 else ""
        maker = users[1] if len(users) > 1 else ""
        hash_val = t.get("hash", "")

        trade = {
            "coin": coin,
            "side": side,
            "price": price,
            "qty": qty,
            "size_usd": size_usd,
            "hash": hash_val,
            "taker": taker,
            "maker": maker,
            "time": timestamp,
            "time_str": time_str,
        }

        stats["total_trades"] += 1
        stats["total_volume"] += size_usd
        if side == "B":
            stats["long_volume"] += size_usd
        else:
            stats["short_volume"] += size_usd

        trade_history.append(trade)
        if len(trade_history) > 500:
            trade_history.pop(0)

        await broadcast("trade", trade)
        await broadcast("stats", stats)

        # Fire-and-forget Telegram (don't slow down the stream)
        asyncio.create_task(send_telegram(trade))

        # Console log
        c = "\033[92m" if side == "B" else "\033[91m"
        r = "\033[0m"
        d = "LONG " if side == "B" else "SHORT"
        print(
            f"  {time_str} | {c}{d}{r} | {coin:>6} | "
            f"{fmt_usd(size_usd):>10} | ${price:,.2f} | "
            f"taker={truncate_addr(taker)}"
        )


# ────────────────────────────────────────────────────────
# Hyperliquid WebSocket stream
# ────────────────────────────────────────────────────────

async def get_all_coins() -> List[str]:
    async with aiohttp.ClientSession() as session:
        async with session.post(HL_INFO_URL, json={"type": "meta"}) as resp:
            data = await resp.json()
            return [a["name"] for a in data.get("universe", [])]


async def hyperliquid_stream():
    coins = config.get("coins", [])
    if not coins:
        print("  Fetching all available coins...")
        coins = await get_all_coins()
        print(f"  Found {len(coins)} coins")

    delay = 5

    while True:
        try:
            print("  Connecting to Hyperliquid WebSocket...")
            async with websockets.connect(
                HL_WS_URL, ping_interval=20, ping_timeout=10
            ) as ws:
                stats["connected"] = True
                await broadcast("stats", stats)
                print("  Connected!")

                # Subscribe in batches to avoid flooding
                batch_size = 50
                for i in range(0, len(coins), batch_size):
                    batch = coins[i : i + batch_size]
                    for coin in batch:
                        await ws.send(
                            json.dumps(
                                {
                                    "method": "subscribe",
                                    "subscription": {"type": "trades", "coin": coin},
                                }
                            )
                        )
                    if i + batch_size < len(coins):
                        await asyncio.sleep(0.2)

                print(f"  Subscribed to {len(coins)} coins")
                print(
                    f"  Watching for trades >= {fmt_usd(config.get('min_trade_size_usd', 100_000))}\n"
                )
                delay = 5

                async for message in ws:
                    try:
                        await process_trade_message(json.loads(message))
                    except json.JSONDecodeError:
                        continue

        except Exception as e:
            stats["connected"] = False
            await broadcast("stats", stats)
            print(f"  Connection lost: {e}")
            print(f"  Reconnecting in {delay}s...")
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)


# ────────────────────────────────────────────────────────
# Web routes
# ────────────────────────────────────────────────────────

async def handle_index(request):
    return web.FileResponse(BASE_DIR / "static" / "index.html")


async def handle_websocket(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    browser_clients.add(ws)

    # Send current state on connect
    await ws.send_str(json.dumps({"type": "stats", "data": stats}))
    await ws.send_str(json.dumps({"type": "history", "data": trade_history[-200:]}))
    await ws.send_str(json.dumps({"type": "config", "data": config}))
    await ws.send_str(json.dumps({"type": "available_coins", "data": available_coins}))

    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                data = json.loads(msg.data)
                cmd = data.get("type", "")

                if cmd == "update_config":
                    new = data.get("data", {})
                    config.update(new)
                    save_config(config)
                    await broadcast("config", config)

                elif cmd == "test_telegram":
                    test = {
                        "coin": "BTC",
                        "side": "B",
                        "price": 71000.0,
                        "qty": 14.08,
                        "size_usd": 1_000_000,
                        "hash": "0xtest",
                        "taker": "0x1234567890abcdef1234567890abcdef12345678",
                        "maker": "0xabcdef1234567890abcdef1234567890abcdef12",
                        "time": 0,
                        "time_str": datetime.now(timezone.utc).strftime("%H:%M:%S"),
                    }
                    await send_telegram(test)
                    await ws.send_str(json.dumps({"type": "telegram_test_result", "data": "sent"}))
    except Exception:
        pass
    finally:
        browser_clients.discard(ws)
    return ws


# ────────────────────────────────────────────────────────
# App lifecycle
# ────────────────────────────────────────────────────────

async def on_startup(app):
    global available_coins
    print("  Fetching available coins list...")
    available_coins = await get_all_coins()
    print(f"  {len(available_coins)} coins available")
    app["hl_task"] = asyncio.create_task(hyperliquid_stream())


async def on_cleanup(app):
    app["hl_task"].cancel()
    try:
        await app["hl_task"]
    except asyncio.CancelledError:
        pass


def create_app():
    app = web.Application()
    app.router.add_get("/", handle_index)
    app.router.add_get("/ws", handle_websocket)
    static_dir = BASE_DIR / "static"
    static_dir.mkdir(exist_ok=True)
    app.router.add_static("/static/", static_dir)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"\n  HYPERLIQUID WHALE TRACKER")
    print(f"  Dashboard: http://localhost:{port}")
    print(f"  Press Ctrl+C to stop\n")
    web.run_app(create_app(), host="0.0.0.0", port=port, print=None)
