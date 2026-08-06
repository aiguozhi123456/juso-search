# Output and failures

Standard output contains exactly one JSON value: the normalized Juso search reply, the provider list, or a skill lifecycle error. Diagnostics go to standard error.

Skill lifecycle errors use `{"ok":false,"error":{"kind":"...","message":"..."}}`. Agents should branch on `error.kind`:

| kind | Meaning |
|------|---------|
| `chrome_not_found` | No browser executable resolved |
| `chrome_launch_failed` | OS failed to start the browser process |
| `extension_did_not_claim` | Browser opened (or was targeted) but the extension never claimed the bridge request — wrong browser, profile, extension id, or extension disabled/missing |
| `extension_did_not_complete` | Extension claimed but did not complete — reload the extension; check worker/runtime if path/profile/id are correct |
| `invalid_extension_id` | Extension id is not 32 lowercase letters a–p |
| `wait_failed` | Unexpected wait failure |

Do not retry by exposing API keys. Fix path, profile, extension id, and that Juso is enabled in the opened browser, then retry. For `engine-search`, page-state errors (`challenge`, `consent`, `unsupported-layout`, `no-results`) and orchestration errors (`tab-closed`, `timeout`, `aborted`, `extract-failed`) also return nonzero because no usable engine results were obtained.
