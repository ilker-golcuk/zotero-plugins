# Zotero Plugins

Two small, dependency-free plugins for **Zotero 10**, written for a real
literature-review workflow: one checks that reference metadata is actually
correct, the other gets the attached PDFs back out of Zotero.

| Plugin | What it adds | Docs |
|---|---|---|
| [`ref-verifier`](ref-verifier/) | Right-click → **Verify Metadata (Crossref)** — checks every field of the selected references against Crossref and OpenAlex and applies only the corrections you approve | [README](ref-verifier/README.md) |
| [`pdf-exporter`](pdf-exporter/) | Right-click → **Export PDFs to Folder…** — copies the PDFs of the selected items into a folder you pick, keeping their filenames | [README](pdf-exporter/README.md) |

Both are plain JavaScript. No build step, no bundler, no npm dependencies —
`manifest.json` + `bootstrap.js` + two SVG icons, zipped into an `.xpi`.

---

## Why these exist

### Reference metadata is quietly wrong more often than you think

A reference list is only as good as the metadata behind it. Volume and issue
numbers get mangled by import translators, page ranges go missing, DOIs point at
the wrong record, an author gets dropped, a title arrives with raw publisher HTML
inside it. None of this is visible while you work — it only shows up in the
formatted bibliography, usually after submission.

Zotero can *fetch* metadata, but it has no way to **re-check** a record you
already have. The nearest thing is deleting the item and re-importing it by DOI,
which throws away your tags, notes, collections and attachments.

`ref-verifier` fills that gap: it compares what you have against authoritative
sources field by field and shows you a diff, so you decide what changes.

Running it over a 95-item library found two genuine defects that would have
reached the bibliography:

* a conference paper missing one of its four authors
* a journal article whose stored title contained literal markup —
  `Assessment of ... the <span style="font-variant:small-caps;">S</span>ustainable ...`

### Getting PDFs out of Zotero is harder than it should be

Zotero stores attachments in a content-addressed folder tree — every PDF sits
alone in a directory named after an internal key. There is no supported way to
say "give me the PDFs for these 40 references, in one folder."

Zotero's own source actually contains a function for this,
`ZoteroPane.exportSelectedFiles()` (`zoteroPane.js:6567`, commented
*"TEMP: Quick implementation"*), but the menu item bound to it is
`hidden="true"` — it was never exposed. It also lives in the File menu rather
than the item context menu.

`pdf-exporter` exposes that capability properly, from the place you'd look for
it, and keeps the filenames your reference manager gave the files.

---

## How they work

Both plugins use the same Zotero 10 bootstrapped-plugin skeleton:

```
manifest.json          metadata + compatibility range
bootstrap.js           startup() / shutdown() lifecycle hooks
chrome/content/*.svg   icons
```

`startup()` registers a `chrome://` package (so the plugin's own menu icon can be
resolved) and adds a menu entry through `Zotero.MenuManager.registerMenu()`,
targeting `main/library/item` — the item context menu. `shutdown()` unregisters
both, so the plugins load and unload cleanly without restarting Zotero.

Everything else is ordinary async JavaScript against Zotero's item API.

### A note on how these were written

Zotero 10 is recent enough that writing against remembered APIs does not work.
Every API used here was verified against the running application's own source,
extracted from `Zotero.app/Contents/Resources/app/omni.ja`, before being used.
That process caught several things that guesswork would have gotten wrong:

* Zotero **requires** `applications.zotero.update_url` in the manifest. Without
  it, installation fails with a misleading *"may be incompatible with this
  version of Zotero"* dialog (`Extension.sys.mjs:1875`).
* `Zotero.MenuManager` renders menu labels **only** through Fluent l10n IDs. A
  menu registered without a resolvable FTL bundle appears as a blank row. Both
  plugins set the label directly on the element instead, which cannot fail.
* Menu icons must be **filled paths** using `fill="context-fill"` to pick up the
  theme colour and invert on the selected row. Stroked icons do not work.
* Zotero 10's schema (version 44) added `publisher`, `place`, `section` and
  `partNumber` to the `journalArticle` type — fields that did not exist in
  earlier versions and that change what a metadata checker should report.

---

## Installing

Download the `.xpi` from
[**Releases**](https://github.com/ilker-golcuk/zotero-plugins/releases), then in
Zotero: **Tools → Plugins** → gear icon → **Install Plugin From File…**

The `.xpi` files are not committed to the tree — they are build artefacts, and
keeping them in git invites the packaged version drifting out of step with the
source. Each release is built from the source at its tag.

To build one yourself, from inside the plugin's folder:

```bash
zip -qr ../my-plugin.xpi manifest.json bootstrap.js chrome
```

Bump `version` in `manifest.json` when reinstalling over an existing copy.

Both plugins auto-update: their `update_url` points at
[`update.json`](update.json) in this repository, which lists the current version
and the release asset to fetch. Publishing a new release and bumping the version
in `update.json` is enough for installed copies to offer the update.

Compatibility is declared as Zotero `8.999`–`10.*`. Zotero 11 will refuse to
install these until the range is widened, which is deliberate: the plugin APIs
they use were verified against Zotero 10 specifically, and Zotero 10 changed
enough from 7 that claiming forward compatibility would be a guess.

---

## Tests

There is no Zotero test harness, so the tests load the real `bootstrap.js`,
stub the parts of the Zotero API each plugin touches, and exercise the logic
directly. They run on plain Node with no dependencies:

```bash
cd ref-verifier/tests && node suite.mjs && node types-suite.mjs   # 143 tests
cd pdf-exporter && node tests/suite.mjs                           # 21 tests
```

`ref-verifier`'s harness reads Zotero's field schema out of the **installed
application** rather than a checked-in copy, so the tests track whatever Zotero
version is on the machine. That is how the schema-44 field additions above were
noticed.

---

## Privacy

`ref-verifier` sends the DOI, title, author surname and year of the items you
select to **Crossref** (`api.crossref.org`) and **OpenAlex**
(`api.openalex.org`) in order to look them up. Nothing else leaves the machine:
no library dump, no account identifier, no telemetry, and nothing at all until
you run the action on a selection. No API keys are used or required.

`pdf-exporter` makes no network requests whatsoever.

## Licence

MIT. Use them, fork them, break them.
