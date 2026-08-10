# Engine result shapes

> The set of available engines is dynamic and discovered at runtime. Call `list-engines` to get the current list of engine ids before calling `engine-search`. The caveats below apply to specific engines and may not cover all engines returned by `list-engines`.

`engine-search` extracts ordinary result links only and does not promise AI summaries, knowledge panels, or other page content. Once an agent has a result URL, page retrieval belongs to its host's own capability, such as `web_fetch`.

## `bilibili`

Results are scraped from `search.bilibili.com/all` in the user's logged-in profile; `snippet` is rich metadata (`UP主: … · 播放: … · 弹幕: … · 时长: …`), not a description. The list mixes two card types: true search results (full metadata) and a top "author latest videos" aggregate block (no UP主/弹幕 — those snippet fields are omitted, not zero). Distinguish them by snippet completeness, not position.

## `xiaohongshu`

Results are scraped from `www.xiaohongshu.com/search_result` in the user's logged-in profile; `snippet` is rich metadata (`作者: … · 点赞: …`), not a note body. Notes often have no title — untitled notes carry the placeholder `(无标题)`. Ad/live-stream/trending cards carry no `/explore/` link and are excluded automatically.

## `douyin`

Results are scraped from `www.douyin.com/search/{keyword}` in the user's logged-in profile. Douyin is heavily obfuscated: cards have no `<a>` links (navigation is JS-routed), so the result `url` is synthesized from the card id as `https://www.douyin.com/video/{id}` (videos) or `/note/{id}` (image posts). There is no title element — `title` is the full caption text and `snippet` is `作者: … · 点赞: …` parsed from it. User-aggregate / related-searches cards (no duration or `图文` prefix) are skipped.

> **`douyin` headless limitation (2026-07-31):** the extractor code is correct (verified: the same selectors return 25 cards when the tab is open and visible), but in the automated `engine-search` flow — which opens the SERP as a programmatically-created tab — Douyin's anti-bot frequently returns `no-results` (cards not rendered) or `challenge` (captcha/slider). This is a site anti-bot reaction to the automated tab, not an extraction bug. Retry, or treat `douyin` as best-effort; `bilibili` and `xiaohongshu` are reliable in the same flow.
