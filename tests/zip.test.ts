import { describe, it, expect } from 'vitest';
import { createStoreZip } from '@/lib/zip';

const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

// vitest 的 jsdom 环境里，TextEncoder 与 transformed 模块各自产出的 Uint8Array
// 原型可能不同（跨 realm），toEqual 会误判；用 Array.from 做逐字节比较更稳。
const bytes = (u: Uint8Array): number[] => Array.from(u);

/**
 * 独立的 CRC-32（逐位实现，IEEE 反射多项式 0xEDB88320）——刻意与 lib/zip.ts 的
 * 表驱动实现不同，保证测试通过时 CRC 是对照独立推导值验证的，而非自洽。
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type ReadEntry = { path: string; data: Uint8Array; crc: number; method: number };

/** 极简 ZIP 读取器：EOCD → central directory → local header → STORE 数据。 */
function readZip(buf: Uint8Array): ReadEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let eocd = buf.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('EOCD signature not found');
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);

  const out: ReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error('bad central directory record');
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const path = new TextDecoder().decode(buf.subarray(pos + 46, pos + 46 + nameLen));

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('bad local file header');
    const method = view.getUint16(localOffset + 8, true);
    const crc = view.getUint32(localOffset + 14, true);
    const compSize = view.getUint32(localOffset + 18, true);
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const data = buf.slice(dataStart, dataStart + compSize);

    out.push({ path, data, crc, method });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('createStoreZip', () => {
  const files = [
    { path: 'a/SKILL.md', data: encode('# title\n') },
    { path: 'a/scripts/x.py', data: encode('print(1)\n') },
  ];

  it('round-trips files and data with auto-inserted directory entries', () => {
    const entries = readZip(createStoreZip(files));

    // 目录 entry 在前（排序后），文件 entry 保持输入顺序。
    expect(entries.map((e) => e.path)).toEqual(['a/', 'a/scripts/', 'a/SKILL.md', 'a/scripts/x.py']);

    const fileEntries = entries.filter((e) => !e.path.endsWith('/'));
    const dirEntries = entries.filter((e) => e.path.endsWith('/'));

    expect(fileEntries).toHaveLength(2);
    expect(fileEntries.map((e) => e.path)).toEqual(['a/SKILL.md', 'a/scripts/x.py']);
    expect(bytes(fileEntries[0].data)).toEqual(bytes(encode('# title\n')));
    expect(bytes(fileEntries[1].data)).toEqual(bytes(encode('print(1)\n')));

    expect(dirEntries.map((e) => e.path)).toEqual(['a/', 'a/scripts/']);
    expect(dirEntries[0].data).toHaveLength(0);
    expect(dirEntries[1].data).toHaveLength(0);

    for (const e of entries) expect(e.method).toBe(0); // STORE only
  });

  it('stores the correct CRC-32 in each local header', () => {
    // 先把独立实现锚定到公开发布的 CRC-32 校验值，再逐条对照写入的 CRC。
    expect(crc32(encode('123456789'))).toBe(0xcbf43926);

    const entries = readZip(createStoreZip(files));
    const original = new Map(files.map((f) => [f.path, f.data]));
    for (const e of entries) {
      if (e.path.endsWith('/')) continue; // 目录 CRC 在下一个测试单独断言
      expect(e.crc).toBe(crc32(original.get(e.path)!));
    }
  });

  it('gives empty directory entries zero crc and zero size', () => {
    const entries = readZip(createStoreZip(files));
    for (const e of entries.filter((x) => x.path.endsWith('/'))) {
      expect(e.crc).toBe(0);
      expect(e.data).toHaveLength(0);
    }
  });

  it('keeps forward slashes and no leading slash in paths', () => {
    const paths = readZip(createStoreZip(files)).map((e) => e.path);
    for (const p of paths) {
      expect(p).not.toMatch(/\\/); // 永不出现反斜杠
      expect(p.startsWith('/')).toBe(false); // 永不出现前导斜杠
    }
    expect(paths).toContain('a/SKILL.md');
    expect(paths).toContain('a/scripts/x.py');
    expect(paths).toContain('a/scripts/');
  });
});
