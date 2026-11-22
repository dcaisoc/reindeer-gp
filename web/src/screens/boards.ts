/**
 * Live leaderboards. Snapshots are polled every 10 s while the tab is
 * visible (paused when hidden), so boards feel live without costing much.
 */

import { api, boardKey, getMe } from '../api.js';
import { TRACKS, getTrack } from '../tracks.js';
import { fmtTime, h, type Screen } from '../ui.js';

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

export function boardsScreen(trackId?: string, kind?: string): Screen {
  const track = getTrack(trackId ?? '') ?? TRACKS[0];
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
  const el = h('main', { class: 'page boards' },
    h('h1', {}, 'Leaderboards'),
    tabs,
    h('div', { class: 'toolbar' }, kinds, filters,
      h('a', { class: 'btn small', href: `#/projector/${track.id}/${k}` }, 'Projector view')),
    callouts, table, updated,
    h('p', { class: 'muted small' }, 'Score = lap time + 1 s per wall hit. Each team’s best counts; on a tie, the earlier submission ranks higher. ',
      k === 'bots' ? 'The Beginner bracket is for Elf teams whose bot was made with the in-browser trainer from their own driving.' : 'Human laps are re-driven by the server from your recorded key presses before they count.'),
  );

  function draw(): void {
    if (!snap) return;
    const rows = snap.entries.filter((e) => filter === 'all' || (filter === 'beginner' ? e.beginner : e.level === filter));
    if (!rows.length) {
      table.replaceChildren(h('div', { class: 'empty' }, h('p', {}, snap.entries.length ? 'Nobody in this bracket yet.' : 'No times yet. Be the first!'),
        h('a', { class: 'btn btn-primary', href: k === 'bots' ? `#/train/${track.id}` : `#/drive/${track.id}` }, k === 'bots' ? 'Train a bot' : 'Drive a lap')));
    } else {
      table.replaceChildren(h('table', { class: 'board-table' },
        h('caption', { class: 'sr-only' }, `${snap.trackName} ${k} leaderboard`),
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Team'), h('th', { scope: 'col' }, 'College'),
          h('th', { scope: 'col', class: 'num' }, 'Score (s)'), h('th', { scope: 'col', class: 'num' }, 'Penalties'),
          h('th', { scope: 'col' }, 'Level'), h('th', { scope: 'col' }, 'Submitted'), h('th', { scope: 'col' }, ''))),
        h('tbody', {}, rows.map((e, i) =>
          h('tr', { class: e.teamId === myTeam ? 'mine' : '' },
            h('td', { class: 'rank' }, String(filter === 'all' ? e.rank : i + 1), ' ', movement(e)),
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
    const ups = snap.entries.filter((e) => e.prevRank !== null && e.prevRank > e.rank).sort((a, b) => (b.prevRank! - b.rank) - (a.prevRank! - a.rank));
    const leader = snap.entries[0];
    callouts.replaceChildren(
      leader ? h('div', { class: 'callout' }, h('strong', {}, leader.prevRank !== 1 ? 'New leader: ' : 'Leader: '), `${leader.team} (${fmtTime(leader.score)} s)`) : '',
      ups[0] ? h('div', { class: 'callout' }, h('strong', {}, 'Biggest climber: '), `${ups[0].team} (▲${ups[0].prevRank! - ups[0].rank})`) : '',
    );
    updated.textContent = `Updated ${new Date(snap.updatedAt).toLocaleTimeString()}. Refreshes automatically.`;
  }

  const stop = pollBoard(boardKey(track.id, k), (s) => {
    snap = s;
    draw();
  }, () => (updated.textContent = 'Could not reach the server; retrying…'));
  return { el, dispose: stop };
}

/** Big, auto-refreshing board for the kickoff projector. */
export function projectorScreen(trackId?: string, kind?: string): Screen {
  const track = getTrack(trackId ?? '') ?? TRACKS[0];
  const k: 'bots' | 'humans' = kind === 'humans' ? 'humans' : 'bots';
  const list = h('ol', { class: 'proj-list' });
  const banner = h('div', { class: 'proj-banner', 'aria-live': 'assertive' });
  const el = h('main', { class: 'projector' },
    h('header', {}, h('h1', {}, `${track.name}: ${k === 'bots' ? 'Bots' : 'Humans'}`), h('p', {}, location.host)),
    banner, list);
  let leaderKey = '';
  const stop = pollBoard(boardKey(track.id, k), (s) => {
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
  api.get<{ team: { name: string; college: string; level: string; members: { displayName: string }[] }; entries: { board_key: string; score: number; penalties: number; replay_id: string }[] }>(`/teams/${encodeURIComponent(id)}`)
    .then(({ team, entries }) => {
      el.replaceChildren(
        h('h1', {}, team.name),
        h('p', { class: 'lead' }, `${team.college} · ${team.level} · ${team.members.map((m) => m.displayName).join(', ')}`),
        h('h2', {}, 'Best times'),
        entries.length
          ? h('table', { class: 'laps-table' }, h('tbody', {}, entries.map((e) => {
              const [, t, , kind] = e.board_key.split('/');
              return h('tr', {}, h('td', {}, `${getTrack(t)?.name ?? t} (${kind})`), h('td', { class: 'num' }, `${fmtTime(e.score)} s`),
                h('td', {}, h('a', { href: `#/replay/remote/${e.replay_id}` }, 'Watch')));
            })))
          : h('p', { class: 'muted' }, 'No times yet.'),
      );
    })
    .catch((e) => el.replaceChildren(h('h1', {}, 'Team not found'), h('p', {}, e instanceof Error ? e.message : String(e))));
  return { el };
}
