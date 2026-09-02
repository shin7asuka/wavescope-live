#!/usr/bin/env python3
import asyncio
import time
from datetime import datetime, timezone

import requests
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="WaveScope Live")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

SYMBOLS = {
    "gold": {"ticker": "GC=F", "name": "黄金", "code": "GC", "unit": "USD/oz"},
    "silver": {"ticker": "SI=F", "name": "白银", "code": "SI", "unit": "USD/oz"},
    "wti": {"ticker": "CL=F", "name": "WTI 原油", "code": "CL", "unit": "USD/bbl"},
}
INTERVALS = {
    "1m": ("1m", "1d"),
    "5m": ("5m", "5d"),
    "15m": ("15m", "5d"),
    "1h": ("60m", "1mo"),
}
CACHE = {}
LOCKS = {k: asyncio.Lock() for k in SYMBOLS}


def clean_chart(payload, key, interval):
    result = payload["chart"]["result"][0]
    meta = result["meta"]
    stamps = result.get("timestamp") or []
    q = result["indicators"]["quote"][0]
    bars = []
    for i, ts in enumerate(stamps):
        vals = {x: q.get(x, [None] * len(stamps))[i] for x in ("open", "high", "low", "close")}
        if any(v is None for v in vals.values()):
            continue
        bars.append({"time": int(ts), **{k: round(float(v), 5) for k, v in vals.items()}})
    bars = bars[-420:]
    last = float(meta.get("regularMarketPrice") or (bars[-1]["close"] if bars else 0))
    prev = float(meta.get("chartPreviousClose") or meta.get("previousClose") or last)
    if bars:
        bars[-1]["close"] = round(last, 5)
        bars[-1]["high"] = max(bars[-1]["high"], round(last, 5))
        bars[-1]["low"] = min(bars[-1]["low"], round(last, 5))
    return {
        "asset": key,
        **SYMBOLS[key],
        "interval": interval,
        "price": last,
        "previousClose": prev,
        "change": last - prev,
        "changePct": ((last / prev) - 1) * 100 if prev else 0,
        "currency": meta.get("currency", "USD"),
        "exchange": meta.get("exchangeName", "COMEX/NYMEX"),
        "marketState": meta.get("marketState", "UNKNOWN"),
        "dataTime": int(meta.get("regularMarketTime") or (bars[-1]["time"] if bars else time.time())),
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "bars": bars,
    }


async def fetch_market(key, interval):
    now = time.time()
    cache_key = f"{key}:{interval}"
    cached = CACHE.get(cache_key)
    if cached and now - cached["at"] < 0.85:
        return cached["data"]
    async with LOCKS[key]:
        cached = CACHE.get(cache_key)
        if cached and now - cached["at"] < 0.85:
            return cached["data"]
        y_interval, y_range = INTERVALS[interval]
        ticker = SYMBOLS[key]["ticker"]
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        params = {"interval": y_interval, "range": y_range, "includePrePost": "true"}
        try:
            response = await asyncio.to_thread(
                requests.get,
                url,
                params=params,
                headers={"User-Agent": "Mozilla/5.0 WaveScope/1.0"},
                timeout=8,
            )
            response.raise_for_status()
            data = clean_chart(response.json(), key, interval)
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
    return await fetch_market(asset, interval)


@app.get("/api/health")
async def health():
    return {"ok": True, "time": datetime.now(timezone.utc).isoformat()}


app.mount("/assets", StaticFiles(directory="."), name="assets")


@app.get("/")
async def index():
    return FileResponse("index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
