import fs from "fs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, "http-cache.json");

// Read the field schema out of the installed Zotero so the tests always match
// the running version. Zotero 10 (schema 44) added publisher/place to
// journalArticle; a frozen copy would have hidden that.
function loadSchema() {
	const omni = "/Applications/Zotero.app/Contents/Resources/app/omni.ja";
	if (fs.existsSync(omni)) {
		try {
			return JSON.parse(execSync(
				`unzip -p ${JSON.stringify(omni)} resource/schema/global/schema.json`,
				{ maxBuffer: 32 * 1024 * 1024, encoding: "utf8" }));
		}
		catch (e) {
			console.warn("! Zotero şeması okunamadı, yedek kopya kullanılıyor:", e.message);
		}
	}
	else {
		console.warn("! Zotero bulunamadı, yedek şema kopyası kullanılıyor.");
	}
	return JSON.parse(fs.readFileSync(path.join(HERE, "zotero-schema-fallback.json"), "utf8"));
}

const schema = loadSchema();
console.log(`Zotero şeması v${schema.version}`);

const typeByName = new Map(schema.itemTypes.map(t => [t.itemType, t]));
const allFields = new Set();
for (const t of schema.itemTypes) for (const f of t.fields) {
  allFields.add(f.field); if (f.baseField) allFields.add(f.baseField);
}

let cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
let netCalls = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

globalThis.Services = { locale: { appLocaleAsBCP47: "en-US" } };
globalThis.Zotero = {
  Promise: { delay: sleep },
  logError: e => console.error("  [logError]", e && e.message),
  HTTP: { request: async (m, url) => {
      if (!(url in cache)) {
        netCalls++;
        await sleep(400);
        const r = await fetch(url, { headers: { "User-Agent": "test/1.0" } });
        cache[url] = r.ok ? await r.json() : null;
        fs.writeFileSync(CACHE, JSON.stringify(cache));
      }
      if (cache[url] === null) throw new Error("HTTP error (cached)");
      return { response: cache[url] };
  }},
  ItemTypes: { getName: id => id, getID: n => (typeByName.has(n) ? n : false) },
  ItemFields: {
    getID: n => (allFields.has(n) ? n : false),
    getName: id => id,
    getLocalizedString: f => f,
    isValidForType: (f, t) => !!(typeByName.get(t)?.fields.some(x => x.field === f)),
    getFieldIDFromTypeAndBase: (t, base) => {
      if (!typeByName.has(t)) throw new Error("Invalid item type " + t);
      if (!allFields.has(base)) throw new Error("Invalid field " + base);
      const fs_ = typeByName.get(t).fields;
      const mapped = fs_.find(x => x.baseField === base);
      if (mapped) return mapped.field;
      return fs_.some(x => x.field === base) ? base : false;
    },
  },
  CreatorTypes: { getID: () => "author" },
};

let src = fs.readFileSync(path.join(HERE, "..", "bootstrap.js"), "utf8");
src = src.slice(0, src.indexOf("// ---------- dialog ----------"));
eval(src + "\nglobalThis.verifyItem=verifyItem; globalThis.similarity=similarity; globalThis.resolveField=resolveField;");

export function makeItem(type, fields, authors) {
  return {
    itemTypeID: type,
    isRegularItem: () => true,
    getField: k => fields[k] ?? "",
    getCreators: () => (authors || []).map(a => {
      if (Array.isArray(a)) return { creatorTypeID: "author", lastName: a[0], firstName: a[1] ?? "" };
      if (typeof a === "object") return { ...a };   // editor/translator vb.
      return { creatorTypeID: "author", lastName: a, firstName: "" };
    }),
  };
}
export const stats = { pass: 0, fail: 0, failures: [] };
export function check(name, cond, detail = "") {
  if (cond) { stats.pass++; console.log(`  ✓ ${name}`); }
  else { stats.fail++; stats.failures.push(name); console.log(`  ✗ ${name}  ${detail}`); }
}
export function netCount() { return netCalls; }
export function verify(item) { return globalThis.verifyItem(item); }
