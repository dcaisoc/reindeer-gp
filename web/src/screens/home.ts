import { TRACKS } from '../tracks.js';
import { bestLap, listLaps } from '../store.js';
import { fmtTime, h, stars, type Screen } from '../ui.js';
import { Renderer } from '../render.js';

export function homeScreen(): Screen {
  const cards = TRACKS.map((t) => {
    const best = h('span', { class: 'best' }, 'No laps yet');
    const count = h('span', { class: 'muted' }, '');
    const canvas = h('canvas', { class: 'track-thumb', 'aria-hidden': 'true' });
    bestLap(t.id).then((b) => {
      if (b) best.textContent = `Your best: ${fmtTime(b.result.score)} s`;
    });
    listLaps(t.id).then((l) => {
      if (l.length) count.textContent = `${l.length} lap${l.length === 1 ? '' : 's'} recorded`;
    });
    requestAnimationFrame(() => {
      const r = new Renderer(canvas);
      r.mode = 'full';
      r.setTrack(t);
      r.draw({ x: 0, y: 0 }, { sleighs: [{ x: t.start.x, y: t.start.y, heading: t.start.heading }] });
    });
    return h(
      'article',
      { class: 'track-card' },
      canvas,
      h('div', { class: 'track-info' },
        h('h2', {}, t.name),
        h('p', { class: 'difficulty', 'aria-label': `Difficulty ${t.difficulty} of 3` }, stars(t.difficulty)),
        h('p', {}, t.description),
        h('p', { class: 'stats' }, best, count),
        h('div', { class: 'actions' },
          h('a', { class: 'btn btn-primary', href: `#/drive/${t.id}` }, 'Drive'),
          h('a', { class: 'btn', href: `#/replay/baseline/${t.id}` }, 'Watch the baseline bot'),
        ),
      ),
    );
  });

  const el = h(
    'main',
    { class: 'page home' },
    h('section', { class: 'hero' },
      h('h1', {}, 'Reindeer Grand Prix'),
      h('p', { class: 'lead' }, 'Drive a sleigh round the track. Every lap you drive is recorded, and soon you will train a small neural network to drive like you.'),
      h('ul', { class: 'how' },
        h('li', {}, h('strong', {}, 'Steer'), ' with ← → or A D'),
        h('li', {}, h('strong', {}, 'Go / brake'), ' with ↑ ↓ or W S'),
        h('li', {}, h('strong', {}, 'Pause'), ' with P or Esc, ', h('strong', {}, 'restart'), ' with R'),
        h('li', {}, 'Each wall hit adds ', h('strong', {}, '1 second'), '. Pass every checkpoint in order.'),
      ),
    ),
    h('section', { class: 'tracks', 'aria-label': 'Practice tracks' }, cards),
  );
  return { el };
}
