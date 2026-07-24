---
title: "WXT extension icon rasterization and manifest wiring"
date: 2026-07-24
category: tooling-decisions
module: build-config
problem_type: tooling_decision
component: tooling
severity: low
tags:
  - wxt
  - extension-icon
  - manifest
  - rasterization
  - system-drawing
  - multi-size-png
---

# WXT extension icon rasterization and manifest wiring

## Context

The project had no custom extension icon — `wxt.config.ts` declared neither `icons` nor `action.default_icon`, and `@wxt-dev/auto-icons` was not enabled. Chrome showed a default placeholder puzzle-piece icon in the toolbar, extension management page, and (eventually) the Web Store listing. Two brand-artwork PNGs were provided at the repo root, and the task was to wire one of them as the extension icon across all required sizes.

## Guidance

### 1. Rasterize the source image to the five standard sizes

Chrome MV3 expects icon bitmaps at 16, 32, 48, 96, and 128 px. The source artwork (1254×1254 px square) was rasterized using `System.Drawing` (GDI+) with high-quality bicubic interpolation and center-crop to square (in case the source is not already square). Output PNGs go into `public/icon/`:

```
public/icon/
  16.png
  32.png
  48.png
  96.png
  128.png
```

PowerShell snippet (Windows):

```powershell
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($srcPath)
$side = [Math]::Min($img.Width, $img.Height)
$sx = [int](($img.Width - $side) / 2)
$sy = [int](($img.Height - $side) / 2)
$srcRect = New-Object System.Drawing.Rectangle $sx, $sy, $side, $side

foreach ($s in 16, 32, 48, 96, 128) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $s, $s), $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $bmp.Save("$outDir\$s.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
$img.Dispose()
```

### 2. Declare icons in `wxt.config.ts`

WXT passes the `manifest` function return through to the final `manifest.json`. Add both `icons` (extension management page, Web Store) and `action.default_icon` (toolbar button):

```ts
// wxt.config.ts — inside defineConfig({ manifest: () => ({ ... }) })
action: {
  default_title: '__MSG_ext_name__',
  default_icon: {
    16: 'icon/16.png',
    32: 'icon/32.png',
    48: 'icon/48.png',
    96: 'icon/96.png',
    128: 'icon/128.png',
  },
},
icons: {
  16: 'icon/16.png',
  32: 'icon/32.png',
  48: 'icon/48.png',
  96: 'icon/96.png',
  128: 'icon/128.png',
},
```

Paths are relative to the `public/` directory (WXT copies `public/` contents to the build output root).

### 3. Archive high-resolution source artwork separately

The rasterized PNGs in `public/icon/` are build artifacts (max 128 px). Keep the original high-resolution source in a `brand/` directory at the repo root for future marketing/store-promo use. This directory is not packaged by WXT (only `public/` is).

### 4. Avoid runtime icon switching for style variants

MV3 manifest `icons` are static — they cannot change at runtime. `browser.action.setIcon()` can swap the toolbar icon dynamically, but:

- It requires background worker code to listen for style-preference changes.
- The extension management page and Web Store listing remain fixed to the manifest icon.
- At 16 px, multi-color artwork with embedded text is less legible than a simpler high-contrast design.

For projects with a style toggle (e.g., `classic` vs `colorful`), the pragmatic approach is: pick one icon for the manifest, archive the other as a brand asset, and defer runtime switching until there is a concrete user need.

## Why This Matters

Without explicit `icons` and `action.default_icon` in the manifest, Chrome shows a generic placeholder — the extension is invisible among installed extensions and looks unfinished in the Web Store. Declaring multi-size bitmaps ensures crisp rendering at every context (toolbar 16–32 px, extension page 48 px, store listing 128 px) without browser upscaling artifacts.

## When to Apply

- Adding or replacing the extension icon in any WXT (or plain MV3) project.
- Rasterizing a single high-res artwork into the required size set on a Windows build machine without ImageMagick or other CLI tools.
- Deciding whether to support runtime icon switching for style/theme variants.

## Examples

**Before** (no icon — placeholder shown):

```ts
// wxt.config.ts
action: {
  default_title: '__MSG_ext_name__',
},
// no icons field
```

**After** (custom icon at all sizes):

```ts
action: {
  default_title: '__MSG_ext_name__',
  default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 96: 'icon/96.png', 128: 'icon/128.png' },
},
icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 96: 'icon/96.png', 128: 'icon/128.png' },
```

## Related

- `docs/solutions/design-patterns/orthogonal-style-axis-and-semantic-color-ownership.md` — the style toggle architecture that motivated the two-variant icon question.
- WXT docs: [Static Assets](https://wxt.dev/guide/essentials/assets.html) — how `public/` maps to build output.
- Chrome MV3 manifest: [`icons`](https://developer.chrome.com/docs/extensions/reference/manifest/icons) and [`action.default_icon`](https://developer.chrome.com/docs/extensions/reference/manifest/action#default_icon).
