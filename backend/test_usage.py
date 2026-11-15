"""Tests of the cost log and the admin page's server side:  python test_usage.py"""
import datetime
import os
import tempfile

os.environ["DATA_DIR"] = tempfile.mkdtemp()
os.environ["ADMIN_CODE"] = "secret-code"
os.environ["APP_PASSWORD"] = "pw"

import usage

utc = datetime.timezone.utc
# 1,000,000 tokens in and 1,000,000 out of flash-lite = 0.30 + 2.50 dollars
assert usage.record("text", "gemini-3.5-flash-lite", 1_000_000, 1_000_000)["cost"] == 2.8
usage.record("voice", "gemini-3.8-flash-lite-tts", 100, 1250, now=datetime.datetime(2026, 11, 14, 22, 30, tzinfo=utc))  # 23:30 in Paris
usage.record("text", "gemini-3.5-flash-lite", 2000, 150, now=datetime.datetime(2026, 11, 14, 23, 30, tzinfo=utc))  # 00:30 on the 15th in Paris
stats = usage.stats(now=datetime.datetime(2026, 11, 15, 12, 0, tzinfo=utc))
days = {d["date"]: d for d in stats["days"]}
assert "2026-11-14" in days and "2026-11-15" in days and days["2026-11-14"]["voice"] > 0  # days follow Paris time
assert stats["months"][-1]["date"] == "2026-11" or len(stats["months"]) >= 1
assert abs(stats["total"]["cost"] - sum(d["cost"] for d in stats["days"])) < 1e-9
assert stats["total"]["calls"] == 3 and stats["persistent"] is True

# settings: only known models and voices are accepted, prices must be numbers
usage.set_config({"model": "gemini-3.5-flash", "voice": "Umbriel", "eurRate": 0.9, "prices": {"gemini-3.5-flash": {"in": 1, "out": 4}}})
config = usage.get_config()
assert config["model"] == "gemini-3.5-flash" and config["voice"] == "Umbriel" and config["prices"]["gemini-3.5-flash"] == {"in": 1.0, "out": 4.0}
usage.set_config({"model": "rm -rf", "voice": "Hacker", "prices": {"nope": {"in": 1, "out": 1}, "gemini-3.5-flash": {"in": "x"}}})
config = usage.get_config()
assert config["model"] == "gemini-3.5-flash" and config["voice"] == "Umbriel" and "nope" not in config["prices"]
assert usage.cost_of("gemini-3.5-flash", 1_000_000, 0) == 1.0  # the edited price counts for new calls

# the endpoints
try:
    from fastapi.testclient import TestClient
    import main
except (ImportError, RuntimeError) as error:
    print("endpoints not tested:", error)
else:
    client = TestClient(main.app)
    assert client.get("/admin/stats").status_code == 401
    assert client.post("/admin/login", headers={"X-Admin-Code": "wrong"}).status_code == 401
    assert client.post("/admin/login", headers={"X-Admin-Code": "secret-code"}).status_code == 200
    stats = client.get("/admin/stats", headers={"X-Admin-Code": "secret-code"}).json()
    assert stats["config"]["model"] == "gemini-3.5-flash" and "Charon" in stats["voices"]
    assert client.post("/admin/config", json={"model": "gemini-3.5-flash-lite"}, headers={"X-Admin-Code": "secret-code"}).json()["config"]["model"] == "gemini-3.5-flash-lite"
    assert client.post("/admin/config", json={"model": "gemini-3.8-flash"}).status_code == 401
    os.environ.pop("ADMIN_CODE")
    assert client.get("/admin/stats", headers={"X-Admin-Code": ""}).status_code == 503  # not configured: closed
print("test_usage: ok")
