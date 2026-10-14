import {
  barGeometry,
  compactAxisNumber,
  niceDomain,
  niceStep,
  scaleLinear,
  seriesGeometry,
  timeAxisTicks,
} from '../scale';

const plot = { left: 0, top: 0, width: 100, height: 50 };

describe('niceStep', () => {
  it('picks 1, 2 or 5 times a power of ten', () => {
    expect(niceStep(10, 4)).toBe(2);
    expect(niceStep(1234, 3)).toBe(500);
    expect(niceStep(0.6, 4)).toBe(0.2);
    expect(niceStep(100, 10)).toBe(10);
  });

  it('falls back to 1 for an empty span', () => {
    expect(niceStep(0, 4)).toBe(1);
    expect(niceStep(NaN, 4)).toBe(1);
  });
});

describe('niceDomain', () => {
  it('includes zero and rounds the top out to a step', () => {
    expect(niceDomain([3, 7, 9.2], 4)).toEqual({ min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10] });
  });

  it('keeps zero for an all-positive series that starts high', () => {
    expect(niceDomain([500, 510], 3).min).toBe(0);
  });

  it('rounds the bottom out for negative values', () => {
    const d = niceDomain([-3, 4], 3);
    expect(d.min).toBe(-4);
    expect(d.max).toBe(4);
  });

  it('gives 0–1 with no data or all zeros', () => {
    expect(niceDomain([]).min).toBe(0);
    expect(niceDomain([]).max).toBe(1);
    expect(niceDomain([0, 0]).max).toBe(1);
  });

  it('ignores values that are not finite', () => {
    expect(niceDomain([NaN, Infinity, 2], 2)).toEqual({ min: 0, max: 2, ticks: [0, 1, 2] });
  });

  it('has no float noise in tick values', () => {
    expect(niceDomain([0.3], 3).ticks).toEqual([0, 0.1, 0.2, 0.3]);
  });
});

describe('scaleLinear', () => {
  it('maps and inverts ranges', () => {
    const y = scaleLinear(0, 10, 50, 0);
    expect(y(0)).toBe(50);
    expect(y(10)).toBe(0);
    expect(y(5)).toBe(25);
  });

  it('maps a zero-width domain to the range end', () => {
    expect(scaleLinear(3, 3, 0, 100)(3)).toBe(100);
  });
});

describe('seriesGeometry', () => {
  it('pins the window end to the right edge and the first sample to the left', () => {
    // Samples stop 50s before the window end: the gap shows on the right.
    const g = seriesGeometry(
      [
        { t: 1000, v: 0 },
        { t: 1050, v: 10 },
      ],
      1100,
      plot,
      2
    );
    expect(g.line).toBe('M0,50L50,0');
    expect(g.area).toBe('M0,50L50,0L50,50L0,50Z');
    expect(g.dot).toBeNull();
  });

  it('draws nothing for no data', () => {
    const g = seriesGeometry([], 1100, plot);
    expect(g.line).toBe('');
    expect(g.area).toBe('');
    expect(g.dot).toBeNull();
  });

  it('marks a lone sample with a dot', () => {
    expect(seriesGeometry([{ t: 1050, v: 3 }], 1100, plot, 2).dot).toEqual({ x: 0, y: 12.5 });
    // A lone sample at the window end sits on the right edge.
    expect(seriesGeometry([{ t: 1100, v: 5 }], 1100, plot, 2).dot?.x).toBe(100);
  });

  it('skips samples that are not finite', () => {
    const g = seriesGeometry(
      [
        { t: 1000, v: 0 },
        { t: 1050, v: NaN },
        { t: 1100, v: 10 },
      ],
      1100,
      plot,
      2
    );
    expect(g.line).toBe('M0,50L100,0');
  });

  it('closes the area on the zero line, not the plot bottom', () => {
    const g = seriesGeometry(
      [
        { t: 0, v: -10 },
        { t: 10, v: 10 },
      ],
      10,
      plot,
      2
    );
    expect(g.area.endsWith('L100,25L0,25Z')).toBe(true);
  });
});

describe('barGeometry', () => {
  it('bands bars evenly from zero and caps their width', () => {
    const { bars, domain } = barGeometry([10, 0, 5], { left: 0, top: 0, width: 300, height: 100 }, { maxWidth: 40 });
    expect(domain.max).toBe(10);
    expect(bars.map((b) => b.center)).toEqual([50, 150, 250]);
    expect(bars[0]).toMatchObject({ x: 30, width: 40, y: 0, height: 100 });
    expect(bars[1].height).toBe(0);
    expect(bars[2]).toMatchObject({ y: 50, height: 50 });
  });
});

describe('timeAxisTicks', () => {
  it('gives the first, middle and end times', () => {
    expect(timeAxisTicks(100, 200)).toEqual([100, 150, 200]);
  });
});

describe('compactAxisNumber', () => {
  it('drops trailing zeros', () => {
    expect(compactAxisNumber(1500)).toBe('1.5K');
    expect(compactAxisNumber(2000)).toBe('2K');
    expect(compactAxisNumber(500)).toBe('500');
    expect(compactAxisNumber(0.25)).toBe('0.25');
    expect(compactAxisNumber(0)).toBe('0');
  });
});
