import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));

export const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pdfexp-"));

globalThis.Services = { locale: { appLocaleAsBCP47: "en-US" }, prompt: { alert(){} } };
globalThis.PathUtils = { join: (...a) => path.join(...a), filename: p => path.basename(p) };
globalThis.IOUtils = {
  exists: async p => fs.existsSync(p),
  copy: async (a, b) => fs.copyFileSync(a, b),
};
globalThis.ChromeUtils = { importESModule: () => ({ FilePicker: class {} }) };

const registry = new Map();
globalThis.Zotero = {
  logError: e => console.error("  [logError]", e && e.message),
  Items: { get: id => registry.get(id) || null },
  Attachments: {
    // Zotero's real default format: "Author - Year - Title"
    getFileBaseNameFromItem: (item) => {
      const a = item._authors?.[0] || "";
      const y = (item.getField("date") || "").slice(0, 4);
      const t = item.getField("title") || "";
      return [a, y, t].filter(Boolean).join(" - ");
    },
  },
  File: {
    getValidFileName: n => String(n).replace(/[\/\\?*:|"<>]/g, "").replace(/[\r\n\t]/g, " ").trim(),
  },
  PDFWorker: { export: async (id, p) => { fs.writeFileSync(p, "ANNOTATED"); return 1; } },
  ProgressWindow: class { changeHeadline(){} show(){} close(){} startCloseTimer(){}
    ItemProgress = class { setText(){} setProgress(){} } },
  getMainWindow: () => ({}),
};

let nextID = 1;
export function makeAttachment(fields = {}, opts = {}) {
  const it = {
    id: nextID++,
    _fields: { title: "PDF", ...fields },
    parentItem: opts.parent || null,
    attachmentFilename: opts.filename || "file.pdf",
    _annotations: opts.annotations || [],
    _path: opts.path === undefined
      ? path.join(fs.mkdtempSync(path.join(TMP, "store-")), opts.filename || `src-${nextID}.pdf`)
      : opts.path,
    isPDFAttachment: () => opts.contentType !== false,
    isRegularItem: () => false,
    getField: k => it._fields[k] ?? "",
    getAttachments: () => [],
    getAnnotations: () => it._annotations,
    getFilePathAsync: async () => it._path,
  };
  if (it._path) fs.writeFileSync(it._path, "PDFDATA");
  registry.set(it.id, it);
  return it;
}
export function makeItem(fields = {}, authors = [], attachments = []) {
  const it = {
    id: nextID++,
    _fields: fields,
    _authors: authors,
    isPDFAttachment: () => false,
    isRegularItem: () => true,
    getField: k => it._fields[k] ?? "",
    getAttachments: () => attachments.map(a => a.id),
  };
  for (const a of attachments) a.parentItem = it;
  registry.set(it.id, it);
  return it;
}

let src = fs.readFileSync(path.join(HERE, "..", "bootstrap.js"), "utf8");
src = src.slice(0, src.indexOf("// ---------- lifecycle ----------"));
eval(src + `
globalThis.__api = { collectPDFs, itemsWithoutPDF, uniquePath, exportOne };`);
export const api = globalThis.__api;

export const stats = { pass: 0, fail: 0, failures: [] };
export function check(name, cond, detail = "") {
  if (cond) { stats.pass++; console.log(`  ✓ ${name}`); }
  else { stats.fail++; stats.failures.push(name); console.log(`  ✗ ${name}  ${detail}`); }
}
