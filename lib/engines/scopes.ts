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
