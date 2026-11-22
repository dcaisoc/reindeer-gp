"""Reindeer Grand Prix simulation. Line-by-line port of engine/reindeer/sim.ts.

If you change anything here, the golden traces (tests/test_golden.py) must
still match the TypeScript engine bit for bit.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Sequence

from .config import DEFAULT_CONFIG, DT, ENGINE_VERSION, GAME_ID
from .fmath import PI, fcos, fsin, wrap_angle
from .hashing import StateHasher

CELL = 8


@dataclass
class Observation:
    """What the sleigh senses. rays: wall distances / range (0..1), left to right."""

    rays: list[float]
    speed: float
    lateral: float
    surface: str

    def to_inputs(self, names: Sequence[str]) -> list[float]:
        out: list[float] = []
        for k in names:
            if k.startswith("ray"):
                out.append(self.rays[int(k[3:])])
            elif k == "speed":
                out.append(self.speed)
            elif k == "lateral":
                out.append(self.lateral)
            elif k == "surf_snow":
                out.append(1.0 if self.surface == "snow" else 0.0)
            elif k == "surf_ice":
                out.append(1.0 if self.surface == "ice" else 0.0)
            elif k == "surf_rough":
                out.append(1.0 if self.surface == "rough" else 0.0)
            else:
                raise ValueError(f'Unknown input "{k}"')
        return out


class TrackGeometry:
    """Wall segments bucketed into a uniform grid for fast queries."""

    def __init__(self, track: dict[str, Any]) -> None:
        self.track = track
        segs: list[tuple[float, float, float, float]] = []
        for loop in (track["walls"]["left"], track["walls"]["right"]):
            n = len(loop)
            for i in range(n):
                a = loop[i]
                b = loop[(i + 1) % n]
                segs.append((a[0], a[1], b[0], b[1]))
        self.n = len(segs)
        self.ax = [s[0] for s in segs]
        self.ay = [s[1] for s in segs]
        self.bx = [s[2] for s in segs]
        self.by = [s[3] for s in segs]
        pad = 64
        b = track["bounds"]
        self.gx0 = math.floor((b["minX"] - pad) / CELL) * CELL
        self.gy0 = math.floor((b["minY"] - pad) / CELL) * CELL
        self.cols = math.floor((b["maxX"] + pad - self.gx0) / CELL) + 1
        self.rows = math.floor((b["maxY"] + pad - self.gy0) / CELL) + 1
        cells: list[list[int]] = [[] for _ in range(self.cols * self.rows)]
        for i in range(self.n):
            c0, r0, c1, r1 = self.cell_range(
                min(self.ax[i], self.bx[i]), min(self.ay[i], self.by[i]), max(self.ax[i], self.bx[i]), max(self.ay[i], self.by[i])
            )
            for r in range(r0, r1 + 1):
                for c in range(c0, c1 + 1):
                    cells[r * self.cols + c].append(i)
        self.cells = cells

    def cell_range(self, x0: float, y0: float, x1: float, y1: float) -> tuple[int, int, int, int]:
        c0 = math.floor((x0 - self.gx0) / CELL)
        r0 = math.floor((y0 - self.gy0) / CELL)
        c1 = math.floor((x1 - self.gx0) / CELL)
        r1 = math.floor((y1 - self.gy0) / CELL)
        if c0 < 0:
            c0 = 0
        if r0 < 0:
            r0 = 0
        if c1 > self.cols - 1:
            c1 = self.cols - 1
        if r1 > self.rows - 1:
            r1 = self.rows - 1
        return c0, r0, c1, r1

    def in_box(self, x0: float, y0: float, x1: float, y1: float) -> list[int]:
        """Segment ids in cells overlapping the box, each once, in the engine's order."""
        c0, r0, c1, r1 = self.cell_range(x0, y0, x1, y1)
        seen: set[int] = set()
        out: list[int] = []
        cols = self.cols
        cells = self.cells
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                for i in cells[r * cols + c]:
                    if i not in seen:
                        seen.add(i)
                        out.append(i)
        return out

    def cast_ray(self, ox: float, oy: float, dx: float, dy: float, rng: float) -> float:
        ex = ox + dx * rng
        ey = oy + dy * rng
        best = rng
        ax, ay, bx, by = self.ax, self.ay, self.bx, self.by
        for i in self.in_box(min(ox, ex), min(oy, ey), max(ox, ex), max(oy, ey)):
            sx = bx[i] - ax[i]
            sy = by[i] - ay[i]
            denom = dx * sy - dy * sx
            if -1e-12 < denom < 1e-12:
                continue
            qx = ax[i] - ox
            qy = ay[i] - oy
            t = (qx * sy - qy * sx) / denom
            s = (qx * dy - qy * dx) / denom
            if t >= 0 and s >= 0 and s <= 1 and t < best:
                best = t
        return best


def _inside_polygon(x: float, y: float, poly: Sequence[Sequence[float]]) -> bool:
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i][0], poly[i][1]
        xj, yj = poly[j][0], poly[j][1]
        if (yi > y) != (yj > y):
            x_cross = ((xj - xi) * (y - yi)) / (yj - yi) + xi
            if x < x_cross:
                inside = not inside
        j = i
    return inside


def _segments_cross(px, py, qx, qy, ax, ay, bx, by) -> bool:  # type: ignore[no-untyped-def]
    d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
    d2 = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax)
    if (d1 > 0 and d2 > 0) or (d1 < 0 and d2 < 0):
        return False
    d3 = (qx - px) * (ay - py) - (qy - py) * (ax - px)
    d4 = (qx - px) * (by - py) - (qy - py) * (bx - px)
    if (d3 > 0 and d4 > 0) or (d3 < 0 and d4 < 0):
        return False
    if d1 == 0 and d2 == 0:
        return False
    return True


@dataclass
class LapEvents:
    splits: list[int] = field(default_factory=list)
    collision_ticks: list[int] = field(default_factory=list)


class ReindeerGame:
    """One sleigh, one lap. step() advances one 1/60 s tick."""

    game_id = GAME_ID
    engine_version = ENGINE_VERSION
    participants = 1

    def __init__(self, track: dict[str, Any], cfg: dict[str, Any] | None = None, geo: TrackGeometry | None = None) -> None:
        self.track = track
        self.cfg = cfg or DEFAULT_CONFIG
        self.geo = geo or TrackGeometry(track)
        self.x = float(track["start"]["x"])
        self.y = float(track["start"]["y"])
        self.heading = float(track["start"]["heading"])
        self.vx = 0.0
        self.vy = 0.0
        self.tick = 0
        self.next_cp = 1 if len(track["checkpoints"]) > 1 else 0
        self.penalties = 0
        self.collisions = 0
        self.cooldown = 0
        self.touching = 0
        self.finished = 0
        self.timed_out = 0
        self.events = LapEvents()
        self._ray_angles = [(d * PI) / 180 for d in self.cfg["rayAnglesDeg"]]
        self._obs: Observation | None = None

    def surface_at(self, x: float, y: float) -> str:
        s = "snow"
        for p in self.track["surfaces"]:
            if _inside_polygon(x, y, p["polygon"]):
                s = p["type"]
        return s

    @property
    def speed(self) -> float:
        return self.vx * fcos(self.heading) + self.vy * fsin(self.heading)

    def is_done(self) -> bool:
        return self.finished == 1 or self.timed_out == 1

    def step(self, action: Sequence[int]) -> None:
        """Advance one tick. action = (steer, throttle) as ints in -127..127."""
        if self.is_done():
            return
        cfg = self.cfg
        steer = action[0] / 127
        thr = action[1] / 127
        surf = cfg["surfaces"][self.surface_at(self.x, self.y)]

        c = fcos(self.heading)
        s = fsin(self.heading)
        v = self.vx * c + self.vy * s
        u = -self.vx * s + self.vy * c

        if thr >= 0:
            force = thr * cfg["accel"] * surf["traction"]
        elif v > 0.5:
            force = thr * cfg["brake"] * surf["traction"]
        else:
            force = thr * cfg["reverseAccel"] * surf["traction"]
        abs_v0 = -v if v < 0 else v
        drag = (cfg["dragLinear"] * v + cfg["dragQuad"] * v * abs_v0) * surf["drag"]
        v_before = v
        v = v + (force - drag) * DT
        if thr < 0 and v_before > 0.5 and v < 0:
            v = 0.0
        if v < -cfg["maxReverse"]:
            v = float(-cfg["maxReverse"])
        if thr == 0 and -0.05 < v < 0.05:
            v = 0.0

        abs_v = -v if v < 0 else v
        g = abs_v / cfg["turnFullSpeed"] if abs_v < cfg["turnFullSpeed"] else 1
        frac = abs_v / cfg["maxSpeed"] if abs_v < cfg["maxSpeed"] else 1
        g = g * (1 - cfg["highSpeedTurnLoss"] * frac)
        direction = 1 if v >= 0 else -1
        self.heading = wrap_angle(self.heading + steer * cfg["turnRate"] * g * direction * DT)

        vx = v * c - u * s
        vy = v * s + u * c
        c2 = fcos(self.heading)
        s2 = fsin(self.heading)
        v2 = vx * c2 + vy * s2
        u2 = -vx * s2 + vy * c2
        k = 1 - surf["grip"] * cfg["gripRate"] * DT
        if k < 0:
            k = 0
        u2 = u2 * k
        vx = v2 * c2 - u2 * s2
        vy = v2 * s2 + u2 * c2

        px = self.x
        py = self.y
        x = px + vx * DT
        y = py + vy * DT

        r = cfg["sleighRadius"]
        best_d2 = r * r
        hit = -1
        hx = 0.0
        hy = 0.0
        geo = self.geo
        gax, gay, gbx, gby = geo.ax, geo.ay, geo.bx, geo.by
        for i in geo.in_box(x - r, y - r, x + r, y + r):
            sx = gbx[i] - gax[i]
            sy = gby[i] - gay[i]
            len2 = sx * sx + sy * sy
            t = ((x - gax[i]) * sx + (y - gay[i]) * sy) / len2 if len2 > 0 else 0
            if t < 0:
                t = 0
            elif t > 1:
                t = 1
            cx = gax[i] + sx * t
            cy = gay[i] + sy * t
            dx = x - cx
            dy = y - cy
            d2 = dx * dx + dy * dy
            if d2 < best_d2:
                best_d2 = d2
                hit = i
                hx = cx
                hy = cy

        touching_now = 0
        if hit >= 0 and best_d2 > 1e-18:
            touching_now = 1
            d = math.sqrt(best_d2)
            nx = (x - hx) / d
            ny = (y - hy) / d
            x = x + nx * (r - d)
            y = y + ny * (r - d)
            vn = vx * nx + vy * ny
            if vn < 0:
                vx = vx - nx * vn
                vy = vy - ny * vn
            f = 1 - cfg["wallFriction"] * DT
            if self.touching == 0:
                f = f * cfg["wallSpeedFactor"]
                self.collisions += 1
                self.events.collision_ticks.append(self.tick + 1)
            vx = vx * f
            vy = vy * f
            if self.cooldown <= 0:
                self.penalties += 1
                self.cooldown = cfg["penaltyCooldownTicks"]
        if self.cooldown > 0:
            self.cooldown -= 1
        self.touching = touching_now

        self.x = x
        self.y = y
        self.vx = vx
        self.vy = vy
        self.tick += 1

        cp = self.track["checkpoints"][self.next_cp]
        if _segments_cross(px, py, x, y, cp[0], cp[1], cp[2], cp[3]):
            fx = cp[3] - cp[1]
            fy = -(cp[2] - cp[0])
            if (x - px) * fx + (y - py) * fy > 0:
                self.events.splits.append(self.tick)
                if self.next_cp == 0:
                    self.finished = 1
                else:
                    self.next_cp = self.next_cp + 1 if self.next_cp + 1 < len(self.track["checkpoints"]) else 0
        if self.finished == 0 and self.tick >= cfg["timeoutTicks"]:
            self.timed_out = 1
        self._obs = None

    def observe(self) -> Observation:
        if self._obs is not None:
            return self._obs
        cfg = self.cfg
        rng = cfg["rayRange"]
        rays = []
        for a in self._ray_angles:
            ang = self.heading + a
            rays.append(self.geo.cast_ray(self.x, self.y, fcos(ang), fsin(ang), rng) / rng)
        c = fcos(self.heading)
        s = fsin(self.heading)
        self._obs = Observation(
            rays=rays,
            speed=(self.vx * c + self.vy * s) / cfg["maxSpeed"],
            lateral=(-self.vx * s + self.vy * c) / cfg["maxSpeed"],
            surface=self.surface_at(self.x, self.y),
        )
        return self._obs

    def result(self) -> dict[str, Any]:
        valid = self.finished == 1
        score = self.tick / 60 + self.penalties * self.cfg["penaltySeconds"] if valid else math.inf
        return {"valid": valid, "score": score, "ticks": self.tick, "penalties": self.penalties, "collisions": self.collisions}

    def state_hash(self) -> str:
        return (
            StateHasher()
            .f64(self.x)
            .f64(self.y)
            .f64(self.heading)
            .f64(self.vx)
            .f64(self.vy)
            .i32(self.tick)
            .i32(self.next_cp)
            .i32(self.penalties)
            .i32(self.collisions)
            .i32(self.cooldown)
            .i32(self.touching)
            .i32(self.finished)
            .i32(self.timed_out)
            .hex()
        )
