"""What the Gemini calls cost, and the settings the admin page can change (model, voice, prices).

Everything lives in DATA_DIR: on Render, add a Disk mounted on /data (or set DATA_DIR) so it survives deploys.
Without a disk it still works, but is wiped at every deploy or restart (the admin page says so)."""
import datetime
import json
import os
import threading

try:
    from zoneinfo import ZoneInfo
    PARIS = ZoneInfo("Europe/Paris")
except Exception:  # no tz database in the image: UTC is good enough for a cost chart
    PARIS = datetime.timezone.utc

TEXT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"]
VOICES = ["Charon", "Umbriel", "Enceladus", "Algenib", "Orus", "Iapetus", "Rasalgethi", "Kore", "Aoede", "Puck", "Leda", "Zephyr"]
AUDIO_TOKENS_PER_SECOND = 25

# USD per 1M tokens (Google's paid tier, until 2026-12-31). "in" = text in, "out" = answer incl. thinking, or audio for the voices.
DEFAULT_PRICES = {
    "gemini-3.5-flash-lite": {"in": 0.30, "out": 2.50},
    "gemini-3.5-flash": {"in": 0.75, "out": 3.75},  # not published: same as 3.8 Flash, to check
    "gemini-3.1-flash-lite": {"in": 0.25, "out": 1.50},
    "gemini-3.6-flash": {"in": 0.75, "out": 3.75},
    "gemini-3.7-flash": {"in": 0.75, "out": 3.75},
    "gemini-3.8-flash": {"in": 0.75, "out": 3.75},
    "gemini-3.8-flash-lite-tts": {"in": 0.50, "out": 6.00},
    "gemini-3.8-flash-tts": {"in": 0.50, "out": 9.00},
    "gemini-3.1-flash-tts-preview": {"in": 0.50, "out": 9.00},
}
DEFAULT_EUR_RATE = 0.92

_lock = threading.Lock()


def data_dir():
    return os.environ.get("DATA_DIR") or ("/data" if os.path.isdir("/data") else os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))


def persistent():
    return bool(os.environ.get("DATA_DIR")) or os.path.isdir("/data")


def _path(name):
    return os.path.join(data_dir(), name)


def get_config():
    try:
        with open(_path("config.json"), encoding="utf-8") as f:
            config = json.load(f)
    except (OSError, ValueError):
        config = {}
    return config if isinstance(config, dict) else {}


def set_config(changes):
    """Merges the allowed settings; returns the new config. Unknown values are ignored."""
    with _lock:
        config = get_config()
        if changes.get("model") in TEXT_MODELS:
            config["model"] = changes["model"]
        if changes.get("voice") in VOICES:
            config["voice"] = changes["voice"]
        if isinstance(changes.get("prices"), dict):
            prices = config.setdefault("prices", {})
            for model, entry in changes["prices"].items():
                if model in DEFAULT_PRICES and isinstance(entry, dict):
                    try:
                        prices[model] = {"in": max(float(entry["in"]), 0), "out": max(float(entry["out"]), 0)}
                    except (KeyError, TypeError, ValueError):
                        pass
        if "eurRate" in changes:
            try:
                config["eurRate"] = min(max(float(changes["eurRate"]), 0.1), 5)
            except (TypeError, ValueError):
                pass
        os.makedirs(data_dir(), exist_ok=True)
        with open(_path("config.json"), "w", encoding="utf-8") as f:
            json.dump(config, f)
        return config


def price_of(model):
    entry = (get_config().get("prices") or {}).get(model) or DEFAULT_PRICES.get(model) or {"in": 0.75, "out": 3.75}
    return float(entry["in"]), float(entry["out"])


def cost_of(model, tokens_in, tokens_out):
    price_in, price_out = price_of(model)
    return (tokens_in * price_in + tokens_out * price_out) / 1_000_000


def record(kind, model, tokens_in, tokens_out, now=None):
    """One Gemini call: kind is "text" or "voice"."""
    tokens_in, tokens_out = int(tokens_in or 0), int(tokens_out or 0)
    entry = {"ts": (now or datetime.datetime.now(datetime.timezone.utc)).isoformat(timespec="seconds"), "kind": kind, "model": model,
             "in": tokens_in, "out": tokens_out, "cost": round(cost_of(model, tokens_in, tokens_out), 6)}
    try:
        with _lock:
            os.makedirs(data_dir(), exist_ok=True)
            with open(_path("usage.jsonl"), "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
    except OSError as error:  # never break the assistant because the log cannot be written
        print("USAGE could not write:", error, flush=True)
    return entry


def entries():
    try:
        with open(_path("usage.jsonl"), encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return []
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def stats(now=None):
    """Per-day and per-month cost (Paris time), the totals, and the current settings."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    days, months = {}, {}
    total = {"cost": 0.0, "text": 0.0, "voice": 0.0, "calls": 0}
    for e in entries():
        try:
            local = datetime.datetime.fromisoformat(e["ts"]).astimezone(PARIS)
        except (KeyError, ValueError):
            continue
        for bucket, key in ((days, local.strftime("%Y-%m-%d")), (months, local.strftime("%Y-%m"))):
            row = bucket.setdefault(key, {"cost": 0.0, "text": 0.0, "voice": 0.0, "calls": 0})
            row["cost"] += e["cost"]; row[e["kind"]] = row.get(e["kind"], 0.0) + e["cost"]; row["calls"] += 1
        total["cost"] += e["cost"]; total[e["kind"]] = total.get(e["kind"], 0.0) + e["cost"]; total["calls"] += 1
    today = now.astimezone(PARIS)
    config = get_config()
    return {
        "days": [{"date": d, **row} for d, row in sorted(days.items())][-60:],
        "months": [{"date": m, **row} for m, row in sorted(months.items())],
        "today": days.get(today.strftime("%Y-%m-%d"), {"cost": 0.0, "calls": 0})["cost"],
        "month": months.get(today.strftime("%Y-%m"), {"cost": 0.0, "calls": 0})["cost"],
        "total": total,
        "config": {"model": config.get("model") or os.environ.get("GEMINI_MODEL") or "", "voice": config.get("voice") or os.environ.get("GEMINI_VOICE") or "",
                   "eurRate": config.get("eurRate", DEFAULT_EUR_RATE),
                   "prices": {m: dict(zip(("in", "out"), price_of(m))) for m in DEFAULT_PRICES}},
        "models": TEXT_MODELS, "voices": VOICES, "persistent": persistent(),
    }
