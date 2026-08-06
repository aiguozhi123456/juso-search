# Provider instances

Providers that support custom instances (currently Exa and Doubao) can have multiple tuned variants — e.g. one Exa instance for AI research (category=publication), another for startup news (category=news). Each instance is a first-class search target with its own options.

Use `list-providers` to discover which providers have instances (the `hasInstances` field). Use `list-instances` to list all instances with their ids and labels. Use `search-instance` to search through a specific instance.

```bash
python scripts/juso_search.py list-providers          # check hasInstances field
python scripts/juso_search.py list-instances           # list all provider instances
python scripts/juso_search.py search-instance "latest AI research" --instance-id inst:exa:abc123
```

`--instance-id` is required for `search-instance`. Instance ids are opaque strings starting with `inst:` — obtain them from `list-instances`.
