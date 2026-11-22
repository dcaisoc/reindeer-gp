/**
 * Live leaderboards. Snapshots are polled every 10 s while the tab is
 * visible (paused when hidden), so boards feel live without costing much.
 */

import { api, courseBoardKey, getMe } from '../api.js';
import { baselinePolicy } from '../../../engine/reindeer/autopilot.js';
import { runPolicy } from '../../../engine/reindeer/run.js';
import { TRACKS, ensureCourse, geometry, getCourse, listTwists, type Course } from '../tracks.js';
import { fmtDate, fmtTime, h, type Screen } from '../ui.js';

interface Entry {
  rank: number;
  prevRank: number | null;
  teamId: string;
  team: string;
  college: string;
  level: string;
  beginner: boolean;
  score: number;
  penalties: number;
  submittedAt: string;
  replayId: string;
}
interface Snapshot {
  boardKey: string;
  trackName: string;
  baseline?: { valid: boolean; score: number | null; penalties: number } | null;
  kind: 'bots' | 'humans';
  updatedAt: string;
  entries: Entry[];
}

type Filter = 'all' | 'elf' | 'reindeer' | 'santa' | 'beginner';
const POLL_MS = 10_000;

/** Poll a board while the page is visible. Returns a stop function. */
function pollBoard(key: string, onData: (s: Snapshot) => void, onError: (e: unknown) => void): () => void {
  let timer = 0;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    if (!document.hidden) {
      try {
        onData(await api.get<Snapshot>(`/boards/${key}`));
      } catch (e) {
        onError(e);
      }
    }
    timer = window.setTimeout(tick, POLL_MS);
  };
  const onVis = () => {
    if (!document.hidden) {
      clearTimeout(timer);
      tick();
    }
  };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('rgp:submitted', onVis);
  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('rgp:submitted', onVis);
  };
}

function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function movement(e: Entry): HTMLElement | string {
  if (e.prevRank === null) return h('span', { class: 'move new', title: 'New today' }, 'new');
  const d = e.prevRank - e.rank;
  if (d > 0) return h('span', { class: 'move up', title: `Up ${d} since this morning`, 'aria-label': `up ${d}` }, `▲${d}`);
  if (d < 0) return h('span', { class: 'move down', title: `Down ${-d} since this morning`, 'aria-label': `down ${-d}` }, `▼${-d}`);
  return '';
}

/** The baseline bot's score on a course, worked out in the browser when the server hasn't sent it yet. */
const localBaselines = new Map<string, number | null>();
function baselineScore(c: Course, snap: Snapshot | null): number | null {
  if (snap?.baseline) return snap.baseline.valid ? snap.baseline.score : null;
  if (!localBaselines.has(c.id)) {
    const r = runPolicy(c.track, baselinePolicy, { kind: 'bot', name: 'Baseline' }, { cfg: c.cfg, twist: c.twist, geo: geometry(c.track) }).header.result;
    localBaselines.set(c.id, r.valid ? r.score : null);
  }
  return localBaselines.get(c.id)!;
}

export function boardsScreen(trackId?: string, kind?: string): Screen {
  const course = getCourse(trackId ?? '') ?? getCourse(TRACKS[0].id)!;
  const track = course;
  const k: 'bots' | 'humans' = kind === 'humans' ? 'humans' : 'bots';
  let filter: Filter = 'all';
  let snap: Snapshot | null = null;
  let myTeam: string | null = null;
  getMe().then((m) => {
    myTeam = m.user?.teamId ?? null;
    draw();
  });

  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Track' },
    TRACKS.map((t) => h('a', { href: `#/boards/${t.id}/${k}`, 'aria-current': t.id === track.id ? 'page' : undefined }, t.name)));
  // Weekly twists: live ones first, then past ones. Always fresh here: a twist may have just opened.
  listTwists(true).then((tw) => {
    for (const w of [...tw].sort((a, b) => Number(b.live) - Number(a.live))) {
      tabs.append(h('a', { class: `twist-tab${w.live ? ' live' : ''}`, href: `#/boards/${w.id}/${k}`, 'aria-current': w.id === course.id ? 'page' : undefined },
        `🌀 ${w.name}`, w.live ? '' : h('small', {}, ' (ended)')));
    }
  });
  const raceLeader = h('a', { class: 'btn small btn-primary', hidden: true }, 'Race the leader');
  const kinds = h('div', { class: 'seg', role: 'group', 'aria-label': 'Board' },
    h('a', { class: 'btn toggle', href: `#/boards/${track.id}/bots`, 'aria-pressed': String(k === 'bots') }, 'Bots'),
    h('a', { class: 'btn toggle', href: `#/boards/${track.id}/humans`, 'aria-pressed': String(k === 'humans') }, 'Humans'));
  const filters = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter by level' },
    (['all', 'beginner', 'elf', 'reindeer', 'santa'] as Filter[]).map((f) =>
      h('button', { class: 'btn toggle small', 'aria-pressed': String(f === filter), 'data-f': f, onclick: () => {
        filter = f;
        filters.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === f)));
        draw();
      } }, f === 'all' ? 'Everyone' : f === 'beginner' ? 'Beginner' : f[0].toUpperCase() + f.slice(1))));
  const callouts = h('div', { class: 'callouts', 'aria-live': 'polite' });
  const table = h('div', { class: 'table-wrap' });
  const updated = h('p', { class: 'muted small' });
  const twistNote = course.twist
    ? h('p', { class: 'twist-note' }, h('strong', {}, `🌀 ${course.name}: `), course.description, ' ',
        course.status === 'live' ? (course.liveUntil ? `Open until ${fmtDate(course.liveUntil)}.` : 'Open now.') : h('em', {}, 'This twist has finished; its board is kept.'))
    : '';
  const el = h('main', { class: 'page boards' },
    h('h1', {}, 'Leaderboards'),
    tabs, twistNote,
    h('div', { class: 'toolbar' }, kinds, filters, raceLeader,
      h('a', { class: 'btn small', href: `#/projector/${track.id}/${k}` }, 'Projector view'),
      h('a', { class: 'btn small', href: '#/standings' }, 'Standings')),
    callouts, table, updated,
    h('p', { class: 'muted small' }, 'Score = lap time + 1 s per wall hit. Each team’s best counts; on a tie, the earlier submission ranks higher. ',
      k === 'bots' ? 'The Beginner bracket is for Elf teams whose bot was made with the in-browser trainer from their own driving.' : 'Human laps are re-driven by the server from your recorded key presses before they count.'),
  );

  function draw(): void {
    if (!snap) return;
    const rows = snap.entries.filter((e) => filter === 'all' || (filter === 'beginner' ? e.beginner : e.level === filter));
    if (!rows.length) {
      const b = k === 'bots' ? baselineScore(course, snap) : null;
      table.replaceChildren(h('div', { class: 'empty' }, h('p', {}, snap.entries.length ? 'Nobody in this bracket yet.' : 'No times yet. Be the first!'),
        b !== null ? h('p', { class: 'muted' }, `The baseline bot does ${fmtTime(b)} s here. Can you beat it?`) : '',
        h('a', { class: 'btn btn-primary', href: k === 'bots' ? `#/train/${track.id}` : `#/drive/${track.id}` }, k === 'bots' ? 'Train a bot' : 'Drive a lap')));
    } else {
      table.replaceChildren(h('table', { class: 'board-table' },
        h('caption', { class: 'sr-only' }, `${snap.trackName} ${k} leaderboard`),
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Team'), h('th', { scope: 'col' }, 'College'),
          h('th', { scope: 'col', class: 'num' }, 'Score (s)'), h('th', { scope: 'col', class: 'num' }, 'Penalties'),
          h('th', { scope: 'col' }, 'Level'), h('th', { scope: 'col' }, 'Submitted'), h('th', { scope: 'col' }, ''))),
        h('tbody', {}, withBaseline(rows).map((e, i) => e === 'baseline' ? baselineRow() :
          h('tr', { class: e.teamId === myTeam ? 'mine' : '' },
            h('td', { class: 'rank' }, String(filter === 'all' ? e.rank : rows.indexOf(e) + 1), ' ', movement(e)),
            h('td', {}, h('a', { href: `#/teams/${e.teamId}` }, e.team)),
            h('td', {}, e.college),
            h('td', { class: 'num strong' }, fmtTime(e.score)),
            h('td', { class: 'num' }, String(e.penalties)),
            h('td', {}, h('span', { class: `badge ${e.level}` }, e.level), e.beginner ? h('span', { class: 'badge beginner' }, 'beginner') : ''),
            h('td', {}, ago(e.submittedAt)),
            h('td', {}, h('div', { class: 'row-actions' },
              h('a', { class: 'btn small', href: `#/replay/remote/${e.replayId}` }, 'Watch'),
              h('a', { class: 'btn small', href: `#/drive/${track.id}/${e.replayId}` }, 'Race ghost'))),
          ))),
      ));
    }
    const lead = snap.entries[0];
    raceLeader.hidden = !lead;
    if (lead) {
      raceLeader.setAttribute('href', `#/drive/${track.id}/${lead.replayId}`);
      raceLeader.title = `Drive against ${lead.team}'s ${fmtTime(lead.score)} s as a ghost`;
    }
    const ups = snap.entries.filter((e) => e.prevRank !== null && e.prevRank > e.rank).sort((a, b) => (b.prevRank! - b.rank) - (a.prevRank! - a.rank));
    const leader = snap.entries[0];
    callouts.replaceChildren(
      leader ? h('div', { class: 'callout' }, h('strong', {}, leader.prevRank !== 1 ? 'New leader: ' : 'Leader: '), `${leader.team} (${fmtTime(leader.score)} s)`) : '',
      ups[0] ? h('div', { class: 'callout' }, h('strong', {}, 'Biggest climber: '), `${ups[0].team} (▲${ups[0].prevRank! - ups[0].rank})`) : '',
    );
    updated.textContent = `Updated ${new Date(snap.updatedAt).toLocaleTimeString()}. Refreshes automatically.`;
  }

  /** The baseline bot as a reference row, slotted in where its time would rank (not ranked itself). */
  function withBaseline(rows: Entry[]): (Entry | 'baseline')[] {
    const b = k === 'bots' ? baselineScore(course, snap) : null;
    if (b === null) return rows;
    const at = rows.findIndex((e) => e.score > b);
    const out: (Entry | 'baseline')[] = [...rows];
    out.splice(at === -1 ? rows.length : at, 0, 'baseline');
    return out;
  }
  function baselineRow(): HTMLElement {
    const b = baselineScore(course, snap)!;
    return h('tr', { class: 'baseline-row' },
      h('td', { class: 'rank' }, '–'),
      h('td', { colspan: '2' }, h('strong', {}, 'Baseline bot'), h('span', { class: 'muted small' }, ' (a few hand-written rules; beat it for a badge)')),
      h('td', { class: 'num' }, fmtTime(b)),
      h('td', { class: 'num' }, String(snap?.baseline?.penalties ?? 0)),
      h('td', {}), h('td', {}),
      h('td', {}, h('div', { class: 'row-actions' }, h('a', { class: 'btn small', href: `#/replay/baseline/${track.id}` }, 'Watch'))));
  }

  const stop = pollBoard(courseBoardKey(course, k), (s) => {
    snap = s;
    draw();
  }, () => (updated.textContent = 'Could not reach the server; retrying…'));
  return { el, dispose: stop };
}

/** Big, auto-refreshing board for the kickoff projector. */
export function projectorScreen(trackId?: string, kind?: string): Screen {
  const track = getCourse(trackId ?? '') ?? getCourse(TRACKS[0].id)!;
  const k: 'bots' | 'humans' = kind === 'humans' ? 'humans' : 'bots';
  const list = h('ol', { class: 'proj-list' });
  const banner = h('div', { class: 'proj-banner', 'aria-live': 'assertive' });
  const el = h('main', { class: 'projector' },
    h('header', {}, h('h1', {}, `${track.name}: ${k === 'bots' ? 'Bots' : 'Humans'}`), h('p', {}, location.host)),
    banner, list);
  let leaderKey = '';
  const stop = pollBoard(courseBoardKey(track, k), (s) => {
    const top = s.entries.slice(0, 10);
    list.replaceChildren(...top.map((e) =>
      h('li', {}, h('span', { class: 'p-rank' }, String(e.rank)), h('span', { class: 'p-team' }, e.team, h('small', {}, ` ${e.college}`)),
        e.beginner ? h('span', { class: 'badge beginner' }, 'beginner') : '', h('span', { class: 'p-score' }, fmtTime(e.score)))));
    if (!top.length) list.replaceChildren(h('li', { class: 'p-empty' }, 'Waiting for the first time…'));
    const lk = top[0] ? `${top[0].teamId}:${top[0].score}` : '';
    if (leaderKey && lk && lk !== leaderKey) {
      banner.textContent = `New record! ${top[0].team} — ${fmtTime(top[0].score)} s`;
      banner.classList.add('show');
      setTimeout(() => banner.classList.remove('show'), 8000);
    }
    leaderKey = lk;
  }, () => undefined);
  document.body.classList.add('projector-mode');
  return { el, dispose: () => { stop(); document.body.classList.remove('projector-mode'); } };
}

/** Public team page. */
export function publicTeamScreen(id: string): Screen {
  const el = h('main', { class: 'page narrow' }, h('p', {}, 'Loading…'));
  api.get<{ team: { name: string; college: string; level: string; members: { displayName: string }[]; badges: Badge[] }; entries: { board_key: string; score: number; penalties: number; replay_id: string }[] }>(`/teams/${encodeURIComponent(id)}`)
    .then(async ({ team, entries }) => {
      const names = new Map<string, string>();
      for (const e of entries) {
        const [, t, tw] = e.board_key.split('/');
        const cid = tw === 'base' ? t : tw;
        names.set(e.board_key, (await ensureCourse(cid))?.name ?? cid);
      }
      el.replaceChildren(
        h('h1', {}, team.name),
        h('p', { class: 'lead' }, `${team.college} · ${team.level} · ${team.members.map((m) => m.displayName).join(', ')}`),
        badgeShelf(team.badges),
        h('h2', {}, 'Best times'),
        entries.length
          ? h('table', { class: 'laps-table' }, h('tbody', {}, entries.map((e) => {
              const kind = e.board_key.split('/')[3];
              return h('tr', {}, h('td', {}, `${names.get(e.board_key)} (${kind})`), h('td', { class: 'num' }, `${fmtTime(e.score)} s`),
                h('td', {}, h('a', { href: `#/replay/remote/${e.replay_id}` }, 'Watch')));
            })))
          : h('p', { class: 'muted' }, 'No times yet.'),
      );
    })
    .catch((e) => el.replaceChildren(h('h1', {}, 'Team not found'), h('p', {}, e instanceof Error ? e.message : String(e))));
  return { el };
}

export interface Badge {
  id: string;
  name: string;
  emoji: string;
  description: string;
  awardedAt?: string;
}

/** Earned badges in colour; with `all`, the rest greyed out as goals. */
export function badgeShelf(earned: Badge[], all?: Badge[]): HTMLElement {
  const have = new Set(earned.map((b) => b.id));
  const list = all ? all.map((b) => earned.find((e) => e.id === b.id) ?? b) : earned;
  return h('section', { class: 'badges', 'aria-label': 'Badges' },
    h('h2', {}, 'Badges'),
    list.length
      ? h('ul', { class: 'badge-shelf' }, list.map((b) =>
          h('li', { class: have.has(b.id) ? 'earned' : 'locked', title: `${b.description}${b.awardedAt ? ` Earned ${fmtDate(b.awardedAt)}.` : ''}` },
            h('span', { class: 'badge-emoji', 'aria-hidden': 'true' }, b.emoji), h('span', { class: 'badge-name' }, b.name),
            have.has(b.id) ? '' : h('span', { class: 'sr-only' }, ' (not yet earned)'))))
      : h('p', { class: 'muted' }, 'None yet.'));
}

interface Standings {
  formula: string[];
  teams: { rank: number; teamId: string; team: string; college: string; level: string; points: number; places: number[] }[];
  colleges: { rank: number; college: string; points: number; teams: { team: string; points: number }[] }[];
}

/** Team and college standings, with the formula on the page. */
export function standingsScreen(): Screen {
  const body = h('div', {}, h('p', {}, 'Loading…'));
  const el = h('main', { class: 'page standings' }, h('h1', {}, 'Standings'), body);
  api.get<Standings>('/standings').then((s) => {
    body.replaceChildren(
      h('details', { class: 'formula', open: true }, h('summary', {}, 'How points work'), h('ul', {}, s.formula.map((f) => h('li', {}, f)))),
      h('h2', {}, 'Colleges'),
      s.colleges.length
        ? h('table', { class: 'board-table' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'College'), h('th', { class: 'num' }, 'Points'), h('th', {}, 'Teams counted'))),
            h('tbody', {}, s.colleges.map((c) => h('tr', {}, h('td', {}, String(c.rank)), h('td', {}, c.college), h('td', { class: 'num strong' }, String(c.points)),
              h('td', {}, c.teams.map((t) => `${t.team} (${t.points})`).join(', '))))))
        : h('p', { class: 'muted' }, 'No points yet.'),
      h('h2', {}, 'Teams'),
      s.teams.length
        ? h('table', { class: 'board-table' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Team'), h('th', {}, 'College'), h('th', {}, 'Level'), h('th', { class: 'num' }, 'Points'), h('th', { class: 'num' }, 'Wins'))),
            h('tbody', {}, s.teams.map((t) => h('tr', {}, h('td', {}, String(t.rank)), h('td', {}, h('a', { href: `#/teams/${t.teamId}` }, t.team)), h('td', {}, t.college),
              h('td', {}, h('span', { class: `badge ${t.level}` }, t.level)), h('td', { class: 'num strong' }, String(t.points)), h('td', { class: 'num' }, String(t.places[0]))))))
        : h('p', { class: 'muted' }, 'No points yet.'),
    );
  }).catch((e) => body.replaceChildren(h('p', {}, e instanceof Error ? e.message : String(e))));
  return { el };
}
