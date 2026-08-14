// 划词搜索弹窗的选区塌陷压制守卫（纯逻辑，无浏览器依赖，可单测）。
//
// 从 content script 抽离，避免测试 import 整个 entrypoint（触发 webextension-polyfill
// 在 Node.js 下抛 "This script should only be loaded in a browser extension"）；
// 且 jsdom 无法模拟「mousedown 默认动作折叠真实选区 → selectionchange」的完整时序，
// 故把可判定的状态机部分拆出单独覆盖。
//
// 用途：点击弹窗内部（如分组容器等普通 div）时，mousedown 默认动作会把划词选区折叠，
// selectionchange 随之派发；若无守卫，handleSelectionChange 会无条件 dismissPopup，
// 弹窗在 click 到达前就被卸载，onClick 永远不生效。此守卫记录「本次 mousedown 是否
// 在弹窗内」，供 selectionchange 处理器判断是否压制这次误关闭。

/**
 * 创建「弹窗内指针按下」守卫。
 *
 * 生命周期约定：每次 mousedown 先调 noteMouseDown 记录落点；若 mousedown 发生在
 * 弹窗内部（mouseup 也预期在内部，return 前调 clear 之外的路径见下），期间的
 * selectionchange 塌陷应被 shouldSuppressSelectionDismiss 压制；mouseup 分支在
 * 放行（return）前调 clear 清除标志，防止陈旧标志压制后续合法关闭。
 */
export function createInsidePointerGuard() {
  let pointerInsidePopup = false;

  return {
    /**
     * 记录本次 mousedown 是否落在弹窗内。
     * @param composedPath mousedown 事件的 composedPath（穿透 shadow DOM）
     * @param host 弹窗 shadow host（未挂载时为 null）
     * @returns 是否在弹窗内
     */
    noteMouseDown(composedPath: EventTarget[], host: EventTarget | null): boolean {
      pointerInsidePopup = host != null && composedPath.includes(host);
      return pointerInsidePopup;
    },

    /** selectionchange 处理器查询：当前是否应压制「选区塌陷 → 关闭弹窗」。 */
    shouldSuppressSelectionDismiss(): boolean {
      return pointerInsidePopup;
    },

    /** 清除标志（mouseup 放行前调用，防止陈旧标志压制后续合法关闭）。 */
    clear(): void {
      pointerInsidePopup = false;
    },
  };
}
