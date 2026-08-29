import fs from "fs";
import path from "path";
import { api, makeItem, makeAttachment, check, stats, TMP } from "./harness.mjs";

console.log("\n===== 1. PDF toplama =====");
{
  const pdf1 = makeAttachment({ title: "Full Text PDF" });
  const epub = makeAttachment({ title: "EPUB" }, { contentType: false });
  const parent = makeItem({ title: "Bir Makale", date: "2023" }, ["Celik"], [pdf1, epub]);
  const got = api.collectPDFs([parent]);
  check("üst öğeden PDF çekiliyor", got.length === 1 && got[0] === pdf1, `→ ${got.length}`);
  check("PDF olmayan ek atlanıyor", !got.includes(epub));

  check("hem üst hem alt seçiliyse tekrarlamıyor",
    api.collectPDFs([parent, pdf1]).length === 1);
  check("doğrudan seçilen PDF eki alınıyor", api.collectPDFs([pdf1]).length === 1);

  const bare = makeItem({ title: "Eksiz Kayıt", date: "2020" }, ["Yilmaz"], []);
  check("eki olmayan kayıt boş dönüyor", api.collectPDFs([bare]).length === 0);
  check("eksiz kayıt 'PDF yok' listesinde",
    api.itemsWithoutPDF([parent, bare], api.collectPDFs([parent, bare]))
      .map(i => i.getField("title")).join() === "Eksiz Kayıt");
}

console.log("\n===== 2. Diskteki ad korunuyor (yeniden adlandırma YOK) =====");
{
  const dir = fs.mkdtempSync(path.join(TMP, "keep-"));
  const cite = makeAttachment({ title: "Full Text PDF" },
    { filename: "malikRandomVectorFunctional2023.pdf" });
  makeItem({ title: "Random vector functional link network", date: "2023" }, ["Malik"], [cite]);
  const r = await api.exportOne(cite, dir, new Set());
  check("citation key adı birebir korunuyor",
    path.basename(r.path) === "malikRandomVectorFunctional2023.pdf", `→ ${path.basename(r.path)}`);
  check("künye biçimine göre yeniden adlandırmıyor",
    !path.basename(r.path).includes("Malik - 2023"), `→ ${path.basename(r.path)}`);

  const tr = makeAttachment({ title: "PDF" }, { filename: "gölcükŞehirPlanlaması2024.pdf" });
  makeItem({ title: "Şehir", date: "2024" }, ["Gölcük"], [tr]);
  const r2 = await api.exportOne(tr, dir, new Set());
  check("Türkçe karakterli dosya adı bozulmuyor",
    path.basename(r2.path) === "gölcükŞehirPlanlaması2024.pdf", `→ ${path.basename(r2.path)}`);

  const spaced = makeAttachment({ title: "PDF" }, { filename: "Celik et al. - 2017 - Shelter.pdf" });
  makeItem({ title: "Shelter", date: "2017" }, ["Celik"], [spaced]);
  const r3 = await api.exportOne(spaced, dir, new Set());
  check("boşluklu/noktalı adlar aynen geçiyor",
    path.basename(r3.path) === "Celik et al. - 2017 - Shelter.pdf", `→ ${path.basename(r3.path)}`);

  const noExt = makeAttachment({ title: "PDF" }, { filename: "uzantisiz" });
  makeItem({ title: "Uzantisiz", date: "2020" }, ["X"], [noExt]);
  const r4 = await api.exportOne(noExt, dir, new Set());
  check("uzantısız dosyaya .pdf uydurmuyor",
    path.basename(r4.path) === "uzantisiz", `→ ${path.basename(r4.path)}`);

  const orphan = makeAttachment({ title: "Başlık farklı" }, { filename: "standalone2019.pdf" });
  const r5 = await api.exportOne(orphan, dir, new Set());
  check("üst öğesiz ek de dosya adıyla kopyalanıyor",
    path.basename(r5.path) === "standalone2019.pdf", `→ ${path.basename(r5.path)}`);
}

console.log("\n===== 3. Ad çakışması =====");
{
  const dir = fs.mkdtempSync(path.join(TMP, "collide-"));
  const taken = new Set();
  const p1 = await api.uniquePath(dir, "Ayni Ad.pdf", taken);
  const p2 = await api.uniquePath(dir, "Ayni Ad.pdf", taken);
  const p3 = await api.uniquePath(dir, "Ayni Ad.pdf", taken);
  check("aynı isim üzerine yazmıyor", p1 !== p2 && p2 !== p3);
  check("  (2) (3) diye numaralanıyor",
    path.basename(p2) === "Ayni Ad (2).pdf" && path.basename(p3) === "Ayni Ad (3).pdf",
    `→ ${path.basename(p2)}, ${path.basename(p3)}`);

  fs.writeFileSync(path.join(dir, "Var Olan.pdf"), "x");
  const p4 = await api.uniquePath(dir, "Var Olan.pdf", new Set());
  check("diskte var olan dosyanın üzerine yazmıyor",
    path.basename(p4) === "Var Olan (2).pdf", `→ ${path.basename(p4)}`);
}

console.log("\n===== 4. Dışa aktarma =====");
{
  const dir = fs.mkdtempSync(path.join(TMP, "out-"));
  const plain = makeAttachment({ title: "PDF" });
  makeItem({ title: "Notsuz", date: "2020" }, ["Kaya"], [plain]);
  const r1 = await api.exportOne(plain, dir, new Set());
  check("notsuz PDF kopyalandı", r1.ok && fs.existsSync(r1.path));
  check("  içerik birebir kopya", fs.readFileSync(r1.path, "utf8") === "PDFDATA");
  check("  kaynak dosya adıyla yazıldı",
    path.basename(r1.path) === path.basename(plain._path), `→ ${path.basename(r1.path)}`);

  // Varsayılan: düz kopya. Zotero notu olsa bile dosya olduğu gibi kopyalanmalı.
  const noted = makeAttachment({ title: "PDF" },
    { annotations: [{ annotationIsExternal: false }] });
  makeItem({ title: "Notlu", date: "2021" }, ["Demir"], [noted]);
  const r2 = await api.exportOne(noted, dir, new Set());
  check("Zotero notu olsa bile dosya birebir kopyalanıyor",
    r2.annotated === 0 && fs.readFileSync(r2.path, "utf8") === "PDFDATA",
    `→ annotated=${r2.annotated} içerik=${fs.readFileSync(r2.path, "utf8")}`);
  check("  worker devreye girmiyor (dosya yeniden yazılmıyor)",
    fs.readFileSync(r2.path, "utf8") !== "ANNOTATED");

  const gone = makeAttachment({ title: "Kayıp" }, { path: null });
  makeItem({ title: "Kayip Dosya", date: "2019" }, ["Yok"], [gone]);
  const r4 = await api.exportOne(gone, dir, new Set());
  check("diskte olmayan dosya hata değil, rapor", r4.ok === false && r4.reason === "missing");
}

console.log(`\n===== SONUÇ: ${stats.pass} geçti, ${stats.fail} kaldı =====`);
if (stats.fail) console.log("Kalanlar:\n - " + stats.failures.join("\n - "));
