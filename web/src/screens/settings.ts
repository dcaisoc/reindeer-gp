/** Settings: reduced motion and driving assists, kept in this browser. */

import { getPrefs, setPrefs, type Prefs } from '../prefs.js';
import { h, toast, type Screen } from '../ui.js';

export function settingsScreen(): Screen {
  const p = getPrefs();
  const radio = <K extends keyof Prefs>(name: K, value: Prefs[K], label: string, hint: string) =>
    h('label', { class: 'check radio' },
      h('input', { type: 'radio', name, value: String(value), checked: p[name] === value, onchange: () => { setPrefs({ [name]: value } as Partial<Prefs>); toast('Saved.'); } }),
      ' ', h('strong', {}, label), h('span', { class: 'muted small' }, ` ${hint}`));
  const auto = h('input', { type: 'checkbox', id: 'pref-auto', checked: p.autoThrottle, onchange: () => { setPrefs({ autoThrottle: auto.checked }); toast('Saved.'); } }) as HTMLInputElement;
  const el = h('main', { class: 'page narrow settings' },
    h('h1', {}, 'Settings'),
    h('p', { class: 'lead' }, 'These settings are kept in this browser.'),
    h('fieldset', {},
      h('legend', {}, 'Motion'),
      radio('motion', 'auto', 'Follow my device', '(your system’s “reduce motion” setting)'),
      radio('motion', 'reduce', 'Reduce motion', '(no animations; replays and bot test-drives wait for you to press Play)'),
      radio('motion', 'full', 'Full motion', '')),
    h('fieldset', {},
      h('legend', {}, 'Driving assists'),
      h('p', { class: 'muted small' }, 'For anyone who finds fast key presses hard. Assists never change the physics: your lap time is game time, and your laps are just as good for training a bot. Laps driven with an assist are marked “assisted” on the Human board.'),
      radio('slow', 1, 'Normal speed', ''),
      radio('slow', 0.75, '75% speed', '(the game runs slower; lap times are unchanged)'),
      radio('slow', 0.5, 'Half speed', ''),
      h('p', {}, h('label', { class: 'check', for: 'pref-auto' }, auto, ' ', h('strong', {}, 'Auto-throttle'), h('span', { class: 'muted small' }, ' the game handles go and brake; you only steer with ← →. Pressing ↑ or ↓ takes over.')))),
    h('fieldset', {},
      h('legend', {}, 'Keyboard'),
      h('p', {}, 'Everything except driving works with the keyboard: Tab and Shift+Tab move between controls, Enter or Space presses them. In the replay viewer, Space plays and pauses, ← → step through the replay.')),
  );
  return { el };
}
