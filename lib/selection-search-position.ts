// 划词搜索弹窗定位纯函数（无浏览器依赖，可单测）。
//
// 从 content script 抽离，避免测试 import 整个 entrypoint（触发 webextension-polyfill
// 在 Node.js 下抛 "This script should only be loaded in a browser extension"）。
//
// 定位策略：弹窗出现在鼠标坐标的右下方（MARGIN 间距），视口边缘自动翻转。

/** 弹窗估计尺寸（用于溢出判断；实际尺寸由 CSS 决定）。 */
const EST_WIDTH = 180;
const EST_HEIGHT = 36;
const MARGIN = 8;

/**
 * 计算弹窗位置：鼠标坐标右下方，视口边缘翻转。
 * flyoutUp = true 时 flyout 朝上展开（弹窗在视口下半部时）。
 */
export function computePosition(
  mouseX: number,
  mouseY: number,
  viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1280),
  viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 800),
): { x: number; y: number; flyoutUp: boolean } {
  let x = mouseX + MARGIN;
  let y = mouseY + MARGIN;

  // 右侧溢出 → 放到鼠标左侧
  if (x + EST_WIDTH > viewportWidth - MARGIN) {
    x = mouseX - EST_WIDTH - MARGIN;
  }

  // 下方溢出 → 放到鼠标上方，flyout 朝上
  let flyoutUp = false;
  if (y + EST_HEIGHT > viewportHeight - MARGIN) {
    flyoutUp = true;
    y = mouseY - EST_HEIGHT - MARGIN;
  }

  // 最终 clamp
  x = Math.max(MARGIN, Math.min(x, viewportWidth - EST_WIDTH - MARGIN));
  y = Math.max(MARGIN, Math.min(y, viewportHeight - MARGIN));

  return { x, y, flyoutUp };
}
