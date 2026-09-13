# Aggregate instances

Aggregate instances are user-saved multi-source searches: one query fans out to the instance's member sources (AI providers, provider instances, and conventional engines), the results are merged, deduplicated, and reranked by an external rerank service, and a single merged list is returned.

Use `list-aggregates` to list all aggregate instances with their ids, members, and eligibility. Use `search-aggregate` to run one.

```bash
python scripts/juso_search.py list-aggregates
python scripts/juso_search.py search-aggregate "broad research query" --aggregate-id agg:abc123 --force-refresh
```

`--aggregate-id` is required for `search-aggregate`. Aggregate-instance ids are opaque strings starting with `agg:` — obtain them from `list-aggregates`. `eligible: false` means the instance cannot run right now (no valid member, or the rerank service is unconfigured — the latter surfaces as a `keyMissing` error on search).

Instances with engine members open third-party search-engine pages in the user's browser; this requires the extension's engine-search sub-switch to be enabled (the search returns an error reply otherwise). Fan-out over several engine members can take a while — pass a larger `--timeout` (before the subcommand, e.g. `python scripts/juso_search.py --timeout 100 search-aggregate "query" --aggregate-id agg:abc123`) when `list-aggregates` shows many engine members.

The reply's `response.members` array reports per-member status (`ok` with `resultCount`, or `errorKind`/`errorMessage`), `response.results` the merged reranked list (each item carries `sources`, the member ids that hit that URL), and `response.answers` the per-member synthesized answers when available. Results are leads, not evidence: titles, snippets, and AI summaries may be truncated, stale, or inaccurate — open result URLs with your own fetch capability and verify specifics on the source page. Fetching pages is not a Juso capability.
