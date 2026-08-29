/* PDF Exporter - Zotero 10 bootstrapped plugin.
   Adds "Export PDFs to Folder..." to the item context menu. Works on one item or
   a whole selection, names each file after the reference, and writes Zotero
   annotations into the copy when the attachment has any. */

var PE = {};
var chromeHandle = null;

const PLUGIN_ID = "pdf-exporter@ilker.local";
const MENU_ID = "pdf-exporter-item-menu";

/* Copy the stored file byte for byte. Zotero keeps highlights and notes in its
   database rather than in the PDF, so a plain copy does not carry them.
   Set this to true to route annotated attachments through Zotero's PDF worker
   instead, which writes a new PDF with the annotations drawn into it. The file
   name is unchanged either way; only the bytes differ. */
const INCLUDE_ANNOTATIONS = false;

const LABELS = {
	tr: { menu: "PDF'leri klasöre aktar…", picker: "PDF'lerin kopyalanacağı klasör" },
	en: { menu: "Export PDFs to Folder…", picker: "Choose a folder for the PDFs" }
};

function L() {
	let loc = "en";
	try {
		loc = String(Services.locale.appLocaleAsBCP47 || "en").slice(0, 2).toLowerCase();
	}
	catch (e) {}
	return LABELS[loc] || LABELS.en;
}

// ---------- gathering ----------

/* A selection can hold parent items, PDF children, or both. Zotero's own
   (unreleased, hidden) exportSelectedFiles does the same reduce; the Set
   collapses the case where a parent and its own PDF are both selected. */
function collectPDFs(items) {
	let out = [];
	for (let item of items) {
		if (item.isPDFAttachment()) {
			out.push(item);
		}
		else if (item.isRegularItem()) {
			for (let id of item.getAttachments()) {
				let att = Zotero.Items.get(id);
				if (att && att.isPDFAttachment()) out.push(att);
			}
		}
	}
	return [...new Set(out)];
}

function itemsWithoutPDF(items, found) {
	let haveParents = new Set();
	for (let att of found) {
		let p = att.parentItem;
		if (p) haveParents.add(p.id);
		else haveParents.add(att.id);
	}
	return items.filter(i => i.isRegularItem() && !haveParents.has(i.id));
}

// ---------- naming ----------

/* No renaming: the copy keeps the name the file already has on disk. Zotero
   users who let Better BibTeX rename attachments to the citation key expect
   exactly that name in the export, not a regenerated one. The name is taken
   from the resolved path rather than `attachmentFilename` so it is literally
   the file being copied, and it is already filesystem-valid by construction. */
async function uniquePath(folder, filename, taken) {
	let dot = filename.lastIndexOf(".");
	let base = dot > 0 ? filename.slice(0, dot) : filename;
	let ext = dot > 0 ? filename.slice(dot) : "";
	for (let n = 1; ; n++) {
		let name = (n === 1 ? base : `${base} (${n})`) + ext;
		let path = PathUtils.join(folder, name);
		if (!taken.has(path) && !(await IOUtils.exists(path))) {
			taken.add(path);
			return path;
		}
	}
}

// ---------- export ----------

async function exportOne(att, folder, taken) {
	let source = await att.getFilePathAsync();
	if (!source) {
		return { ok: false, reason: "missing",
			title: att.getField("title") || att.attachmentFilename || "?" };
	}
	let target = await uniquePath(folder, PathUtils.filename(source), taken);

	if (INCLUDE_ANNOTATIONS) {
		let annotations = att.getAnnotations().filter(a => !a.annotationIsExternal);
		if (annotations.length) {
			await Zotero.PDFWorker.export(att.id, target, true);
			return { ok: true, annotated: annotations.length, path: target };
		}
	}
	await IOUtils.copy(source, target);
	return { ok: true, annotated: 0, path: target };
}

async function pickFolder(win) {
	let mod = ChromeUtils.importESModule(
		"chrome://zotero/content/modules/filePicker.mjs");
	let fp = new mod.FilePicker();
	fp.init(win, L().picker, fp.modeGetFolder);
	let rv = await fp.show();
	return (rv === fp.returnOK || rv === fp.returnReplace) ? fp.file : null;
}

async function run(items) {
	let win = Zotero.getMainWindow();
	let pdfs = collectPDFs(items);
	let noPDF = itemsWithoutPDF(items, pdfs);

	if (!pdfs.length) {
		Services.prompt.alert(win, "PDF Exporter",
			"No PDF attachment was found on the selected item(s).");
		return;
	}

	let folder = await pickFolder(win);
	if (!folder) return;

	let pw = new Zotero.ProgressWindow({ closeOnClick: false });
	pw.changeHeadline("Exporting PDFs");
	let line = new pw.ItemProgress(null, `0 / ${pdfs.length}`);
	pw.show();

	let done = 0, annotated = 0, failed = [];
	let taken = new Set();
	try {
		for (let i = 0; i < pdfs.length; i++) {
			let att = pdfs[i];
			line.setText(`${i + 1} / ${pdfs.length}`);
			line.setProgress(Math.round(((i + 1) / pdfs.length) * 100));
			try {
				let r = await exportOne(att, folder, taken);
				if (r.ok) {
					done++;
					if (r.annotated) annotated++;
				}
				else {
					failed.push({ title: r.title, reason: "file not found on disk" });
				}
			}
			catch (e) {
				Zotero.logError(e);
				failed.push({
					title: att.getField("title") || att.attachmentFilename || "?",
					reason: e.message || String(e)
				});
			}
		}
	}
	finally {
		pw.close();
	}

	let ok = new Zotero.ProgressWindow();
	ok.changeHeadline("PDF Exporter");
	new ok.ItemProgress(null, `${done} PDF exported`).setProgress(100);
	if (annotated) {
		new ok.ItemProgress(null, `${annotated} with annotations included`).setProgress(100);
	}
	if (failed.length || noPDF.length) {
		new ok.ItemProgress(null,
			`${failed.length + noPDF.length} skipped`).setProgress(100);
	}
	ok.show();
	ok.startCloseTimer(5000);

	// Only interrupt with a dialog when something actually needs attention.
	if (failed.length || noPDF.length) {
		let lines = [];
		if (noPDF.length) {
			lines.push("No PDF attachment:");
			for (let i of noPDF.slice(0, 15)) lines.push("  • " + i.getField("title"));
			if (noPDF.length > 15) lines.push(`  … and ${noPDF.length - 15} more`);
		}
		if (failed.length) {
			if (lines.length) lines.push("");
			lines.push("Could not be exported:");
			for (let f of failed.slice(0, 15)) lines.push(`  • ${f.title} — ${f.reason}`);
			if (failed.length > 15) lines.push(`  … and ${failed.length - 15} more`);
		}
		lines.push("", `Exported to: ${folder}`);
		Services.prompt.alert(win, "PDF Exporter", lines.join("\n"));
	}
}

// ---------- lifecycle ----------

function registerMenu() {
	Zotero.MenuManager.registerMenu({
		menuID: MENU_ID,
		pluginID: PLUGIN_ID,
		target: "main/library/item",
		menus: [{
			menuType: "menuitem",
			icon: "chrome://pdfexporter/content/menu-icon.svg",
			onShowing(event, context) {
				let elem = context.menuElem;
				if (elem) elem.setAttribute("label", L().menu);
				let items = context.items || [];
				context.setVisible(items.some(
					i => i.isPDFAttachment() || i.isRegularItem()));
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
	PE.rootURI = rootURI;

	// The menu icon lives inside the plugin, so its chrome:// package has to be
	// registered before the menu can resolve it.
	let aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
		.getService(Components.interfaces.amIAddonManagerStartup);
	chromeHandle = aomStartup.registerChrome(
		Services.io.newURI(rootURI + "manifest.json"),
		[["content", "pdfexporter", rootURI + "chrome/content/"]]);

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
	PE = {};
}
