# Output and failures

Standard output contains exactly one JSON value: the normalized Juso search reply, the provider list, or a skill lifecycle error. Diagnostics go to standard error.

Skill lifecycle errors use `{"ok":false,"error":{"kind":"...","message":"..."}}`. Agents should branch on `error.kind`:

| kind | Meaning |
|------|---------|
| `chrome_not_found` | No browser executable resolved |
| `chrome_launch_failed` | OS failed to start the browser process |
| `extension_did_not_claim` | Browser opened (or was targeted) but the extension never claimed the bridge request — wrong browser, profile, extension id, or extension disabled/missing |
| `extension_did_not_complete` | Extension claimed but did not complete. When the message starts with `bridge aborted:`, the extension itself aborted the action (e.g. a `list-*` handler failed) — read the abort reason instead of reloading. Otherwise reload the extension and check worker/runtime if path/profile/id are correct |
| `invalid_extension_id` | `--extension-id`/`JUSO_EXTENSION_ID` does not match a supported form (Chrome `[a-p]{32}`, Firefox email-style id, or `{GUID}`), or a provided `--bridge-url`/`JUSO_BRIDGE_URL` is not a trusted extension bridge-page URL (scheme/host/path pinned, no query/fragment/userinfo/port) |
| `wait_failed` | Unexpected wait failure, including the loopback bridge server failing to start (bind refused) |
| `cancelled` | The bridge request was cancelled by the caller before the extension completed it |

Do not retry by exposing API keys. Fix path, profile, extension id, and that Juso is enabled in the opened browser, then retry. For `engine-search`, page-state errors (`challenge`, `consent`, `unsupported-layout`, `no-results`) and orchestration errors (`tab-closed`, `timeout`, `aborted`, `extract-failed`) also return nonzero because no usable engine results were obtained.
