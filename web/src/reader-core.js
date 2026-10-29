export const normalizeText = (text = '') => text.normalize('NFKC').replace(/\s+/gu, '').trim();
// Dark coloured words (red, blue, green...) are text; pale colours are decoration.
export const isColoredInk = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) > 45 && .299 * r + .587 * g + .114 * b < 150;

export class ReadingGate {
  constructor({ settleMs = 1400, absentMs = 2500, minSamples = 3 } = {}) {
    Object.assign(this, { settleMs, absentMs, minSamples });
    this.reset();
  }
  reset() {
    this.candidate = ''; this.since = 0; this.samples = 0;
    this.lastRead = ''; this.absentSince = null; this.lastSeen = null;
  }
  accept(text, now) {
    const key = normalizeText(text);
    // Slow OCR must still obtain multiple recent observations.
    if (this.lastSeen !== null && now - this.lastSeen > 10000) {
      this.candidate = ''; this.samples = 0;
    }
    this.lastSeen = now;
    // An unreadable frame (glare, focus, an abstained vote) does not end the dialogue.
    // Only a continuous absence closes it and forgets what was read.
    if (this.absentSince !== null && now - this.absentSince >= this.absentMs) {
      this.candidate = ''; this.samples = 0; this.lastRead = '';
    }
    if (!key) {
      this.absentSince ??= now;
      return null;
    }
    this.absentSince = null;
    if (key !== this.candidate) {
      this.candidate = key; this.since = now; this.samples = 1;
      return null;
    }
    this.samples++;
    if (this.samples < this.minSamples || now - this.since < this.settleMs || key === this.lastRead) return null;
    this.lastRead = key;
    return text;
  }
  markRead(text) { this.lastRead = normalizeText(text); }
}

/** Find the game's pale dialogue balloon directly, so no user-selected region is needed.
 * Input can be downsampled; output coordinates are normalized to the whole camera frame.
 * Deliberately conservative: a bright capsule + dark text + lavender outline are required.
 */
export function findDialoguePanel({ data, width: w, height: h }, diagnostics = null) {
  const mask = new Uint8Array(w * h), visited = new Uint8Array(w * h);
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    mask[p] = Math.min(r, g, b) >= 160 && Math.max(r, g, b) - Math.min(r, g, b) < 55 ? 1 : 0;
  }
  const queue = new Int32Array(w * h), candidates = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || visited[seed]) continue;
    let head = 0, tail = 1, count = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    queue[0] = seed; visited[seed] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % w, y = Math.floor(p / w);
      count++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      let n = p - 1;
      if (x > 0 && mask[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
      n = p + 1;
      if (x < w - 1 && mask[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
      n = p - w;
      if (y > 0 && mask[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
      n = p + w;
      if (y < h - 1 && mask[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
    }
    const bw = x1 - x0 + 1;
    if (bw < w * 0.22) continue;
    // A pale character or shirt can touch the balloon. Trim thin protrusions
    // so its upper edge, rather than that character, defines the text crop.
    const rowCounts = new Uint32Array(h);
    for (let i = 0; i < tail; i++) rowCounts[Math.floor(queue[i] / w)]++;
    while (y0 < y1 && rowCounts[y0] < bw * 0.42) y0++;
    while (y1 > y0 && rowCounts[y1] < bw * 0.42) y1--;
    const bh = y1 - y0 + 1, ratio = bw / bh;
    if (bw < w * 0.22 || bh < h * 0.025 || ratio < 2.5 || ratio > 9.5 || y0 < h * 0.28 || count / (bw * bh) < 0.52) continue;
    let dark = 0, total = 0, border = 0, borderTotal = 0;
    for (let y = y0 + Math.ceil(bh * 0.12); y < y0 + bh * 0.88; y++) {
      for (let x = x0 + Math.ceil(bw * 0.07); x < x0 + bw * 0.88; x++) {
        const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
        if (Math.max(r, g, b) < 135 || isColoredInk(r, g, b)) dark++;
        total++;
      }
    }
    // Sample just outside the connected white component, including rounded corners.
    const margin = Math.max(3, Math.round(bh * 0.12));
    for (let y = Math.max(0, y0 - margin); y <= Math.min(h - 1, y1 + margin); y += 2) {
      for (let x = Math.max(0, x0 - margin); x <= Math.min(w - 1, x1 + margin); x += 2) {
        if (x > x0 + margin && x < x1 - margin && y > y0 + margin && y < y1 - margin) continue;
        const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
        if (b > 130 && b - g > 14 && r - g > 5 && b >= r - 10) border++;
        borderTotal++;
      }
    }
    const darkFraction = dark / Math.max(1, total), purpleFraction = border / Math.max(1, borderTotal);
    diagnostics?.push({ x0, y0, bw, bh, darkFraction, purpleFraction });
    // Two characters in the game font cover about 0.25% of the interior; an empty balloon has none.
    if (darkFraction < 0.0015 || darkFraction > 0.35 || purpleFraction < 0.08) continue;
    candidates.push({ x: x0 / w, y: y0 / h, width: bw / w, height: bh / h,
      score: count / (w * h) + purpleFraction * 0.15 + (y0 / h) * 0.32, darkFraction, purpleFraction });
  }
  return candidates.sort((a, b) => b.score - a.score)[0] ?? null;
}

/** Ignore the small ruby rows above the larger main characters. */
export function mainTextBands({ data, width: w, height: h }) {
  const runs = [];
  let start = null, lastDark = -1;
  for (let y = 0; y < h; y++) {
    let dark = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (Math.max(data[i], data[i + 1], data[i + 2]) < 140) dark++;
    }
    if (dark >= Math.max(3, w * 0.003)) { start ??= y; lastDark = y; }
    if (start !== null && (y - lastDark > 1 || y === h - 1)) {
      runs.push({ y: start, height: lastDark - start + 1 }); start = null;
    }
  }
  const maxHeight = Math.max(0, ...runs.map(r => r.height));
  return runs.filter(r => r.height >= Math.max(7, maxHeight * 0.60)).slice(0, 3);
}
