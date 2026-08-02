import { useRef, useState } from 'react';
import { resolveIconUrl, type SearchSource, type SourceId } from '@/lib/sources';
import type {
  GroupConfig,
  SourceGroup,
  SourceGroupId,
  SwitcherItem,
} from '@/lib/source-groups';
import {
  groupOrderOf,
  isBuiltinGroupId,
  normalizeGroupConfig,
  resolveGroupId,
} from '@/lib/source-groups';
import { sendMessage } from '@/lib/messaging';
import { ChevronDownIcon, ChevronUpIcon, GripIcon, PlusIcon } from '@/components/icons';
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

  /** 来源品牌图标：与 SourceSwitcher 同款渲染（解析扩展内相对路径、加载失败隐藏）。 */
  function sourceFavicon(source: SearchSource | undefined) {
    return source?.favicon ? (
      <img
        className="layout-source-icon"
        src={resolveIconUrl(source.favicon)}
        alt=""
        width={14}
        height={14}
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    ) : null;
  }

  // ── 拖拽排序状态 ──
  // 数据走 ref（drop 时读取，jsdom 测试友好）；视觉高亮走 state。
  /** 顶层拖拽：正在拖拽的行 index（ref 供 onDrop 读取）。 */
  const dragFromLayoutRef = useRef<number | null>(null);
  /** 顶层拖拽：正在拖拽的行 index（state 供拖拽中半透明样式）。 */
  const [draggingLayoutIndex, setDraggingLayoutIndex] = useState<number | null>(null);
  /** 顶层拖拽：当前悬停的目标行 index（drop 高亮）。 */
  const [dropTargetLayoutIndex, setDropTargetLayoutIndex] = useState<number | null>(null);
  /** 组内拖拽：正在拖拽的成员（ref 供 onDrop 读取）。 */
  const dragFromMemberRef = useRef<{ groupId: SourceGroupId; sourceId: SourceId } | null>(null);
  /** 组内拖拽：正在拖拽的成员（state 供拖拽中半透明样式）。 */
  const [draggingMember, setDraggingMember] = useState<{ groupId: SourceGroupId; sourceId: SourceId } | null>(null);
  /** 组内拖拽：当前悬停的目标成员（drop 高亮）。 */
  const [dropTargetMember, setDropTargetMember] = useState<{ groupId: SourceGroupId; sourceId: SourceId } | null>(null);

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
    return label.kind === 'literal' ? label.value : t(label.key);
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

  // ── 顶层移动 ──
  /** 箭头键移动：removeAt(index) 后 insertAt(index+direction)。相邻移动与旧 swap 结果一致。 */
  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (index < 0 || target < 0 || target >= cfg.layout.length || saving) return;
    const previous = cfg;
    const nextLayout = [...cfg.layout];
    const [moved] = nextLayout.splice(index, 1);
    nextLayout.splice(target, 0, moved);
    void persist({ ...cfg, layout: nextLayout }, previous);
  }

  /** 顶层拖拽落点：remove(from) 后 insert(to)，与箭头移动同语义。 */
  function moveLayoutItem(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= cfg.layout.length || to >= cfg.layout.length || saving) return;
    const previous = cfg;
    const nextLayout = [...cfg.layout];
    const [moved] = nextLayout.splice(from, 1);
    nextLayout.splice(to, 0, moved);
    void persist({ ...cfg, layout: nextLayout }, previous);
  }

  // ── 组内顺序 ──
  // 组内成员顺序解析统一走 lib/source-groups.ts 的 groupOrderOf 纯函数
  // （与 projectLayout 同规则，对拍测试锁定一致），本组件不重复实现。
  const allSourceIds = sources.map((s) => s.id);

  /** 组内排序：以 groupOrderOf 结果为基础数组 remove+insert，写回 groupOrders[groupId]。 */
  function moveGroupMember(groupId: SourceGroupId, from: number, to: number) {
    const base = groupOrderOf(allSourceIds, cfg, groupId);
    if (from === to || from < 0 || to < 0 || from >= base.length || to >= base.length || saving) return;
    const previous = cfg;
    const nextList = [...base];
    const [moved] = nextList.splice(from, 1);
    nextList.splice(to, 0, moved);
    void persist({ ...cfg, groupOrders: { ...(cfg.groupOrders ?? {}), [groupId]: nextList } }, previous);
  }

  // ── 顶层拖拽事件 ──
  /** 从行内交互控件（按钮/select/输入框）上按下不启动拖拽，防止轻微位移吞掉点击。 */
  function isInteractiveTarget(e: React.DragEvent): boolean {
    return !!(e.target as HTMLElement | null)?.closest('button, select, input, a');
  }

  function handleLayoutDragStart(e: React.DragEvent, index: number) {
    if (saving) return;
    if (isInteractiveTarget(e)) {
      // Chrome 中 dragstart 已开始拖拽，preventDefault 取消；Firefox 未 setData 本就不启动。
      e.preventDefault();
      return;
    }
    dragFromLayoutRef.current = index;
    setDraggingLayoutIndex(index);
    // Firefox 必须 setData 才能启动拖拽；index 同时存 ref 供 drop 读取。
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleLayoutDragOver(e: React.DragEvent, index: number) {
    // 组内拖拽进行中时，顶层行不响应（跨层拖拽不支持）。
    if (dragFromLayoutRef.current == null || dragFromMemberRef.current != null) return;
    e.preventDefault(); // 允许 drop
    e.dataTransfer.dropEffect = 'move';
    setDropTargetLayoutIndex(index);
  }

  function handleLayoutDrop(e: React.DragEvent, index: number) {
    e.preventDefault();
    const from = dragFromLayoutRef.current;
    dragFromLayoutRef.current = null;
    setDraggingLayoutIndex(null);
    setDropTargetLayoutIndex(null);
    if (from == null) return;
    moveLayoutItem(from, index);
  }

  function handleLayoutDragEnd() {
    dragFromLayoutRef.current = null;
    setDraggingLayoutIndex(null);
    setDropTargetLayoutIndex(null);
  }

  // ── 组内成员拖拽事件（仅同组内；跨组移动靠置顶/入组 select） ──
  function handleMemberDragStart(e: React.DragEvent, groupId: SourceGroupId, sourceId: SourceId) {
    if (saving) return;
    if (isInteractiveTarget(e)) {
      // 芯片内按钮（上移/下移/置顶）上按下不启动拖拽；同时阻断冒泡，避免误启分组行拖拽。
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // 阻止冒泡：成员芯片在分组行内部，不能触发分组行的顶层拖拽。
    e.stopPropagation();
    dragFromMemberRef.current = { groupId, sourceId };
    setDraggingMember({ groupId, sourceId });
    e.dataTransfer.setData('text/plain', sourceId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleMemberDragOver(e: React.DragEvent, groupId: SourceGroupId, sourceId: SourceId) {
    const from = dragFromMemberRef.current;
    if (!from || from.groupId !== groupId) return; // 跨组拖拽不支持
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetMember({ groupId, sourceId });
  }

  function handleMemberDrop(e: React.DragEvent, groupId: SourceGroupId, sourceId: SourceId) {
    e.preventDefault();
    e.stopPropagation();
    const from = dragFromMemberRef.current;
    dragFromMemberRef.current = null;
    setDraggingMember(null);
    setDropTargetMember(null);
    if (!from || from.groupId !== groupId) return;
    const base = groupOrderOf(allSourceIds, cfg, groupId);
    const fromIndex = base.indexOf(from.sourceId);
    const toIndex = base.indexOf(sourceId);
    if (fromIndex === -1 || toIndex === -1) return;
    moveGroupMember(groupId, fromIndex, toIndex);
  }

  function handleMemberDragEnd() {
    dragFromMemberRef.current = null;
    setDraggingMember(null);
    setDropTargetMember(null);
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
    // 组内顺序：物化目标组「全量」成员序（显式前缀 + 按管理序补尾的剩余成员，
    // 移除该 source 防残留）后末尾追加 —— 部分显式序（仅手工导入文件可达）时
    // 新成员也真正排在渲染末尾，与「追加到新组末尾」语义一致。
    // 注意：不能以旧组顺序为基底——旧组顺序含其它组成员，会跨组污染新组顺序。
    const orders = cfg.groupOrders ?? {};
    const base = orders[groupId] ?? [];
    const full = [
      ...base,
      ...groupOrderOf(allSourceIds, cfg, groupId).filter(
        (id) => id !== sourceId && !base.includes(id),
      ),
    ];
    const nextGroupOrders: Record<string, SourceId[]> = {};
    for (const [gid, ids] of Object.entries(orders)) {
      const filtered = ids.filter((id) => id !== sourceId); // 旧组/其它组移除该 source
      if (filtered.length > 0) nextGroupOrders[gid] = filtered; // 空条目清理
    }
    nextGroupOrders[groupId] = [...full.filter((id) => id !== sourceId), sourceId as SourceId];
    void persist(
      { ...cfg, layout: nextLayout, assignments: nextAssignments, groupOrders: nextGroupOrders },
      previous,
    );
  }

  /** 把某 source 置顶（从分组里提出来单独平铺），追加到 layout 末尾。 */
  function pinSource(sourceId: string) {
    if (!knownSourceIds.has(sourceId as SearchSource['id'])) return;
    const previous = cfg;
    const nextAssignments = { ...cfg.assignments };
    delete nextAssignments[sourceId];
    // 置顶后不再属于任何组：从所有 groupOrders 中移除（空条目清理）。
    const nextGroupOrders: Record<string, SourceId[]> = {};
    for (const [gid, ids] of Object.entries(cfg.groupOrders ?? {})) {
      const filtered = ids.filter((id) => id !== sourceId);
      if (filtered.length > 0) nextGroupOrders[gid] = filtered;
    }
    const nextLayout = [...cfg.layout, { kind: 'source', sourceId } as SwitcherItem];
    void persist(
      { ...cfg, layout: nextLayout, assignments: nextAssignments, groupOrders: nextGroupOrders },
      previous,
    );
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
    const nextGroupOrders = { ...(cfg.groupOrders ?? {}) };
    delete nextGroupOrders[groupId]; // 组已删除，其显式成员顺序一并清理
    const next: GroupConfig = {
      groups: cfg.groups.filter((g) => g.id !== groupId),
      layout: cfg.layout.filter((item) => !(item.kind === 'group' && item.groupId === groupId)),
      // 该组下的 source 赋值清除 → 回退到 defaultGroupForSourceId。
      assignments: Object.fromEntries(
        Object.entries(cfg.assignments).filter(([, gid]) => gid !== groupId),
      ),
      groupOrders: nextGroupOrders,
    };
    void persist(next, previous);
  }

  // ── 渲染 ──
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
              <div
                className={[
                  'layout-row',
                  'layout-row--source',
                  draggingLayoutIndex === index ? 'layout-row--dragging' : '',
                  dropTargetLayoutIndex === index ? 'layout-row--drop-target' : '',
                ].filter(Boolean).join(' ')}
                key={`s:${item.sourceId}`}
                data-kind="source"
                draggable={!saving}
                onDragStart={(e) => handleLayoutDragStart(e, index)}
                onDragOver={(e) => handleLayoutDragOver(e, index)}
                onDrop={(e) => handleLayoutDrop(e, index)}
                onDragEnd={handleLayoutDragEnd}
              >
                <span
                  className="layout-drag-handle"
                  role="img"
                  aria-label={t(MSG.opts_group_drag_handle)}
                  title={t(MSG.opts_group_drag_handle)}
                >
                  <GripIcon size={16} />
                </span>
                <span className="layout-tag layout-tag--source">{t(MSG.opts_group_item_source)}</span>
                {sourceFavicon(source)}
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
                  <div className="layout-move">
                    <button
                      type="button"
                      className="layout-btn layout-btn--icon"
                      aria-label={t(MSG.opts_group_move_up, [name])}
                      title={t(MSG.opts_group_move_up, [name])}
                      disabled={saving || index === 0}
                      onClick={() => moveItem(index, -1)}
                    >
                      <ChevronUpIcon size={16} />
                    </button>
                    <button
                      type="button"
                      className="layout-btn layout-btn--icon"
                      aria-label={t(MSG.opts_group_move_down, [name])}
                      title={t(MSG.opts_group_move_down, [name])}
                      disabled={saving || index === cfg.layout.length - 1}
                      onClick={() => moveItem(index, 1)}
                    >
                      <ChevronDownIcon size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          }
          // 分组项
          const groupId = item.groupId;
          const group = cfg.groups.find((g) => g.id === groupId);
          const isBuiltin = isBuiltinGroupId(groupId);
          // 组内成员顺序：显式 groupOrders 优先，缺省回退 sources 顺序（含防御过滤）。
          const itemsInGroup = groupOrderOf(allSourceIds, cfg, groupId)
            .map((id) => sourceById.get(id))
            .filter((s): s is SearchSource => s != null);
          const renaming = renamingId === groupId;
          return (
            <div
              className={[
                'layout-row',
                'layout-row--group',
                draggingLayoutIndex === index ? 'layout-row--dragging' : '',
                dropTargetLayoutIndex === index ? 'layout-row--drop-target' : '',
              ].filter(Boolean).join(' ')}
              key={`g:${groupId}`}
              data-kind="group"
              draggable={!saving}
              onDragStart={(e) => handleLayoutDragStart(e, index)}
              onDragOver={(e) => handleLayoutDragOver(e, index)}
              onDrop={(e) => handleLayoutDrop(e, index)}
              onDragEnd={handleLayoutDragEnd}
            >
              <div className="layout-group-head">
                <span
                  className="layout-drag-handle"
                  role="img"
                  aria-label={t(MSG.opts_group_drag_handle)}
                  title={t(MSG.opts_group_drag_handle)}
                >
                  <GripIcon size={16} />
                </span>
                <span className="layout-tag layout-tag--group">{t(MSG.opts_group_item_group)}</span>
                <span className="layout-name">
                  {renaming ? (
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
                      <span className="layout-group-title">{groupDisplayLabel(groupId)}</span>
                      <span className="layout-group-count" aria-hidden="true">{itemsInGroup.length}</span>
                    </>
                  )}
                </span>
                <div className="layout-actions">
                  <button
                    type="button"
                    className="layout-btn"
                    disabled={saving}
                    onClick={() => (group ? startRename(group) : undefined)}
                  >
                    {t(MSG.opts_group_rename)}
                  </button>
                  {!isBuiltin && (
                    <button
                      type="button"
                      className="layout-btn layout-btn--danger"
                      disabled={saving}
                      onClick={() => deleteGroup(groupId)}
                    >
                      {t(MSG.opts_group_delete)}
                    </button>
                  )}
                  <div className="layout-move">
                    <button
                      type="button"
                      className="layout-btn layout-btn--icon"
                      aria-label={t(MSG.opts_group_move_up, [groupDisplayLabel(groupId)])}
                      title={t(MSG.opts_group_move_up, [groupDisplayLabel(groupId)])}
                      disabled={saving || index === 0}
                      onClick={() => moveItem(index, -1)}
                    >
                      <ChevronUpIcon size={16} />
                    </button>
                    <button
                      type="button"
                      className="layout-btn layout-btn--icon"
                      aria-label={t(MSG.opts_group_move_down, [groupDisplayLabel(groupId)])}
                      title={t(MSG.opts_group_move_down, [groupDisplayLabel(groupId)])}
                      disabled={saving || index === cfg.layout.length - 1}
                      onClick={() => moveItem(index, 1)}
                    >
                      <ChevronDownIcon size={16} />
                    </button>
                  </div>
                </div>
              </div>
              {!renaming && itemsInGroup.length > 0 && (
                <div className="layout-group-members">
                  {itemsInGroup.map((s, memberIndex) => (
                    <span
                      className={[
                        'layout-group-member',
                        draggingMember?.groupId === groupId && draggingMember?.sourceId === s.id ? 'layout-group-member--dragging' : '',
                        dropTargetMember?.groupId === groupId && dropTargetMember?.sourceId === s.id ? 'layout-group-member--drop-target' : '',
                      ].filter(Boolean).join(' ')}
                      key={s.id}
                      draggable={!saving}
                      onDragStart={(e) => handleMemberDragStart(e, groupId, s.id)}
                      onDragOver={(e) => handleMemberDragOver(e, groupId, s.id)}
                      onDrop={(e) => handleMemberDrop(e, groupId, s.id)}
                      onDragEnd={handleMemberDragEnd}
                    >
                      <span
                        className="layout-member-drag"
                        role="img"
                        aria-label={t(MSG.opts_group_member_drag, [resolveLabel(s)])}
                        title={t(MSG.opts_group_member_drag, [resolveLabel(s)])}
                      >
                        <GripIcon size={12} />
                      </span>
                      {sourceFavicon(s)}
                      <span className="layout-member-name">{resolveLabel(s)}</span>
                      {/* 组内箭头：触屏/键盘回退（HTML5 拖拽在触摸设备上不生效）。 */}
                      <button
                        type="button"
                        className="layout-member-move"
                        aria-label={t(MSG.opts_group_move_up, [resolveLabel(s)])}
                        title={t(MSG.opts_group_move_up, [resolveLabel(s)])}
                        disabled={saving || memberIndex === 0}
                        onClick={() => moveGroupMember(groupId, memberIndex, memberIndex - 1)}
                      >
                        <ChevronUpIcon size={12} />
                      </button>
                      <button
                        type="button"
                        className="layout-member-move"
                        aria-label={t(MSG.opts_group_move_down, [resolveLabel(s)])}
                        title={t(MSG.opts_group_move_down, [resolveLabel(s)])}
                        disabled={saving || memberIndex === itemsInGroup.length - 1}
                        onClick={() => moveGroupMember(groupId, memberIndex, memberIndex + 1)}
                      >
                        <ChevronDownIcon size={12} />
                      </button>
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
                </div>
              )}
            </div>
          );
        })}

        {/* 未出现在 layout 的 source（理论上 normalize 已覆盖）兜底：显示可置顶入口 */}
        {sources
          .filter((s) => !cfg.layout.some((it) => it.kind === 'source' && it.sourceId === s.id))
          .filter((s) => !cfg.layout.some((it) => it.kind === 'group' && resolveGroupId(s.id, cfg.assignments) === it.groupId))
          .map((s) => (
            <div className="layout-row layout-row--source layout-row--orphan" key={`o:${s.id}`}>
              {sourceFavicon(s)}
              <span className="layout-name">{resolveLabel(s)}</span>
              <div className="layout-actions">
                <button type="button" className="layout-btn" disabled={saving} onClick={() => pinSource(s.id)}>
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
        <button type="button" className="layout-btn layout-btn--primary" disabled={saving || !newGroupName.trim()} onClick={createGroup}>
          <PlusIcon size={15} />
          <span>{t(MSG.opts_group_new)}</span>
        </button>
      </div>
      {error && <p className="status fail" role="alert">{error}</p>}
    </section>
  );
}
