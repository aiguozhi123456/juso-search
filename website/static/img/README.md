# Website Images

Screenshots are duplicated from `docs/assets/screens/` for the website build.
When updating a screenshot, update BOTH locations.

| Website (`static/img/`) | Docs (`docs/assets/screens/`) | Used for |
|---|---|---|
| screenshot-instances.png | settings-instances-clean.png | Hero carousel slide 2 + "深入一面" instances shot (`layouts/index.html`) |
| screenshot-cache.png | search-cache-panel-clean.png | Hero carousel slide 3 + "深入一面" cache shot (`layouts/index.html`) |
| screenshot-sources.png | settings-sources-clean.png | Hero carousel slide 4 + "深入一面" sources shot (`layouts/index.html`) |
| screenshot-agent-bridge.png | settings-general-clean.png | Agent Bridge section (`layouts/index.html`) |
| screenshot-search.png | — | Hero carousel slide 1 — no docs copy |
| screenshot-serp.png | — | Showcase SERP shot (`layouts/index.html`) — no docs copy |

## Showcase images

The `showcase/` subdirectory contains the curated product-display images used by the homepage and product-face pages. Unlike the legacy `screenshot-*.png` files above, these are copied from `docs/assets/showcase/` and follow a strict language-and-theme pairing.

| Website (`static/img/showcase/`) | Source (`docs/assets/showcase/`) | Used for |
|---|---|---|
| `search-zh-light.png` | `01-search-zh-light.png` | Chinese light search experience on the homepage and People page |
| `selection-zh-light.png` | `07-selection-search-zh-light.png` | Chinese light selection-search experience on the homepage and People page |
| `sources-zh-light.png` | `03-sources-zh-light.png` | Chinese light source orchestration on the Chinese People page |
| `agent-bridge-zh-light.png` | `09-agent-bridge-zh-light.png` | Chinese light Agent Bridge on the Chinese People and Agents pages |
| `search-en-dark.png` | `04-search-en-dark.png` | English dark search experience on the English homepage and People page |
| `selection-en-dark.png` | `08-selection-search-en-dark.png` | English dark selection-search experience on the English homepage and People page |
| `agent-bridge-en-dark.png` | `05-agent-bridge-en-dark.png` | English dark Agent Bridge on the English People and Agents pages |

> Keep the Chinese pages on the **Chinese light** image set and the English pages on the **English dark** image set. Do not mix these assets within the same page flow.

## Convention
Website screenshots use the `screenshot-<topic>.png` naming convention.
Docs screenshots use the `<area>-<topic>-clean.png` naming convention. Curated product-display assets live under `showcase/` and use the `<scene>-<locale>-<theme>.png` pattern.
