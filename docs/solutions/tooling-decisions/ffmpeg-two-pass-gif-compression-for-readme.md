---
title: "Compressing UI demo GIFs for README with ffmpeg two-pass palette"
date: 2026-07-24
category: tooling-decisions
module: "docs/assets / README media"
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Adding a screen-recording GIF to a README or docs site"
  - "A captured GIF is several megabytes and bloats the repo or page load"
  - "Compressing a UI demo where on-screen text must stay legible"
tags: ["ffmpeg", "gif", "palette", "two-pass", "readme-assets", "image-compression", "lanczos", "ui-demo"]
---

# Compressing UI demo GIFs for README with ffmpeg two-pass palette

## Context

A browser-extension README often wants a short demo GIF to show the core interaction. Screen recorders (or screen-capture-to-GIF tools) typically emit a naive full-frame encoding: every frame redraws the whole screen, the palette is unoptimized, and the resolution matches the native display. A UI demo at 1184×640, 10fps, ~22 seconds easily lands above 20 MB. Committing that straight into git makes every clone pull the extra 20 MB, and embedding it in the README loads slowly on GitHub or a docs site. The file needs to shrink to a few megabytes without turning the on-screen text to mush.

## Guidance

Use ffmpeg's **two-pass palette** method rather than a single-pass direct conversion. The first pass analyzes the whole animation and builds one optimal palette; the second pass re-encodes against it. Layer resolution and frame-rate control on top. The parameters that matter for a UI demo:

- `scale=960:-1:flags=lanczos` — drop width to 960 (height proportional); lanczos keeps text edges sharp. A README thumbnail does not need native resolution.
- `fps=10` — 10fps is enough for cursor movement and page switches, and cuts redundant frames.
- `palettegen=max_colors=128:stats_mode=diff` — 128 colors is plenty for flat UI color blocks; `stats_mode=diff` biases the palette toward inter-frame change regions so the static background does not waste color slots.
- `paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle` — `diff_mode=rectangle` is the key to size: it redraws only the changed rectangles, so the large static page background in a UI demo costs almost nothing. Bayer dithering produces less noise than the default floyd_steinberg on flat UI.

Two-pass commands in PowerShell (palette written to a temp file):

```powershell
$pal = "$env:TEMP\palette.png"
ffmpeg -y -loglevel error -i docs\assets\demo.gif -vf "fps=10,scale=960:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" $pal
ffmpeg -y -loglevel error -i docs\assets\demo.gif -i $pal -lavfi "fps=10,scale=960:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" docs\assets\demo-compressed.gif
```

Once verified, replace the master with the compressed version — **do not commit the 20 MB master into the repo.**

After compressing, always **spot-check frames by eye**: open the compressed GIF in an image viewer or the Read tool and confirm the on-screen titles, URLs, and button text are legible with no dithering noise at the edges. The acceptance criterion for a UI demo is "text is readable," not "PSNR is high."

## Why This Matters

Naive full-frame encoding is the root cause of the size: it stores each frame as an independent whole image, ignoring the fact that in a UI demo most pixels stay unchanged for long stretches. `diff_mode=rectangle` exploits exactly this, storing only changed rectangles, so the same visual quality can drop an order of magnitude in size. The two-pass palette avoids the suboptimal "generate-and-use-at-once" palette of a single pass, which causes banding and dithering. The cost of not compressing is repo bloat and a slow-loading README — and for an extension README whose job is to make someone decide in three seconds whether to install, a slow demo image is counterproductive.

## When to Apply

- When adding a screen-recording GIF to a README or docs site.
- When the source GIF is already several megabytes, or ffprobe shows resolution/frame-rate higher than the demo needs.
- When the content is UI (text, icons, flat color blocks) and text must survive compression legibly.

Not a fit for: photographic or video content (use H.264/VP9 mp4/webm, not GIF), or pixel-exact regression-comparison images.

## Examples

Measured on this repo's `docs/assets/demo.gif`: source 23.01 MB (1184×640, 10fps, 223 frames, 22.3s) → with the parameters above, 5.48 MB (960 wide, 128 colors, diff_mode=rectangle). Frame spot-check: the Chinese search-result titles, the domain URLs, and the SERP switch-bar icons are all sharp, with no dithering noise at the text edges.

Probe the parameters before compressing to pick the scale target and decide whether to drop frames:

```powershell
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames -show_entries format=duration -of default=noprint_wrappers=1 docs\assets\demo.gif
```

Tuning notes: if text is still soft, raise width from 960 to 1100–1200; if size is still too big, drop `max_colors` from 128 to 96, or raise `bayer_scale` from 3 to 4 (coarser dither, smaller file). Re-spot-check the text after every change.

## Related

- ../conventions/bilingual-visual-assets-per-readme-language.md — same batch: ship one localized variant of a text-bearing asset per README language.
- ../best-practices/browser-extension-readme-structure-and-media.md — same batch: README structure and screenshot/demo placement.
- ../best-practices/bilingual-brand-naming-shuangmiansou-juso.md — adjacent topic: bilingual brand-name consistency (different dimension — naming only).
