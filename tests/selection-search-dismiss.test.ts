import { describe, it, expect } from 'vitest';
import { createInsidePointerGuard } from '@/lib/selection-search-dismiss';

// 「弹窗内指针按下」守卫单元测试：压制点击弹窗内普通 div 引起的选区塌陷误关闭。
// 时序背景：mousedown（记录）→ 默认动作折叠选区 → selectionchange（查询压制）→
// mouseup（放行时清除）。entrypoint 本体因 webextension-polyfill 无法在 vitest 下
// import，故守卫以纯逻辑抽离后在此覆盖。

describe('createInsidePointerGuard', () => {
  it('弹窗内 mousedown → noteMouseDown 返回 true 且压制生效', () => {
    const guard = createInsidePointerGuard();
    const host = document.createElement('div');
    const inside = document.createElement('button');
    host.appendChild(inside);
    // composedPath 模拟：[target, ..., host, document, window]
    expect(guard.noteMouseDown([inside, host, document], host)).toBe(true);
    expect(guard.shouldSuppressSelectionDismiss()).toBe(true);
  });

  it('弹窗外 mousedown → noteMouseDown 返回 false 且不压制', () => {
    const guard = createInsidePointerGuard();
    const host = document.createElement('div');
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    try {
      expect(guard.noteMouseDown([outside, document.body, document], host)).toBe(false);
      expect(guard.shouldSuppressSelectionDismiss()).toBe(false);
    } finally {
      document.body.removeChild(outside);
    }
  });

  it('host 为 null（弹窗未挂载）时不压制', () => {
    const guard = createInsidePointerGuard();
    expect(guard.noteMouseDown([document, window], null)).toBe(false);
    expect(guard.shouldSuppressSelectionDismiss()).toBe(false);
  });

  it('clear() 后恢复压制关闭（清除陈旧标志）', () => {
    const guard = createInsidePointerGuard();
    const host = document.createElement('div');
    expect(guard.noteMouseDown([host, document], host)).toBe(true);
    expect(guard.shouldSuppressSelectionDismiss()).toBe(true);
    guard.clear();
    expect(guard.shouldSuppressSelectionDismiss()).toBe(false);
  });

  it('连续 mousedown 以最后一次为准（外部点击覆盖内部标志）', () => {
    const guard = createInsidePointerGuard();
    const host = document.createElement('div');
    expect(guard.noteMouseDown([host, document], host)).toBe(true);
    expect(guard.noteMouseDown([document.body, document], host)).toBe(false);
    expect(guard.shouldSuppressSelectionDismiss()).toBe(false);
  });

  // 约定用例：dismissPopup 必须在末尾 guard.clear()（防跨弹窗重建泄漏）。
  // 弹窗内 mousedown 置位的压制标志若随 dismiss 残留，重建后的弹窗会误压制
  // 本应发生的 selectionchange 关闭（弹窗内按下拖出弹窗松开、触屏 pointercancel、
  // 中途禁用开关等场景）。调用点：entrypoints/selection-search.content.ts 的 dismissPopup。
  it('dismissPopup 应 clear（防跨弹窗重建泄漏）', () => {
    const guard = createInsidePointerGuard();
    const host = document.createElement('div');
    // 弹窗内 mousedown 置位 → 压制生效
    expect(guard.noteMouseDown([host, document], host)).toBe(true);
    expect(guard.shouldSuppressSelectionDismiss()).toBe(true);
    // dismissPopup 末尾的 guard.clear()（见 entrypoints/selection-search.content.ts）
    guard.clear();
    // 重建后的弹窗不再误压制本应发生的 selectionchange 关闭
    expect(guard.shouldSuppressSelectionDismiss()).toBe(false);
  });
});
