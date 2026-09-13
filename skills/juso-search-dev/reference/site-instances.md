# Site instances

Site instances are user-saved "search this one site" shortcuts backed by a conventional engine (google, bing, or baidu). A search navigates the user's browser to the scoped result page and extracts ordinary result links, like `engine-search`. It requires the extension's engine-search sub-switch to be enabled; with the sub-switch off, `search-site` returns an error reply.

Use `list-sites` to list all site instances with their ids, backing engine, and target site. Use `search-site` to search within one instance.

```bash
python scripts/juso_search.py list-sites
python scripts/juso_search.py search-site "latest AI research" --site-id site:abc123 --max-results 10
```

`--site-id` is required for `search-site`. Site-instance ids are opaque strings starting with `site:` — obtain them from `list-sites`. The reply's `response.engine` reports the backing engine that produced the results.

An error reply (`ok: false`) is a normal result, not a tool failure: unknown or deleted ids and engine-page extraction failures surface there, with the page-side failure kind (challenge, timeout, ...) in the message. Results are leads, not evidence: titles and snippets may be truncated, stale, or inaccurate — open result URLs with your own fetch capability and verify specifics on the source page. Fetching pages is not a Juso capability.
