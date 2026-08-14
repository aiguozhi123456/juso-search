// 划词搜索弹窗定位纯函数测试。
//
// computePosition 接受鼠标坐标，返回弹窗视口位置。
// 覆盖：默认右下方放置、右侧溢出翻转左侧、下方溢出翻转上方（flyoutUp）、最终 clamp。
import { describe, it, expect } from 'vitest';
import { computePosition } from '@/lib/selection-search-position';

describe('computePosition: default placement', () => {
  it('places popup below-right of mouse cursor', () => {
    const pos = computePosition(100, 200, 1280, 800);
    expect(pos.x).toBe(108); // mouseX (100) + MARGIN (8)
    expect(pos.y).toBe(208); // mouseY (200) + MARGIN (8)
    expect(pos.flyoutUp).toBe(false);
  });
});

describe('computePosition: right overflow', () => {
  it('flips to left of cursor when popup would overflow right edge', () => {
    // Mouse at far right of a 400px viewport
    const pos = computePosition(390, 100, 400, 800);
    // mouseX (390) + 8 = 398; 398 + 180 (EST_WIDTH) = 578 > 400 - 8 = 392 → flip left
    // Left: mouseX (390) - 180 - 8 = 202
    expect(pos.x).toBe(202);
    expect(pos.flyoutUp).toBe(false);
  });
});

describe('computePosition: bottom overflow', () => {
  it('flips above cursor and sets flyoutUp when popup would overflow bottom', () => {
    // Mouse near bottom of a 200px viewport
    const pos = computePosition(100, 180, 1280, 200);
    // mouseY (180) + 8 = 188; 188 + 36 (EST_HEIGHT) = 224 > 200 - 8 = 192 → flip up
    // Top: mouseY (180) - 36 - 8 = 136
    expect(pos.y).toBe(136);
    expect(pos.flyoutUp).toBe(true);
  });
});

describe('computePosition: clamping', () => {
  it('clamps x to viewport bounds when flipping left produces negative value', () => {
    // Mouse at left edge of a tiny viewport
    const pos = computePosition(0, 50, 100, 400);
    // mouseX (0) + 8 = 8; 8 + 180 = 188 > 100 - 8 = 92 → flip left
    // Left: 0 - 180 - 8 = -188 → clamp to MARGIN (8)
    expect(pos.x).toBe(8);
  });

  it('clamps y to viewport bounds when flipping up produces negative value', () => {
    const pos = computePosition(100, 0, 1280, 50);
    // mouseY (0) + 8 = 8; 8 + 36 = 44 < 50 - 8 = 42 → NO... wait 44 > 42 → flip up
    // Top: 0 - 36 - 8 = -44 → clamp to MARGIN (8)
    expect(pos.y).toBe(8);
    expect(pos.flyoutUp).toBe(true);
  });
});
