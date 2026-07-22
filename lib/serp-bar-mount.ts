// SERP 栏挂载相关的纯函数：锚点候选级联解析 + remount 策略 + 宿主页 CSS shim。
//
// 从 entrypoints/serp-bar.content.ts 抽出以便单测（content script 的 IIFE 内部
// 定义无法被导入测试；详见 docs/solutions/runtime-errors/serp-to-extension-page-blocked-by-client.md
// 关于 content script 不得有 named export 的说明）。镜像 lib/serp-bar-layout.ts
// 与 lib/serp-handoff.ts 的「纯函数 + 注入依赖」模式。
import type { AnchorStrategy, SearchEngine } from '@/lib/engines/types';

/** 各 engine 注入宿主页 <head> 的 <style> 共享 id。 */
export const PAGE_STYLES_ID = 'juso-serp-page-styles';

/** 每个 SERP URL 生命周期（locationRevision）允许的最大成功 mount 次数。 */
export const DEFAULT_REMOUNT_BUDGET = 8;

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
 * 多候选时末位视为「兜底」（如 #app）；单候选时无兜底（Bing 等）。
 * 兜底不参与「值得立刻挂载」的 readiness，避免永远不出现首选。
 */
export function preferredAnchorCandidates(candidates: AnchorStrategy[]): AnchorStrategy[] {
  if (candidates.length <= 1) return candidates;
  return candidates.slice(0, -1);
}

export function isLastResortAnchorIndex(candidates: AnchorStrategy[], index: number): boolean {
  return candidates.length > 1 && index === candidates.length - 1;
}

/**
 * 是否存在「值得挂载」的非兜底锚点（或单候选引擎的唯一锚点）。
 */
export function preferredAnchorsPresent(
  candidates: AnchorStrategy[],
  querySelectorFn: (selector: string) => Element | null,
): boolean {
  return preferredAnchorCandidates(candidates).some((c) => !!querySelectorFn(c.selector));
}

export function anyAnchorPresent(
  candidates: AnchorStrategy[],
  querySelectorFn: (selector: string) => Element | null,
): boolean {
  return candidates.some((c) => !!querySelectorFn(c.selector));
}

/**
 * 是否允许在本 revision 发起一次 mount 尝试。
 * - 有非兜底候选 → 可挂
 * - 仅兜底存在且预算只剩最后 1 次 → 允许挂兜底，避免永久空白
 */
export function canAttemptMount(options: {
  candidates: AnchorStrategy[];
  remountBudget: number;
  querySelectorFn: (selector: string) => Element | null;
}): boolean {
  if (options.remountBudget <= 0) return false;
  if (preferredAnchorsPresent(options.candidates, options.querySelectorFn)) return true;
  return options.remountBudget <= 1 && anyAnchorPresent(options.candidates, options.querySelectorFn);
}

/**
 * 是否应从当前挂载升级到更高优先级候选。
 * **仅当当前挂在末位兜底上** 且 任一非兜底候选已出现 时才升级——
 * 禁止「#search-input → .feeds-container」这类非兜底之间的跳位（小红书必然抖动）。
 */
export function shouldUpgradeFromLastResort(options: {
  candidates: AnchorStrategy[];
  mountedAnchorIndex: number;
  querySelectorFn: (selector: string) => Element | null;
}): boolean {
  if (!isLastResortAnchorIndex(options.candidates, options.mountedAnchorIndex)) return false;
  return preferredAnchorsPresent(options.candidates, options.querySelectorFn);
}

/** 消费一次重挂预算；预算耗尽返回 0。 */
export function consumeRemountBudget(budget: number): number {
  return budget > 0 ? budget - 1 : 0;
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
