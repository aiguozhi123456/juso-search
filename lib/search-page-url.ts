// 把 SERP 注入栏传来的「跳 Juso 搜索页」深链，收敛为扩展内 search.html 的绝对 URL。
//
// 信任边界：openSearchPage handler 接收任意 content-script 来源的 data（@webext-core/messaging
// 不做 origin 校验），本函数是唯一的入参净化点。固定 base 为 /search.html（路径层防 open-redirect：
// 不能跳到 options.html 等特权页），仅白名单转发 provider 与 query 参数（参数层防注入无关键）。
// provider 值本身不在此校验——search 页 mount effect 的 isProviderId + configuredProviderIds
// 是最终防线（见 lib/deep-link.ts 与 App.tsx）。

/** 运行期 getURL 形态（WXT 把类型签名收窄为 PublicPath，运行期接受任意扩展内相对路径）。 */
type GetUrl = (path: string) => string;

/**
 * 把深链 data 收敛为 chrome-extension://<id>/search.html[?...] 绝对 URL。
 * 非法/空/非 search.html 路径一律返回 null，由调用方决定是否记录可观测性日志。
 */
export function buildSafeSearchUrl(data: string | undefined): string | null {
  if (typeof data !== 'string' || data.length === 0) return null;
  const rawParams = data.includes('?') ? data.slice(data.indexOf('?') + 1) : '';
  const parsed = new URLSearchParams(rawParams);
  const allowed = new URLSearchParams();
  const provider = parsed.get('provider');
  if (provider) allowed.set('provider', provider);
  const query = parsed.get('query');
  if (query) allowed.set('query', query);
  const search = allowed.toString();
  const path = search ? `/search.html?${search}` : '/search.html';
  return (browser.runtime.getURL as GetUrl)(path);
}
