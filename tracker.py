#!/usr/bin/env python3
"""
Hyperliquid Whale Trade Tracker
Monitors real-time trades on Hyperliquid for massive longs and shorts.
No API key required — uses free public WebSocket + REST API.
"""

import asyncio
import json
import sys
from datetime import datetime
from typing import List

import aiohttp
import websockets

# ============================================================
# CONFIGURATION — Tweak these to your liking
# ============================================================

# Minimum trade size in USD to trigger an alert
MIN_TRADE_SIZE_USD = 100_000  # $100K default — lower this to see more trades

# Coins to track (empty list = ALL coins on Hyperliquid)
# Examples: ["BTC", "ETH", "SOL", "HYPE", "DOGE", "PEPE", "WIF"]
COINS_TO_TRACK = []  # [] means track everything

# Hyperliquid endpoints (free, no key needed)
WS_URL = "wss://api.hyperliquid.xyz/ws"
INFO_URL = "https://api.hyperliquid.xyz/info"

# Reconnect settings
RECONNECT_DELAY = 5  # seconds before reconnecting on disconnect
MAX_RECONNECT_DELAY = 60

# ============================================================
# DISPLAY
# ============================================================

RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

LONG_EMOJI = f"{GREEN}LONG  >>>>{RESET}"
SHORT_EMOJI = f"{RED}SHORT <<<<{RESET}"


def fmt_usd(value: float) -> str:
    if value >= 1_000_000:
        return f"${value / 1_000_000:,.2f}M"
    elif value >= 1_000:
        return f"${value / 1_000:,.1f}K"
    return f"${value:,.2f}"


def print_banner():
    print(f"""
{BOLD}{CYAN}╔══════════════════════════════════════════════════════════════╗
║           HYPERLIQUID WHALE TRACKER                          ║
║           Tracking massive longs & shorts 24/7               ║
║           No API key needed — 100% free                      ║
╚══════════════════════════════════════════════════════════════╝{RESET}

  Min trade size: {YELLOW}{fmt_usd(MIN_TRADE_SIZE_USD)}{RESET}
  Coins:          {YELLOW}{', '.join(COINS_TO_TRACK) if COINS_TO_TRACK else 'ALL'}{RESET}
  WebSocket:      {CYAN}{WS_URL}{RESET}
""")


def print_alert(coin: str, side: str, size_usd: float, price: float, qty: float, timestamp: str):
    direction = LONG_EMOJI if side == "B" else SHORT_EMOJI
    color = GREEN if side == "B" else RED
    size_str = fmt_usd(size_usd)

    # Bigger alerts for bigger trades
    if size_usd >= 1_000_000:
        prefix = f"{BOLD}{'🚨' * 3} WHALE ALERT {'🚨' * 3}{RESET}"
    elif size_usd >= 500_000:
        prefix = f"{BOLD}{'⚠️ ' * 2}BIG TRADE{'⚠️ ' * 2}{RESET}"
    else:
        prefix = ""

    now = datetime.now().strftime("%H:%M:%S")

    if prefix:
        print(f"\n  {prefix}")
    print(
        f"  {now} | {direction} | {BOLD}{coin:>6}{RESET} | "
        f"Size: {color}{BOLD}{size_str:>10}{RESET} | "
        f"Price: ${price:,.2f} | Qty: {qty:,.4f}"
    )


# ============================================================
# FETCHING AVAILABLE COINS
# ============================================================

async def get_all_coins() -> List[str]:
    """Fetch all available perpetual coins from Hyperliquid."""
    async with aiohttp.ClientSession() as session:
        payload = {"type": "meta"}
        async with session.post(INFO_URL, json=payload) as resp:
            data = await resp.json()
            coins = [asset["name"] for asset in data.get("universe", [])]
            return coins


# ============================================================
# WEBSOCKET TRADE STREAM
# ============================================================

async def subscribe_trades(ws, coins: List[str]):
    """Subscribe to trade feeds for the given coins."""
    for coin in coins:
        msg = {
            "method": "subscribe",
            "subscription": {
                "type": "trades",
                "coin": coin
            }
        }
        await ws.send(json.dumps(msg))
    print(f"  {CYAN}Subscribed to {len(coins)} coin(s) trade feeds{RESET}")


def process_trades(data: dict):
    """Process incoming trade messages and alert on large trades."""
    if data.get("channel") != "trades":
        return

    trades = data.get("data", [])
    for trade in trades:
        coin = trade.get("coin", "???")
        price = float(trade.get("px", 0))
        qty = float(trade.get("sz", 0))
        side = trade.get("side", "?")  # "B" = buy/long, "A" = sell/short
        size_usd = price * qty

        if size_usd >= MIN_TRADE_SIZE_USD:
            timestamp = trade.get("time", "")
            print_alert(coin, side, size_usd, price, qty, timestamp)


# ============================================================
# MAIN LOOP WITH AUTO-RECONNECT
# ============================================================

async def run_tracker():
    """Main tracking loop with auto-reconnect."""
    print_banner()

    # Determine which coins to track
    if COINS_TO_TRACK:
        coins = COINS_TO_TRACK
    else:
        print(f"  {CYAN}Fetching all available coins...{RESET}")
        coins = await get_all_coins()
        print(f"  {CYAN}Found {len(coins)} coins on Hyperliquid{RESET}")

    reconnect_delay = RECONNECT_DELAY

    while True:
        try:
            print(f"\n  {CYAN}Connecting to Hyperliquid WebSocket...{RESET}")
            async with websockets.connect(
                WS_URL,
                ping_interval=20,
                ping_timeout=10,
                close_timeout=5,
            ) as ws:
                print(f"  {GREEN}Connected!{RESET}")
                reconnect_delay = RECONNECT_DELAY  # reset on success

                await subscribe_trades(ws, coins)
                print(f"\n  {YELLOW}Watching for trades >= {fmt_usd(MIN_TRADE_SIZE_USD)}...{RESET}\n")
                print(f"  {'—' * 60}")

                async for message in ws:
                    try:
                        data = json.loads(message)
                        process_trades(data)
                    except json.JSONDecodeError:
                        continue

        except (websockets.ConnectionClosed, ConnectionError, OSError) as e:
            print(f"\n  {RED}Connection lost: {e}{RESET}")
            print(f"  {YELLOW}Reconnecting in {reconnect_delay}s...{RESET}")
            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, MAX_RECONNECT_DELAY)

        except Exception as e:
            print(f"\n  {RED}Unexpected error: {e}{RESET}")
            print(f"  {YELLOW}Reconnecting in {reconnect_delay}s...{RESET}")
            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, MAX_RECONNECT_DELAY)


def main():
    print("\n  Press Ctrl+C to stop the tracker.\n")
    try:
        asyncio.run(run_tracker())
    except KeyboardInterrupt:
        print(f"\n\n  {YELLOW}Tracker stopped.{RESET}\n")
        sys.exit(0)


if __name__ == "__main__":
    main()
