/**
 * "Driving data": every lap saved in this browser. Players delete bad laps and
 * choose which ones to train their bot on (training itself arrives in M2).
 */

import { decodeReplay, ReplayFormatError } from '../../../engine/core/replay.js';
import { simulateReplay } from '../../../engine/reindeer/run.js';
import { ENGINE_VERSION } from '../../../engine/reindeer/config.js';
import { bestLap, deleteLap, listLaps, newId, qualityHint, saveLap, updateLap, defaultUseForTraining, type LapRecord } from '../store.js';
import { TRACKS, configFor, ensureCourse, ensureCourseForReplay, geometry, getCourse, listTwists } from '../tracks.js';
import { download, fmtDate, fmtTime, h, toast, type Screen } from '../ui.js';
import { submitHumanLap } from './drive.js';

export function lapsScreen(initialTrack?: string): Screen {
  let filter = initialTrack && getCourse(initialTrack) ? initialTrack : 'all';
  const body = h('div', { class: 'laps-body' });
  const select = h('select', { id: 'track-filter', onchange: (e: Event) => {
    filter = (e.target as HTMLSelectElement).value;
    history.replaceState(null, '', filter === 'all' ? '#/laps' : `#/laps/${filter}`);
    render();
  } },
    h('option', { value: 'all' }, 'All tracks'),
    TRACKS.map((t) => h('option', { value: t.id, selected: t.id === filter }, t.name)),
  );
  // Weekly twists (live and past) join the list once loaded.
  listTwists().then((tw) => {
    for (const w of tw) select.append(h('option', { value: w.id, selected: w.id === filter }, `🌀 ${w.name}`));
  });
  const fileInput = h('input', { type: 'file', accept: '.rgpr', multiple: true, hidden: true, 'aria-label': 'Replay files to import', onchange: (e: Event) => importFiles((e.target as HTMLInputElement).files) });

  const el = h('main', { class: 'page laps' },
    h('h1', {}, 'Your driving data'),
    h('p', { class: 'lead' }, 'Every lap you drive is saved in this browser. Tick the laps your bot should learn from: clean, confident laps teach it best.'),
    h('div', { class: 'toolbar' },
      h('label', { for: 'track-filter' }, 'Track '), select,
      h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Import replay files'),
      fileInput,
    ),
    body,
  );

  async function importFiles(files: FileList | null): Promise<void> {
    if (!files) return;
    let ok = 0;
    for (const f of Array.from(files)) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const rep = await decodeReplay(bytes);
        const course = await ensureCourseForReplay(rep.header);
        if (!course) throw new ReplayFormatError(`Unknown track "${rep.header.twist?.id ?? rep.header.track.id}" (a twist that isn't live yet?).`);
        const track = course.track;
        const out = simulateReplay(track, rep, { geo: geometry(track), cfg: configFor(course.id) });
        if (!out.matches) throw new ReplayFormatError(`does not match engine ${ENGINE_VERSION} (first difference at tick ${(out.firstMismatch + 1) * 60}).`);
        const lap: LapRecord = {
          id: newId(), trackId: track.id, trackVersion: rep.header.track.version, engineVersion: rep.header.engineVersion,
          createdAt: rep.header.createdAt, kind: rep.header.participants[0]?.kind ?? 'human',
          name: rep.header.participants[0]?.name ?? f.name, result: rep.header.result, bytes,
          useForTraining: rep.header.participants[0]?.kind === 'human' && defaultUseForTraining(rep.header.result), imported: true,
        };
        await saveLap(lap);
        ok++;
      } catch (e) {
        toast(`${f.name}: ${e instanceof Error ? e.message : e}`, 'error');
      }
    }
    if (ok) toast(`Imported ${ok} replay${ok === 1 ? '' : 's'}.`);
    fileInput.value = '';
    render();
  }

  async function render(): Promise<void> {
    const laps = await listLaps(filter === 'all' ? undefined : filter);
    if (!laps.length) {
      body.replaceChildren(
        h('div', { class: 'empty' },
          h('p', {}, 'No laps yet.'),
          h('a', { class: 'btn btn-primary', href: `#/drive/${filter === 'all' ? TRACKS[0].id : filter}` }, 'Drive a lap'),
        ),
      );
      return;
    }
    const bests = new Map<string, LapRecord | null>();
    for (const id of new Set(laps.map((l) => l.trackId))) {
      await ensureCourse(id);
      bests.set(id, await bestLap(id));
    }
    const used = laps.filter((l) => l.useForTraining).length;
    const rows = laps.map((lap) => {
      const t = getCourse(lap.trackId);
      const best = bests.get(lap.trackId) ?? null;
      const hint = qualityHint(lap, best);
      const isBest = best?.id === lap.id;
      const cb = h('input', {
        type: 'checkbox',
        checked: lap.useForTraining,
        disabled: lap.kind !== 'human',
        'aria-label': `Use lap from ${fmtDate(lap.createdAt)} for training`,
        onchange: async (e: Event) => {
          await updateLap(lap.id, { useForTraining: (e.target as HTMLInputElement).checked });
          render();
        },
      });
      return h('tr', { class: lap.result.valid ? '' : 'invalid' },
        h('td', {}, cb),
        h('td', {}, fmtDate(lap.createdAt), lap.imported ? h('span', { class: 'tag' }, 'imported') : null, lap.kind === 'bot' ? h('span', { class: 'tag' }, 'bot') : null),
        h('td', {}, t?.name ?? lap.trackId),
        h('td', { class: 'num' }, lap.result.valid ? fmtTime(lap.result.score) : 'DNF', isBest ? h('span', { class: 'tag best' }, 'best') : null),
        h('td', { class: 'num' }, String(lap.result.penalties)),
        h('td', { class: 'num' }, String(lap.result.collisions)),
        h('td', { class: 'hint-cell' }, hint ?? ''),
        h('td', {}, h('div', { class: 'row-actions' },
          h('a', { class: 'btn small', href: `#/replay/lap/${lap.id}` }, 'Watch'),
          lap.kind === 'human' && lap.result.valid ? h('button', { class: 'btn small', onclick: (e: Event) => submitHumanLap(lap, e.currentTarget as HTMLButtonElement) }, 'Submit to Human board') : null,
          h('button', { class: 'btn small', onclick: () => download(lap.bytes, `${lap.trackId}-${lap.id}.rgpr`) }, 'Download'),
          h('button', { class: 'btn small danger', onclick: async () => {
            if (!confirmDelete(lap)) return;
            await deleteLap(lap.id);
            render();
          } }, 'Delete'),
        )),
      );
    });
    body.replaceChildren(
      h('p', { class: 'summary-line' }, `${laps.length} lap${laps.length === 1 ? '' : 's'} · ${used} marked for training`),
      h('div', { class: 'table-wrap' },
        h('table', { class: 'laps-table' },
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col' }, 'Train'), h('th', { scope: 'col' }, 'When'), h('th', { scope: 'col' }, 'Track'),
            h('th', { scope: 'col', class: 'num' }, 'Score (s)'), h('th', { scope: 'col', class: 'num' }, 'Penalties'),
            h('th', { scope: 'col', class: 'num' }, 'Wall hits'), h('th', { scope: 'col' }, 'Advice'), h('th', { scope: 'col' }, ''),
          )),
          h('tbody', {}, rows),
        ),
      ),
    );
  }

  render();
  return { el };
}

/** Inline confirmation without a blocking browser dialog. */
const pendingDelete = new Map<string, number>();
function confirmDelete(lap: LapRecord): boolean {
  const now = Date.now();
  const t = pendingDelete.get(lap.id);
  if (t && now - t < 4000) {
    pendingDelete.delete(lap.id);
    return true;
  }
  pendingDelete.set(lap.id, now);
  toast('Press Delete again to remove this lap.');
  return false;
}
