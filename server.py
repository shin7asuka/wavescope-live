#!/usr/bin/env python3
import asyncio
import hashlib
import json
import os
import random
import sqlite3
import string
import time
from datetime import datetime, timezone

import websockets
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pywebpush import WebPushException, webpush

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
DATABASE_PATH = os.getenv("DATABASE_PATH", "/tmp/wavescope.db")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:alerts@wavescope.app")
MONITOR_TASK = None


class PushSubscription(BaseModel):
    endpoint: str
    keys: dict[str, str]


class AlertRequest(BaseModel):
    subscriptionId: str
    asset: str
    direction: str
    price: float


def db():
    parent = os.path.dirname(DATABASE_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS subscriptions (
              id TEXT PRIMARY KEY,
              endpoint TEXT NOT NULL,
              p256dh TEXT NOT NULL,
              auth TEXT NOT NULL,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS alerts (
              id TEXT PRIMARY KEY,
              subscription_id TEXT NOT NULL,
              asset TEXT NOT NULL,
              direction TEXT NOT NULL,
              price REAL NOT NULL,
              last_price REAL,
              created_at INTEGER NOT NULL,
              FOREIGN KEY(subscription_id) REFERENCES subscriptions(id)
            );
            """
        )


def send_push(subscription, payload):
    if not VAPID_PRIVATE_KEY:
        return False
    info = {
        "endpoint": subscription["endpoint"],
        "keys": {"p256dh": subscription["p256dh"], "auth": subscription["auth"]},
    }
    try:
        webpush(
            subscription_info=info,
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUBJECT},
            ttl=300,
        )
        return True
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (404, 410):
            with db() as connection:
                connection.execute("DELETE FROM alerts WHERE subscription_id=?", (subscription["id"],))
                connection.execute("DELETE FROM subscriptions WHERE id=?", (subscription["id"],))
        return False


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


async def monitor_alerts():
    while True:
        try:
            with db() as connection:
                pending = connection.execute(
                    """
                    SELECT a.*, s.endpoint, s.p256dh, s.auth
                    FROM alerts a JOIN subscriptions s ON s.id=a.subscription_id
                    ORDER BY a.created_at
                    """
                ).fetchall()
            if pending:
                needed = sorted({row["asset"] for row in pending})
                results = await asyncio.gather(
                    *(fetch_market(asset, "1m") for asset in needed), return_exceptions=True
                )
                prices = {
                    asset: result["price"]
                    for asset, result in zip(needed, results)
                    if not isinstance(result, Exception)
                }
                for row in pending:
                    current = prices.get(row["asset"])
                    if current is None:
                        continue
                    previous = row["last_price"]
                    if row["direction"] == "above":
                        crossed = current >= row["price"] if previous is None else previous < row["price"] <= current
                    else:
                        crossed = current <= row["price"] if previous is None else previous > row["price"] >= current
                    if crossed:
                        asset_name = SYMBOLS[row["asset"]]["code"]
                        verb = "上穿" if row["direction"] == "above" else "下破"
                        payload = {
                            "title": "WaveScope 价位提醒",
                            "body": f"{asset_name} 当前 {current:.3f}，已{verb}目标 {row['price']:.3f}",
                            "tag": f"wavescope-{row['id']}",
                            "url": "/?alert=triggered",
                        }
                        await asyncio.to_thread(send_push, row, payload)
                        with db() as connection:
                            connection.execute("DELETE FROM alerts WHERE id=?", (row["id"],))
                    else:
                        with db() as connection:
                            connection.execute("UPDATE alerts SET last_price=? WHERE id=?", (current, row["id"]))
        except Exception:
            pass
        await asyncio.sleep(5)


@app.on_event("startup")
async def startup():
    global MONITOR_TASK
    init_db()
    MONITOR_TASK = asyncio.create_task(monitor_alerts())


@app.on_event("shutdown")
async def shutdown():
    if MONITOR_TASK:
        MONITOR_TASK.cancel()


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


@app.get("/api/push/public-key")
async def push_public_key():
    return {"enabled": bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY), "publicKey": VAPID_PUBLIC_KEY}


@app.post("/api/push/subscriptions")
async def save_subscription(subscription: PushSubscription):
    if not VAPID_PUBLIC_KEY or not VAPID_PRIVATE_KEY:
        raise HTTPException(status_code=503, detail="服务器推送尚未配置")
    p256dh = subscription.keys.get("p256dh")
    auth = subscription.keys.get("auth")
    if not subscription.endpoint.startswith("https://") or not p256dh or not auth:
        raise HTTPException(status_code=400, detail="无效的推送订阅")
    subscription_id = hashlib.sha256(subscription.endpoint.encode()).hexdigest()[:32]
    with db() as connection:
        connection.execute(
            """
            INSERT INTO subscriptions(id,endpoint,p256dh,auth,created_at)
            VALUES(?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth
            """,
            (subscription_id, subscription.endpoint, p256dh, auth, int(time.time())),
        )
    return {"subscriptionId": subscription_id}


@app.get("/api/alerts/{subscription_id}")
async def list_alerts(subscription_id: str):
    with db() as connection:
        rows = connection.execute(
            "SELECT id,asset,direction,price,last_price AS lastPrice,created_at AS createdAt FROM alerts WHERE subscription_id=? ORDER BY created_at",
            (subscription_id,),
        ).fetchall()
    return {"alerts": [dict(row) for row in rows]}


@app.post("/api/alerts")
async def create_alert(request: AlertRequest):
    if request.asset not in SYMBOLS or request.direction not in ("above", "below") or request.price <= 0:
        raise HTTPException(status_code=400, detail="无效提醒参数")
    with db() as connection:
        subscription = connection.execute(
            "SELECT id FROM subscriptions WHERE id=?", (request.subscriptionId,)
        ).fetchone()
        if not subscription:
            raise HTTPException(status_code=404, detail="推送订阅不存在，请重新启用通知")
        alert_id = "a" + hashlib.sha256(
            f"{request.subscriptionId}:{request.asset}:{request.direction}:{request.price}:{time.time_ns()}".encode()
        ).hexdigest()[:24]
        connection.execute(
            "INSERT INTO alerts(id,subscription_id,asset,direction,price,last_price,created_at) VALUES(?,?,?,?,?,?,?)",
            (alert_id, request.subscriptionId, request.asset, request.direction, request.price, None, int(time.time())),
        )
    return {"id": alert_id, "status": "monitoring"}


@app.delete("/api/alerts/{subscription_id}/{alert_id}")
async def delete_alert(subscription_id: str, alert_id: str):
    with db() as connection:
        connection.execute("DELETE FROM alerts WHERE id=? AND subscription_id=?", (alert_id, subscription_id))
    return {"deleted": True}


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
