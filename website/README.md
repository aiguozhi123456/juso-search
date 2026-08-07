# 双面搜 / Juso — 官网展示站

Hugo extended 构建的最小展示站。无主题，全部自写 layouts。双语（中文根路径 / 英文 `/en/`），双面（人类面 `/` ⇄ 智能体面 `/agents`）。

## 前置：安装 Hugo

需要 Hugo **extended** 版本（用于 CSS 资源管道）。

```powershell
# Windows（winget）
winget install Hugo.Hugo.Extended
```

```bash
# macOS
brew install hugo
```

安装后确认 `hugo` 在 PATH：

```sh
hugo version
```

## 构建

在仓库根目录运行：

```sh
hugo --source website --minify
```

产物输出到 `website/public/`。部署到子路径时用 `--baseURL` 覆盖，例如：

```sh
hugo --source website --minify --baseURL https://example.com/juso-search/
```

## 本地预览

```sh
hugo --source website server
```

默认 `http://localhost:1313/`。

## 页面

| URL | 语言 | 面 |
| --- | --- | --- |
| `/` | 中文 | 人类 |
| `/agents/` | 中文 | 智能体 |
| `/en/` | English | People |
| `/en/agents/` | English | Agents |

## 结构

```
hugo.toml          站点配置（双语、链接、参数）
content/           _index.md / _index.en.md（人类面）
                   agents/index.md / index.en.md（智能体面）
data/              sources / capabilities / agent_capabilities / cli / security / agent_setup（YAML）
i18n/              zh.yaml / en.yaml（界面文案）
layouts/           _default/baseof.html + partials/ + index.html + agents/single.html + 404.html
assets/css/        style.css（设计系统，含自托管 @font-face）
static/            brand/ icons/ img/ fonts/（静态素材，fonts/ 为自托管 woff2）
```

## 备注

- `baseURL` 保持 `/`，部署时用 `--baseURL` 覆盖。所有站内引用走 Hugo `relURL` / `relLangURL` / `absURL`，子路径部署无需改模板。
- 字体自托管（Fraunces / Hanken Grotesk / JetBrains Mono，latin 子集 woff2），不请求第三方 CDN；CJK 回退系统字体。
- 切换器为纯链接，零 JS；滚动揭示用最小内联 IntersectionObserver，渐进增强。
