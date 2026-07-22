// 常规搜索引擎（非 AI provider）的归一描述 + 行为适配器（v3）。
//
// 与 ProviderAdapter 并行存在，但语义不同：engine 是**纯导航目标**
// （无 key / 无 answer / 无 search()），仅用于构建 SERP URL、在 SERP 页
// 注入切换栏，以及把 AI provider 与常规引擎投影成同一个快切栏。
//
// v3：engine 从纯数据记录升级为带方法的自包含适配器——buildSerpUrl/matches/
// extractQuery/anchors 各自归属到每个 engine，新增 engine（DuckDuckGo 等）时
// 不再需要改散落的自由函数。serpUrlTemplate/queryParam 降级为各 engine 模块内的
// 私有构造细节。
//
// 不并入 ProviderId：ProviderId 绑定 BYOK key 与 adapter.search() 契约，
// 而常规引擎两者都没有——把它们塞进同一联合会污染 gateway / storage 的
// key 读路径。详见 docs/solutions architecture-patterns v2 learning。

export type EngineId = 'google' | 'bing' | 'baidu' | 'douyin' | 'xiaohongshu';

/** WXT append 模式的本地镜像（与 wxt 的 ContentScriptAppendMode 字面量一致，避免在纯数据模块里 import wxt 类型）。 */
export type AppendMode = 'last' | 'first' | 'replace' | 'before' | 'after';

/** SERP 注入锚点策略（原 lib/engines/serp-anchor.ts，现归入 engine 契约）。 */
export interface AnchorStrategy {
  /** 持久锚点的 CSS 选择器。 */
  selector: string;
  /** 相对锚点的插入位置。 */
  append: AppendMode;
  /** 需要按某个元素的 content box 同步 host 宽度/左边距时使用。 */
  alignTo?: string;
}

export interface SearchEngine {
  readonly id: EngineId;
  /** 显示标签的 i18n 消息名（渲染处用 t() 解析）。 */
  readonly label: string;
  /** favicon 图标：扩展内相对路径，经 web_accessible_resources 暴露，渲染处用 runtime.getURL 解析。 */
  readonly favicon: string;
  /** 构建该 engine 的 SERP 查询 URL。 */
  buildSerpUrl(query: string): string;
  /** 构建 engine 首页 URL（无查询时跳转用，如 https://www.google.com/）。 */
  buildHomeUrl(): string;
  /** SERP URL 归属判定：该 URL 是否为本 engine 支持 host 上的 canonical HTTPS SERP route（registry 的 matchEngineByUrl 逐 engine 委托）。 */
  matches(url: string): boolean;
  /** 从本 engine 的 SERP URL 提取查询词；非本 engine 或无查询参数返回 null。 */
  extractQuery(url: string): string | null;
  /**
   * 本 engine 的持久 SERP 注入锚点候选（按优先级降序）。
   * index 0 是首选锚点；后续元素是当首选选择器在该页面布局下缺失时的递进回退。
   * content script 启动时按顺序取第一个匹配 `document.querySelector` 的候选；
   * 全部缺失时落到数组末尾元素并交由 mountWhenAnchorReady 等待其出现。
   */
  readonly anchors: AnchorStrategy[];
  /**
   * 当 SERP 栏挂载时把这段 CSS 注入宿主页 <head>，卸载时移除。
   * 用于在栏会与宿主元素重叠时腾出空间。可选。
   */
  readonly pageStyles?: string;
}

/**
 * null / 未知 engine 的兜底锚点候选（= Google 的 #rcnt 外置、#center_col 对齐策略）。
 * 单元素数组，保留历史上 null/未知 engine 退回单个锚点的语义。
 */
export const DEFAULT_ANCHORS: AnchorStrategy[] = [
  { selector: '#rcnt', append: 'before', alignTo: '#center_col' },
];
