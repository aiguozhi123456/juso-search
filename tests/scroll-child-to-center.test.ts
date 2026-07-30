import { describe, it, expect, beforeEach } from 'vitest';
import { scrollChildToCenter } from '@/lib/scroll-child-to-center';

function mockMetrics(
  el: HTMLElement,
  metrics: {
    scrollWidth?: number;
    clientWidth?: number;
    offsetLeft?: number;
    offsetWidth?: number;
    offsetParent?: HTMLElement | null;
  },
) {
  if (metrics.scrollWidth != null) {
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => metrics.scrollWidth });
  }
  if (metrics.clientWidth != null) {
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => metrics.clientWidth });
  }
  if (metrics.offsetLeft != null) {
    Object.defineProperty(el, 'offsetLeft', { configurable: true, get: () => metrics.offsetLeft });
  }
  if (metrics.offsetWidth != null) {
    Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => metrics.offsetWidth });
  }
  if (metrics.offsetParent !== undefined) {
    Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => metrics.offsetParent });
  }
}

describe('scrollChildToCenter', () => {
  let parent: HTMLElement;
  let child: HTMLElement;

  beforeEach(() => {
    parent = document.createElement('div');
    child = document.createElement('button');
    parent.appendChild(child);
    document.body.appendChild(parent);
    parent.scrollLeft = 0;
  });

  it('centers child when there is room on both sides', () => {
    // parent viewport 200, content 600 → maxScroll 400
    // child at offsetLeft 250, width 50 → target = 250 - (200-50)/2 = 175
    mockMetrics(parent, { scrollWidth: 600, clientWidth: 200 });
    mockMetrics(child, { offsetLeft: 250, offsetWidth: 50, offsetParent: parent });
    scrollChildToCenter(parent, child);
    expect(parent.scrollLeft).toBe(175);
  });

  it('clamps to 0 when target would go negative', () => {
    // child near start: target negative → 0
    mockMetrics(parent, { scrollWidth: 600, clientWidth: 200 });
    mockMetrics(child, { offsetLeft: 10, offsetWidth: 50, offsetParent: parent });
    // target = 10 - (200-50)/2 = 10 - 75 = -65 → 0
    scrollChildToCenter(parent, child);
    expect(parent.scrollLeft).toBe(0);
  });

  it('clamps to maxScroll when target exceeds it', () => {
    // child near end
    mockMetrics(parent, { scrollWidth: 600, clientWidth: 200 });
    mockMetrics(child, { offsetLeft: 520, offsetWidth: 50, offsetParent: parent });
    // target = 520 - 75 = 445 → maxScroll 400
    scrollChildToCenter(parent, child);
    expect(parent.scrollLeft).toBe(400);
  });

  it('sets scrollLeft to 0 when maxScroll is 0 (no overflow)', () => {
    parent.scrollLeft = 42;
    mockMetrics(parent, { scrollWidth: 200, clientWidth: 200 });
    mockMetrics(child, { offsetLeft: 50, offsetWidth: 40, offsetParent: parent });
    scrollChildToCenter(parent, child);
    expect(parent.scrollLeft).toBe(0);
  });
});
