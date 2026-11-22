/** Loss curve and network diagram for the trainer (canvas, no libraries). */

export function drawLossCurve(canvas: HTMLCanvasElement, train: number[], val: (number | null)[], epochs: number): void {
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const all = [...train, ...(val.filter((v) => v !== null) as number[])];
  const max = Math.max(0.05, ...all) * 1.08;
  const X = (i: number) => pad.l + (i / Math.max(1, epochs - 1)) * (w - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  ctx.strokeStyle = '#d5dee8';
  ctx.fillStyle = '#4a5a70';
  ctx.font = '11px system-ui, sans-serif';
  ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, Y(v));
    ctx.lineTo(w - pad.r, Y(v));
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(v.toFixed(2), pad.l - 6, Y(v) + 4);
  }
  ctx.textAlign = 'center';
  ctx.fillText('practice rounds (epochs)', (pad.l + w - pad.r) / 2, h - 6);
  const line = (vals: (number | null)[], colour: string, dash: number[]) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2.5;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    vals.forEach((v, i) => {
      if (v === null) return;
      if (started) ctx.lineTo(X(i), Y(v));
      else {
        ctx.moveTo(X(i), Y(v));
        started = true;
      }
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line(train, '#b20d27', []);
  line(val, '#2b6cb0', [6, 4]);
}

/**
 * Network diagram: a column of circles per layer, every connection drawn,
 * red for positive weights and blue for negative, thicker for stronger.
 * Large layers show a sample of neurons so it stays readable.
 */
export function drawNetwork(canvas: HTMLCanvasElement, sizes: number[], weights: Float64Array[] | null, labels: string[]): void {
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const MAX_SHOWN = 12;
  const shown = sizes.map((n) => Math.min(n, MAX_SHOWN));
  const left = 70;
  const right = 70;
  const colX = (c: number) => left + (c / (sizes.length - 1)) * (w - left - right);
  const rowY = (c: number, r: number) => {
    const n = shown[c];
    const gap = Math.min(26, (h - 20) / Math.max(1, n));
    return h / 2 + (r - (n - 1) / 2) * gap;
  };
  // Connections.
  for (let c = 0; c < sizes.length - 1; c++) {
    const W = weights?.[c];
    let maxAbs = 1e-9;
    if (W) for (const v of W) maxAbs = Math.max(maxAbs, Math.abs(v));
    for (let o = 0; o < shown[c + 1]; o++) {
      for (let i = 0; i < shown[c]; i++) {
        const v = W ? W[o * sizes[c] + i] : 0;
        const s = Math.abs(v) / maxAbs;
        ctx.strokeStyle = W ? (v >= 0 ? `rgba(200, 16, 46, ${0.08 + 0.7 * s})` : `rgba(43, 108, 176, ${0.08 + 0.7 * s})`) : 'rgba(74, 90, 112, 0.15)';
        ctx.lineWidth = W ? 0.4 + 2.6 * s : 0.6;
        ctx.beginPath();
        ctx.moveTo(colX(c), rowY(c, i));
        ctx.lineTo(colX(c + 1), rowY(c + 1, o));
        ctx.stroke();
      }
    }
  }
  // Neurons.
  ctx.font = '11px system-ui, sans-serif';
  for (let c = 0; c < sizes.length; c++) {
    for (let r = 0; r < shown[c]; r++) {
      ctx.fillStyle = c === 0 ? '#1f8a5b' : c === sizes.length - 1 ? '#b20d27' : '#0f2340';
      ctx.beginPath();
      ctx.arc(colX(c), rowY(c, r), 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#13233a';
      if (c === 0 && labels[r]) {
        ctx.textAlign = 'right';
        ctx.fillText(labels[r], colX(c) - 10, rowY(c, r) + 4);
      }
      if (c === sizes.length - 1) {
        ctx.textAlign = 'left';
        ctx.fillText(r === 0 ? 'steer' : 'throttle', colX(c) + 10, rowY(c, r) + 4);
      }
    }
    if (sizes[c] > shown[c]) {
      ctx.fillStyle = '#4a5a70';
      ctx.textAlign = 'center';
      ctx.fillText(`${sizes[c]} neurons`, colX(c), h - 4);
    }
  }
}
