import { describe, it, expect } from 'vitest';
import { detectGap, appendGap } from './gap-detector.js';

describe('detectGap', () => {
  it('keine Lücke ohne vorherige Trennung (closedAt = null)', () => {
    expect(detectGap(null, Date.now(), 60_000)) .toBeNull();
  });

  it('keine Lücke unterhalb der Schwelle', () => {
    const closedAt = 1_000_000;
    const reopenedAt = closedAt + 30_000; // 30s
    expect(detectGap(closedAt, reopenedAt, 60_000)).toBeNull();
  });

  it('genau auf der Schwelle → keine Lücke (Grenzfall exklusiv)', () => {
    const closedAt = 1_000_000;
    const reopenedAt = closedAt + 60_000;
    expect(detectGap(closedAt, reopenedAt, 60_000)).toBeNull();
  });

  it('Lücke oberhalb der Schwelle: from/to/minutes korrekt', () => {
    const closedAt = Date.parse('2026-08-25T16:14:39.998Z');
    const reopenedAt = Date.parse('2026-08-25T16:59:26.562Z'); // ~45 Min (realer Fall aus #483)
    const gap = detectGap(closedAt, reopenedAt, 2 * 60_000);
    expect(gap).toEqual({
      from: '2026-08-25T16:14:39.998Z',
      to: '2026-08-25T16:59:26.562Z',
      minutes: 45,
    });
  });

  it('rundet Minuten', () => {
    const closedAt = 0;
    const reopenedAt = 150_000; // 2.5 Min
    const gap = detectGap(closedAt, reopenedAt, 60_000);
    expect(gap?.minutes).toBe(3);
  });
});

describe('appendGap', () => {
  const gap = (n: number) => ({ from: `t${n}`, to: `t${n}`, minutes: n });

  it('hängt an eine leere Liste an', () => {
    expect(appendGap([], gap(1), 5)).toEqual([gap(1)]);
  });

  it('hängt an eine bestehende Liste an', () => {
    expect(appendGap([gap(1)], gap(2), 5)).toEqual([gap(1), gap(2)]);
  });

  it('deckelt auf maxEntries — älteste zuerst raus', () => {
    const gaps = [gap(1), gap(2), gap(3)];
    expect(appendGap(gaps, gap(4), 3)).toEqual([gap(2), gap(3), gap(4)]);
  });
});
