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

/** 内置分组 id：AI 搜索 / 搜索引擎 / 站点。 */
export const AI_SEARCH_GROUP = 'ai-search';
export const ENGINES_GROUP = 'engines';
export const SITES_GROUP = 'sites';

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
}

/** 内置默认分组定义（i18n 标签，渲染处用 t() 解析）。 */
export const DEFAULT_GROUPS: SourceGroup[] = [
  { id: AI_SEARCH_GROUP, label: { kind: 'i18n', key: 'group_ai_search' } },
  { id: ENGINES_GROUP, label: { kind: 'i18n', key: 'group_engines' } },
  { id: SITES_GROUP, label: { kind: 'i18n', key: 'group_sites' } },
];

const BUILTIN_GROUP_IDS: ReadonlySet<string> = new Set([
  AI_SEARCH_GROUP,
  ENGINES_GROUP,
  SITES_GROUP,
]);

/** 按 source 的 kind 推导缺省分组 id（不查 assignments，仅按类型）。 */
export function defaultGroupForSourceId(sourceId: SourceId): SourceGroupId {
  if (isProviderId(sourceId)) return AI_SEARCH_GROUP;
  if (isEngineId(sourceId)) return ENGINES_GROUP;
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
 *     layout 缺失/空时回退默认：仅含三个内置分组项；
 *   - assignments：剔除指向已删除分组 / 未知 source / 已置顶 source 的赋值。
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
  // 补齐缺失的内置三组（保持在前，按 DEFAULT_GROUPS 顺序）。
  const missingBuiltin = DEFAULT_GROUPS.filter((g) => !seenGroupIds.has(g.id));
  for (const g of [...missingBuiltin, ...groups]) {
    seenGroupIds.add(g.id);
  }
  groups.unshift(...missingBuiltin);
  const knownGroupIds = new Set(groups.map((g) => g.id));

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
  // layout 空/缺失 → 默认：三个内置分组项（按 DEFAULT_GROUPS 顺序）。
  if (layout.length === 0) {
    for (const g of DEFAULT_GROUPS) {
      layout.push({ kind: 'group', groupId: g.id });
    }
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

  return { groups, layout, assignments };
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
 *   - 组内 source 按 sources 数组顺序（即 sourceOrder）排列；
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
    const group = groupDefById.get(groupId) ?? DEFAULT_GROUPS.find((g) => g.id === groupId);
    if (!group) continue;
    items.push({
      kind: 'group',
      group,
      items: groupItems,
      containsActive: activeId != null && groupItems.some((s) => s.id === activeId),
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
