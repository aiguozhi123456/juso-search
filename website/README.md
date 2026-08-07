# 双面搜 / Juso — 官网展示站

Hugo v0.164.0 extended 构建的最小展示站。无主题，全部自写 layouts。双语（中文根路径 / 英文 `/en/`），双面（人类面 `/` ⇄ 智能体面 `/agents`）。

## 构建

`hugo` 不在默认 PATH。用全路径调用（PowerShell）：

```powershell
& 'C:\Users\wuyiy\AppData\Local\Microsoft\WinGet\Packages\Hugo.Hugo.Extended_Microsoft.Winget.Source_8wekyb3d8bbwe\hugo.exe' --source C:\workspace\search\website --minify
```

产物输出到 `website\public\`。

## 本地预览

```powershell
& 'C:\Users\wuyiy\AppData\Local\Microsoft\WinGet\Packages\Hugo.Hugo.Extended_Microsoft.Winget.Source_8wekyb3d8bbwe\hugo.exe' --source C:\workspace\search\website server
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
data/              sources / capabilities / agent-capabilities / cli / security / agent-setup（YAML）
i18n/              zh.yaml / en.yaml（界面文案）
layouts/           _default/baseof.html + partials/ + index.html + agents/single.html
assets/css/        style.css（设计系统）
static/            brand/ icons/ img/（静态素材）
```

## 备注

- `baseURL` 保持 `/`，部署时用 `--baseURL` 覆盖。
- 字体经 Google Fonts CDN 加载（Fraunces / Hanken Grotesk / JetBrains Mono）；离线时回退到系统字体栈。
- 切换器为纯链接，零 JS；滚动揭示用最小内联 IntersectionObserver，渐进增强。
