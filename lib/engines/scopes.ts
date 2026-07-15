export type HttpsHostMatchPattern = `https://${string}/*`;
export type HttpsSerpMatchPattern = `https://${string}${`/${string}`}*`;

export const GOOGLE_SERP_HOSTS = [
  'www.google.com',
  'www.google.com.hk',
  'www.google.com.tw',
  'www.google.co.jp',
  'www.google.co.uk',
] as const;

export const BING_SERP_HOSTS = ['www.bing.com', 'cn.bing.com'] as const;
export const BAIDU_SERP_HOSTS = ['www.baidu.com'] as const;
export const SERP_HOSTS = [...GOOGLE_SERP_HOSTS, ...BING_SERP_HOSTS, ...BAIDU_SERP_HOSTS];

export const SERP_HOST_MATCH_PATTERNS = SERP_HOSTS.map(hostMatchPattern);
export const SERP_CONTENT_MATCH_PATTERNS = [
  ...GOOGLE_SERP_HOSTS.map((host) => serpContentMatchPattern(host, '/search')),
  ...BING_SERP_HOSTS.map((host) => serpContentMatchPattern(host, '/search')),
  ...BAIDU_SERP_HOSTS.map((host) => serpContentMatchPattern(host, '/s')),
];
// 结果抽取需要在引擎站内的 challenge / consent 重定向页接收消息；注入搜索栏仍只匹配
// canonical SERP 路径，避免在这些页面渲染 UI。
export const ENGINE_EXTRACTOR_CONTENT_MATCH_PATTERNS = SERP_HOST_MATCH_PATTERNS;

const googleSerpHosts = new Set<string>(GOOGLE_SERP_HOSTS);
const bingSerpHosts = new Set<string>(BING_SERP_HOSTS);
const baiduSerpHosts = new Set<string>(BAIDU_SERP_HOSTS);

export function isGoogleSerpHostname(hostname: string): boolean {
  return googleSerpHosts.has(hostname);
}

export function isBingSerpHostname(hostname: string): boolean {
  return bingSerpHosts.has(hostname);
}

export function isBaiduSerpHostname(hostname: string): boolean {
  return baiduSerpHosts.has(hostname);
}

export function isEngineChallengeOrConsentUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || url.port !== '' || !SERP_HOSTS.some((host) => host === url.hostname)) return false;
  return /\/(?:sorry|captcha|challenge|consent)(?:\/|$)/i.test(url.pathname);
}

export function isEngineChallengeOrConsentUrlForHost(url: URL, hostnames: readonly string[]): boolean {
  return hostnames.includes(url.hostname) && isEngineChallengeOrConsentUrl(url);
}

export function isSerpUrl(
  url: URL,
  isSerpHostname: (hostname: string) => boolean,
  pathname: string = '/search',
): boolean {
  return url.protocol === 'https:'
    && url.port === ''
    && url.pathname === pathname
    && isSerpHostname(url.hostname);
}

function hostMatchPattern(host: string): HttpsHostMatchPattern {
  return `https://${host}/*`;
}

function serpContentMatchPattern(host: string, pathname: `/${string}`): HttpsSerpMatchPattern {
  return `https://${host}${pathname}*`;
}
