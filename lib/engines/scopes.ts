export type HttpsHostMatchPattern = `https://${string}/*`;
export type HttpsSerpMatchPattern = `https://${string}/search*`;

export const GOOGLE_SERP_HOSTS = [
  'www.google.com',
  'www.google.com.hk',
  'www.google.com.tw',
  'www.google.co.jp',
  'www.google.co.uk',
] as const;

export const BING_SERP_HOSTS = ['www.bing.com', 'cn.bing.com'] as const;
export const SERP_HOSTS = [...GOOGLE_SERP_HOSTS, ...BING_SERP_HOSTS];

export const SERP_HOST_MATCH_PATTERNS = SERP_HOSTS.map(hostMatchPattern);
export const SERP_CONTENT_MATCH_PATTERNS = SERP_HOSTS.map(serpContentMatchPattern);

const googleSerpHosts = new Set<string>(GOOGLE_SERP_HOSTS);
const bingSerpHosts = new Set<string>(BING_SERP_HOSTS);

export function isGoogleSerpHostname(hostname: string): boolean {
  return googleSerpHosts.has(hostname);
}

export function isBingSerpHostname(hostname: string): boolean {
  return bingSerpHosts.has(hostname);
}

export function isSerpUrl(url: URL, isSerpHostname: (hostname: string) => boolean): boolean {
  return url.protocol === 'https:'
    && url.port === ''
    && url.pathname === '/search'
    && isSerpHostname(url.hostname);
}

function hostMatchPattern(host: string): HttpsHostMatchPattern {
  return `https://${host}/*`;
}

function serpContentMatchPattern(host: string): HttpsSerpMatchPattern {
  return `https://${host}/search*`;
}
