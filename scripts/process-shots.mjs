// Regenerate clean, consistently-cropped product screenshots from full-window
// captures dropped in the repo root.
//
// Problem it solves: raw captures are full-browser-window (2560x1528 @2x) and
// include Chromium chrome (tab strip / toolbar / bookmarks bar). For README and
// website use we want chrome-free, uniformly-ratioed images.
//
// It is pixel-blind by design (the orchestrator cannot read images), so the one
// physical knob is CHROME_TOP — how many top pixels (@2x) to strip as browser
// chrome. Override via env, e.g.:
//   $env:CHROME_TOP=240; node scripts/process-shots.mjs
//
// Inputs : every *.png in docs/assets/screens/raw/ whose name matches a known slug keyword.
// Outputs: <slug>-clean.png  (full content width, chrome stripped)
//          <slug>-web.png     (side-cropped to WEB_RATIO to match the website's
//                              existing ~1.85 images, full content height kept)
//          -> docs/assets/screens-staging/
//
// Re-run freely; outputs are overwritten.

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:\\workspace\\search';
const INPUT = path.join(ROOT, 'docs', 'assets', 'screens', 'raw'); // raw full-window captures
const OUT = path.join(ROOT, 'docs', 'assets', 'screens');
const CHROME_TOP = Number(process.env.CHROME_TOP ?? 160); // px @2x stripped from top
const WEB_RATIO = Number(process.env.WEB_RATIO ?? 1.6);   // store ratio; narrower/taller

fs.mkdirSync(OUT, { recursive: true });

// Order matters: more-specific keywords first.
function slugFor(name) {
  const n = name.toLowerCase();
  if (name.includes('主页')) return 'search-home';
  if (name.includes('exa')) return 'search-results-exa';
  if (name.includes('缓存展示')) return 'search-cache-panel';
  if (name.includes('缓存')) return 'search-cache-notice';
  if (name.includes('快切') || n.includes('bing')) return 'serp-bar-bing';
  if (name.includes('关于')) return 'settings-about';
  if (name.includes('密钥')) return 'settings-keys';
  if (name.includes('实例')) return 'settings-instances';
  if (name.includes('通用')) return 'settings-general';
  if (name.includes('搜索页') || name.includes('搜索')) return 'settings-sources';
  return null;
}

if (!fs.existsSync(INPUT)) {
  console.error(`Input dir not found: ${INPUT}\nDrop full-window captures into it, then re-run.`);
  process.exit(0);
}
const files = fs.readdirSync(INPUT).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
const report = [];

for (const f of files) {
  const slug = slugFor(f);
  if (!slug) {
    report.push({ file: f, note: 'skipped (no slug)' });
    continue;
  }
  const src = path.join(INPUT, f);
  const meta = await sharp(src).metadata();
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) {
    report.push({ file: f, note: 'unreadable metadata' });
    continue;
  }

  const top = Math.max(0, Math.min(CHROME_TOP, H - 100));
  const contentH = H - top;
  if (contentH <= 0) {
    report.push({ file: f, note: 'CHROME_TOP too large' });
    continue;
  }

  // 1) clean: full width, chrome stripped
  await sharp(src)
    .extract({ left: 0, top, width: W, height: contentH })
    .toFile(path.join(OUT, `${slug}-clean.png`));

  // 2) web: side-crop to WEB_RATIO keeping full content height (top-anchored,
  //    so the topbar / answer card / injected bar are preserved)
  const webW = Math.min(W, Math.max(1, Math.round(contentH * WEB_RATIO)));
  const left = Math.max(0, Math.round((W - webW) / 2));
  await sharp(src)
    .extract({ left, top, width: webW, height: contentH })
    .toFile(path.join(OUT, `${slug}-web.png`));

  report.push({
    file: f,
    slug,
    src: `${W}x${H}`,
    clean: `${W}x${contentH}`,
    web: `${webW}x${contentH}`,
  });
}

console.log(`CHROME_TOP=${CHROME_TOP}  WEB_RATIO=${WEB_RATIO}  out=${OUT}\n`);
console.table(report);
