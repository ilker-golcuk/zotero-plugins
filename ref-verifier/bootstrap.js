/* Reference Verifier - Zotero 10 bootstrapped plugin.
   Checks selected items field by field against Crossref (primary) and OpenAlex
   (second opinion), and applies only the differences you approve. */

var RV = {};
var chromeHandle = null;

const PLUGIN_ID = "ref-verifier@ilker.local";
const MENU_ID = "ref-verifier-item-menu";
const UA = "Zotero Reference Verifier/1.2";

// The MenuManager only supports Fluent l10n IDs, which needs a registered FTL
// bundle. The label is set directly instead so it can never come up blank.
// Without a DOI, only the title vouches for the match. Papers by the same group
// on the same topic score deceptively high, so anything below ACCEPT is shown to
// the user as a candidate instead of being turned into proposed edits.
const TITLE_ACCEPT = 0.92;
const TITLE_SUGGEST = 0.84;

const LABELS = {
	tr: "Künyeyi doğrula (Crossref)",
	en: "Verify Metadata (Crossref)"
};

function menuLabel() {
	let loc = "en";
	try {
		loc = String(Services.locale.appLocaleAsBCP47 || "en").slice(0, 2).toLowerCase();
	}
	catch (e) {}
	return LABELS[loc] || LABELS.en;
}

/* Fields are listed by Zotero BASE field name and resolved per item type, so
   "publicationTitle" becomes proceedingsTitle on a conference paper and
   bookTitle on a book section. Fields a type doesn't have are skipped.

   Every field is checked in both directions:
     - Zotero empty, source has a value  -> a "missing" row
     - the two contradict each other     -> a "wrong" row, always pre-checked
   `core` decides whether a *missing* value is pre-checked. It keeps rows that
   are blank by convention (ISSN, language) visible without ticking them by
   default. It may be a function of the item type, because a publisher is
   core for a book and incidental for a journal article.
   `fillOnly` fields are never called wrong, only offered when empty. */

// Zotero 10 (schema 44) added publisher/place to journalArticle, and Crossref
// returns a publisher for every article, so these must not default to on there.
const IMPRINT_TYPES = new Set(["book", "bookSection", "report", "thesis", "manuscript"]);
const imprint = type => IMPRINT_TYPES.has(type);

const FIELDS = [
	["title", "Title", true],
	["publicationTitle", "Container", true],
	["volume", "Volume", true],
	["issue", "Issue", true],
	["pages", "Pages", true],
	["date", "Date", true],
	["DOI", "DOI", true],
	["publisher", "Publisher", imprint],
	["place", "Place", imprint],
	["ISBN", "ISBN", imprint],
	["ISSN", "ISSN", false],
	["journalAbbreviation", "Journal abbr.", false],
	["language", "Language", false],
	["abstractNote", "Abstract", false, { fillOnly: true }]
];

// Crossref work type -> Zotero item type
const TYPE_MAP = {
	"journal-article": "journalArticle",
	"proceedings-article": "conferencePaper",
	"book-chapter": "bookSection",
	"book": "book",
	"monograph": "book",
	"edited-book": "book",
	"reference-book": "book",
	"posted-content": "preprint",
	"report": "report",
	"dissertation": "thesis"
};

// ---------- text helpers ----------

function delay(ms) {
	return Zotero.Promise.delay(ms);
}

function stripTags(s) {
	return String(s || "")
		// Block boundaries become spaces; inline tags vanish, so publishers'
		// small-caps markup ("<span>S</span>ustainable") rejoins as "Sustainable".
		.replace(/<\s*(br|\/p|\/div|\/li|\/jats:p)\b[^>]*>/gi, " ")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

// Unicode-aware: an a-z filter silently mangles Turkish, Thai, Cyrillic and CJK
// titles. Accents are decomposed and dropped so "Şehir" == "Sehir" and
// "café" == "cafe"; dotless i is folded because it has no decomposition.
function norm(s) {
	return String(s || "")
		.normalize("NFKD")
		.replace(/\p{M}+/gu, "")
		.toLowerCase()
		.replace(/ı/g, "i")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

// Dice coefficient over character bigrams - tolerant of small title variations.
function similarity(a, b) {
	a = norm(a);
	b = norm(b);
	if (!a || !b) return 0;
	if (a === b) return 1;
	let grams = (s) => {
		let m = new Map();
		for (let i = 0; i < s.length - 1; i++) {
			let g = s.substr(i, 2);
			m.set(g, (m.get(g) || 0) + 1);
		}
		return m;
	};
	let ga = grams(a), gb = grams(b), hits = 0, total = 0;
	for (let [g, n] of ga) {
		hits += Math.min(n, gb.get(g) || 0);
		total += n;
	}
	for (let n of gb.values()) total += n;
	return total ? (2 * hits) / total : 0;
}

function yearOf(d) {
	let m = /\b(1[5-9]\d{2}|20\d{2})\b/.exec(String(d || ""));
	return m ? m[1] : "";
}

function normPages(p) {
	return String(p || "").replace(/[‐-―-]/g, "-").replace(/\s/g, "");
}

function normISSN(v) {
	return String(v || "").replace(/[^0-9xX]/g, "").toUpperCase();
}

const LANG_MAP = {
	english: "en", eng: "en", turkish: "tr", tur: "tr", türkçe: "tr",
	german: "de", ger: "de", deu: "de", french: "fr", fra: "fr", fre: "fr",
	spanish: "es", spa: "es", chinese: "zh", zho: "zh", chi: "zh"
};

function normLang(v) {
	let s = String(v || "").toLowerCase().trim().replace(/[_\s]/g, "-");
	if (LANG_MAP[s]) return LANG_MAP[s];
	return s.split("-")[0];
}

// ---------- item field access ----------

// Resolve a base field to the field this item type actually uses.
function resolveField(item, baseField) {
	try {
		let id = Zotero.ItemFields.getFieldIDFromTypeAndBase(item.itemTypeID, baseField);
		if (id) return Zotero.ItemFields.getName(id);
	}
	catch (e) {}
	try {
		let direct = Zotero.ItemFields.getID(baseField);
		if (direct && Zotero.ItemFields.isValidForType(direct, item.itemTypeID)) {
			return baseField;
		}
	}
	catch (e) {}
	return null;
}

function authorsOf(item) {
	let authorTypeID = Zotero.CreatorTypes.getID("author");
	return item.getCreators().filter(c => c.creatorTypeID === authorTypeID);
}

/* Zotero's setCreators() replaces the whole creator list and drops anything
   past the array it is given, so editors, translators and every other creator
   type have to be carried across or accepting an author fix would delete them.
   getCreators() already returns copies carrying creatorTypeID, which setCreator
   accepts as-is. */
function nonAuthorsOf(item) {
	let authorTypeID = Zotero.CreatorTypes.getID("author");
	return item.getCreators().filter(c => c.creatorTypeID !== authorTypeID);
}

// ---------- HTTP ----------

async function getJSON(url) {
	let xhr = await Zotero.HTTP.request("GET", url, {
		responseType: "json",
		headers: { "User-Agent": UA },
		errorDelayMax: 0,
		successCodes: [200]
	});
	return xhr.response;
}

// ---------- sources ----------

async function crossrefByDOI(doi) {
	try {
		let d = await getJSON("https://api.crossref.org/works/" + encodeURIComponent(doi));
		return (d && d.message) || null;
	}
	catch (e) {
		return null;
	}
}

// The author is a ranking signal, never a hard filter: a wrong author in the
// Zotero record would otherwise poison the query and return nothing.
async function crossrefByTitle(title, author, year) {
	let attempts = [[title, year].filter(Boolean).join(" "), title];
	// bestScore ranks candidates and may include the author bonus; bestRaw is the
	// unboosted title similarity and is the only thing allowed to clear the
	// acceptance bar, so a same-group paper can't be boosted over the line.
	let best = null, bestScore = 0, bestRaw = 0;
	for (let q of attempts) {
		try {
			let d = await getJSON("https://api.crossref.org/works?rows=10&query.bibliographic="
				+ encodeURIComponent(q));
			for (let it of ((d && d.message && d.message.items) || [])) {
				let raw = similarity(title, stripTags((it.title || [""])[0]));
				let s = raw;
				if (author && (it.author || []).some(a => norm(a.family) === norm(author))) {
					s += 0.05;
				}
				if (s > bestScore) {
					best = it;
					bestScore = s;
					bestRaw = raw;
				}
			}
		}
		catch (e) {
			// fall through to the looser query
		}
		if (bestRaw >= TITLE_ACCEPT) break;
		await delay(400);
	}
	return best ? { work: best, score: bestRaw } : null;
}

function datePartsOf(node) {
	let p = (node && node["date-parts"] && node["date-parts"][0]) || [];
	if (!p[0]) return "";
	let d = String(p[0]);
	if (p[1]) d += "-" + String(p[1]).padStart(2, "0");
	if (p[1] && p[2]) d += "-" + String(p[2]).padStart(2, "0");
	return d;
}

function crossrefFields(m) {
	if (!m) return null;
	// An article can carry an online-first date and a later issue date. Both are
	// correct, so every one of them counts as a match and only the issue date
	// (what a citation prints) is proposed.
	let issueDate = datePartsOf(m["journal-issue"] && m["journal-issue"]["published-print"]);
	let printDate = datePartsOf(m["published-print"]);
	let onlineDate = datePartsOf(m["published-online"]);
	let issuedDate = datePartsOf(m.issued);
	let date = printDate || issueDate || issuedDate || onlineDate;
	let dateYears = [issueDate, printDate, onlineDate, issuedDate]
		.map(yearOf).filter(Boolean);
	return {
		title: stripTags((m.title || [""])[0]),
		publicationTitle: stripTags((m["container-title"] || [""])[0]),
		volume: m.volume || "",
		issue: m.issue || "",
		pages: (m.page || "").replace(/-/g, "–"),
		date: date,
		DOI: (m.DOI || "").toLowerCase(),
		publisher: m.publisher || "",
		// Used for thesis/report only - see the note at the use site.
		institution: ((m.institution || [])[0] || {}).name || "",
		place: m["publisher-location"]
			|| (((m.institution || [])[0] || {}).place || [])[0] || "",
		dateYears: dateYears,
		// Journals have separate print and electronic ISSNs and Zotero stores both.
		ISBN: (m.ISBN || []).join(", "),
		ISBNList: m.ISBN || [],
		ISSN: (m.ISSN || []).join(", "),
		ISSNList: m.ISSN || [],
		journalAbbreviation: stripTags((m["short-container-title"] || [""])[0]),
		language: m.language || "",
		abstractNote: stripTags(m.abstract || ""),
		type: m.type || "",
		// Crossref entries are not uniform: some carry only `name` (organisations)
		// and a few only `given`. Anything that would end up blank is dropped
		// rather than written into the record as an empty creator.
		authors: (m.author || []).map((a) => {
			if (a.family) {
				return { creatorType: "author", firstName: (a.given || "").trim(),
					lastName: String(a.family).trim() };
			}
			let single = String(a.name || a.given || "").trim();
			return single
				? { creatorType: "author", name: single, fieldMode: 1 }
				: null;
		}).filter(Boolean)
	};
}

async function openAlex(doi, title) {
	try {
		let d;
		if (doi) {
			d = await getJSON("https://api.openalex.org/works/doi:" + encodeURIComponent(doi));
		}
		else {
			let r = await getJSON("https://api.openalex.org/works?per_page=3&search="
				+ encodeURIComponent(title));
			let best = null, bestScore = 0;
			for (let w of ((r && r.results) || [])) {
				let s = similarity(title, w.title || "");
				if (s > bestScore) {
					best = w;
					bestScore = s;
				}
			}
			if (bestScore < 0.85) return null;
			d = best;
		}
		if (!d) return null;
		let bib = d.biblio || {};
		let src = (d.primary_location && d.primary_location.source) || {};
		let pages = bib.first_page
			? bib.first_page + (bib.last_page ? "–" + bib.last_page : "")
			: "";
		return {
			title: d.title || "",
			publicationTitle: src.display_name || "",
			volume: bib.volume || "",
			issue: bib.issue || "",
			pages: pages,
			date: d.publication_date || String(d.publication_year || ""),
			DOI: (d.doi || "").replace("https://doi.org/", "").toLowerCase(),
			publisher: src.host_organization_name || "",
			ISSN: (src.issn || [])[0] || src.issn_l || "",
			language: d.language || "",
			authors: (d.authorships || []).map(a => (a.author && a.author.display_name) || "")
		};
	}
	catch (e) {
		return null;
	}
}

// ---------- comparison ----------

function idSet(v) {
	return new Set(String(v || "").split(/[,;\s]+/)
		.map(x => x.replace(/[^0-9xX]/g, "").toUpperCase()).filter(Boolean));
}

function idsOverlap(a, b) {
	let sa = idSet(a), sb = idSet(b);
	if (!sa.size || !sb.size) return false;
	for (let v of sa) if (sb.has(v)) return true;
	return false;
}

function valuesMatch(field, a, b, cr) {
	switch (field) {
		case "title":
			return norm(a) === norm(b) || similarity(a, b) >= 0.97;
		case "pages":
			return normPages(a) === normPages(b);
		case "date": {
			let y = yearOf(a);
			if (!y) return false;
			let candidates = (cr && cr.dateYears && cr.dateYears.length)
				? cr.dateYears : [yearOf(b)];
			return candidates.includes(y);
		}
		case "DOI":
			return String(a || "").toLowerCase().trim() === String(b || "").toLowerCase().trim();
		case "ISSN":
		case "ISBN":
			// Zotero commonly stores "print, electronic"; any overlap is a match.
			return idsOverlap(a, b);
		case "language":
			return normLang(a) === normLang(b);
		default:
			return norm(a) === norm(b);
	}
}

function displayValue(field, v) {
	if (field === "date") return yearOf(v) || String(v || "");
	let s = String(v || "");
	return s.length > 180 ? s.slice(0, 177) + "…" : s;
}

// Surnames only: Crossref's given-name style ("AJ" vs "A. J.") differs from
// Zotero's by convention and is not an error.
function compareAuthors(item, crAuthors) {
	let zAuthors = authorsOf(item);
	let zNames = zAuthors.map(c => c.lastName || c.firstName || "");
	let cNames = crAuthors.map(a => a.lastName || a.name || "");
	if (!cNames.length) return null;

	let sameSurnames = zNames.map(norm).join("|") === cNames.map(norm).join("|");

	if (!sameSurnames) {
		let zSet = new Set(zNames.map(norm));
		let cSet = new Set(cNames.map(norm));
		let missing = cNames.filter(n => !zSet.has(norm(n)));
		let extra = zNames.filter(n => !cSet.has(norm(n)));
		let why;
		if (missing.length && !extra.length) why = `${missing.length} author(s) missing`;
		else if (extra.length && !missing.length) why = `${extra.length} extra author(s)`;
		else if (missing.length || extra.length) why = "author names differ";
		else why = "author order differs";
		return {
			kind: "creators",
			field: "creators",
			label: "Authors",
			note: why,
			current: zNames.join("; ") || "(empty)",
			proposed: cNames.join("; "),
			rawProposed: crAuthors.concat(nonAuthorsOf(item)),
			agrees: false,
			conflict: true,
			serious: true,
			// Off by default: this replaces the entire creator list.
			checked: false
		};
	}

	// Surnames line up; offer to fill in given names Zotero is missing.
	let fillable = zAuthors.some((c, i) => !String(c.firstName || "").trim()
		&& crAuthors[i] && String(crAuthors[i].firstName || "").trim());
	if (fillable) {
		let merged = zAuthors.map((c, i) => ({
			creatorType: "author",
			firstName: String(c.firstName || "").trim() || (crAuthors[i].firstName || ""),
			lastName: c.lastName || crAuthors[i].lastName || ""
		}));
		return {
			kind: "creators",
			field: "creators",
			label: "Authors",
			note: "given names missing",
			current: zNames.join("; "),
			proposed: merged.map(c => `${c.lastName}, ${c.firstName}`.replace(/, $/, "")).join("; "),
			rawProposed: merged.concat(nonAuthorsOf(item)),
			agrees: false,
			conflict: false,
			serious: false,
			checked: true
		};
	}
	return null;
}

async function verifyItem(item) {
	let title = item.getField("title") || "";
	let doi = String(item.getField("DOI") || "").trim().toLowerCase();
	let authors = authorsOf(item);
	let firstAuthor = authors.length ? authors[0].lastName : "";

	let msg = doi ? await crossrefByDOI(doi) : null;
	let doiBroken = !!doi && !msg;
	let via = "DOI";
	let searchScore = null;
	if (!msg) {
		let hit = await crossrefByTitle(title, firstAuthor, yearOf(item.getField("date")));
		via = "title search";
		if (hit) {
			searchScore = hit.score;
			if (hit.score >= TITLE_ACCEPT) {
				msg = hit.work;
			}
			else if (hit.score >= TITLE_SUGGEST) {
				// Close, but not close enough to rewrite fields from.
				let cand = crossrefFields(hit.work);
				return { item, title, status: "uncertain", doiBroken,
					candidate: cand, titleScore: hit.score };
			}
		}
	}
	let cr = crossrefFields(msg);
	if (!cr) return { item, title, status: "notfound", doiBroken, titleScore: searchScore };

	let titleScore = similarity(title, cr.title);
	let oa = await openAlex(cr.DOI, title);

	// Retractions and corrections, which Crossref sources from Retraction Watch.
	let alerts = ((msg["updated-by"]) || [])
		.filter(u => /retract|withdraw|removal|correct|erratum|concern/i
			.test(String(u.type || "") + " " + String(u.label || "")))
		.map(u => ({
			label: u.label || u.type || "update",
			doi: u.DOI || "",
			serious: /retract|withdraw|removal|concern/i
				.test(String(u.type || "") + " " + String(u.label || ""))
		}));

	// Reported only: changing an item's type rewrites its whole field set.
	let expectedType = TYPE_MAP[cr.type] || "";
	let actualType = Zotero.ItemTypes.getName(item.itemTypeID);
	let typeMismatch = (expectedType && expectedType !== actualType)
		? { expected: expectedType, actual: actualType }
		: null;

	let diffs = [];
	for (let [baseField, label, core, opts] of FIELDS) {
		let proposed = cr[baseField];
		let field = resolveField(item, baseField);
		if (!field) continue;
		// Matches Zotero's own Crossref translator: `institution` wins for a
		// thesis's university and a report's institution, but a preprint's
		// repository takes the publisher (the translator's own fixtures expect
		// "Cold Spring Harbor Laboratory" for bioRxiv, not the "bioRxiv" institution).
		if (baseField === "publisher" && cr.institution
			&& (field === "institution" || field === "university")) {
			proposed = cr.institution;
		}
		if (!proposed) continue;
		let current = item.getField(field) || "";
		let conflict = !!current;
		if (conflict) {
			if (opts && opts.fillOnly) continue;
			if (valuesMatch(baseField, current, proposed, cr)) continue;
		}
		let agrees = oa && oa[baseField]
			&& valuesMatch(baseField, oa[baseField], proposed, cr);
		diffs.push({
			kind: "field",
			field,
			label: label === "Container"
				? (Zotero.ItemFields.getLocalizedString(field) || label)
				: label,
			current: displayValue(baseField, current),
			proposed: displayValue(baseField, proposed),
			rawProposed: proposed,
			agrees: !!agrees,
			conflict,
			note: conflict ? null : "missing",
			// A contradiction is always worth fixing. A blank field is only
			// pre-ticked when it is core for this item type.
			checked: conflict || (typeof core === "function" ? core(actualType) : core)
		});
	}

	let authorDiff = compareAuthors(item, cr.authors);
	if (authorDiff) diffs.push(authorDiff);

	return { item, title, status: "ok", via, titleScore, doiBroken, cr, oa,
		diffs, alerts, typeMismatch };
}

// ---------- dialog ----------

function el(doc, tag, props, children) {
	let e = doc.createElement(tag);
	for (let k in (props || {})) {
		if (k === "text") e.textContent = props[k];
		else if (k.startsWith("on")) e.addEventListener(k.slice(2), props[k]);
		else e.setAttribute(k, props[k]);
	}
	for (let c of (children || [])) if (c) e.appendChild(c);
	return e;
}

const CSS = `
:root { color-scheme: light dark; }
body { font: message-box; font-size: 13px; background: Canvas; color: CanvasText;
       margin: 0; padding: 14px 16px 0; }
h2 { font-size: 14px; margin: 0 0 10px; }
.item { border: 1px solid color-mix(in srgb, CanvasText 22%, Canvas);
        border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; }
.title { font-weight: 600; margin-bottom: 3px; }
.meta { opacity: .72; font-size: 12px; margin-bottom: 6px; }
.row { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; }
.lbl { width: 104px; flex: none; opacity: .8; }
.old { text-decoration: line-through; opacity: .6; }
.new { font-weight: 600; }
.arrow { opacity: .5; }
.vals { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
.badge { font-size: 11px; padding: 1px 6px; border-radius: 9px; white-space: nowrap;
         background: color-mix(in srgb, AccentColor 22%, Canvas); }
.tag { font-size: 11px; padding: 1px 6px; border-radius: 9px; white-space: nowrap;
       background: color-mix(in srgb, #c2410c 20%, Canvas); }
.tag-missing { font-size: 11px; padding: 1px 6px; border-radius: 9px; white-space: nowrap;
       background: color-mix(in srgb, CanvasText 12%, Canvas); opacity: .8; }
.clean { opacity: .7; }
.warn { color: #c2410c; }
.alert { margin: 6px 0; padding: 6px 9px; border-radius: 5px; font-size: 12px;
         background: color-mix(in srgb, #dc2626 16%, Canvas);
         border: 1px solid color-mix(in srgb, #dc2626 45%, Canvas); }
.note { margin: 4px 0; font-size: 12px; }
.scroll { overflow: auto; height: calc(100vh - 16px); }
.bar { position: sticky; bottom: 0; background: Canvas; padding: 10px 0;
       display: flex; gap: 8px; align-items: center;
       border-top: 1px solid color-mix(in srgb, CanvasText 18%, Canvas); }
.spacer { flex: 1; }
button { font: message-box; font-size: 13px; padding: 5px 14px; }
`;

async function showDialog(results) {
	let win = Zotero.getMainWindow().openDialog("about:blank", "ref-verifier",
		"chrome,centerscreen,resizable,width=940,height=660");
	if (win.document.readyState !== "complete") {
		await new Promise(res => win.addEventListener("load", res, { once: true }));
	}

	let doc = win.document;
	doc.title = "Reference Verifier";
	doc.head.appendChild(el(doc, "style", { text: CSS }));

	let boxes = [];
	let scroll = el(doc, "div", { class: "scroll" });

	let hasConflict = r => r.diffs.some(d => d.conflict);
	// Rows that are off by default are optional enrichment, not a defect, so an
	// item carrying only those still counts as correct.
	let hasCoreGap = r => r.diffs.some(d => !d.conflict && d.checked);
	// Split "this field is wrong" from "this field is blank" - both are worth
	// showing, but only the first means the reference is actually incorrect.
	let wrong = results.filter(r => r.status === "ok" && hasConflict(r));
	let incomplete = results.filter(r => r.status === "ok" && !hasConflict(r) && hasCoreGap(r));
	// A record can be accurate in every field and still be retracted, or filed
	// under the wrong item type - that must not land in the "correct" pile.
	let flagged = results.filter(r => r.status === "ok" && !hasConflict(r) && !hasCoreGap(r)
		&& (r.alerts.length || r.typeMismatch));
	let clean = results.filter(r => r.status === "ok" && !hasConflict(r) && !hasCoreGap(r)
		&& !r.alerts.length && !r.typeMismatch);
	let uncertain = results.filter(r => r.status === "uncertain");
	let missing = results.filter(r => r.status === "notfound");

	scroll.appendChild(el(doc, "h2", {
		text: `${results.length} checked — ${wrong.length} with wrong fields, `
			+ `${incomplete.length} with gaps, ${flagged.length} flagged, `
			+ `${clean.length} correct, ${uncertain.length} uncertain, `
			+ `${missing.length} not found`
	}));

	function annotate(box, r) {
		for (let a of r.alerts) {
			box.appendChild(el(doc, "div", { class: "alert",
				text: (a.serious ? "⛔ " : "⚠ ") + a.label
					+ (a.serious ? " — this work has been retracted or withdrawn" : "")
					+ (a.doi ? "  (" + a.doi + ")" : "") }));
		}
		if (r.doiBroken) {
			box.appendChild(el(doc, "div", { class: "alert",
				text: "⛔ The DOI in this record does not resolve on Crossref." }));
		}
		if (r.typeMismatch) {
			box.appendChild(el(doc, "div", { class: "note warn",
				text: `⚠ Item type is "${r.typeMismatch.actual}" but the source says `
					+ `"${r.typeMismatch.expected}" — change this by hand if it matters.` }));
		}
	}

	function header(r) {
		let warn = r.titleScore < 0.9;
		let meta = el(doc, "div", {
			class: "meta" + (warn ? " warn" : ""),
			text: `matched via ${r.via} · title similarity ${r.titleScore.toFixed(2)}`
				+ (warn ? "  ⚠ low similarity — check this one by hand" : "")
		});
		return el(doc, "div", { class: "item" }, [
			el(doc, "div", { class: "title", text: r.title }), meta
		]);
	}

	// An otherwise-correct record can still carry optional rows; say so plainly
	// so 90 accurate references don't all look like they need fixing.
	let cleanSet = new Set(clean);
	for (let r of wrong.concat(incomplete, flagged, clean).filter(r => r.diffs.length)) {
		let box = header(r);
		if (cleanSet.has(r)) {
			box.querySelector(".meta").textContent =
				"every checked field matches Crossref — the row(s) below are optional additions";
		}
		annotate(box, r);
		for (let d of r.diffs) {
			let cb = el(doc, "input", { type: "checkbox" });
			cb.checked = d.checked;
			boxes.push({ cb, item: r.item, diff: d });
			box.appendChild(el(doc, "label", { class: "row" }, [
				cb,
				el(doc, "span", { class: "lbl", text: d.label }),
				el(doc, "span", { class: "vals" }, [
					el(doc, "span", { class: "old", text: d.current || "(empty)" }),
					el(doc, "span", { class: "arrow", text: "→" }),
					el(doc, "span", { class: "new", text: d.proposed }),
					d.agrees ? el(doc, "span", { class: "badge", text: "OpenAlex agrees" }) : null,
					d.note ? el(doc, "span", {
						class: d.note === "missing" ? "tag-missing" : "tag", text: d.note }) : null
				])
			]));
		}
		scroll.appendChild(box);
	}

	for (let r of flagged.filter(r => !r.diffs.length)) {
		let box = header(r);
		box.querySelector(".meta").textContent = "every field matches the source, but:";
		annotate(box, r);
		scroll.appendChild(box);
	}

	for (let r of uncertain) {
		let c = r.candidate;
		scroll.appendChild(el(doc, "div", { class: "item" }, [
			el(doc, "div", { class: "title", text: "? " + r.title }),
			el(doc, "div", { class: "meta warn",
				text: `no DOI, and the closest Crossref record only scores `
					+ `${r.titleScore.toFixed(2)} — too low to edit from. Check by hand:` }),
			el(doc, "div", { class: "note",
				text: `${c.title} — ${c.publicationTitle} ${c.volume}`
					+ `${c.issue ? "(" + c.issue + ")" : ""} ${c.pages}, `
					+ `${yearOf(c.date)}  ${c.DOI}` })
		]));
	}

	for (let r of clean.filter(r => !r.diffs.length)) {
		scroll.appendChild(el(doc, "div", { class: "item clean" }, [
			el(doc, "div", { class: "title", text: "✓ " + r.title }),
			el(doc, "div", { class: "meta", text: "every checked field matches Crossref" })
		]));
	}

	for (let r of missing) {
		scroll.appendChild(el(doc, "div", { class: "item" }, [
			el(doc, "div", { class: "title", text: "? " + r.title }),
			el(doc, "div", { class: "meta warn",
				text: r.doiBroken
					? "the DOI does not resolve and no confident title match was found — verify by hand"
					: "no confident Crossref match — verify by hand" })
		]));
	}

	let resolveFn;
	let done = new Promise(res => (resolveFn = res));

	let applyBtn = el(doc, "button", {
		text: "Apply selected",
		onclick: () => {
			resolveFn(boxes.filter(b => b.cb.checked));
			win.close();
		}
	});
	if (!boxes.length) applyBtn.disabled = true;

	scroll.appendChild(el(doc, "div", { class: "bar" }, [
		el(doc, "button", { text: "Select all",
			onclick: () => boxes.forEach(b => (b.cb.checked = true)) }),
		el(doc, "button", { text: "Select none",
			onclick: () => boxes.forEach(b => (b.cb.checked = false)) }),
		el(doc, "span", { class: "spacer" }),
		el(doc, "button", { text: "Cancel", onclick: () => { resolveFn([]); win.close(); } }),
		applyBtn
	]));
	doc.body.appendChild(scroll);
	win.addEventListener("unload", () => resolveFn([]), { once: true });

	return done;
}

// ---------- main action ----------

async function run(items) {
	items = items.filter(i => i.isRegularItem());
	if (!items.length) return;

	let pw = new Zotero.ProgressWindow({ closeOnClick: false });
	pw.changeHeadline("Verifying references");
	let line = new pw.ItemProgress(null, `0 / ${items.length}`);
	pw.show();

	let results = [];
	try {
		for (let i = 0; i < items.length; i++) {
			line.setText(`${i + 1} / ${items.length}`);
			line.setProgress(Math.round(((i + 1) / items.length) * 100));
			try {
				results.push(await verifyItem(items[i]));
			}
			catch (e) {
				Zotero.logError(e);
				results.push({
					item: items[i],
					title: items[i].getField("title"),
					status: "notfound",
					doiBroken: false
				});
			}
			// Be polite to the public APIs.
			if (i < items.length - 1) await delay(350);
		}
	}
	finally {
		pw.close();
	}

	let approved = await showDialog(results);
	if (!approved.length) return;

	let byItem = new Map();
	for (let a of approved) {
		if (!byItem.has(a.item.id)) byItem.set(a.item.id, { item: a.item, diffs: [] });
		byItem.get(a.item.id).diffs.push(a.diff);
	}

	let n = 0;
	await Zotero.DB.executeTransaction(async function () {
		for (let { item, diffs } of byItem.values()) {
			for (let d of diffs) {
				if (d.kind === "creators") item.setCreators(d.rawProposed);
				else item.setField(d.field, d.rawProposed);
			}
			await item.save();
			n++;
		}
	});

	let ok = new Zotero.ProgressWindow();
	ok.changeHeadline("Reference Verifier");
	new ok.ItemProgress(null, `${n} item(s) updated`).setProgress(100);
	ok.show();
	ok.startCloseTimer(3000);
}

// ---------- lifecycle ----------

function registerMenu() {
	Zotero.MenuManager.registerMenu({
		menuID: MENU_ID,
		pluginID: PLUGIN_ID,
		target: "main/library/item",
		menus: [{
			menuType: "menuitem",
			icon: "chrome://refverifier/content/menu-icon.svg",
			onShowing(event, context) {
				let elem = context.menuElem;
				if (elem) elem.setAttribute("label", menuLabel());
				context.setVisible((context.items || []).some(i => i.isRegularItem()));
			},
			onCommand(event, context) {
				run(context.items || []).catch(e => Zotero.logError(e));
			}
		}]
	});
}

function install() {}
function uninstall() {}

async function startup({ id, version, rootURI }) {
	await Zotero.initializationPromise;
	RV.rootURI = rootURI;

	// The menu icon lives inside the plugin, so its chrome:// package has to be
	// registered before the menu can resolve it.
	let aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
		.getService(Components.interfaces.amIAddonManagerStartup);
	chromeHandle = aomStartup.registerChrome(
		Services.io.newURI(rootURI + "manifest.json"),
		[["content", "refverifier", rootURI + "chrome/content/"]]);

	registerMenu();
}

function onMainWindowLoad({ window }) {}
function onMainWindowUnload({ window }) {}

function shutdown() {
	try {
		Zotero.MenuManager.unregisterMenu(MENU_ID);
	}
	catch (e) {}
	if (chromeHandle) {
		chromeHandle.destruct();
		chromeHandle = null;
	}
	RV = {};
}
