// 常规搜索引擎（非 AI provider）的归一描述（v2 快切）。
//
// 与 ProviderAdapter 并行存在，但语义不同：engine 是**纯导航目标**
// （无 key / 无 answer / 无 search()），仅用于构建 SERP URL、在 SERP 页
// 注入切换栏，以及把 AI provider 与常规引擎投影成同一个快切栏。
//
// 不并入 ProviderId：ProviderId 绑定 BYOK key 与 adapter.search() 契约，
// 而常规引擎两者都没有——把它们塞进同一联合会污染 gateway / storage 的
// key 读路径。详见 docs/solutions architecture-patterns v2 learning。

export type EngineId = 'google' | 'bing';

export interface SearchEngine {
  id: EngineId;
  /** 显示标签的 i18n 消息名（渲染处用 t() 解析）。 */
  label: string;
  /** favicon 图标：扩展内相对路径，经 web_accessible_resources 暴露，渲染处用 runtime.getURL 解析。 */
  favicon: string;
  /** SERP 查询 URL 模板，{q} 为查询词占位符。 */
  serpUrlTemplate: string;
  /** 该 engine SERP 的查询参数名（用于从当前 SERP URL 提取 query）。 */
  queryParam: string;
}
