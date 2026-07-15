import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENTRYPOINT_HTMLS = [
  'entrypoints/search/index.html',
  'entrypoints/options/index.html',
  'entrypoints/bridge/index.html',
];

function getScriptTags(html: string): string[] {
  return html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? [];
}

describe('extension CSP', () => {
  it.each(ENTRYPOINT_HTMLS)('%s does not contain inline scripts', async (file) => {
    const html = await readFile(resolve(process.cwd(), file), 'utf8');
    const inlineScripts = getScriptTags(html).filter((tag) => !/\ssrc\s*=/.test(tag));

    expect(inlineScripts).toEqual([]);
  });
});
