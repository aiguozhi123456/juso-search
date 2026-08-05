// AI 对话引擎（AI Engine）：可导航的 AI 对话站，部分站需 content script 注入填充+提交。
//
// 与 SearchEngine（常规搜索引擎）平行存在，但语义不同：AI engine 是**对话导航目标**
// （无 SERP / 无 key / 无 search() / 无 answer），仅用于构建带 query 的导航 URL，
// 部分站需要 content script 在页面加载后自动填充输入框并提交。
//
// 三种执行机制统一为 AiEngine.execution 判别联合：
//   - url-only：原生支持 URL 预填+自动提交（Perplexity / Grok / Kagi / Bing Copilot），零注入
//   - inject：需要 content script 注入
//     · 机制 2（ChatGPT/Claude）：原生预填但不提交，仅补合成 Enter
//     · 机制 3（DeepSeek/豆包/Kimi/Gemini）：完整注入（等 DOM → 填充 → 提交）
//
// 不并入 EngineId：EngineId 绑定 SERP URL/锚点/抽取契约，AI engine 四项全不满足——
// 把 deepseek 塞进 EngineId 会迫使 SearchEngine 接口降级或大量字段可选化。
// 不复用 CustomEngine：id 空间分离 = 生命周期分离（预置硬编码 vs 用户存储）。
//
// injectorKey 桥接：registry 是纯数据（被 worker/UI/content 共享），injector 函数引用
// DOM API（仅 content script 可用）。registry 用 InjectorKey 字面量联合标记（编译期防呆），
// content script 经 host → INJECT_HOST_TABLE 取 engineId → registry.getAiEngine 取到
// execution.injectorKey，再查 INJECTORS 映射——registry 是 injectorKey 的唯一真相源。

/** AI 对话引擎的动态 id，形式 `ai:<slug>`（预置）或 `ai:<uuid>`（用户自定义，v1 不做）。 */
export type AiEngineId = `ai:${string}`;

/**
 * Per-site 注入适配器：在 content script 上下文执行，负责从 URL 提取 query、
 * 等 DOM 渲染、填充输入框、提交。
 *
 * 机制 2（ChatGPT/Claude）共享一个 generic 实现（仅补 Enter）；
 * 机制 3（DeepSeek/豆包/Kimi/Gemini）每站一个独立实现。
 *
 * 实现约定：
 *   - 失败静默降级——选择器超时 / 未登录 / 页面改版时不报错，让用户看到带 q 的页面手动操作；
 *     机制 3 站点若 SPA 已清参，注入降级失败后 query 仅存于 Juso 侧（地址栏不可恢复，需回 Juso 重搜）
 *   - 仅填充+提交，不提取回复——对话回复是流式会话，不回灌进 Juso 的 NormalizedResult
 *   - 幂等——MV3 静态 content script 仅在页面加载时运行一次（pushState/replaceState
 *     不会触发重跑）；提交成功后注入器调用 clearUrlQuery() 清掉 URL 中的 q/prompt
 *     参数，防止用户手动刷新导致重复提交
 */
export interface AiEngineInjector {
  /** 从页面 URL 提取预填查询词；无参数返回 null。 */
  extractQuery(url: string): string | null;
  /** 等 DOM 渲染、填充输入框、提交。在 content script 上下文执行。失败静默降级。
   *  opts.timeoutMs 为可选的 DOM 等待超时（threaded 到 waitForElement，缺省用默认值）——
   *  生产调用不传；测试注入短超时避免真等默认 10s。
   *  opts.autoSubmit 控制是否在填充后自动提交（默认 true）。false 时仅预填不提交，
   *  供「enter=1 参数缺失」场景使用（?q= 原生预填、不自动回车）。 */
  fillAndSubmit(query: string, opts?: { autoSubmit?: boolean; timeoutMs?: number }): Promise<void>;
}

/** content script 注入器标识（字面量联合，编译期防呆）：registry 的 inject 分支引用它，
 *  INJECTORS 映射按它查表。新增注入站必须同步扩展此联合与 INJECTORS/INJECT_HOST_TABLE。 */
export type InjectorKey = 'generic-enter:chatgpt' | 'deepseek' | 'doubao' | 'gemini';

/** 机制 1：纯 URL 导航，零注入。 */
export interface UrlOnlyExecution {
  kind: 'url-only';
}

/** 机制 2+3：需要 content script 注入。injectorKey 由 registry 声明，content script
 *  经 host → engineId → registry 取到后查 INJECTORS 映射（registry 是唯一真相源）。 */
export interface InjectExecution {
  kind: 'inject';
  /** 标识使用哪个注入器；content script 经 host → engineId → registry 取到本值后查 INJECTORS。 */
  injectorKey: InjectorKey;
}

/** 执行策略判别联合。 */
export type AiEngineExecution = UrlOnlyExecution | InjectExecution;

/**
 * AI 对话引擎的归一描述 + 行为适配器。
 * 与 SearchEngine 平行，但不含 SERP 锚点/抽取——AI 对话站不是搜索结果页。
 */
export interface AiEngine {
  readonly id: AiEngineId;
  /** 显示标签的 i18n 消息名（渲染处用 t() 解析）。 */
  readonly label: string;
  /** favicon 图标：扩展内相对路径，经 web_accessible_resources 暴露。 */
  readonly favicon: string;
  /** 构建带 query 的导航 URL。 */
  buildUrl(query: string): string;
  /** 构建首页 URL（无查询时跳转用）。 */
  buildHomeUrl(): string;
  /** 执行策略。 */
  readonly execution: AiEngineExecution;
}
