/** Referee tools: settings, announcements, teams, entries, audit log, CSV export. */

import { api, boardKey } from '../api.js';
import { TRACKS } from '../tracks.js';
import { fmtDate, fmtTime, h, toast, type Screen } from '../ui.js';

interface Overview {
  settings: Record<string, string>;
  stats: Record<string, number>;
  teams: { id: string; name: string; college: string; level: string; hidden: number; members: number; created_at: string }[];
  audit: { action: string; target: string | null; display_name: string | null; created_at: string; details_json: string }[];
  announcements: { id: string; text: string; active: number; created_at: string }[];
}

export function adminScreen(): Screen {
  const el = h('main', { class: 'page admin' }, h('h1', {}, 'Referee'));
  const body = h('div');
  el.append(body);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      render();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  async function render(): Promise<void> {
    let o: Overview;
    try {
      o = await api.get<Overview>('/admin/overview');
    } catch (e) {
      body.replaceChildren(h('p', {}, e instanceof Error ? e.message : String(e)));
      return;
    }
    const toggle = (key: string, label: string, onText: string, offText: string, turnOn: string, turnOff: string) => {
      const on = o.settings[key] === 'true';
      return h('p', {}, h('strong', {}, `${label}: `), on ? onText : offText, ' ',
        h('button', { class: 'btn small', onclick: () => act(() => api.post('/admin/settings', { key, value: String(!on) }), `${label} updated.`) }, on ? turnOff : turnOn));
    };
    const limitInput = (key: string, label: string) => {
      const inp = h('input', { type: 'number', min: '0', max: '9999', value: o.settings[key] ?? '', id: `set-${key}`, class: 'short' });
      return h('p', {}, h('label', { for: `set-${key}` }, `${label} `), inp, ' ',
        h('button', { class: 'btn small', onclick: () => act(() => api.post('/admin/settings', { key, value: inp.value }), 'Limit saved.') }, 'Save'));
    };
    const annText = h('textarea', { id: 'ann', rows: '2', maxlength: '500', placeholder: 'Shown at the top of every page' });
    const boardSel = h('select', { id: 'board-sel' }, TRACKS.flatMap((t) => (['bots', 'humans'] as const).map((k) => h('option', { value: boardKey(t.id, k) }, `${t.name} ${k}`))));
    const entriesEl = h('div');
    const loadEntries = async () => {
      const snap = await api.get<{ entries: { rank: number; team: string; teamId: string; score: number }[] }>(`/boards/${boardSel.value}`);
      entriesEl.replaceChildren(snap.entries.length
        ? h('table', { class: 'laps-table' }, h('tbody', {}, snap.entries.map((e) =>
            h('tr', {}, h('td', {}, String(e.rank)), h('td', {}, e.team), h('td', { class: 'num' }, fmtTime(e.score)),
              h('td', {}, h('button', { class: 'btn small danger', onclick: () => act(() => api.post('/admin/entries/hide', { boardKey: boardSel.value, teamId: e.teamId, hidden: true }), 'Entry hidden.') }, 'Hide'))))))
        : h('p', { class: 'muted' }, 'No visible entries.'));
    };
    boardSel.addEventListener('change', loadEntries);

    body.replaceChildren(
      h('section', { class: 'card' },
        h('h2', {}, 'At a glance'),
        h('dl', { class: 'figures' }, Object.entries({
          'Players': o.stats.users, 'Teams': o.stats.teams, 'Submissions today': o.stats.submissionsToday,
          'In the queue': o.stats.queued, 'Rejected today': o.stats.rejectedToday,
        }).map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', { class: 'big' }, String(v))))),
      ),
      h('section', { class: 'card' },
        h('h2', {}, 'Competition switches'),
        toggle('submissions_open', 'Submissions', 'open', 'closed', 'Open submissions', 'Close submissions'),
        toggle('boards_frozen', 'Boards', 'frozen (new scores are saved, but never enter the boards)', 'live', 'Freeze boards', 'Unfreeze boards'),
        limitInput('bot_submissions_per_day', 'Bot submissions per team per day'),
        limitInput('human_submissions_per_day', 'Human laps per team per day'),
        h('a', { class: 'btn', href: '/api/v1/admin/export.csv' }, 'Download results (CSV)'),
      ),
      h('section', { class: 'card' },
        h('h2', {}, 'Announcements'),
        annText, ' ',
        h('button', { class: 'btn btn-primary', onclick: () => act(() => api.post('/admin/announcements', { text: annText.value }), 'Announcement posted.') }, 'Post'),
        h('ul', {}, o.announcements.map((a) => h('li', { class: a.active ? '' : 'muted' }, `${fmtDate(a.created_at)}: ${a.text} `,
          a.active ? h('button', { class: 'btn small', onclick: () => act(() => api.del(`/admin/announcements/${a.id}`), 'Removed.') }, 'Remove') : '(removed)'))),
      ),
      h('section', { class: 'card' },
        h('h2', {}, 'Leaderboard entries'),
        h('label', { for: 'board-sel' }, 'Board '), boardSel, entriesEl,
      ),
      h('section', { class: 'card' },
        h('h2', {}, 'Teams'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'laps-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'College'), h('th', {}, 'Level'), h('th', { class: 'num' }, 'Members'), h('th', {}))),
          h('tbody', {}, o.teams.map((t) => {
            const name = h('input', { value: t.name, maxlength: '32', 'aria-label': `New name for ${t.name}` });
            return h('tr', { class: t.hidden ? 'invalid' : '' },
              h('td', {}, name), h('td', {}, t.college), h('td', {}, t.level), h('td', { class: 'num' }, String(t.members)),
              h('td', {}, h('div', { class: 'row-actions' },
                h('button', { class: 'btn small', onclick: () => act(() => api.post(`/admin/teams/${t.id}`, { name: name.value }), 'Team renamed.') }, 'Rename'),
                h('button', { class: 'btn small danger', onclick: () => act(() => api.post(`/admin/teams/${t.id}`, { hidden: !t.hidden }), t.hidden ? 'Team shown.' : 'Team hidden.') }, t.hidden ? 'Show' : 'Hide'))));
          })))),
      ),
      h('section', { class: 'card' },
        h('h2', {}, 'Audit log (latest 50)'),
        h('ul', { class: 'audit' }, o.audit.map((a) => h('li', {}, `${fmtDate(a.created_at)} · ${a.display_name ?? 'someone'} · ${a.action}${a.target ? ` · ${a.target}` : ''}`))),
      ),
    );
    loadEntries();
  }

  render();
  return { el };
}
