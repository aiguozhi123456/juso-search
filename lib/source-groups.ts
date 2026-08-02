// 来源分组与顶层布局（v1）。
//
// 把快切栏顶层从「纯 source 序列」升级为「混合序列」：顶层一串统一排序的项，
// 每项要么是置顶 source（裸平铺 pill），要么是分组（折叠 pill，hover 展开）。
// 一个 source 二态：置顶（layout 里以 {kind:'source'} 出现）或入组（写 assignments）。
//
// 开箱默认：所有 source 按类型进内置分组（AI 搜索 / 搜索引擎 / 站点），
// 用户可在设置页把任意 source 置顶出来与分组并列，或自建/重命名/删除分组。
//
// 与 sources.ts 的关系：sources.ts 仍是 source 投影层（sourceOrder/sourceHidden），
// 本文件在其之上叠加一层「布局」——分组只是布局层，不改变 source 的显隐与底层顺序。

import type { SearchSource, SourceId } from './sources';
import { isProviderId, isEngineId } from './sources';
import { isCustomEngineId } from './custom-engines';

/** 内置分组 id：AI 搜索 / 搜索引擎 / 站点 / 自定义。 */
export const AI_SEARCH_GROUP = 'ai-search';
export const ENGINES_GROUP = 'engines';
export const SITES_GROUP = 'sites';
export const CUSTOM_GROUP = 'custom';

export type SourceGroupId = string;

export type SourceLabel =
  | { kind: 'i18n'; key: string }
  | { kind: 'literal'; value: string };

export interface SourceGroup {
  id: SourceGroupId;
  label: SourceLabel;
}

/** 顶层布局项：置顶 source 或分组。 */
export type SwitcherItem =
  | { kind: 'source'; sourceId: SourceId }
  | { kind: 'group'; groupId: SourceGroupId };

export interface GroupConfig {
  /** 分组定义（含顺序，决定设置页与新分组列表展示顺序）。 */
  groups: SourceGroup[];
  /** 顶层混合序列：置顶 source 与分组统一排序。 */
  layout: SwitcherItem[];
  /** sourceId → groupId；仅对「入组」的 source 记录，置顶 source 不出现。 */
  assignments: Record<string, SourceGroupId>;
  /** groupId → 该组显式成员顺序（仅收录「入组」且已知的 source；可缺省 = 回退 sources 顺序）。 */
  groupOrders: Record<string, SourceId[]>;
}

/** 内置默认分组定义（i18n 标签，渲染处用 t() 解析）。 */
export const DEFAULT_GROUPS: SourceGroup[] = [
  { id: AI_SEARCH_GROUP, label: { kind: 'i18n', key: 'group_ai_search' } },
  { id: ENGINES_GROUP, label: { kind: 'i18n', key: 'group_engines' } },
  { id: SITES_GROUP, label: { kind: 'i18n', key: 'group_sites' } },
  { id: CUSTOM_GROUP, label: { kind: 'i18n', key: 'group_custom' } },
];

const BUILTIN_GROUP_IDS: ReadonlySet<string> = new Set([
  AI_SEARCH_GROUP,
  ENGINES_GROUP,
  SITES_GROUP,
  CUSTOM_GROUP,
]);

/** 按 source 的 kind 推导缺省分组 id（不查 assignments，仅按类型）。 */
export function defaultGroupForSourceId(sourceId: SourceId): SourceGroupId {
  if (isProviderId(sourceId)) return AI_SEARCH_GROUP;
  if (isEngineId(sourceId)) return ENGINES_GROUP;
  if (isCustomEngineId(sourceId)) return CUSTOM_GROUP;
  return SITES_GROUP; // site:*
}

/**
 * 解析某 source 的归属分组：先查用户显式赋值，否则按类型兜底。
 * 注意：置顶 source 不应在 assignments 里；调用方需先用 isPinned 排除。
 */
export function resolveGroupId(
  sourceId: SourceId,
  assignments: Record<string, SourceGroupId>,
): SourceGroupId {
  return assignments[sourceId] ?? defaultGroupForSourceId(sourceId);
}

/** layout 中作为 {kind:'source'} 出现的 source id 集合（即「置顶」）。 */
export function pinnedSourceIds(layout: readonly SwitcherItem[]): Set<SourceId> {
  const set = new Set<SourceId>();
  for (const item of layout) {
    if (item.kind === 'source') set.add(item.sourceId);
  }
  return set;
}

/** 该 layout 中出现的分组 id 集合。 */
export function layoutGroupIds(layout: readonly SwitcherItem[]): Set<SourceGroupId> {
  const set = new Set<SourceGroupId>();
  for (const item of layout) {
    if (item.kind === 'group') set.add(item.groupId);
  }
  return set;
}

/**
 * 解析某组的「管理视图」成员顺序（编辑器使用）：显式 groupOrders 优先
 * （防御过滤：未知/置顶/归属变更 id 剔除、去重保留首现），剩余成员按
 * `sourceIds` 顺序补尾；无显式顺序时全部按 `sourceIds` 顺序。
 *
 * 与 projectLayout 的组内顺序规则一致——projectLayout 作用于可见子集
 * （跳过不可见 id），本函数作用于完整管理列表（含隐藏项）；两者对同一
 * 可见成员序列严格同序（对拍测试见 tests/source-groups.test.ts）。
 */
export function groupOrderOf(
  sourceIds: readonly SourceId[],
  config: GroupConfig,
  groupId: SourceGroupId,
): SourceId[] {
  const pinned = pinnedSourceIds(config.layout);
  const idSet = new Set(sourceIds);
  const members = sourceIds.filter(
    (id) => !pinned.has(id) && resolveGroupId(id, config.assignments) === groupId,
  );
  const explicit = [...new Set(config.groupOrders?.[groupId] ?? [])].filter(
    (id) => idSet.has(id) && !pinned.has(id) && resolveGroupId(id, config.assignments) === groupId,
  );
  return [...explicit, ...members.filter((id) => !explicit.includes(id))];
}

function isSourceLabel(raw: unknown): raw is SourceLabel {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === 'i18n') return typeof obj.key === 'string' && obj.key.length > 0;
  if (obj.kind === 'literal') return typeof obj.value === 'string' && obj.value.length > 0;
  return false;
}

function isSwitcherItem(raw: unknown, knownSourceIds: Set<string>, knownGroupIds: Set<string>): raw is SwitcherItem {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === 'source') return typeof obj.sourceId === 'string' && knownSourceIds.has(obj.sourceId);
  if (obj.kind === 'group') return typeof obj.groupId === 'string' && knownGroupIds.has(obj.groupId);
  return false;
}

/**
 * 规范化用户保存的 GroupConfig：
 *   - groups：剔除非法 label 与重复 id（保留首现），内置三组缺失则补齐；
 *   - layout：剔除未知 source/group，保留首次出现（去重），并保证「全部 source 都有归宿」——
 *     每个已知 source 要么置顶（layout 里），要么可被某分组收纳（按 assignments/defaultGroupFor）。
 *     layout 缺失/空时回退默认：全部内置分组项；非空时把缺失的内置组按 DEFAULT_GROUPS 顺序追加到
 *     末尾（用户自建组不自动加，已存在的内置组不重复），保证升级新增的内置组（如 custom）位置持久化；
 *   - assignments：剔除指向已删除分组 / 未知 source / 已置顶 source 的赋值；
 *   - groupOrders：在 layout 与 assignments 清洗之后做（依赖两者结果）——gid 必须存在于
 *     清洗后的 groups；ids 逐个过滤：必须已知、未置顶、且解析归属为该 gid；去重保留首现。
 *     过滤后为空的条目丢弃（缺省语义 = 回退 sources 顺序，等价）；属于其它分组的残留 id
 *     （assignment 变更遗留）一并丢弃，防止位置残留。
 * 返回值保证自洽，可直接被 projectLayout 消费。
 */
export function normalizeGroupConfig(
  raw: unknown,
  allSourceIds: readonly SourceId[],
): GroupConfig {
  const knownSourceIds = new Set(allSourceIds);

  // ── groups ──
  const groups: SourceGroup[] = [];
  const seenGroupIds = new Set<SourceGroupId>();
  const rawGroups = raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).groups)
    ? (raw as Record<string, unknown>).groups as unknown[]
    : [];
  for (const g of rawGroups) {
    if (!g || typeof g !== 'object') continue;
    const obj = g as Record<string, unknown>;
    if (typeof obj.id !== 'string' || obj.id.length === 0 || seenGroupIds.has(obj.id)) continue;
    if (!isSourceLabel(obj.label)) continue;
    seenGroupIds.add(obj.id);
    groups.push({ id: obj.id, label: obj.label });
  }
  // 补齐缺失的内置三组，并保证「内置在前、按 DEFAULT_GROUPS 顺序」。
  // 不能只 unshift 缺失项：若持久化里已有部分内置组（如只有 engines），
  // 仅补缺失的 ai-search/sites 会让结果变成 [ai-search, sites, engines, ...]，
  // 打破 DEFAULT_GROUPS 顺序。改为以 DEFAULT_GROUPS 为骨架重排：内置位用已有项或默认项，再追加自定义组。
  const orderedIds = new Set<SourceGroupId>();
  const ordered: SourceGroup[] = [];
  for (const def of DEFAULT_GROUPS) {
    const existing = groups.find((g) => g.id === def.id);
    ordered.push(existing ?? def);
    orderedIds.add(def.id);
  }
  for (const g of groups) {
    if (!orderedIds.has(g.id)) {
      ordered.push(g);
      orderedIds.add(g.id);
    }
  }
  groups.splice(0, groups.length, ...ordered);
  seenGroupIds.clear();
  for (const g of groups) seenGroupIds.add(g.id);
  const knownGroupIds = seenGroupIds;

  // ── layout ──
  const layout: SwitcherItem[] = [];
  const seenLayoutKeys = new Set<string>();
  const rawLayout = raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).layout)
    ? (raw as Record<string, unknown>).layout as unknown[]
    : [];
  for (const item of rawLayout) {
    if (!isSwitcherItem(item, knownSourceIds, knownGroupIds)) continue;
    const key = item.kind === 'source' ? `s:${item.sourceId}` : `g:${item.groupId}`;
    if (seenLayoutKeys.has(key)) continue; // 去重，保留首现顺序
    seenLayoutKeys.add(key);
    layout.push(item);
  }
  // layout 空/缺失 → 默认：全部内置分组项（按 DEFAULT_GROUPS 顺序）。
  if (layout.length === 0) {
    for (const g of DEFAULT_GROUPS) {
      layout.push({ kind: 'group', groupId: g.id });
    }
  }
  // 补齐缺失的内置分组到 layout 末尾：升级新增内置组（如 custom）后，老用户的非空 layout 不含该组，
  // 否则该组只能靠 projectLayout 的兜底扫描渲染（位置不可控、不持久化）。这里把缺失的内置组按
  // DEFAULT_GROUPS 顺序追加到末尾，使其位置持久化、用户可控。规则：
  //   - 仅补内置组（DEFAULT_GROUPS）——用户自建组不自动进 layout，须由用户显式添加；
  //   - 已存在于 layout 的内置组不重复追加；既有顺序保持不变，仅在末尾追加。
  const presentGroupIds = layoutGroupIds(layout);
  for (const g of DEFAULT_GROUPS) {
    if (!presentGroupIds.has(g.id)) layout.push({ kind: 'group', groupId: g.id });
  }

  // ── assignments ──
  const pinned = pinnedSourceIds(layout);
  const assignments: Record<string, SourceGroupId> = {};
  const rawAssignments = raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).assignments === 'object' && (raw as Record<string, unknown>).assignments !== null
    ? (raw as Record<string, unknown>).assignments as Record<string, unknown>
    : {};
  for (const [sid, gid] of Object.entries(rawAssignments)) {
    if (!knownSourceIds.has(sid as SourceId)) continue; // 未知 source
    if (pinned.has(sid as SourceId)) continue; // 置顶 source 不应残留赋值
    if (typeof gid !== 'string' || !knownGroupIds.has(gid)) continue; // 指向已删除/未知分组
    assignments[sid] = gid;
  }

  // ── groupOrders ──
  // 依赖上面已清洗的 layout（pinned 集合）与 assignments（归属解析），故放在最后。
  const groupOrders: Record<string, SourceId[]> = {};
  const rawGroupOrders = raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).groupOrders === 'object' && (raw as Record<string, unknown>).groupOrders !== null
    ? (raw as Record<string, unknown>).groupOrders as Record<string, unknown>
    : {};
  for (const [gid, rawIds] of Object.entries(rawGroupOrders)) {
    if (!knownGroupIds.has(gid) || !Array.isArray(rawIds)) continue; // 未知/已删除分组
    const ids: SourceId[] = [];
    const seen = new Set<SourceId>();
    for (const id of rawIds) {
      if (typeof id !== 'string' || !knownSourceIds.has(id as SourceId)) continue; // 未知 source
      if (pinned.has(id as SourceId)) continue; // 已置顶 → 不再属于任何组
      if (resolveGroupId(id as SourceId, assignments) !== gid) continue; // 不属于该组（assignment 变更残留）
      if (seen.has(id as SourceId)) continue; // 去重保留首现
      seen.add(id as SourceId);
      ids.push(id as SourceId);
    }
    if (ids.length > 0) groupOrders[gid] = ids; // 空数组丢弃：缺省 = 回退 sources 顺序
  }

  return { groups, layout, assignments, groupOrders };
}

/**
 * 开箱默认配置：所有 source 进各自类型分组，layout 为三个内置分组项，
 * assignments 空（全部走 defaultGroupForSourceId 兜底）。
 * 供存储无 groupConfig 时回退，以及 normalizeGroupConfig 的 layout 兜底。
 */
export function defaultGroupConfig(allSourceIds: readonly SourceId[]): GroupConfig {
  return normalizeGroupConfig(
    {
      groups: DEFAULT_GROUPS,
      layout: DEFAULT_GROUPS.map((g) => ({ kind: 'group', groupId: g.id } as SwitcherItem)),
      assignments: {},
    },
    allSourceIds,
  );
}

/** 判断 group id 是否为内置三组之一（删除内置组需特殊处理：其下 source 改为按类型兜底而非置顶）。 */
export function isBuiltinGroupId(id: string): boolean {
  return BUILTIN_GROUP_IDS.has(id);
}

// ────────────────────────────────────────────────────────────────────────────
// 投影层：把 GroupConfig + source 列表投影成 SourceSwitcher 可直接渲染的序列。
// ────────────────────────────────────────────────────────────────────────────

/** 置顶平铺项（裸 source，渲染同原 SourceSwitcher pill）。 */
export interface PinnedItem {
  kind: 'source';
  source: SearchSource;
}

/** 分组项（折叠 pill，hover 展开浮层渲染 items）。 */
export interface GroupItem {
  kind: 'group';
  group: SourceGroup;
  items: SearchSource[];
  /** 组内是否含当前激活源（→ pill 显示徽章）。 */
  containsActive: boolean;
}

export type ProjectedItem = PinnedItem | GroupItem;

export interface ProjectedLayout {
  items: ProjectedItem[];
}

/**
 * 把 GroupConfig + 已投影的 source 列表（含顺序/显隐）投影成顶层混合序列。
 *
 * 规则：
 *   - 遍历 config.layout：
 *     · {kind:'source'} → 找到该 source（不在 sources 里则跳过，如被隐藏/未配置）→ 置顶项；
 *     · {kind:'group'}  → 收集所有 resolveGroupId===groupId 且未被置顶的 source → 分组项；
 *       空组（无可见 source）跳过；
 *   - 组内 source 顺序：显式 groupOrders 优先（仅保留可见且未置顶的成员），
 *     其余成员按 sources 数组顺序（即 sourceOrder）补尾；无 groupOrders 时完全回退 sources 顺序；
 *   - containsActive = items.some(s => s.id === activeId)；
 *   - 置顶优先：某 source 作为 {kind:'source'} 出现后，绝不重复进任何分组。
 *
 * 保证：结果中每个 source 至多出现一次（置顶处或某分组内）。
 */
export function projectLayout(
  sources: readonly SearchSource[],
  config: GroupConfig,
  activeId: SourceId | null,
): ProjectedLayout {
  // 防御：非法/缺失配置回退默认（保证渲染不崩，如存储迁移中或测试部分 mock）。
  const safeConfig = config && typeof config === 'object' && Array.isArray(config.layout)
    ? config
    : defaultGroupConfig(sources.map((s) => s.id));
  const pinned = pinnedSourceIds(safeConfig.layout);
  const groupDefById = new Map(safeConfig.groups.map((g) => [g.id, g]));
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const items: ProjectedItem[] = [];

  for (const layoutItem of safeConfig.layout) {
    if (layoutItem.kind === 'source') {
      const source = sourceById.get(layoutItem.sourceId);
      if (!source) continue; // 已隐藏 / 未配置 / 已删除 site-engine
      items.push({ kind: 'source', source });
      continue;
    }
    // 分组项：收集归属该组且非置顶的 source。
    const groupId = layoutItem.groupId;
    const groupItems = sources.filter((s) => {
      if (pinned.has(s.id)) return false;
      return resolveGroupId(s.id, safeConfig.assignments) === groupId;
    });
    if (groupItems.length === 0) continue; // 空组不渲染
    // 组内顺序：显式 groupOrders 优先（防御层——只取存在于 sources 且未置顶的成员，
    // 并按显式顺序排列），剩余成员按 sources 顺序补尾（保持缺省回退行为）。
    const explicit = safeConfig.groupOrders?.[groupId] ?? [];
    const explicitOrdered: SearchSource[] = [];
    const explicitSeen = new Set<SourceId>();
    for (const id of explicit) {
      if (explicitSeen.has(id)) continue;
      const source = sourceById.get(id);
      if (!source || pinned.has(source.id)) continue; // 不可见（隐藏/未配置）或已置顶
      if (resolveGroupId(source.id, safeConfig.assignments) !== groupId) continue; // 归属变更残留
      explicitSeen.add(source.id);
      explicitOrdered.push(source);
    }
    const orderedGroupItems = [
      ...explicitOrdered,
      ...groupItems.filter((s) => !explicitSeen.has(s.id)),
    ];
    const group = groupDefById.get(groupId) ?? DEFAULT_GROUPS.find((g) => g.id === groupId);
    if (!group) continue;
    items.push({
      kind: 'group',
      group,
      items: orderedGroupItems,
      containsActive: activeId != null && orderedGroupItems.some((s) => s.id === activeId),
    });
  }

  // 兜底：被 normalize 漏掉的 source（理论上不会发生）——归入其默认分组的最后一项分组。
  const placed = new Set<SourceId>();
  for (const item of items) {
    if (item.kind === 'source') placed.add(item.source.id);
    else for (const s of item.items) placed.add(s.id);
  }
  for (const s of sources) {
    if (placed.has(s.id)) continue;
    const defaultGid = defaultGroupForSourceId(s.id);
    const existing = items.find(
      (it): it is GroupItem => it.kind === 'group' && it.group.id === defaultGid,
    );
    if (existing) {
      existing.items.push(s);
      if (s.id === activeId) existing.containsActive = true;
    } else {
      const group = groupDefById.get(defaultGid) ?? DEFAULT_GROUPS.find((g) => g.id === defaultGid);
      if (group) {
        items.push({
          kind: 'group',
          group,
          items: [s],
          containsActive: s.id === activeId,
        });
      } else {
        // 极端兜底：连默认组定义都缺失 → 当作置顶项渲染，保证可见。
        items.push({ kind: 'source', source: s });
      }
    }
  }

  return { items };
}
