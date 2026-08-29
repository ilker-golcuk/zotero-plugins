# PDF Exporter

Copies the PDFs of the selected Zotero items into a folder you choose — one
item or a whole selection.

Select items → right-click → **Export PDFs to Folder…** → pick a folder.

---

## Why this is needed

Zotero stores attachments in a content-addressed tree: every PDF sits alone in a
directory named after an internal item key, like
`storage/A1B2C3D4/malikRandomVector2023.pdf`. That is fine for Zotero and
useless for anything else. There is no supported way to say *"give me the PDFs
for these forty references, in one folder"* — you either drag them out one at a
time or go spelunking in the storage directory.

Zotero's own source contains a function that does almost exactly this,
`ZoteroPane.exportSelectedFiles()` (`zoteroPane.js:6567`, marked
*"TEMP: Quick implementation"*). Its menu item is `hidden="true"` — it was never
shipped to users — and it lives in the File menu rather than the item context
menu.

This plugin exposes the capability from where you'd expect to find it.

---

## What it does

* Select a parent item and it finds the PDF attachments underneath; select a PDF
  attachment directly and it uses that. Selecting both a parent **and** its own
  PDF copies the file once, not twice.
* Non-PDF attachments — EPUBs, web snapshots, link attachments — are skipped.
* **Copies the file as-is and does not rename it.** Whatever name the file has
  on disk is the name it gets in the destination. If Better BibTeX renames your
  attachments to the citation key, that is what you get. The extension is left
  alone; a file without one doesn't gain a `.pdf`.
* If two files would land on the same name, the later ones become `(2)`, `(3)`.
  **Nothing is ever overwritten** — not files written during this run, and not
  files already sitting in the destination folder.

The name is taken from the *resolved file path* rather than the
`attachmentFilename` field, so it is literally the name of the file being
copied.

---

## Annotations — the one thing to know

Zotero keeps your highlights and notes **in its database, not inside the PDF**.
Because this plugin copies the file byte for byte, annotations you made inside
Zotero will **not** appear in the copy. What you get is the original document.

That is usually what you want — you can hand the files to someone without your
private markup riding along, which matters for a citation-key export feeding a
LaTeX build.

If you'd rather have annotations drawn into the exported PDFs, flip one line at
the top of `bootstrap.js` and repackage:

```js
const INCLUDE_ANNOTATIONS = true;
```

Annotated attachments then go through Zotero's own PDF worker
(`Zotero.PDFWorker.export`), which writes a new PDF with the annotations
rendered in. The filename is unchanged either way; only the bytes differ.

---

## Reporting

When it finishes, anything that needs attention is listed in a single dialog:
items with no PDF attachment, and attachments whose file is missing from disk.
If everything went through, that dialog never appears — you just get a summary
and your files.

---

## Tests

**21 tests, all passing.**

```bash
node tests/suite.mjs
```

They load `../bootstrap.js` directly and cover attachment collection and
deduplication, filename preservation (citation keys, Turkish characters, spaces
and dots, missing extensions), collision numbering against both in-run and
pre-existing files, and the export paths — including that a file with Zotero
annotations is still copied byte for byte under the default setting.

Export tests run against real files in a temporary directory, so a copy that
silently produced the wrong bytes would fail.
