// SERP 栏挂载相关的纯函数：锚点候选级联解析 + 宿主页 CSS shim 注入/移除。
//
// 从 entrypoints/serp-bar.content.ts 抽出以便单测（content script 的 IIFE 内部
// 定义无法被导入测试；详见 docs/solutions/runtime-errors/serp-to-extension-page-blocked-by-client.md
// 关于 content script 不得有 named export 的说明）。镜像 lib/serp-bar-layout.ts
// 与 lib/serp-handoff.ts 的「纯函数 + 注入依赖」模式。
import type { AnchorStrategy, SearchEngine } from '@/lib/engines/types';

/** 各 engine 注入宿主页 <head> 的 <style> 共享 id。 */
export const PAGE_STYLES_ID = 'juso-serp-page-styles';

/**
 * 锚点候选级联解析：返回首个 selector 命中的候选；全部不命中时落到末位候选，
 * 使调用方的 MutationObserver 等待有一个具体的 selector 可监听。
 * 纯函数：querySelector 可注入，便于无 DOM 环境下的单测。
 *
 * 注：`candidates` 由 registry 契约保证至少一个元素；传入空数组会返回 `undefined`，
 * 属调用方编程错误，此处不做防御。
 */
export function pickAnchor(
  candidates: AnchorStrategy[],
  querySelectorFn: (selector: string) => Element | null = (s) => document.querySelector(s),
): AnchorStrategy {
  for (const candidate of candidates) {
    if (querySelectorFn(candidate.selector)) return candidate;
  }
  return candidates[candidates.length - 1];
}

/**
 * 把 engine 的宿主页 CSS shim 作为 <style#{PAGE_STYLES_ID}> 注入 <head>。
 * 幂等：先移除同 id 的旧 <style>（防御上一轮 mount 周期未清理的残留）。
 * engine 未声明 pageStyles（如 Bing）时为 no-op。doc 可注入便于单测。
 */
export function injectPageStyles(engine: SearchEngine, doc: Document = document): void {
  if (!engine.pageStyles) return;
  const existing = doc.head.querySelector<HTMLStyleElement>(`style#${PAGE_STYLES_ID}`);
  if (existing) existing.remove();
  const styleEl = doc.createElement('style');
  styleEl.id = PAGE_STYLES_ID;
  styleEl.dataset.engine = engine.id;
  styleEl.textContent = engine.pageStyles;
  doc.head.append(styleEl);
}

/** 移除宿主页 CSS shim；不存在时为 no-op。doc 可注入便于单测。 */
export function removePageStyles(doc: Document = document): void {
  doc.head.querySelector(`style#${PAGE_STYLES_ID}`)?.remove();
}
