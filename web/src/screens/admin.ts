/** Referee tools: twists, settings, announcements, teams, entries, digest, audit log, CSV export. */

interface TwistAdmin {
  id: string;
  version: string;
  name: string;
  description: string;
  baseTrack: string;
  liveFrom: string | null;
  liveUntil: string | null;
  override: 'live' | 'off' | null;
  wentLiveAt: string | null;
  status: 'live' | 'ended' | 'staged';
  entries: number;
  baseline: { valid: boolean; score: number | null } | null;
  dryRun: {
    status: string;
    createdAt: string;
    results: { baseline?: { valid: boolean; score: number | null }; bots?: { team: string; botName: string; valid: boolean; score: number | null; penalties: number | null; note: string | null }[]; error?: string } | null;
  } | null;
}

/** "2026-12-07T12:00:00.000Z" -> "2026-12-07T12:00" in this browser's time zone, for <input type=datetime-local>. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

import { api, ApiError } from '../api.js';
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
    const boards = (await api.get<{ boards: { key: string; trackName: string; kind: string }[] }>('/boards')).boards;
    const boardSel = h('select', { id: 'board-sel' }, boards.map((b) => h('option', { value: b.key }, `${b.trackName} ${b.kind}`)));
    const twists = (await api.get<{ twists: TwistAdmin[] }>('/admin/twists')).twists;
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
      twistsCard(twists),
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
      digestCard(),
      h('section', { class: 'card' },
        h('h2', {}, 'Audit log (latest 50)'),
        h('ul', { class: 'audit' }, o.audit.map((a) => h('li', {}, `${fmtDate(a.created_at)} · ${a.display_name ?? 'someone'} · ${a.action}${a.target ? ` · ${a.target}` : ''}`))),
      ),
    );
    loadEntries();
  }

  function twistsCard(list: TwistAdmin[]): HTMLElement {
    const file = h('input', { type: 'file', accept: '.json,application/json', id: 'twist-file' }) as HTMLInputElement;
    const problems = h('div', { 'aria-live': 'polite' });
    file.onchange = async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const r = await api.post<{ id: string; baseline: { valid: boolean; score: number | null } | null }>('/admin/twists', JSON.parse(await f.text()));
        toast(`Twist ${r.id} uploaded. Baseline bot: ${r.baseline?.valid ? `${fmtTime(r.baseline.score)} s` : 'does not finish'}.`);
        render();
      } catch (e) {
        const errs = e instanceof ApiError ? ((e.details.errors as string[]) ?? []) : [];
        problems.replaceChildren(h('p', { class: 'error-text' }, e instanceof Error ? e.message : String(e)), errs.length ? h('ul', {}, errs.map((x) => h('li', {}, x))) : '');
      }
      file.value = '';
    };
    const rows = list.map((t) => {
      const from = h('input', { type: 'datetime-local', value: toLocalInput(t.liveFrom), 'aria-label': `${t.name} opens` }) as HTMLInputElement;
      const until = h('input', { type: 'datetime-local', value: toLocalInput(t.liveUntil), 'aria-label': `${t.name} closes` }) as HTMLInputElement;
      const set = (body: Record<string, unknown>, msg: string) => act(() => api.patch(`/admin/twists/${t.id}`, body), msg);
      const dry = t.dryRun;
      const dryBody = !dry ? h('p', { class: 'muted small' }, 'No dry run yet.')
        : dry.status !== 'done' ? h('p', { class: 'muted small' }, `Dry run ${dry.status}… (started ${when(dry.createdAt)}; reload to update)`)
        : h('details', {}, h('summary', {}, `Dry run ${when(dry.createdAt)}: ${dry.results?.bots?.filter((b) => b.valid).length ?? 0} of ${dry.results?.bots?.length ?? 0} bots finish (baseline ${dry.results?.baseline?.valid ? `${fmtTime(dry.results.baseline.score)} s` : 'DNF'})`),
            h('table', { class: 'laps-table' }, h('tbody', {}, (dry.results?.bots ?? []).map((b) =>
              h('tr', {}, h('td', {}, b.team), h('td', {}, b.botName), h('td', { class: 'num' }, b.valid ? `${fmtTime(b.score)} s` : '—'), h('td', { class: 'muted small' }, b.note ?? `${b.penalties} penalties`))))));
      return h('article', { class: `twist-admin ${t.status}` },
        h('h3', {}, `🌀 ${t.name} `, h('span', { class: `badge ${t.status}` }, t.status === 'staged' ? 'not public yet' : t.status), h('small', { class: 'muted' }, ` ${t.id} v${t.version} · on ${t.baseTrack}`)),
        h('p', { class: 'muted small' }, t.description),
        h('p', {}, `Opens ${when(t.liveFrom)} · closes ${when(t.liveUntil)}`, t.override ? h('strong', {}, ` · override: ${t.override === 'live' ? 'live now' : 'taken down'}`) : '',
          ` · ${t.entries} board entr${t.entries === 1 ? 'y' : 'ies'} · baseline ${t.baseline ? (t.baseline.valid ? `${fmtTime(t.baseline.score)} s` : 'DNF') : '…'}`),
        h('p', { class: 'schedule' },
          h('label', {}, 'Opens ', from), ' ', h('label', {}, 'Closes ', until), ' ',
          h('button', { class: 'btn small', onclick: () => set({ liveFrom: fromLocalInput(from.value), liveUntil: fromLocalInput(until.value) }, 'Schedule saved. It goes live on its own at that time.') }, 'Save schedule'),
          h('span', { class: 'muted small' }, ' (times in this computer’s time zone)')),
        h('div', { class: 'row-actions' },
          t.status !== 'live' ? h('button', { class: 'btn small btn-primary', onclick: () => confirm(`Make "${t.name}" live for everyone now?`) && set({ override: 'live' }, 'Live now.') }, 'Go live now') : '',
          t.status === 'live' ? h('button', { class: 'btn small danger', onclick: () => confirm(`Close "${t.name}" now? Its board is kept.`) && set({ override: 'off' }, 'Taken down.') }, 'Take down now') : '',
          t.override ? h('button', { class: 'btn small', onclick: () => set({ override: null }, 'Following the schedule again.') }, 'Follow schedule') : '',
          h('button', { class: 'btn small', onclick: () => act(() => api.post(`/admin/twists/${t.id}/dry-run`), 'Dry run started: every team’s latest bot is racing privately. Reload in a moment.') }, 'Dry run'),
          h('a', { class: 'btn small', href: `#/drive/${t.id}` }, 'Test drive'),
          !t.wentLiveAt ? h('button', { class: 'btn small danger', onclick: () => confirm(`Delete "${t.name}"?`) && act(() => api.del(`/admin/twists/${t.id}`), 'Twist deleted.') }, 'Delete') : ''),
        dryBody);
    });
    return h('section', { class: 'card' },
      h('h2', {}, 'Weekly twists'),
      h('p', { class: 'muted small' }, 'Upload a twist file (made with npm run tracks), schedule it, and do a dry run to see how current bots cope. A twist stays hidden until it opens; then it can’t be replaced or deleted, only taken down.'),
      h('p', {}, h('label', { for: 'twist-file' }, 'Upload twist file '), file), problems,
      list.length ? rows : h('p', { class: 'muted' }, 'No twists yet.'));
  }

  function digestCard(): HTMLElement {
    const days = h('input', { type: 'number', min: '1', max: '60', value: '7', class: 'short', id: 'digest-days' }) as HTMLInputElement;
    const out = h('textarea', { rows: '12', readonly: true, class: 'digest', 'aria-label': 'Digest text', hidden: true }) as HTMLTextAreaElement;
    const copy = h('button', { class: 'btn small', hidden: true, onclick: async () => {
      await navigator.clipboard?.writeText(out.value).catch(() => undefined);
      toast('Digest copied. Paste it into the group chat.');
    } }, 'Copy');
    return h('section', { class: 'card' },
      h('h2', {}, 'Weekly digest'),
      h('p', { class: 'muted small' }, 'A markdown summary of leaders, records, climbers, badges and colleges, ready for the group chat. It is also posted every Monday at 09:00 on the repository’s Actions page.'),
      h('p', {}, h('label', { for: 'digest-days' }, 'Days to cover '), days, ' ',
        h('button', { class: 'btn small btn-primary', onclick: async () => {
          const res = await fetch(`/api/v1/digest.md?days=${encodeURIComponent(days.value)}`, { cache: 'no-store' });
          out.value = await res.text();
          out.hidden = false;
          copy.hidden = false;
        } }, 'Build digest'), ' ', copy),
      out);
  }

  render();
  return { el };
}
