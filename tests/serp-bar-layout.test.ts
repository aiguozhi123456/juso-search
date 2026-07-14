import { describe, expect, it } from 'vitest';
import { serpBarStyles } from '@/entrypoints/shared/serp-bar-styles';
import { calculateAlignedHostLayout } from '@/lib/serp-bar-layout';

describe('SERP bar shadow-host layout', () => {
  it('restores host layout with important rules and namespaced alignment variables', () => {
    for (const property of [
      'display: block',
      'position: relative',
      'z-index: 20',
      'box-sizing: border-box',
      'padding: 8px 0',
      'visibility: visible',
      'pointer-events: auto',
    ]) {
      expect(serpBarStyles).toContain(`${property} !important`);
    }
    expect(serpBarStyles).toMatch(/font-family:[^;]+!important/);
    expect(serpBarStyles).toMatch(/margin-left:\s*var\(--juso-serp-offset-left, 0px\)\s*!important/);
    expect(serpBarStyles).toMatch(/width:\s*var\(--juso-serp-width, auto\)\s*!important/);
    expect(serpBarStyles).not.toMatch(/--juso-serp-(?:offset-left|width)\s*:/);
  });

  it('aligns the Bing host to the target content box', () => {
    const layout = calculateAlignedHostLayout(
      { left: 0, width: 1096.667 },
      { borderLeft: 0, borderRight: 0, paddingLeft: 0, paddingRight: 0 },
      { left: 0, width: 1096.667 },
      { borderLeft: 0, borderRight: 0, paddingLeft: 113, paddingRight: 0 },
    );

    expect(layout.offsetLeft).toBe(113);
    expect(layout.width).toBeCloseTo(983.667, 3);
  });

  it('aligns the Google host to #center_col relative to its outer parent', () => {
    expect(
      calculateAlignedHostLayout(
        { left: 0, width: 868 },
        { borderLeft: 0, borderRight: 0, paddingLeft: 0, paddingRight: 0 },
        { left: 52, width: 652 },
        { borderLeft: 0, borderRight: 0, paddingLeft: 0, paddingRight: 0 },
      ),
    ).toEqual({ offsetLeft: 52, width: 652 });
  });

  it('uses parent-relative content boxes and clamps negative geometry', () => {
    expect(
      calculateAlignedHostLayout(
        { left: 40, width: 500 },
        { borderLeft: 2, borderRight: 3, paddingLeft: 11, paddingRight: 13 },
        { left: 70, width: 200 },
        { borderLeft: 5, borderRight: 7, paddingLeft: 17, paddingRight: 19 },
      ),
    ).toEqual({ offsetLeft: 39, width: 152 });

    expect(
      calculateAlignedHostLayout(
        { left: 100, width: 10 },
        { borderLeft: 5, borderRight: 5, paddingLeft: 5, paddingRight: 5 },
        { left: 10, width: 8 },
        { borderLeft: 3, borderRight: 3, paddingLeft: 3, paddingRight: 3 },
      ),
    ).toEqual({ offsetLeft: 0, width: 0 });
  });
});
