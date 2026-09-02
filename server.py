#!/usr/bin/env python3
import asyncio
import json
import random
import string
import time
from datetime import datetime, timezone

import websockets
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="WaveScope Live")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

SYMBOLS = {
    "gold": {"ticker": "OANDA:XAUUSD", "name": "黄金现货", "code": "XAUUSD", "unit": "USD/oz", "exchange": "OANDA"},
    "silver": {"ticker": "OANDA:XAGUSD", "name": "白银现货", "code": "XAGUSD", "unit": "USD/oz", "exchange": "OANDA"},
    "wti": {"ticker": "TVC:USOIL", "name": "WTI 现货", "code": "USOIL", "unit": "USD/bbl", "exchange": "TVC"},
}
INTERVALS = {
    "1m": "1",
    "5m": "5",
    "15m": "15",
    "1h": "60",
    "1d": "1D",
    "1w": "1W",
}
CACHE = {}
LOCKS = {k: asyncio.Lock() for k in SYMBOLS}


def tv_message(method, params):
    raw = json.dumps({"m": method, "p": params}, separators=(",", ":"))
    return f"~m~{len(raw)}~m~{raw}"


def parse_frames(raw):
    messages, pos = [], 0
    while True:
        start = raw.find("~m~", pos)
        if start < 0:
            break
        len_end = raw.find("~m~", start + 3)
        if len_end < 0:
            break
        try:
            size = int(raw[start + 3 : len_end])
        except ValueError:
            pos = len_end + 3
            continue
        body_start = len_end + 3
        body = raw[body_start : body_start + size]
        pos = body_start + size
        if body.startswith("{"):
            try:
                messages.append(json.loads(body))
            except json.JSONDecodeError:
                pass
    return messages


async def tradingview_bars(symbol, tv_interval, count=420):
    uri = "wss://data.tradingview.com/socket.io/websocket?from=chart%2F"
    session = "cs_" + "".join(random.choices(string.ascii_lowercase, k=12))
    symbol_spec = "=" + json.dumps(
        {"symbol": symbol, "adjustment": "splits", "session": "extended"},
        separators=(",", ":"),
    )
    bars = []
    async with websockets.connect(
        uri,
        origin="https://www.tradingview.com",
        additional_headers={"User-Agent": "Mozilla/5.0 WaveScope/1.1"},
        open_timeout=6,
        close_timeout=2,
    ) as ws:
        commands = [
            tv_message("set_auth_token", ["unauthorized_user_token"]),
            tv_message("chart_create_session", [session, ""]),
            tv_message("resolve_symbol", [session, "symbol_1", symbol_spec]),
            tv_message("create_series", [session, "s1", "s1", "symbol_1", tv_interval, count]),
        ]
        for command in commands:
            await ws.send(command)
        for _ in range(18):
            raw = await asyncio.wait_for(ws.recv(), timeout=8)
            if raw.startswith("~m~~h~"):
                await ws.send(raw)
                continue
            for message in parse_frames(raw):
                if message.get("m") == "symbol_error":
                    raise RuntimeError(f"无效现货代码: {symbol}")
                if message.get("m") == "timescale_update":
                    series = message.get("p", [{}, {}])[1].get("s1", {})
                    for item in series.get("s", []):
                        v = item.get("v", [])
                        if len(v) >= 5 and all(x is not None for x in v[:5]):
                            bars.append(
                                {
                                    "time": int(v[0]),
                                    "open": round(float(v[1]), 5),
                                    "high": round(float(v[2]), 5),
                                    "low": round(float(v[3]), 5),
                                    "close": round(float(v[4]), 5),
                                }
                            )
                if message.get("m") == "series_completed":
                    return sorted({b["time"]: b for b in bars}.values(), key=lambda b: b["time"])
    return sorted({b["time"]: b for b in bars}.values(), key=lambda b: b["time"])


def clean_chart(bars, key, interval):
    if len(bars) < 20:
        raise RuntimeError("现货K线数量不足")
    last = float(bars[-1]["close"])
    prev = float(bars[-2]["close"])
    return {
        "asset": key,
        **SYMBOLS[key],
        "interval": interval,
        "price": last,
        "previousClose": prev,
        "change": last - prev,
        "changePct": ((last / prev) - 1) * 100 if prev else 0,
        "changeBasis": "较上一根K线",
        "currency": "USD",
        "marketState": "STREAMING",
        "dataTime": int(bars[-1]["time"]),
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "bars": bars,
    }


async def fetch_market(key, interval):
    now = time.time()
    cache_key = f"{key}:{interval}"
    cache_ttl = 5 if interval == "1d" else 45 if interval == "1w" else 0.85
    cached = CACHE.get(cache_key)
    if cached and now - cached["at"] < cache_ttl:
        return cached["data"]
    async with LOCKS[key]:
        cached = CACHE.get(cache_key)
        if cached and now - cached["at"] < cache_ttl:
            return cached["data"]
        tv_interval = INTERVALS[interval]
        ticker = SYMBOLS[key]["ticker"]
        try:
            bars = await tradingview_bars(ticker, tv_interval)
            data = clean_chart(bars, key, interval)
            CACHE[cache_key] = {"at": now, "data": data}
            return data
        except Exception as exc:
            if cached:
                stale = dict(cached["data"])
                stale["stale"] = True
                stale["error"] = "上游行情暂时不可用，显示最近一次成功数据"
                return stale
            raise RuntimeError(f"行情请求失败: {exc}")


@app.get("/api/market/{asset}")
async def market(asset: str, interval: str = Query("1m")):
    if asset not in SYMBOLS:
        return {"error": "未知品种"}
    if interval not in INTERVALS:
        interval = "1m"
    data = await fetch_market(asset, interval)
    if asset != "gold":
        return data
    daily = data if interval == "1d" else await fetch_market("gold", "1d")
    enriched = dict(data)
    enriched["macroBars"] = daily["bars"]
    return enriched

@app.get("/api/quotes")
async def quotes():
    results = await asyncio.gather(*(fetch_market(key, "1m") for key in SYMBOLS), return_exceptions=True)
    values = {}
    for key, result in zip(SYMBOLS, results):
        if not isinstance(result, Exception):
            values[key] = result["price"]
    return {"quotes": values, "fetchedAt": datetime.now(timezone.utc).isoformat()}


@app.get("/api/health")
async def health():
    return {"ok": True, "time": datetime.now(timezone.utc).isoformat()}


app.mount("/assets", StaticFiles(directory="."), name="assets")


@app.get("/")
async def index():
    return FileResponse("index.html")


@app.get("/styles.css")
async def styles():
    return FileResponse("styles.css", media_type="text/css")


@app.get("/app.js")
async def javascript():
    return FileResponse("app.js", media_type="application/javascript")

@app.get("/sw.js")
async def service_worker():
    return FileResponse("sw.js", media_type="application/javascript", headers={"Service-Worker-Allowed": "/"})

@app.get("/manifest.webmanifest")
async def manifest():
    return FileResponse("manifest.webmanifest", media_type="application/manifest+json")

@app.get("/icon.svg")
async def icon():
    return FileResponse("icon.svg", media_type="image/svg+xml")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
