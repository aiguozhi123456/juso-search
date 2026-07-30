/**
 * 把 child 滚到 scrollParent 可视区域的水平中心。
 * 纯函数：只读写 scrollLeft，不依赖 React。clamp 到 [0, maxScroll]。
 */
export function scrollChildToCenter(scrollParent: HTMLElement, child: HTMLElement): void {
  const maxScroll = Math.max(0, scrollParent.scrollWidth - scrollParent.clientWidth);
  if (maxScroll <= 0) {
    scrollParent.scrollLeft = 0;
    return;
  }
  // offsetLeft 相对 offsetParent；若 child 不在 scrollParent 的 offset 链上，用 getBoundingClientRect 差分。
  let childLeft = child.offsetLeft;
  let node: HTMLElement | null = child.offsetParent as HTMLElement | null;
  while (node && node !== scrollParent) {
    childLeft += node.offsetLeft;
    node = node.offsetParent as HTMLElement | null;
  }
  if (node !== scrollParent) {
    const parentRect = scrollParent.getBoundingClientRect();
    const childRect = child.getBoundingClientRect();
    childLeft = childRect.left - parentRect.left + scrollParent.scrollLeft;
  }
  const target = childLeft - (scrollParent.clientWidth - child.offsetWidth) / 2;
  scrollParent.scrollLeft = Math.min(maxScroll, Math.max(0, target));
}
