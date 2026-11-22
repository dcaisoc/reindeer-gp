/** Sign-in and team pages. */

import { api, ApiError, getMe, refreshMe, type Submission, type TeamView } from '../api.js';
import { getTrack } from '../tracks.js';
import { fmtDate, h, toast, type Screen } from '../ui.js';
import { statusText } from './train.js';
import { badgeShelf, type Badge } from './boards.js';

const LEVEL_TEXT: Record<string, string> = {
  elf: 'Elf: never trained a network. Drive, click Train, submit. No code.',
  reindeer: 'Reindeer: can write some Python. Use the template notebook.',
  santa: 'Santa: keen or experienced. Anything goes, as long as it exports to the bot format.',
};

export function signinScreen(params: URLSearchParams): Screen {
  const el = h('main', { class: 'page narrow' }, h('h1', {}, 'Sign in'));
  const ret = params.get('return');
  const returnPath = `/#/${ret && /^[a-z/0-9-]+$/.test(ret) ? ret : 'team'}`;
  const error = params.get('error');
  getMe().then((me) => {
    if (me.user) {
      location.hash = returnPath.slice(1);
      return;
    }
    el.append(
      error ? h('p', { class: 'banner-inline error', role: 'alert' }, error) : '',
      h('p', { class: 'lead' }, 'Sign in with your Cambridge Raven account to save laps to your team, submit bots and appear on the leaderboards. You can drive, train and watch without signing in.'),
      me.noServer
        ? h('p', { class: 'banner-inline error', role: 'alert' },
            "Can't reach the Reindeer Grand Prix server. If you're offline, your laps are safe in this browser; try again later. " +
            "(Running it yourself? Use npm run dev, which starts the server too.)")
        : me.ravenConfigured
          ? h('a', { class: 'btn btn-primary big', href: `/api/v1/auth/raven/start?return=${encodeURIComponent(returnPath)}` }, 'Sign in with Raven')
          : h('p', { class: 'muted' }, me.devLogin
              ? 'This is a local or test copy without Raven: use the test sign-in below.'
              : 'Raven sign-in is not configured on this server yet.'),
      h('p', { class: 'muted small' }, 'We only keep a fingerprint of your email (to recognise you next time), a display name you choose, and your team. Nothing else. You can delete your account at any time from the Team page.'),
    );
    if (me.devLogin) {
      const email = h('input', { type: 'email', id: 'dev-email', placeholder: 'abc123@cam.ac.uk', required: true });
      const form = h('form', { class: 'card dev-login', onsubmit: async (e: Event) => {
        e.preventDefault();
        try {
          await api.post('/auth/dev', { email: email.value });
          await refreshMe();
          location.hash = returnPath.slice(1);
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), 'error');
        }
      } },
        h('h2', {}, 'Test sign-in'),
        h('p', { class: 'muted small' }, 'This server is in test mode: sign in as any @cam.ac.uk address without a password.'),
        h('label', { for: 'dev-email' }, 'Email '), email, ' ', h('button', { class: 'btn', type: 'submit' }, 'Sign in'),
      );
      el.append(form);
    }
  });
  return { el };
}

export function teamScreen(): Screen {
  const el = h('main', { class: 'page narrow team' }, h('h1', {}, 'Your team'));
  const body = h('div');
  el.append(body);
  let poll = 0;

  async function render(): Promise<void> {
    const me = await getMe();
    if (!me.user) {
      body.replaceChildren(h('p', {}, 'Sign in to create or join a team.'), h('a', { class: 'btn btn-primary', href: '#/signin?return=team' }, 'Sign in'));
      return;
    }
    const { team } = await api.get<{ team: TeamView | null }>('/teams/mine');
    const meta = await api.get<{ colleges: string[] }>('/meta');
    const profile = profileCard(me.user.displayName);
    if (!team) {
      body.replaceChildren(createJoin(meta.colleges), profile, dangerZone());
      return;
    }
    const subs = await api.get<{ submissions: Submission[] }>('/submissions').catch(() => ({ submissions: [] as Submission[] }));
    const levelSel = h('select', { id: 'level', onchange: async () => {
      try {
        await api.patch('/teams/mine', { level: levelSel.value });
        toast('Level updated.');
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
        render();
      }
    } }, (['elf', 'reindeer', 'santa'] as const).map((l) => h('option', { value: l, selected: l === team.level }, l[0].toUpperCase() + l.slice(1))));
    const copyBtn = h('button', { class: 'btn small', onclick: async () => {
      await navigator.clipboard?.writeText(team.joinCode ?? '').catch(() => undefined);
      toast('Join code copied.');
    } }, 'Copy');
    body.replaceChildren(
      h('section', { class: 'card' },
        h('h2', {}, team.name),
        h('dl', { class: 'facts' },
          h('dt', {}, 'College'), h('dd', {}, team.college),
          h('dt', {}, h('label', { for: 'level' }, 'Level')), h('dd', {}, levelSel, team.levelLocked ? h('span', { class: 'muted small' }, ' (locked after your first bot: you can move up, not down)') : ''),
          h('dt', {}, 'Join code'), h('dd', {}, h('code', { class: 'join-code' }, team.joinCode ?? ''), ' ', copyBtn, h('span', { class: 'muted small' }, ' Share it with up to 3 teammates.')),
          h('dt', {}, 'Members'), h('dd', {}, team.members.map((m) => m.displayName + (m.role === 'captain' ? ' (captain)' : '')).join(', ')),
        ),
        h('p', { class: 'muted small' }, LEVEL_TEXT[team.level]),
        h('div', { class: 'actions' },
          h('a', { class: 'btn btn-primary', href: '#/train' }, 'Train a bot'),
          h('a', { class: 'btn', href: '#/boards' }, 'Leaderboards'),
          h('button', { class: 'btn danger', onclick: async () => {
            if (!(await confirmTwice('leave', 'Press "Leave team" again to confirm.'))) return;
            await api.post('/teams/leave');
            await refreshMe();
            render();
          } }, 'Leave team'),
        ),
      ),
      h('section', { class: 'card' },
        h('h2', {}, 'Recent submissions'),
        subs.submissions.length
          ? h('table', { class: 'laps-table' },
              h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'What'), h('th', {}, 'Track'), h('th', {}, 'Result'), h('th', {}))),
              h('tbody', {}, subs.submissions.slice(0, 30).map((s) =>
                h('tr', {},
                  h('td', {}, fmtDate(s.createdAt)),
                  h('td', {}, s.kind === 'bot' ? `Bot "${s.botName}"` : 'Your driving'),
                  h('td', {}, getTrack(s.trackId)?.name ?? s.trackId),
                  h('td', {}, statusText(s)),
                  h('td', {}, s.replayId ? h('a', { href: `#/replay/remote/${s.replayId}` }, 'Watch') : ''),
                ))))
          : h('p', { class: 'muted' }, 'Nothing yet. Train a bot, or submit one of your laps to the Human board from Driving data.'),
      ),
      badgesCard(team.badges ?? []),
      uploadCard(),
      tokensCard(),
      profile,
      dangerZone(),
    );
    if (subs.submissions.some((s) => s.status === 'queued' || s.status === 'running')) poll = window.setTimeout(render, 3000);
  }

  function createJoin(colleges: string[]): HTMLElement {
    const name = h('input', { id: 'team-name', maxlength: '32', required: true, placeholder: 'e.g. Sleigh Bells' });
    const college = h('select', { id: 'team-college', required: true }, h('option', { value: '' }, 'Choose…'), colleges.map((c) => h('option', { value: c }, c)));
    const levels = (['elf', 'reindeer', 'santa'] as const).map((l, i) =>
      h('label', { class: 'level-choice' }, h('input', { type: 'radio', name: 'level', value: l, checked: i === 0 }), ` ${LEVEL_TEXT[l]}`));
    const code = h('input', { id: 'join-code', maxlength: '6', placeholder: 'ABC234', autocomplete: 'off' });
    return h('div', { class: 'two-col' },
      h('form', { class: 'card', onsubmit: async (e: Event) => {
        e.preventDefault();
        const level = (el.querySelector('input[name=level]:checked') as HTMLInputElement).value;
        try {
          await api.post('/teams', { name: name.value, college: college.value, level });
          await refreshMe();
          render();
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), 'error');
        }
      } },
        h('h2', {}, 'Create a team'),
        h('p', {}, h('label', { for: 'team-name' }, 'Team name'), h('br'), name),
        h('p', {}, h('label', { for: 'team-college' }, 'College'), h('br'), college),
        h('fieldset', {}, h('legend', {}, 'Level'), levels),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create team'),
      ),
      h('form', { class: 'card', onsubmit: async (e: Event) => {
        e.preventDefault();
        try {
          await api.post('/teams/join', { code: code.value });
          await refreshMe();
          render();
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), 'error');
        }
      } },
        h('h2', {}, 'Join a team'),
        h('p', {}, 'Ask your captain for the 6-character join code.'),
        h('p', {}, h('label', { for: 'join-code' }, 'Join code'), h('br'), code),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Join team'),
      ),
    );
  }

  /** Personal API tokens for the `reindeer` command-line tool and notebooks. */
  function badgesCard(earned: Badge[]): HTMLElement {
    const card = h('section', { class: 'card' }, badgeShelf(earned));
    api.get<{ badges: Badge[] }>('/meta').then((m) => card.replaceChildren(badgeShelf(earned, m.badges))).catch(() => undefined);
    return card;
  }

  function uploadCard(): HTMLElement {
    const out = h('div', { 'aria-live': 'polite' });
    const file = h('input', { type: 'file', id: 'bot-file', accept: '.json,application/json' }) as HTMLInputElement;
    const send = h('button', { class: 'btn btn-primary small', disabled: true }, 'Submit to every track') as HTMLButtonElement;
    let bot: unknown = null;
    file.onchange = async () => {
      bot = null;
      send.disabled = true;
      const f = file.files?.[0];
      if (!f) return out.replaceChildren();
      try {
        bot = JSON.parse(await f.text());
      } catch {
        return out.replaceChildren(h('p', { class: 'error-text' }, `${f.name} is not a JSON file.`));
      }
      const v = await api.post<{ ok: boolean; errors: string[]; params: number }>('/bots/validate', bot);
      if (!v.ok) {
        bot = null;
        return out.replaceChildren(h('p', { class: 'error-text' }, `${f.name} has ${v.errors.length === 1 ? 'a problem' : 'problems'}:`), h('ul', {}, v.errors.map((e) => h('li', {}, e))));
      }
      out.replaceChildren(h('p', {}, `\u2713 ${f.name} is a valid bot (${v.params} parameters).`));
      send.disabled = false;
    };
    send.onclick = async () => {
      if (!bot) return;
      send.disabled = true;
      try {
        const r = await api.post<{ submissions: { id: string }[] }>('/submissions', { bot });
        toast(`Submitted to ${r.submissions.length} track${r.submissions.length === 1 ? '' : 's'}. Results appear under Submissions in a minute.`);
        render();
      } catch (e) {
        send.disabled = false;
        const msg = e instanceof ApiError && e.code === 'invalid_bot' ? `${e.message} ${(e.details.errors as string[]).join(' ')}` : e instanceof Error ? e.message : String(e);
        toast(msg, 'error');
      }
    };
    return h('section', { class: 'card' },
      h('h2', {}, 'Submit a bot file'),
      h('p', { class: 'muted small' }, 'Trained in a notebook or anywhere else? Upload the ', h('code', {}, '.json'), ' bot file here. It is checked before it is sent. ',
        h('a', { href: 'https://dcaisoc.github.io/reindeer-gp/formats/bot/', target: '_blank', rel: 'noopener' }, 'Bot file format')),
      h('p', {}, h('label', { for: 'bot-file' }, 'Bot file '), file, ' ', send),
      out,
    );
  }

  function tokensCard(): HTMLElement {
    const list = h('ul', { class: 'token-list' });
    const shown = h('div', { 'aria-live': 'polite' });
    const label = h('input', { id: 'token-label', maxlength: '40', placeholder: 'e.g. my laptop' });
    const load = async () => {
      const { tokens } = await api.get<{ tokens: { id: string; label: string; createdAt: string; lastUsedAt: string | null }[] }>('/me/tokens');
      list.replaceChildren(...(tokens.length ? tokens.map((t) => h('li', {},
        `${t.label} · created ${fmtDate(t.createdAt)} · ${t.lastUsedAt ? `last used ${fmtDate(t.lastUsedAt)}` : 'never used'} `,
        h('button', { class: 'btn small danger', onclick: async () => {
          await api.del(`/me/tokens/${t.id}`);
          toast('Token revoked. Anything using it will stop working.');
          load();
        } }, 'Revoke'))) : [h('li', { class: 'muted' }, 'No tokens yet.')]));
    };
    const card = h('section', { class: 'card' },
      h('h2', {}, 'API tokens (for Python and the command line)'),
      h('p', { class: 'muted small' }, 'Reindeer and Santa teams can submit bots from Python with ', h('code', {}, 'reindeer submit bot.json'), '. A token can only submit bots and read results: it can\u2019t change your team or account. Keep it secret, like a password.'),
      h('p', {}, h('label', { for: 'token-label' }, 'Label '), label, ' ',
        h('button', { class: 'btn small', onclick: async () => {
          try {
            const t = await api.post<{ token: string; label: string }>('/me/tokens', { label: label.value });
            label.value = '';
            const code = h('code', { class: 'token-value' }, t.token);
            shown.replaceChildren(h('div', { class: 'hint' },
              h('strong', {}, `New token "${t.label}": copy it now, it won\u2019t be shown again.`), h('br'), code, ' ',
              h('button', { class: 'btn small', onclick: async () => {
                await navigator.clipboard?.writeText(t.token).catch(() => undefined);
                toast('Token copied. Run `reindeer login` and paste it.');
              } }, 'Copy')));
            load();
          } catch (e) {
            toast(e instanceof Error ? e.message : String(e), 'error');
          }
        } }, 'Create token')),
      shown, list,
    );
    load().catch(() => undefined);
    return card;
  }

  function profileCard(displayName: string): HTMLElement {
    const input = h('input', { id: 'display-name', value: displayName, maxlength: '32' });
    return h('section', { class: 'card' },
      h('h2', {}, 'Your profile'),
      h('p', {}, h('label', { for: 'display-name' }, 'Display name '), input, ' ',
        h('button', { class: 'btn small', onclick: async () => {
          try {
            await api.patch('/me', { displayName: input.value });
            await refreshMe();
            toast('Display name saved.');
          } catch (e) {
            toast(e instanceof ApiError ? e.message : String(e), 'error');
          }
        } }, 'Save')),
      h('p', { class: 'muted small' }, 'Shown to your teammates. Your real name and email are never shown.'),
      h('button', { class: 'btn small', onclick: async () => {
        await api.post('/auth/logout');
        await refreshMe();
        location.hash = '#/';
      } }, 'Sign out'),
    );
  }

  function dangerZone(): HTMLElement {
    return h('details', { class: 'card danger-zone' },
      h('summary', {}, 'Delete my account'),
      h('p', {}, 'This removes your sign-in, display name and team membership. Results your team already set stay on the leaderboards under the team name (a team with no members left is renamed). Laps saved in this browser are not affected.'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmTwice('delete', 'Press "Delete my account" again to confirm. This cannot be undone.'))) return;
        await api.del('/me');
        await refreshMe();
        toast('Your account has been deleted.');
        location.hash = '#/';
      } }, 'Delete my account'),
    );
  }

  render().catch((e) => body.replaceChildren(h('p', { class: 'error-text' }, e instanceof Error ? e.message : String(e))));
  const onMe = () => render();
  window.addEventListener('rgp:me', onMe);
  return { el, dispose: () => { clearTimeout(poll); window.removeEventListener('rgp:me', onMe); } };
}

const pending = new Map<string, number>();
async function confirmTwice(key: string, msg: string): Promise<boolean> {
  const t = pending.get(key);
  if (t && Date.now() - t < 5000) {
    pending.delete(key);
    return true;
  }
  pending.set(key, Date.now());
  toast(msg);
  return false;
}
