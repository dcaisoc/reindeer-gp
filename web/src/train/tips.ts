/**
 * Plain-language coaching after a training run. Each tip says what happened
 * and one concrete thing to try. No jargon without an explanation.
 */

export interface TipInput {
  finished: boolean;
  collisions: number;
  /** Wall contacts where the nearest wall was on the bot's left / right. */
  hitsLeft: number;
  hitsRight: number;
  samples: number;
  laps: number;
  params: number;
  hiddenLayers: number;
  lossHistory: number[];
  valLoss: number | null;
  trainLoss: number;
  mirror: boolean;
  canMirror: boolean;
  usesSpeed: boolean;
  rays: number;
  botScore: number | null;
  humanBest: number | null;
}

export interface Tip {
  tone: 'good' | 'idea' | 'warn';
  title: string;
  text: string;
}

export function coachingTips(t: TipInput): Tip[] {
  const tips: Tip[] = [];
  if (t.finished && t.collisions === 0) {
    tips.push({ tone: 'good', title: 'Clean lap!', text: 'Your bot got round without touching a wall. Submit it, then see if more (or faster) laps make it quicker.' });
  } else if (t.finished) {
    tips.push({ tone: 'good', title: 'It finished the lap', text: `It touched the wall ${t.collisions} time${t.collisions === 1 ? '' : 's'}, though. Each touch costs a second.` });
  } else {
    tips.push({ tone: 'warn', title: "It didn't finish", text: 'Bots only copy what they have seen. Look at where it went wrong in the replay above, then drive more laps that handle that part well.' });
  }
  const side = t.hitsLeft > t.hitsRight * 1.5 && t.hitsLeft >= 2 ? 'left' : t.hitsRight > t.hitsLeft * 1.5 && t.hitsRight >= 2 ? 'right' : null;
  if (side) {
    tips.push({
      tone: 'idea',
      title: `It keeps hitting the ${side} wall`,
      text: `Drive a few more laps where you take the bends that put the wall on your ${side} cleanly, so it sees more examples of getting them right.` +
        (t.canMirror && !t.mirror ? ' Or try "mirror my laps" in Advanced: it doubles your data by flipping left and right.' : ''),
    });
  }
  if (t.samples < 1500 || t.laps < 3) {
    tips.push({ tone: 'idea', title: 'Not much driving data yet', text: `It learned from ${t.laps} lap${t.laps === 1 ? '' : 's'} (${t.samples} moments). Networks learn better from more examples: aim for 4-6 clean laps.` });
  }
  if (!t.finished && t.params < 300) {
    tips.push({ tone: 'idea', title: 'Its brain may be too small', text: `It has only ${t.params} connections to tune. Try 2 layers of 32 neurons (the Recommended setting).` });
  }
  if (t.valLoss !== null && t.valLoss > t.trainLoss * 1.35 && t.trainLoss > 0) {
    tips.push({
      tone: 'idea',
      title: 'It may be memorising, not learning',
      text: 'It does much better on the laps it practised on than on the bits it was tested on (the dashed line). This is called overfitting. More varied laps, fewer practice rounds, or a smaller network can help.',
    });
  }
  const h = t.lossHistory;
  if (h.length >= 10) {
    const late = h[h.length - 1];
    const earlier = h[Math.floor(h.length * 0.8)];
    if (late < earlier * 0.95) tips.push({ tone: 'idea', title: 'It was still improving', text: 'The red line was still going down at the end. Try more practice rounds (epochs).' });
  }
  if (!t.usesSpeed) tips.push({ tone: 'idea', title: "It can't feel its speed", text: 'Without the speed sensor it cannot tell when to brake. Try ticking "speed".' });
  if (t.rays <= 2) tips.push({ tone: 'idea', title: 'It can barely see', text: `With ${t.rays} distance sensor${t.rays === 1 ? '' : 's'} it is nearly blind on bends. Fewer sensors is a fun challenge, but try 5 or 7 first.` });
  if (t.finished && t.botScore !== null && t.humanBest !== null) {
    const d = t.botScore - t.humanBest;
    tips.push(
      d <= 0
        ? { tone: 'good', title: 'Faster than you!', text: `Your bot beat your best lap by ${(-d).toFixed(2)} s.` }
        : { tone: 'idea', title: `${d.toFixed(2)} s behind your best lap`, text: 'Bots copy your average driving, not your best moments. Training only on your fastest, cleanest laps usually helps.' },
    );
  }
  return tips;
}
