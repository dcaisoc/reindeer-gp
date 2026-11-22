/**
 * Reindeer Grand Prix web app entry point: a hash router over a few screens.
 *   #/                       tracks (home)
 *   #/drive/<trackId>        drive yourself
 *   #/drive/<trackId>/<lapId> drive against a chosen lap's ghost
 *   #/laps                   your driving data
 *   #/replay/lap/<lapId>     replay viewer for a saved lap
 *   #/replay/baseline/<id>   watch the baseline bot
 *   #/replay/file            a replay loaded from a file
 */

import { h, type Screen } from './ui.js';
import { homeScreen } from './screens/home.js';
import { driveScreen } from './screens/drive.js';
import { lapsScreen } from './screens/laps.js';
import { replayScreen } from './screens/replay.js';

const app = document.getElementById('app')!;
const nav = document.getElementById('nav')!;
let current: Screen | null = null;

function route(): void {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  current?.dispose?.();
  app.replaceChildren();
  let screen: Screen;
  try {
    if (parts[0] === 'drive' && parts[1]) screen = driveScreen(parts[1], parts[2]);
    else if (parts[0] === 'laps') screen = lapsScreen(parts[1]);
    else if (parts[0] === 'replay') screen = replayScreen(parts[1], parts[2]);
    else screen = homeScreen();
  } catch (e) {
    screen = { el: h('main', { class: 'page' }, h('h1', {}, 'Something went wrong'), h('p', {}, String(e)), h('a', { href: '#/' }, 'Back to tracks')) };
  }
  current = screen;
  app.append(screen.el);
  document.body.dataset.screen = parts[0] || 'home';
  for (const a of nav.querySelectorAll('a')) {
    const target = a.getAttribute('href')!.replace(/^#\/?/, '').split('/')[0];
    a.toggleAttribute('aria-current', target === (parts[0] || ''));
  }
}

window.addEventListener('hashchange', route);
route();
