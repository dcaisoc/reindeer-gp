"""Talk to the Reindeer Grand Prix server with a personal API token.

Create a token on your Team page (web app), then either run `reindeer login`
or set REINDEER_TOKEN. Uses only the standard library.
"""

from __future__ import annotations

import json
import os
import stat
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

DEFAULT_URL = "https://reindeer-gp.dcaisoc.workers.dev"
CONFIG_PATH = Path(os.environ.get("REINDEER_CONFIG", Path.home() / ".config" / "reindeer-gp" / "config.json"))


class ApiError(RuntimeError):
    def __init__(self, status: int, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details or {}


def load_config() -> dict[str, str]:
    try:
        return json.loads(CONFIG_PATH.read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def save_config(url: str, token: str) -> Path:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps({"url": url, "token": token}), "utf-8")
    try:
        CONFIG_PATH.chmod(stat.S_IRUSR | stat.S_IWUSR)  # only you can read your token
    except OSError:
        pass
    return CONFIG_PATH


class Client:
    def __init__(self, url: str | None = None, token: str | None = None) -> None:
        cfg = load_config()
        self.url = (url or os.environ.get("REINDEER_URL") or cfg.get("url") or DEFAULT_URL).rstrip("/")
        self.token = token or os.environ.get("REINDEER_TOKEN") or cfg.get("token")

    def _request(self, method: str, path: str, body: Any = None) -> Any:
        headers = {"accept": "application/json", "user-agent": "reindeer-sdk"}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["content-type"] = "application/json"
        if self.token:
            headers["authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(f"{self.url}/api/v1{path}", data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read()).get("error", {})
            except ValueError:
                err = {}
            msg = err.get("message", f"HTTP {e.code}")
            if e.code == 401 and self.token:
                msg = "Your API token was not accepted (it may have been revoked). Create a new one on your Team page, then run `reindeer login`."
            raise ApiError(e.code, err.get("code", "error"), msg, err.get("details")) from None
        except urllib.error.URLError as e:
            raise ApiError(0, "offline", f"Can't reach {self.url} ({e.reason}).") from None
        except (TimeoutError, OSError) as e:
            raise ApiError(0, "offline", f"No answer from {self.url} ({e}). Check your connection and try again.") from None

    def me(self) -> dict[str, Any] | None:
        return self._request("GET", "/me").get("user")

    def validate(self, bot: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/bots/validate", bot)

    def submit(self, bot: dict[str, Any], tracks: list[str] | None = None) -> list[dict[str, Any]]:
        """Submit a bot. Returns one queued submission per track."""
        if not self.token:
            raise ApiError(401, "unauthenticated", "No API token. Create one on your Team page, then run `reindeer login`.")
        body: dict[str, Any] = {"bot": bot}
        if tracks:
            body["tracks"] = tracks
        return self._request("POST", "/submissions", body)["submissions"]

    def submission(self, sub_id: str) -> dict[str, Any]:
        return self._request("GET", f"/submissions/{sub_id}")["submission"]

    def wait(self, sub_id: str, on_update: Callable[[dict[str, Any]], None] | None = None, timeout: float = 180) -> dict[str, Any]:
        start = time.time()
        delay = 0.5
        while True:
            s = self.submission(sub_id)
            if on_update:
                on_update(s)
            if s["status"] in ("done", "rejected") or time.time() - start > timeout:
                return s
            time.sleep(delay)
            delay = min(3.0, delay * 1.5)

    def twists(self) -> list[dict[str, Any]]:
        """Twists that are live now or have ended (each with its schedule), without track data."""
        return self._request("GET", "/api/v1/twists")["twists"]

    def twist(self, twist_id: str) -> dict[str, Any]:
        """The full twist file (track and config) of a live or past twist."""
        return self._request("GET", f"/api/v1/twists/{twist_id}")["twist"]

    def board(self, track: str, kind: str = "bots") -> dict[str, Any]:
        return self._request("GET", f"/boards/s1/{track}/base/{kind}")
