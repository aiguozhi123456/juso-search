// 右键菜单：选中文本后用 juso 的任一搜索源搜索。
//
// 菜单结构镜像快切栏（SourceSwitcher）的分组布局（resolveEffectiveLayout / projectLayout）：
//   - 置顶源 → 直接作为父菜单的子项；
//   - 分组   → 作为子菜单，组内源作为其子项。
// 点击叶子项时从 info.selectionText 取查询词，用 resolveSerpHandoff 解析跳转
// （engine/ai-engine/site/custom → 直接 URL；provider → 扩展搜索页深链），
// 在新标签页打开。菜单在 worker 启动时构建，并在相关 storage 键变化时重建。
//
// 并发与生命周期注意：
//   - S1：sourceById 是模块级内存 Map，MV3 worker 被终止后清零。唤醒时菜单重建
//     （await getProviderConfigSnapshot）可能尚未完成而 onClicked 已派发——点击处理
//     在 map 未命中时回退到「读快照 → 同参投影 → find」，保证首次点击也有效。
//   - S2：重建请求带 in-flight 防重入，但改为「pending 标记 + do/while 排队重跑」——
//     重建期间到达的新请求标记 pending，当前轮结束后自动再跑一轮，不丢请求。

import { getProviderConfigSnapshot } from './storage';
import { allSources, sourceLabel, type SearchSource } from './sources';
import { projectLayout, resolveEffectiveLayout, type SourceLabel } from './source-groups';
import { resolveSerpHandoff } from './serp-handoff';
import { buildSafeSearchUrl } from './search-page-url';
import { applyLocalePref, t } from './i18n';
import { isLocalePref } from './ui-pref-sync';

const ROOT_MENU_ID = 'juso-search-root';
const SOURCE_PREFIX = 'juso-src:';
const GROUP_PREFIX = 'juso-group:';

/** 模块级 source 映射：菜单构建时填充，点击时据此解析 source（避免重复读配置）。 */
let sourceById = new Map<string, SearchSource>();

/** 触发菜单重建的 storage key 集合（这些键变化会影响菜单结构与可用源）。 */
const REBUILD_KEYS = new Set([
  'sourceOrder',
  'sourceHidden',
  'siteEngines',
  'customEngines',
  'providerInstances',
  'groupConfig',
  'providerKeys',
  'localePref',
  'flatLayoutFewSources',
]);

/** 判断某次 storage 变更是否需要重建右键菜单。 */
export function contextMenuNeedsRebuild(changes: Record<string, unknown>): boolean {
  return Object.keys(changes).some((key) => REBUILD_KEYS.has(key));
}

function resolveLabel(label: SourceLabel): string {
  return label.kind === 'literal' ? label.value : t(label.key);
}

/**
 * 重建右键菜单树（带排队防重入）。
 *
 * 并发语义：重建 in-flight 期间再次调用不丢请求——置 rebuildPending 标记，
 * 当前轮结束后 do/while 自动再跑一轮（合并突发重建请求）。finally 中复位
 * rebuilding，保证异常路径也能解锁。
 */
let rebuilding = false;
let rebuildPending = false;
export async function setupContextMenu(): Promise<void> {
  if (rebuilding) {
    rebuildPending = true; // 请求排队，不丢弃
    return;
  }
  rebuilding = true;
  try {
    do {
      rebuildPending = false;
      await rebuildMenuOnce();
    } while (rebuildPending);
  } finally {
    rebuilding = false;
  }
}

/**
 * 单轮菜单重建：应用语言偏好 → 读配置快照 → 投影源列表 → 投影布局 → 创建菜单树。
 * 置顶源直接挂根菜单下；分组作为子菜单、组内源挂其下；菜单项 id 编码 sourceId。
 * 无可用源时仅清空旧菜单（removeAll）不创建任何项。整体 try/catch 保证重建失败
 * 不冒泡（有日志可排障），sourceById 仅在全部填充完成后一次性赋值。
 */
async function rebuildMenuOnce(): Promise<void> {
  try {
    // M1：语言偏好参与菜单标题。非法值回退 'auto'。
    const prefGot = await browser.storage.local.get('localePref');
    applyLocalePref(isLocalePref(prefGot.localePref) ? prefGot.localePref : 'auto');

    const snapshot = await getProviderConfigSnapshot();
    const sources = allSources(
      snapshot.configuredProviderIds,
      snapshot.sourceOrder,
      snapshot.sourceHidden,
      snapshot.siteEngines,
      snapshot.customEngines,
      snapshot.providerInstances,
    );

    // 无可用源（如全部源被隐藏）→ 仅清空旧菜单，避免残留陈旧项。
    await browser.contextMenus.removeAll();
    if (sources.length === 0) return;

    // S1：先在局部构建新映射，全部填充完成后一次性赋值，避免 clear/set 窗口期竞态。
    const nextSourceById = new Map<string, SearchSource>();
    for (const source of sources) nextSourceById.set(source.id, source);
    sourceById = nextSourceById;

    // M2：镜像快切栏布局决策——flatLayoutFewSources 偏好开启时用
    // resolveEffectiveLayout（少量源自动平铺），关闭时用 projectLayout（保留分组）。
    const layout = snapshot.flatLayoutFewSources
      ? resolveEffectiveLayout(sources, snapshot.groupConfig, null)
      : projectLayout(sources, snapshot.groupConfig, null);

    await browser.contextMenus.create({
      id: ROOT_MENU_ID,
      title: t('context_menu_root'),
      contexts: ['selection'],
    });

    for (const item of layout.items) {
      if (item.kind === 'source') {
        await browser.contextMenus.create({
          id: `${SOURCE_PREFIX}${item.source.id}`,
          parentId: ROOT_MENU_ID,
          title: sourceLabel(item.source, t),
          contexts: ['selection'],
        });
      } else {
        const groupId = `${GROUP_PREFIX}${item.group.id}`;
        await browser.contextMenus.create({
          id: groupId,
          parentId: ROOT_MENU_ID,
          title: resolveLabel(item.group.label),
          contexts: ['selection'],
        });
        for (const source of item.items) {
          await browser.contextMenus.create({
            id: `${SOURCE_PREFIX}${source.id}`,
            parentId: groupId,
            title: sourceLabel(source, t),
            contexts: ['selection'],
          });
        }
      }
    }
  } catch (error) {
    console.warn('[contextMenu] rebuild failed', error);
  }
}

/**
 * contextMenus.onClicked 处理器：从菜单项 id 解析 sourceId，用选中文本
 * resolveSerpHandoff 解析跳转，在新标签页打开。
 *  - navigate → tabs.create({url})
 *  - openSearchPage → buildSafeSearchUrl(deepLink) 后 tabs.create
 *
 * S1：先读一次配置快照（M3 的 aiAutoEnter 偏好 + 回退自解析共用同一份），
 * map 未命中时从快照按同参投影解析 source，保证 worker 唤醒后的首次点击有效。
 */
export async function handleContextMenuClick(
  info: { menuItemId: string | number; selectionText?: string },
): Promise<void> {
  const itemId = String(info.menuItemId);
  if (!itemId.startsWith(SOURCE_PREFIX)) return; // 只处理叶子源项，忽略分组/根
  const sourceId = itemId.slice(SOURCE_PREFIX.length);
  const query = info.selectionText?.trim();
  if (!query) return;

  const snapshot = await getProviderConfigSnapshot();
  const source = sourceById.get(sourceId) ?? resolveSourceFromSnapshot(snapshot, sourceId);
  if (!source) return;

  // M3：AI 注入引擎的 enter 自动提交行为跟随用户偏好（快切栏/搜索页同源）。
  const handoff = resolveSerpHandoff(source, query, { aiAutoEnter: snapshot.aiAutoEnter });
  if (!handoff) return;

  let url: string | null;
  if (handoff.kind === 'navigate') {
    url = handoff.url;
  } else {
    url = buildSafeSearchUrl(handoff.deepLink);
  }
  if (!url) return;
  try {
    await browser.tabs.create({ url });
  } catch (error) {
    console.warn('[contextMenu] tabs.create failed', error);
  }
}

/** 从配置快照按同参投影解析单个 source（点击时 map 未命中的回退路径）。 */
function resolveSourceFromSnapshot(
  snapshot: Awaited<ReturnType<typeof getProviderConfigSnapshot>>,
  sourceId: string,
): SearchSource | undefined {
  return allSources(
    snapshot.configuredProviderIds,
    snapshot.sourceOrder,
    snapshot.sourceHidden,
    snapshot.siteEngines,
    snapshot.customEngines,
    snapshot.providerInstances,
  ).find((s) => s.id === sourceId);
}
