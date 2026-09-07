import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { allSources, resolveIconUrl, sourceLabel, type SearchSource } from '@/lib/sources';
import { getCurrentLocale, t, MSG } from '@/lib/i18n';
import { ChevronDownIcon, ChevronUpIcon, GripIcon, PlusIcon } from '@/components/icons';

// 开箱演示的两枚分组与成员 id：与开箱快切栏一致——「API 搜索」（providers）与
// 「搜索引擎」（传统引擎）；AI 对话引擎默认隐藏、站点/自定义默认为空组不渲染。
const GROUP_A_IDS = ['exa', 'tavily'];
const GROUP_B_IDS = ['google', 'bing', 'baidu'];
const DRAG_ID = 'baidu';
// 新建分组的名称：对应编辑器里用户手输的字面量分组（内置组才是 i18n 标签）。
// 演示中由指针逐字「输入」，取名要短（zh 2 字 / en 4 字母）以控制时间轴长度。
// 渲染时求值：语言切换即时生效（每次调用读当前 locale，不再模块级冻结）。
const newGroupLabel = () => (getCurrentLocale() === 'zh_CN' ? '常用' : 'News');

// 真实 source 对象：图标与名称与设置页同源渲染。providers 传已配置让其投影出来。
const DEMO_SOURCES = new Map<string, SearchSource>(
  allSources(['exa', 'tavily'], [], [], [], [], []).map((s) => [s.id, s] as const),
);

function demoMembers(ids: readonly string[]): SearchSource[] {
  return ids
    .map((id) => DEMO_SOURCES.get(id))
    .filter((s): s is SearchSource => s != null);
}

interface Point {
  x: number;
  y: number;
}

/** 成员芯片：与 SourceGroupEditor 的成员芯片同构（手柄 + favicon + 名称 + 箭头 + 置顶）。 */
function MemberChip({
  source,
  dragging = false,
  dropTarget = false,
  dataId,
  style,
  pinPressed = false,
}: {
  source: SearchSource;
  dragging?: boolean;
  dropTarget?: boolean;
  dataId?: string;
  style?: CSSProperties;
  pinPressed?: boolean;
}) {
  const className = [
    'layout-group-member',
    dragging ? 'layout-group-member--dragging' : '',
    dropTarget ? 'layout-group-member--drop-target' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={className} data-source-id={dataId} style={style}>
      <span className="layout-member-drag">
        <GripIcon size={12} />
      </span>
      {source.favicon && (
        <img
          className="layout-source-icon"
          src={resolveIconUrl(source.favicon)}
          alt=""
          width={14}
          height={14}
        />
      )}
      <span className="layout-member-name">{sourceLabel(source, t)}</span>
      <button type="button" className="layout-member-move" tabIndex={-1}>
        <ChevronUpIcon size={12} />
      </button>
      <button type="button" className="layout-member-move" tabIndex={-1}>
        <ChevronDownIcon size={12} />
      </button>
      <button
        type="button"
        className={`layout-member-pin${pinPressed ? ' onboarding-el-pressed' : ''}`}
        tabIndex={-1}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 2v7.5L9 5.5 6 3l-3-1z" fill="currentColor" />
        </svg>
      </button>
    </span>
  );
}

/** 分组行头部：手柄 + 「分组」标签 + 组名 + 计数 + 重命名/上下移（与编辑器同构）。
 *  deletable：自定义组才有「删除」按钮（内置组在编辑器中不可删除）。 */
function GroupHead({
  label,
  count,
  deletable = false,
  deletePressed = false,
}: {
  label: string;
  count: number;
  deletable?: boolean;
  deletePressed?: boolean;
}) {
  return (
    <div className="layout-group-head">
      <span className="layout-drag-handle">
        <GripIcon size={16} />
      </span>
      <span className="layout-tag layout-tag--group">{t(MSG.opts_group_item_group)}</span>
      <span className="layout-name">
        <span className="layout-group-title">{label}</span>
        <span className="layout-group-count">{count}</span>
      </span>
      <div className="layout-actions">
        <button type="button" className="layout-btn" tabIndex={-1}>
          {t(MSG.opts_group_rename)}
        </button>
        {deletable && (
          <button
            type="button"
            className={`layout-btn layout-btn--danger${deletePressed ? ' onboarding-el-pressed' : ''}`}
            tabIndex={-1}
          >
            {t(MSG.opts_group_delete)}
          </button>
        )}
        <div className="layout-move">
          <button type="button" className="layout-btn layout-btn--icon" tabIndex={-1}>
            <ChevronUpIcon size={16} />
          </button>
          <button type="button" className="layout-btn layout-btn--icon" tabIndex={-1}>
            <ChevronDownIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 鼠标指针（装饰）：经典箭头造型，图形左上角对准坐标热点。 */
function CursorGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.5 2.5 L18.8 12.2 L12.6 13.3 L16.2 20.2 L13.4 21.6 L10 14.6 L5.5 18.2 Z"
        fill="#fff"
        stroke="#333"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 来源布局示意（首装引导）：以「来源布局」编辑器的真实 DOM 结构与样式类
 * （entrypoints/options/styles.css，本页直接引入）渲染，保证与设置页所见一致。
 *
 * 动画用鼠标指针图案模拟真实操作，走一遍编辑器的五类变更后回到初始状态无缝循环：
 *   1. 按住 Baidu chip 拖到「搜索引擎」组内首位（组内拖拽排序）；
 *   2. 点击其「置顶」按钮 → 底部浮现「平铺」行（置顶）；
 *   3. 点击新建输入框 → 逐字输入分组名 → 点击「新建分组」→ 空分组行出现（新建分组）；
 *   4. 展开平铺行的「收入分组」下拉 → 选中「常用」→ Baidu 飞入该组（收入分组）；
 *   5. 点击「常用」行的「删除」→ 行卸下、Baidu 回落默认组搜索引擎、下方位移——
 *      一个节拍完成（删除分组），画面恰为初始状态，循环无缝衔接。
 * 拖拽/悬浮高亮复用编辑器真实状态类（--dragging / --drop-target）；位移动画为 FLIP。
 * 纯装饰：inert + aria-hidden，不可交互；prefers-reduced-motion 与测试环境退化为静态。
 */
export function SourceLayoutDemo() {
  // false = [Google, Bing, Baidu]；true = Baidu 在首位
  const [order, setOrder] = useState(false);
  // Baidu 已置顶为「平铺」行（置顶期间从成员区移除）
  const [pinned, setPinned] = useState(false);
  // 「常用」分组行已创建
  const [newGroup, setNewGroup] = useState(false);
  // Baidu 已收入「常用」组（平铺行随之消失）
  const [folded, setFolded] = useState(false);
  // 拖拽跟随：Baidu chip 相对其原始位置的位移（与指针同步滑向目标槽位）
  const [drag, setDrag] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropId, setDropId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ p: Point; dur: number; on: boolean }>({
    p: { x: 0, y: 0 },
    dur: 0,
    on: false,
  });
  const [pressed, setPressed] = useState(false);
  const [ripple, setRipple] = useState(0);
  // 点击目标的按压反馈（cursor-click-ripple：光标与目标同时压缩，瞬时线性）
  const [pressTarget, setPressTarget] = useState<string | null>(null);
  // 新建分组输入：指针点击输入框后逐字输入（镜像真实的手输过程），聚焦态同步高亮
  const [typedLen, setTypedLen] = useState(0);
  const [inputFocus, setInputFocus] = useState(false);
  // 收入分组的下拉模拟：真实交互是 <select>（cfg.groups 选项）onChange 后才 foldIntoGroup，
  // 故演示必须展示「展开下拉 → 选中目标分组」两步，而非点击收起的 select 直接搬运。
  const [menu, setMenu] = useState(false);
  const [menuHover, setMenuHover] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const orderRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const membersRef = useRef<HTMLDivElement>(null);
  const pinnedRowRef = useRef<HTMLDivElement>(null);
  const prevRectsRef = useRef<Map<string, DOMRect> | null>(null);
  // 收入分组：平铺行位置（Baidu chip 跨行飞行的起点）
  const foldFromRef = useRef<DOMRect | null>(null);
  // 收入分组：「常用」组行原位置（平铺行卸下后该行上移，FLIP 消除跳变）
  const newGroupRowFromRef = useRef<DOMRect | null>(null);
  // 删除分组：「新建分组」区原位置（常用行卸下后上移，FLIP 消除跳变）
  const barFromRef = useRef<DOMRect | null>(null);

  function relCenter(el: Element): Point {
    const c = rootRef.current?.getBoundingClientRect();
    if (!c) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: r.left - c.left + r.width / 2, y: r.top - c.top + r.height / 2 };
  }

  function memberEl(id: string): HTMLElement | null {
    return membersRef.current?.querySelector<HTMLElement>(`[data-source-id="${id}"]`) ?? null;
  }

  function moveToEl(el: Element | null, dur: number) {
    if (el && rootRef.current) setCursor({ p: relCenter(el), dur, on: true });
  }

  /** 指针隐藏待命：不设可见停靠点（容器角落紧邻「新建分组」区，现身会造成误移动感）。 */
  function hideCursor() {
    setCursor((c) => ({ ...c, on: false }));
  }

  /** 指针就位现身：瞬移（dur=0）到目标处淡入，避免从上一次位置滑过半个演示区。 */
  function appearAt(el: Element | null) {
    if (el && rootRef.current) setCursor({ p: relCenter(el), dur: 0, on: true });
  }

  /** FLIP 前拍：重排渲染前记录成员位置（getBoundingClientRect 含进行中的 transform）。 */
  function captureMembers() {
    const container = membersRef.current;
    if (!container) return;
    prevRectsRef.current = new Map(
      Array.from(container.querySelectorAll<HTMLElement>('.layout-group-member')).map((el) => [
        el.dataset.sourceId ?? '',
        el.getBoundingClientRect(),
      ]),
    );
  }

  /** 记录「新建分组」区当前位置：行增删导致其上下移动时由 FLIP 平滑接力，
   *  与芯片/行的位移统一为同一时长与缓动（一次节拍，一种运动语言）。 */
  function captureBar() {
    barFromRef.current =
      rootRef.current?.querySelector<HTMLElement>('.source-layout-new')?.getBoundingClientRect() ?? null;
  }

  function press(target: string | null) {
    setPressed(true);
    setPressTarget(target);
    setRipple((n) => n + 1);
  }

  function release() {
    setPressed(false);
    setPressTarget(null);
  }

  useEffect(() => {
    // jsdom（测试）无 matchMedia；prefers-reduced-motion 用户：均退化为静态示意。
    if (typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let step = 0;
    // 时间轴（tick=300ms，循环 65 tick ≈ 19.5s）：
    //   1 指针隐藏待命 → 3 现身于 Baidu → 6 按下 → 7 按住拖向首位（chip 同步跟随）
    //   → 13 松手重排（FLIP）→ 15 移到「置顶」按钮 → 19 点击 → 20 浮现平铺行
    //   → 23 移到新建输入框 → 27 点击聚焦 → 28–31 逐字输入分组名
    //   → 33 移到「新建分组」→ 37 点击 → 38 出现「常用」空组（输入框清空）
    //   → 41 移到平铺行「收入分组」select → 45 按下展开下拉（真实交互第一步）
    //   → 46 移到「常用」选项 → 48 悬停高亮 → 50 点击选中
    //   → 51 收起下拉，Baidu 飞入「常用」组（foldIntoGroup）
    //   → 54 移到「常用」行「删除」按钮 → 58 点击 → 59 删除分组：Baidu 回落搜索引擎末位
    //     （deleteGroup 语义：无归属来源按类型回默认组）→ 60 记录下方位置 → 61 行卸载、
    //     下方内容 FLIP 上移 → 62–63 定格（恰为初始状态）→ 64 指针隐藏 → 循环。
    const timer = window.setInterval(() => {
      step = (step + 1) % 65;
      if (step >= 28 && step <= 31) setTypedLen(Math.min(step - 27, newGroupLabel().length));
      switch (step) {
        case 1:
          hideCursor();
          break;
        case 3:
          appearAt(memberEl(DRAG_ID));
          break;
        case 6:
          press('chip');
          break;
        case 7: {
          const from = memberEl(DRAG_ID);
          const target = memberEl('google');
          if (from && target && rootRef.current) {
            const to = relCenter(target);
            setDragging(true);
            setDropId('google');
            setDrag({ x: to.x - relCenter(from).x, y: 0 });
            moveToEl(target, 1300);
          }
          break;
        }
        case 13:
          // 松手：真实重排（Baidu 到首位）+ FLIP 滑动；拖拽样式随之清除。
          release();
          setDragging(false);
          setDropId(null);
          setDrag(null);
          captureMembers();
          orderRef.current = true;
          setOrder(true);
          break;
        case 15:
          moveToEl(memberEl(DRAG_ID)?.querySelector<HTMLElement>('.layout-member-pin') ?? null, 520);
          break;
        case 19:
          press('pin');
          break;
        case 20:
          // 置顶：成员区收拢（FLIP），底部浮现「平铺」行，下方区域 FLIP 让位。
          release();
          captureMembers();
          captureBar();
          setPinned(true);
          break;
        case 23:
          // 先点输入框：分组名是手输的，输入框聚焦后才逐字输入。
          moveToEl(rootRef.current?.querySelector<HTMLElement>('.source-layout-new .layout-new-input') ?? null, 520);
          break;
        case 27:
          press('input');
          setInputFocus(true);
          break;
        case 33:
          moveToEl(rootRef.current?.querySelector<HTMLElement>('.source-layout-new .layout-btn--primary') ?? null, 520);
          break;
        case 37:
          press('new');
          setInputFocus(false);
          break;
        case 38:
          // 新建分组：空「常用」组行出现（与编辑器 createGroup 一致，追加到布局末尾）；
          // 输入框随即清空回 placeholder——镜像真实实现里的 setNewGroupName('')。
          release();
          captureBar();
          setTypedLen(0);
          setNewGroup(true);
          break;
        case 41:
          moveToEl(pinnedRowRef.current?.querySelector<HTMLElement>('.layout-fold select') ?? null, 520);
          break;
        case 45: {
          // 按下 select：展开分组下拉（向上弹，避免溢出演示区底部）。
          press('select');
          const sel = pinnedRowRef.current?.querySelector<HTMLElement>('.layout-fold select');
          const c = rootRef.current?.getBoundingClientRect();
          if (sel && c) {
            const r = sel.getBoundingClientRect();
            setMenuPos({
              left: r.left - c.left,
              bottom: c.height - (r.top - c.top) + 4,
            });
            setMenu(true);
          }
          break;
        }
        case 46:
          // 松开（菜单保持展开），移到「常用」选项。
          release();
          moveToEl(rootRef.current?.querySelector<HTMLElement>('[data-menu-target]') ?? null, 520);
          break;
        case 48:
          setMenuHover(true);
          break;
        case 50:
          press('option');
          break;
        case 51: {
          // 选中「常用」：收起下拉，Baidu 从平铺行飞入「常用」组成员区末位
          //（与编辑器 foldIntoGroup 的追加语义一致）。
          release();
          setMenu(false);
          setMenuHover(false);
          foldFromRef.current = pinnedRowRef.current?.getBoundingClientRect() ?? null;
          newGroupRowFromRef.current =
            rootRef.current?.querySelector<HTMLElement>('[data-demo-enter]')?.getBoundingClientRect() ?? null;
          captureMembers();
          captureBar();
          setPinned(false);
          setFolded(true);
          break;
        }
        case 54:
          // 移到「常用」行的「删除」按钮（自定义组在编辑器里真实存在该按钮）。
          moveToEl(
            rootRef.current?.querySelector<HTMLElement>('[data-demo-enter] .layout-btn--danger') ?? null,
            520,
          );
          break;
        case 58:
          press('delete');
          break;
        case 59: {
          // 删除「常用」组：行立即卸载，同一拍内 Baidu 向上飞回搜索引擎末位
          //（deleteGroup 语义：无归属来源按类型回落默认组）、「新建分组」区同步上移补位。
          // 一个 360ms 节拍完成，画面恰好回到初始状态，循环无缝衔接。
          release();
          foldFromRef.current =
            rootRef.current
              ?.querySelector<HTMLElement>('.layout-group-member[data-source-id="baidu"]')
              ?.getBoundingClientRect() ?? null;
          captureBar();
          captureMembers();
          orderRef.current = false;
          setOrder(false);
          setFolded(false);
          setNewGroup(false);
          break;
        }
        case 64:
          hideCursor();
          break;
      }
    }, 300);
    return () => window.clearInterval(timer);
  }, []);

  // FLIP 后拍：按旧位置反向位移后过渡归零，得到真实元素的滑动换位/收拢/跨行飞行。
  useLayoutEffect(() => {
    const prev = prevRectsRef.current;
    prevRectsRef.current = null;
    const root = rootRef.current;
    if (!root) return;
    const flyFrom = foldFromRef.current;
    foldFromRef.current = null;
    // 全区扫描：收入新分组的芯片已不在 membersRef 行内，需跨行匹配。
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('.layout-group-member'))) {
      const id = el.dataset.sourceId ?? '';
      const before = prev?.get(id) ?? (id === DRAG_ID ? flyFrom : null);
      if (!before) continue;
      const after = el.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (dx === 0 && dy === 0) continue;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetHeight; // 强制 reflow：反向位移先生效，随后过渡归零
      el.style.transition = 'transform 360ms var(--ease-out)';
      el.style.transform = '';
    }
    // 「常用」组行：平铺行卸下后整行上移一格，FLIP 消除跳变。
    const rowFrom = newGroupRowFromRef.current;
    newGroupRowFromRef.current = null;
    if (rowFrom) {
      const row = root.querySelector<HTMLElement>('[data-demo-enter]');
      if (row) {
        const dy = rowFrom.top - row.getBoundingClientRect().top;
        if (dy !== 0) {
          row.style.transition = 'none';
          row.style.transform = `translateY(${dy}px)`;
          void row.offsetHeight;
          row.style.transition = 'transform 360ms var(--ease-out)';
          row.style.transform = '';
        }
      }
    }
    // 「新建分组」区：常用行卸载后上移，同样 FLIP 平滑接力。
    const barFrom = barFromRef.current;
    barFromRef.current = null;
    if (barFrom) {
      const bar = root.querySelector<HTMLElement>('.source-layout-new');
      if (bar) {
        const dy = barFrom.top - bar.getBoundingClientRect().top;
        if (dy !== 0) {
          bar.style.transition = 'none';
          bar.style.transform = `translateY(${dy}px)`;
          void bar.offsetHeight;
          bar.style.transition = 'transform 360ms var(--ease-out)';
          bar.style.transform = '';
        }
      }
    }
  }, [order, pinned, newGroup, folded]);

  // 「搜索引擎」成员：置顶/收入期间 Baidu 不在；其余按当前顺序渲染。
  const searchIds = pinned || folded
    ? GROUP_B_IDS.filter((id) => id !== DRAG_ID)
    : order
      ? [DRAG_ID, ...GROUP_B_IDS.filter((id) => id !== DRAG_ID)]
      : GROUP_B_IDS;
  const source = DEMO_SOURCES.get(DRAG_ID);

  return (
    <div className="source-layout-list onboarding-layout-demo" aria-hidden="true" inert ref={rootRef}>
      <div className="layout-row layout-row--group" data-kind="group">
        <GroupHead label={t(MSG.group_ai_search)} count={GROUP_A_IDS.length} />
        <div className="layout-group-members">
          {demoMembers(GROUP_A_IDS).map((s) => (
            <MemberChip key={s.id} source={s} dataId={s.id} />
          ))}
        </div>
      </div>

      <div className="layout-row layout-row--group" data-kind="group">
        <GroupHead label={t(MSG.group_engines)} count={searchIds.length} />
        <div className="layout-group-members" ref={membersRef}>
          {demoMembers(searchIds).map((s) => (
            <MemberChip
              key={s.id}
              source={s}
              dataId={s.id}
              dragging={dragging && s.id === DRAG_ID}
              dropTarget={dropId === s.id}
              pinPressed={pressTarget === 'pin' && s.id === DRAG_ID}
              style={
                drag && s.id === DRAG_ID
                  ? {
                      transform: `translate(${drag.x}px, ${drag.y}px)`,
                      transition: 'transform 1300ms var(--ease-in-out)',
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      {pinned && source && (
        <div className="layout-row layout-row--source" data-kind="source" ref={pinnedRowRef}>
          <span className="layout-drag-handle">
            <GripIcon size={16} />
          </span>
          <span className="layout-tag layout-tag--source">{t(MSG.opts_group_item_source)}</span>
          {source.favicon && (
            <img
              className="layout-source-icon"
              src={resolveIconUrl(source.favicon)}
              alt=""
              width={14}
              height={14}
            />
          )}
          <span className="layout-name">{sourceLabel(source, t)}</span>
          <div className="layout-actions">
            <label className="layout-fold">
              <span className="sr-only">{t(MSG.opts_group_unpin_into)}</span>
              <select
                className={pressTarget === 'select' ? 'onboarding-el-pressed' : undefined}
                value="__pinned__"
                tabIndex={-1}
                onChange={() => undefined}
              >
                <option value="__pinned__">{t(MSG.opts_group_pin_source)}</option>
                <option value="ai-search">{t(MSG.group_ai_search)}</option>
                <option value="engines">{t(MSG.group_engines)}</option>
                <option value="new">{newGroupLabel()}</option>
              </select>
            </label>
            <div className="layout-move">
              <button type="button" className="layout-btn layout-btn--icon" tabIndex={-1}>
                <ChevronUpIcon size={16} />
              </button>
              <button type="button" className="layout-btn layout-btn--icon" tabIndex={-1}>
                <ChevronDownIcon size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {newGroup && (
        <div className="layout-row layout-row--group" data-kind="group" data-demo-enter="">
          <GroupHead
            label={newGroupLabel()}
            count={folded ? 1 : 0}
            deletable
            deletePressed={pressTarget === 'delete'}
          />
          {folded && source && (
            <div className="layout-group-members">
              <MemberChip source={source} dataId={DRAG_ID} />
            </div>
          )}
        </div>
      )}

      {/* 新建分组区：与编辑器一致。指针点击输入框聚焦后逐字输入分组名，再点「新建分组」。 */}
      <div className="source-layout-new">
        <div
          className={`layout-new-input onboarding-input-mirror${inputFocus ? ' layout-new-input--focus' : ''}`}
          aria-label={newGroupLabel()}
        >
          <span>{newGroupLabel().slice(0, typedLen)}</span>
          {inputFocus && <span className="onboarding-caret" />}
          {!inputFocus && typedLen === 0 && (
            <span className="onboarding-input-placeholder">{t(MSG.opts_group_new_placeholder)}</span>
          )}
        </div>
        <button
          type="button"
          className={`layout-btn layout-btn--primary${pressTarget === 'new' ? ' onboarding-el-pressed' : ''}`}
          tabIndex={-1}
        >
          <PlusIcon size={15} />
          <span>{t(MSG.opts_group_new)}</span>
        </button>
      </div>

      {/* 收入分组的下拉模拟：复现 select 展开后的选项列表（当前值「置顶」+ 全部分组），
          指针选中「常用」才触发搬运——与编辑器 select onChange 的真实交互一致。 */}
      {menu && (
        <div className="onboarding-select-menu" style={{ left: menuPos.left, bottom: menuPos.bottom }}>
          <div className="onboarding-select-menu__item onboarding-select-menu__item--current">
            {t(MSG.opts_group_pin_source)}
          </div>
          <div className="onboarding-select-menu__item">{t(MSG.group_ai_search)}</div>
          <div className="onboarding-select-menu__item">{t(MSG.group_engines)}</div>
          <div
            className={`onboarding-select-menu__item${menuHover ? ' onboarding-select-menu__item--hover' : ''}${pressTarget === 'option' ? ' onboarding-el-pressed' : ''}`}
            data-menu-target=""
          >
            {newGroupLabel()}
          </div>
        </div>
      )}

      <div
        className={[
          'onboarding-cursor',
          cursor.on ? 'onboarding-cursor--on' : '',
          pressed ? 'onboarding-cursor--pressed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          transform: `translate(${cursor.p.x - 2}px, ${cursor.p.y - 2}px)`,
          transition: `transform ${cursor.dur}ms var(--ease-in-out), opacity 240ms var(--ease-out)`,
        }}
      >
        <CursorGlyph />
        {pressed && (
          <>
            <span key={`r1-${ripple}`} className="onboarding-ripple" />
            <span key={`r2-${ripple}`} className="onboarding-ripple onboarding-ripple--lag" />
          </>
        )}
      </div>
    </div>
  );
}
