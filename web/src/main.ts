/**
 * Reindeer Grand Prix web app entry point: a hash router over a few screens.
 *   #/                          tracks (home)
 *   #/drive/<trackId>[/<id>]    drive yourself, optionally against a saved lap or replay as a ghost
 *   #/laps[/<trackId>]          your driving data
 *   #/train[/<trackId>]         train a bot in the browser
 *   #/boards[/<track>/<kind>]   live leaderboards        #/projector/<track>/<kind>  big-screen board
 *   #/replay/lap|baseline|remote|file/<id>               replay viewer
 *   #/standings                 team and college standings
 *   #/settings                  reduced motion and driving assists
 *   #/signin  #/team  #/teams/<id>  #/admin
 * A <trackId> may also be a weekly twist's id.
 */

import { getMe } from './api.js';
import { h, type Screen } from './ui.js';
import { homeScreen } from './screens/home.js';
import { driveScreen } from './screens/drive.js';
import { lapsScreen } from './screens/laps.js';
import { replayScreen } from './screens/replay.js';
import { trainScreen } from './screens/train.js';
import { signinScreen, teamScreen } from './screens/account.js';
import { boardsScreen, projectorScreen, publicTeamScreen, standingsScreen } from './screens/boards.js';
import { ensureCourse, getCourse } from './tracks.js';
import { settingsScreen } from './screens/settings.js';
import { applyMotion } from './prefs.js';
import { adminScreen } from './screens/admin.js';

const app = document.getElementById('app')!;
const nav = document.getElementById('nav')!;
const account = document.getElementById('account')!;
const announce = document.getElementById('announce')!;
let current: Screen | null = null;

let routeSeq = 0;

async function route(): Promise<void> {
  const seq = ++routeSeq;
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query ?? '');
  // Screens that take a track id may be given a weekly twist: load its track and config first.
  const courseParam = ['drive', 'laps', 'train', 'boards', 'projector'].includes(parts[0]) ? parts[1] : parts[0] === 'replay' && parts[1] === 'baseline' ? parts[2] : undefined;
  if (courseParam && !getCourse(courseParam)) {
    await ensureCourse(courseParam);
    if (seq !== routeSeq) return;
  }
  current?.dispose?.();
  app.replaceChildren();
  let screen: Screen;
  try {
    switch (parts[0]) {
      case 'drive': screen = driveScreen(parts[1], parts[2]); break;
      case 'laps': screen = lapsScreen(parts[1]); break;
      case 'replay': screen = replayScreen(parts[1], parts[2]); break;
      case 'train': screen = trainScreen(parts[1]); break;
      case 'boards': screen = boardsScreen(parts[1], parts[2]); break;
      case 'projector': screen = projectorScreen(parts[1], parts[2]); break;
      case 'signin': screen = signinScreen(params); break;
      case 'team': screen = teamScreen(); break;
      case 'teams': screen = publicTeamScreen(parts[1]); break;
      case 'standings': screen = standingsScreen(); break;
      case 'settings': screen = settingsScreen(); break;
      case 'admin': screen = adminScreen(); break;
      default: screen = homeScreen();
    }
  } catch (e) {
    screen = { el: h('main', { class: 'page' }, h('h1', {}, 'Something went wrong'), h('p', {}, String(e)), h('a', { href: '#/' }, 'Back to tracks')) };
  }
  current = screen;
  app.append(screen.el);
  document.body.dataset.screen = parts[0] || 'home';
  for (const a of nav.querySelectorAll('a')) {
    const target = a.getAttribute('href')!.replace(/^#\/?/, '').split('/')[0];
    a.toggleAttribute('aria-current', target === (parts[0] || '') || (target === 'boards' && parts[0] === 'projector'));
  }
  window.scrollTo(0, 0);
}

async function renderAccount(): Promise<void> {
  const me = await getMe();
  account.replaceChildren(
    me.user
      ? h('span', { class: 'who' },
          me.user.isReferee ? h('a', { href: '#/admin' }, 'Referee') : '',
          h('a', { href: '#/team' }, me.user.displayName))
      : h('a', { href: '#/signin' }, 'Sign in'),
  );
}

async function renderAnnouncements(): Promise<void> {
  try {
    const res = await fetch('/api/v1/announcements', { cache: 'no-store' });
    if (!res.ok) return;
    const { announcements } = (await res.json()) as { announcements: { id: string; text: string }[] };
    const dismissed = sessionStorage.getItem('rgp.ann') ?? '';
    const a = announcements[0];
    if (!a || a.id === dismissed) {
      announce.hidden = true;
      return;
    }
    announce.replaceChildren(h('span', {}, a.text), h('button', { class: 'btn small', 'aria-label': 'Dismiss announcement', onclick: () => {
      sessionStorage.setItem('rgp.ann', a.id);
      announce.hidden = true;
    } }, '✕'));
    announce.hidden = false;
  } catch {
    /* offline: no announcements */
  }
}

window.addEventListener('hashchange', () => void route());
window.addEventListener('rgp:me', renderAccount);
applyMotion();
matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyMotion);
void route();
renderAccount();
renderAnnouncements();
setInterval(renderAnnouncements, 120_000);
