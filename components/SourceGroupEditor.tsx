import { useRef, useState } from 'react';
import type { SearchSource } from '@/lib/sources';
import type {
  GroupConfig,
  SourceGroup,
  SourceGroupId,
  SwitcherItem,
} from '@/lib/source-groups';
import {
  isBuiltinGroupId,
  normalizeGroupConfig,
  pinnedSourceIds,
  resolveGroupId,
} from '@/lib/source-groups';
import { sendMessage } from '@/lib/messaging';
import { ChevronDownIcon, ChevronUpIcon } from '@/components/icons';
import { t, MSG } from '@/lib/i18n';

interface Props {
  /** 可管理的全部 source（含隐藏项，同 options 快切栏管理列表）。 */
  sources: SearchSource[];
  groupConfig: GroupConfig;
  /** 配置变更时回调（已乐观更新本地态）；持久化由本组件内部完成。 */
  onChange: (config: GroupConfig) => void;
  /** 解析 source 显示名（宿主提供 t() 上下文）。 */
  resolveLabel: (source: SearchSource) => string;
}

/**
 * 来源布局编辑器：把顶层「平铺项 + 分组」混合序列可视化编辑。
 *
 * 能力：
 *   - 顶层统一排序（置顶 source 与分组 pill 一起上下移动）；
 *   - 置顶 ↔ 入组切换（source 在「单独平铺」与「收入某分组」间切换）；
 *   - 分组管理（新建 / 重命名 / 删除；内置三组不可删除）。
 *
 * 持久化沿用 options 既有的乐观更新 + 失败回滚模式：先 onChange 推进本地态，
 * 再 sendMessage('setGroupConfig')；失败则回滚并提示。
 */
export function SourceGroupEditor({ sources, groupConfig, onChange, resolveLabel }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  // 正在重命名的分组 id；其值即输入框文本。
  const [renamingId, setRenamingId] = useState<SourceGroupId | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  /** 防止重命名提交被 Enter + 卸载-on-Blur 触发两次。 */
  const renameCommittedRef = useRef(false);

  // 基于 sources 重新规范化，保证编辑器只展示已知项（隐藏项也保留以便管理）。
  const cfg = normalizeGroupConfig(
    groupConfig,
    sources.map((s) => s.id),
  );
  const knownSourceIds = new Set(sources.map((s) => s.id));
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const groupLabelById = new Map(cfg.groups.map((g) => [g.id, g.label]));

  // 解析分组显示名（i18n key 走 t()，字面量直出，未知分组回退 id）。
  function groupDisplayLabel(id: SourceGroupId): string {
    const label = groupLabelById.get(id);
    if (!label) return id;
    return label.kind === 'literal' ? label.value : t(label.key as never);
  }

  // 持久化：乐观推进 + 失败回滚。
  async function persist(next: GroupConfig, previous: GroupConfig) {
    setSaving(true);
    setError('');
    onChange(next);
    try {
      await sendMessage('setGroupConfig', next);
    } catch {
      onChange(previous);
      setError(t(MSG.opts_group_save_failed));
    } finally {
      setSaving(false);
    }
  }

  // ── 顶层移动：交换 layout 中 index 与 index+direction 的项 ──
  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (index < 0 || target < 0 || target >= cfg.layout.length || saving) return;
    const previous = cfg;
    const nextLayout = [...cfg.layout];
    [nextLayout[index], nextLayout[target]] = [nextLayout[target], nextLayout[index]];
    void persist({ ...cfg, layout: nextLayout }, previous);
  }

  // ── 置顶 ↔ 入组 ──
  /** 把某 source 从置顶改为收入指定分组。 */
  function foldIntoGroup(sourceId: string, groupId: SourceGroupId) {
    if (!knownSourceIds.has(sourceId as SearchSource['id'])) return;
    const previous = cfg;
    const nextLayout = cfg.layout.filter(
      (item) => !(item.kind === 'source' && item.sourceId === sourceId),
    );
    const nextAssignments = { ...cfg.assignments, [sourceId]: groupId };
    void persist({ ...cfg, layout: nextLayout, assignments: nextAssignments }, previous);
  }

  /** 把某 source 置顶（从分组里提出来单独平铺），追加到 layout 末尾。 */
  function pinSource(sourceId: string) {
    if (!knownSourceIds.has(sourceId as SearchSource['id'])) return;
    const previous = cfg;
    const nextAssignments = { ...cfg.assignments };
    delete nextAssignments[sourceId];
    const nextLayout = [...cfg.layout, { kind: 'source', sourceId } as SwitcherItem];
    void persist({ ...cfg, layout: nextLayout, assignments: nextAssignments }, previous);
  }

  // ── 分组管理 ──
  function createGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    const id = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const previous = cfg;
    const next: GroupConfig = {
      ...cfg,
      groups: [...cfg.groups, { id, label: { kind: 'literal', value: name } }],
      layout: [...cfg.layout, { kind: 'group', groupId: id } as SwitcherItem],
    };
    setNewGroupName('');
    void persist(next, previous);
  }

  function startRename(group: SourceGroup) {
    setRenamingId(group.id);
    setRenamingValue(groupDisplayLabel(group.id));
    renameCommittedRef.current = false;
  }

  function commitRename() {
    if (!renamingId || renameCommittedRef.current) return;
    renameCommittedRef.current = true;
    const name = renamingValue.trim();
    const previous = cfg;
    // 内置分组的 label 是 i18n key；重命名后改为字面量（覆盖 i18n 默认名）。
    const next: GroupConfig = {
      ...cfg,
      groups: cfg.groups.map((g) =>
        g.id === renamingId && name ? { id: g.id, label: { kind: 'literal', value: name } } : g,
      ),
    };
    setRenamingId(null);
    setRenamingValue('');
    if (name) void persist(next, previous);
  }

  function deleteGroup(groupId: SourceGroupId) {
    const name = groupDisplayLabel(groupId);
    if (!window.confirm(t(MSG.opts_group_delete_confirm, [name]))) return;
    const previous = cfg;
    const next: GroupConfig = {
      groups: cfg.groups.filter((g) => g.id !== groupId),
      layout: cfg.layout.filter((item) => !(item.kind === 'group' && item.groupId === groupId)),
      // 该组下的 source 赋值清除 → 回退到 defaultGroupForSourceId。
      assignments: Object.fromEntries(
        Object.entries(cfg.assignments).filter(([, gid]) => gid !== groupId),
      ),
    };
    void persist(next, previous);
  }

  // ── 渲染 ──
  const pinned = pinnedSourceIds(cfg.layout);

  return (
    <section data-section="source-groups">
      <h2>{t(MSG.opts_source_groups_heading)}</h2>
      <p className="hint">{t(MSG.opts_source_groups_hint)}</p>
      <div className="source-layout-list">
        {cfg.layout.map((item, index) => {
          if (item.kind === 'source') {
            const source = sourceById.get(item.sourceId);
            if (!source) return null;
            const name = resolveLabel(source);
            return (
              <div className="layout-row" key={`s:${item.sourceId}`} data-kind="source">
                <span className="layout-tag">{t(MSG.opts_group_item_source)}</span>
                <span className="layout-name">{name}</span>
                <div className="layout-actions">
                  <label className="layout-fold">
                    <span className="sr-only">{t(MSG.opts_group_unpin_into)}</span>
                    <select
                      value="__pinned__"
                      disabled={saving}
                      onChange={(e) => foldIntoGroup(item.sourceId, e.target.value)}
                    >
                      <option value="__pinned__">{t(MSG.opts_group_pin_source)}</option>
                      {cfg.groups.map((g) => (
                        <option key={g.id} value={g.id}>{groupDisplayLabel(g.id)}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label={t(MSG.opts_group_move_up, [name])}
                    title={t(MSG.opts_group_move_up, [name])}
                    disabled={saving || index === 0}
                    onClick={() => moveItem(index, -1)}
                  >
                    <ChevronUpIcon size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={t(MSG.opts_group_move_down, [name])}
                    title={t(MSG.opts_group_move_down, [name])}
                    disabled={saving || index === cfg.layout.length - 1}
                    onClick={() => moveItem(index, 1)}
                  >
                    <ChevronDownIcon size={16} />
                  </button>
                </div>
              </div>
            );
          }
          // 分组项
          const groupId = item.groupId;
          const group = cfg.groups.find((g) => g.id === groupId);
          const isBuiltin = isBuiltinGroupId(groupId);
          const itemsInGroup = sources.filter(
            (s) => !pinned.has(s.id) && resolveGroupId(s.id, cfg.assignments) === groupId,
          );
          return (
            <div className="layout-row" key={`g:${groupId}`} data-kind="group">
              <span className="layout-tag">{t(MSG.opts_group_item_group)}</span>
              <span className="layout-name">
                {renamingId === groupId ? (
                  <input
                    className="layout-rename-input"
                    value={renamingValue}
                    autoFocus
                    disabled={saving}
                    onChange={(e) => setRenamingValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') {
                        setRenamingId(null);
                        setRenamingValue('');
                      }
                    }}
                  />
                ) : (
                  <>
                    {groupDisplayLabel(groupId)}
                    <span className="layout-group-members">
                      {itemsInGroup.map((s) => (
                        <span className="layout-group-member" key={s.id}>
                          <span className="layout-member-name">{resolveLabel(s)}</span>
                          <button
                            type="button"
                            className="layout-member-pin"
                            aria-label={t(MSG.opts_group_pin_source, [resolveLabel(s)])}
                            title={t(MSG.opts_group_pin_source, [resolveLabel(s)])}
                            disabled={saving}
                            onClick={() => pinSource(s.id)}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                              <path d="M3 2v7.5L9 5.5 6 3l-3-1z" fill="currentColor" />
                            </svg>
                          </button>
                        </span>
                      ))}
                    </span>
                  </>
                )}
              </span>
              <div className="layout-actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => (group ? startRename(group) : undefined)}
                >
                  {t(MSG.opts_group_rename)}
                </button>
                {!isBuiltin && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => deleteGroup(groupId)}
                  >
                    {t(MSG.opts_group_delete)}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={t(MSG.opts_group_move_up, [groupDisplayLabel(groupId)])}
                  title={t(MSG.opts_group_move_up, [groupDisplayLabel(groupId)])}
                  disabled={saving || index === 0}
                  onClick={() => moveItem(index, -1)}
                >
                  <ChevronUpIcon size={16} />
                </button>
                <button
                  type="button"
                  aria-label={t(MSG.opts_group_move_down, [groupDisplayLabel(groupId)])}
                  title={t(MSG.opts_group_move_down, [groupDisplayLabel(groupId)])}
                  disabled={saving || index === cfg.layout.length - 1}
                  onClick={() => moveItem(index, 1)}
                >
                  <ChevronDownIcon size={16} />
                </button>
              </div>
            </div>
          );
        })}

        {/* 未出现在 layout 的 source（理论上 normalize 已覆盖）兜底：显示可置顶入口 */}
        {sources
          .filter((s) => !cfg.layout.some((it) => it.kind === 'source' && it.sourceId === s.id))
          .filter((s) => !cfg.layout.some((it) => it.kind === 'group' && resolveGroupId(s.id, cfg.assignments) === it.groupId))
          .map((s) => (
            <div className="layout-row layout-row--orphan" key={`o:${s.id}`}>
              <span className="layout-name">{resolveLabel(s)}</span>
              <div className="layout-actions">
                <button type="button" disabled={saving} onClick={() => pinSource(s.id)}>
                  {t(MSG.opts_group_pin_source)}
                </button>
              </div>
            </div>
          ))}
      </div>

      {/* 新建分组 */}
      <div className="source-layout-new">
        <input
          className="layout-new-input"
          value={newGroupName}
          placeholder={t(MSG.opts_group_new_placeholder)}
          disabled={saving}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') createGroup();
          }}
        />
        <button type="button" disabled={saving || !newGroupName.trim()} onClick={createGroup}>
          {t(MSG.opts_group_new)}
        </button>
      </div>
      {error && <p className="status fail" role="alert">{error}</p>}
    </section>
  );
}
