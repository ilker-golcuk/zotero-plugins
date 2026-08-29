# Tests

Plain Node, no dependencies:

```bash
node suite.mjs        # 79 unit tests
node types-suite.mjs  # 57 item-type + Unicode tests
node map.mjs          # prints the base-field mapping table per item type
node sweep.mjs        # scans your real Zotero library (Zotero must be running)
```

`harness.mjs` loads `../bootstrap.js` directly, so the tests exercise the real
plugin code rather than a copy. It extracts Zotero's field schema from the
**installed application** (`omni.ja`), so the tests follow whatever Zotero
version is on this machine — that is how the schema-44 field additions to
`journalArticle` were caught. If Zotero isn't found it falls back to
`zotero-schema-fallback.json` and prints a warning.

`http-cache.json` is created on the first run and caches Crossref/OpenAlex
responses so later runs stay offline. It is **safe to delete** — and worth
deleting occasionally, since a stale cache hides metadata that publishers have
since corrected.

`sweep.mjs` is read-only. It reports; it never writes to your library.
