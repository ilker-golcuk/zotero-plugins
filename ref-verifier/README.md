# Reference Verifier

Checks the metadata of selected Zotero items **field by field** against
[Crossref](https://www.crossref.org/), corroborates it with
[OpenAlex](https://openalex.org/), and applies only the differences you approve.

Select one or more items → right-click → **Verify Metadata (Crossref)**.

Nothing is written until you tick it and press Apply.

---

## What it checks

Title, container (journal / proceedings / book title), volume, issue, pages,
date, DOI, publisher, place, ISBN, ISSN, journal abbreviation, language,
abstract, and the **author list**.

Fields are resolved per item type through Zotero's *base field* mapping, so the
plugin asks the right question for the item in front of it:

| Crossref | journalArticle | conferencePaper | bookSection | book | preprint | thesis | report |
|---|---|---|---|---|---|---|---|
| `container-title` | publicationTitle | proceedingsTitle | bookTitle | — | — | — | — |
| `publisher` | publisher | publisher | publisher | publisher | **repository** | publisher¹ | publisher¹ |
| `institution` | — | — | — | — | — | **university**¹ | **institution**¹ |
| `issue` | issue | issue | — | — | — | — | — |
| `ISBN` | — | ISBN | ISBN | ISBN | — | ISBN | ISBN |

A field a type doesn't have is never asked about — a book is not offered an
issue number, a preprint is not offered a journal abbreviation.

¹ This matches Zotero's own Crossref translator: for a thesis and a report,
Crossref's `institution` overrides `publisher`; for a preprint it does **not**,
because the `repository` field takes the publisher. (Zotero's translator
fixtures expect `"Cold Spring Harbor Laboratory"` for a bioRxiv preprint, not
the `"bioRxiv"` institution.) All four mappings are pinned by tests.

For a `book`, `container-title` is deliberately skipped: Crossref returns the
*series* name there, not the book title.

Every field is examined in both directions:

* **wrong** — the stored value contradicts the source → shown in red, pre-ticked
* **missing** — Zotero is empty and the source has a value → tagged `missing`,
  pre-ticked only for fields that are core to that item type

It also reports **retractions and corrections** (Crossref carries Retraction
Watch data in `updated-by`), **DOIs that don't resolve**, and **item-type
mismatches** such as a conference paper filed as a journal article.

---

## Design decisions worth knowing

These are the cases where the obvious implementation is wrong. Each one was
found by running the checker over a real library and investigating what it
flagged.

**Dates.** Crossref's `issued` field is the *earliest* publication date, which
for an online-first article is not the issue date. A record saying 2021 is not
wrong just because Crossref says 2020. The plugin accepts `issued`,
`published-print`, `published-online` and `journal-issue` — a year matching any
of them is correct — and proposes the issue date, which is what a citation
prints.

**ISSN and ISBN.** Journals have separate print and electronic ISSNs and Zotero
stores both (`"1747-7891, 1878-0059"`). Comparing against Crossref's first entry
alone flags almost every record. They are compared as sets: any overlap is a
match.

**Author names.** Only surnames are compared. Crossref writes given names as
`"AJ"` where Zotero writes `"A. J."`; that difference is a convention, not an
error. When surnames don't line up the row is shown but left **unticked**,
because applying it replaces the item's entire author list with Crossref's.
When surnames match and Zotero is simply missing given names, filling them in is
offered pre-ticked.

Accepting an author row rewrites **authors only**. Editors, translators and
every other creator type on the item are carried across untouched — Zotero's
`setCreators()` replaces the whole creator array and discards anything past the
list it is handed, so they have to be re-supplied explicitly or they would be
silently deleted. This is covered by a regression test.

**Matching without a DOI.** Only the title vouches for the match, and papers by
the same group on the same topic score deceptively high. A real case: a 2024
paper matched a *different* 2022 paper by overlapping authors at 0.878
similarity, and would have rewritten its title, venue, date and author list.
So: raw title similarity ≥ 0.92 is accepted; 0.84–0.92 is reported as
**uncertain** — the candidate is shown, but no edits are proposed; below that is
"not found". The author name is a ranking signal only and never counts toward
the acceptance threshold, so a wrong author in your record can't poison the
search *or* push a bad match over the line.

**Unicode.** Title comparison normalises with Unicode properties, not `[a-z]`.
Accents are decomposed and dropped, so `Şehir` = `Sehir` and `İstanbul` =
`Istanbul`, while genuinely different titles still separate. An ASCII-only
filter silently destroys Turkish, Thai, Cyrillic and CJK titles.

**Abstracts** are offered only when empty and never called wrong.
**Item types** are reported but never changed automatically, because changing an
item's type rewrites its whole field set.

---

## Privacy

Verification sends the selected items' DOI, title, first-author surname and year
to Crossref and OpenAlex to look them up. Nothing else is transmitted, nothing
is sent until you run the action, and no API key is involved.

## Reliability

**143 tests, all passing.**

```bash
cd tests
node suite.mjs        # 86 unit tests
node types-suite.mjs  # 57 item-type and Unicode tests
node map.mjs          # prints the base-field mapping table
node sweep.mjs        # scans your real library, read-only, reports only
```

The suites cover a field-corruption matrix (each field broken individually and
checked for exactly one detection), normalisation regressions (dash, ISSN,
language, case, punctuation), author scenarios, broken DOIs, retractions,
fabricated references, and per-type field mapping against live Crossref records.

`types-suite.mjs` includes a **convergence** property: apply the plugin's own
suggestions, run it again, and nothing should remain. A checker that disagrees
with its own output is broken.

On a 95-item real library: 90 clean, 2 genuine findings, 1 correctly refused as
uncertain, 2 correctly reported as not found (journals not indexed in Crossref),
**0 false positives**.

`tests/harness.mjs` loads `../bootstrap.js` directly — the tests run the real
plugin code, not a copy — and extracts Zotero's field schema from the installed
application, falling back to `zotero-schema-fallback.json` with a warning.

---

## Known gaps

* Records in journals Crossref doesn't index cannot be checked. The plugin
  reports these rather than guessing.
* Series titles for books are not proposed (see above).
* One dim, unticked `Publisher — missing` row appears on most journal articles,
  because Zotero 10 added a `publisher` field to `journalArticle` and Crossref
  always supplies one. It is off by default; delete the `publisher` line from
  `FIELDS` in `bootstrap.js` to suppress it entirely.
