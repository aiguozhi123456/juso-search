// STORE-mode（无压缩）ZIP 写入器，供 MV3 service worker 使用。纯函数，无 DOM /
// worker / Node API 依赖。产出最小但合法的归档：local file header + central
// directory + EOCD（APPNOTE 4.3.7 / 4.3.12 / 4.3.16），全部小端字节序。
// 中间目录自动以「/ 结尾、空数据」的 entry 插入。

export type ZipEntry = { path: string; data: Uint8Array };

const encoder = new TextEncoder();

function bytes(s: string): Uint8Array {
  return encoder.encode(s);
}

// CRC-32（IEEE 802.3，反射多项式 0xEDB88320），表驱动。
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function setU16(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
}

function setU32(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
  buf[off + 2] = (v >>> 16) & 0xff;
  buf[off + 3] = (v >>> 24) & 0xff;
}

/** 收集 `paths` 所需的全部中间目录（去重、按路径排序、以 `/` 结尾）。 */
function collectDirs(paths: string[]): string[] {
  const dirs = new Set<string>();
  for (const path of paths) {
    for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
      dirs.add(path.slice(0, i + 1));
    }
  }
  return [...dirs].sort();
}

/** 生成 STORE-mode ZIP：目录 entry 在前（排序后），文件 entry 保持输入顺序。 */
export function createStoreZip(entries: ZipEntry[]): Uint8Array {
  const files = entries.filter((e) => !e.path.endsWith('/'));
  const all: ZipEntry[] = [
    ...collectDirs(files.map((e) => e.path)).map((path) => ({ path, data: new Uint8Array(0) })),
    ...files,
  ];

  const names = all.map((e) => bytes(e.path));
  const crcs = all.map((e) => crc32(e.data));
  const localSizes = names.map((n, i) => 30 + n.length + all[i].data.length);
  const offsets: number[] = [];
  let cursor = 0;
  for (const s of localSizes) {
    offsets.push(cursor);
    cursor += s;
  }

  const centralStart = cursor;
  const centralSize = names.reduce((sum, n) => sum + 46 + n.length, 0);
  const buf = new Uint8Array(centralStart + centralSize + 22);
  let p = 0;

  // Local file headers（APPNOTE 4.3.7）。
  for (let i = 0; i < all.length; i++) {
    const name = names[i];
    const data = all[i].data;
    setU32(buf, p, 0x04034b50);
    setU16(buf, p + 4, 20); // version needed
    setU16(buf, p + 8, 0); // compression method: STORE
    setU16(buf, p + 12, 0x21); // last mod date: 1980-01-01（time at p+10 stays 0 = 00:00）
    setU32(buf, p + 14, crcs[i]);
    setU32(buf, p + 18, data.length); // compressed size
    setU32(buf, p + 22, data.length); // uncompressed size
    setU16(buf, p + 26, name.length);
    setU16(buf, p + 28, 0); // extra length
    buf.set(name, p + 30);
    p += 30 + name.length;
    buf.set(data, p);
    p += data.length;
  }

  // Central directory records（APPNOTE 4.3.12）。
  for (let i = 0; i < all.length; i++) {
    const name = names[i];
    const data = all[i].data;
    setU32(buf, p, 0x02014b50);
    setU16(buf, p + 4, 20); // version made by
    setU16(buf, p + 6, 20); // version needed
    setU16(buf, p + 10, 0); // compression method: STORE
    setU16(buf, p + 14, 0x21); // last mod date: 1980-01-01（time at p+12 stays 0 = 00:00）
    setU32(buf, p + 16, crcs[i]);
    setU32(buf, p + 20, data.length); // compressed size
    setU32(buf, p + 24, data.length); // uncompressed size
    setU16(buf, p + 28, name.length);
    setU16(buf, p + 30, 0); // extra field length（comment length at p+32 stays 0）
    setU32(buf, p + 42, offsets[i]); // local header offset
    buf.set(name, p + 46);
    p += 46 + name.length;
  }

  // End of central directory（APPNOTE 4.3.16）。
  setU32(buf, p, 0x06054b50);
  setU16(buf, p + 8, all.length); // records on this disk
  setU16(buf, p + 10, all.length); // total records
  setU32(buf, p + 12, centralSize);
  setU32(buf, p + 16, centralStart);
  setU16(buf, p + 20, 0); // comment length

  return buf;
}
