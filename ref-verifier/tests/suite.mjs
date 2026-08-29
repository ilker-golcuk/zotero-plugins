import { verify, makeItem, check, stats, netCount } from "./harness.mjs";

const GT = {  // ground truth, verified against Crossref
  title: "Application of fuzzy DEMATEL–ANP methods for siting refugee camps",
  publicationTitle: "Journal of Humanitarian Logistics and Supply Chain Management",
  volume: "10", issue: "3", pages: "347–369", date: "2020",
  DOI: "10.1108/jhlscm-12-2018-0078", ISSN: "2042-6747", language: "en",
  abstractNote: "an abstract that already exists",
};
const AUTH = [["Abikova", "Jelena"]];
const base = (over = {}, auth = AUTH) =>
  makeItem("journalArticle", { ...GT, ...over }, auth);
const dget = (r, label) => r.diffs.find(d => d.label === label);
const labels = r => r.diffs.map(d => d.label + (d.conflict ? "!" : "?")).sort().join(",");
const conflicts = r => r.diffs.filter(d => d.conflict);
const gaps = r => r.diffs.filter(d => !d.conflict);

console.log("\n===== 1. Doğru kayıtta yanlış alarm olmamalı =====");
{
  const r = await verify(base());
  check("temiz kayıt: ÇELIŞKI yok", conflicts(r).length === 0, `→ ${labels(r)}`);
  check("temiz kayıt: boşluk satırları varsayılan işaretsiz",
    gaps(r).every(d => d.checked === false), `→ ${gaps(r).filter(d=>d.checked).map(d=>d.label)}`);
  check("temiz kayıt: uyarı yok", !r.alerts.length && !r.typeMismatch && !r.doiBroken);
  check("başlık benzerliği 1.00", r.titleScore > 0.99, `→ ${r.titleScore}`);
}

console.log("\n===== 2. Tek tek alan bozma matrisi =====");
const CORRUPT = [
  ["volume", "9", "Volume", "10"],
  ["issue", "7", "Issue", "3"],
  ["pages", "100–110", "Pages", "347–369"],
  ["date", "2019", "Date", "2020"],
  ["publicationTitle", "J. Hum. Log.", "Journal of Humanitarian Logistics and Supply Chain Management", null],
  ["title", "Application of fuzzy DEMATEL methods for siting camps", "Title", null],
];
for (const [field, bad, label, expected] of CORRUPT) {
  const r = await verify(base({ [field]: bad }));
  const d = dget(r, label) || r.diffs.find(x => x.field === field);
  check(`${field} bozuk → yakalandı`, !!d, `→ ${labels(r)}`);
  if (d) {
    check(`  ${field}: eski değer doğru`, d.current === bad, `→ "${d.current}"`);
    if (expected) check(`  ${field}: önerilen "${expected}"`, d.proposed === expected, `→ "${d.proposed}"`);
    check(`  ${field}: tek çelişki`, conflicts(r).length === 1, `→ ${labels(r)}`);
    check(`  ${field}: çelişki varsayılan İŞARETLİ`, d.checked === true);
  }
}

console.log("\n===== 3. Boş alanlar (mode: both) doldurulmalı =====");
{
  const r = await verify(base({ volume: "", issue: "", pages: "" }));
  const core = ["Volume", "Issue", "Pages"].map(l => dget(r, l));
  check("boş volume/issue/pages yakalandı", core.every(Boolean), `→ ${labels(r)}`);
  check("çekirdek boşluklar 'missing' etiketli", core.every(d => d?.note === "missing"));
  check("çekirdek boşluklar varsayılan İŞARETLİ", core.every(d => d?.checked === true));
  check("çekirdek boşluk çelişki sayılmıyor", conflicts(r).length === 0, `→ ${labels(r)}`);
}

console.log("\n===== 4. wrongOnly: boşken susmalı, yanlışken konuşmalı =====");
{
  const empty = await verify(base({ ISSN: "" }));
  const de = dget(empty, "ISSN");
  check("ISSN boş → görünür ama İŞARETSİZ", !!de && de.checked === false, `→ ${JSON.stringify(de?.checked)}`);
  check("ISSN boş → çelişki değil", !de?.conflict);
  const wrong = await verify(base({ ISSN: "1234-5678" }));
  const dw = dget(wrong, "ISSN");
  check("ISSN yanlış → ÇELIŞKI ve İŞARETLİ", !!dw && dw.conflict && dw.checked, `→ ${JSON.stringify(dw)}`);
}

console.log("\n===== 5. fillOnly: sadece boşsa öner, asla 'yanlış' deme =====");
{
  const has = await verify(base({ abstractNote: "kullanıcının kendi özeti" }));
  check("abstract dolu → dokunulmuyor", !dget(has, "Abstract"), `→ ${labels(has)}`);
  const empty = await verify(base({ abstractNote: "" }));
  const d = dget(empty, "Abstract");
  check("abstract boş → öneri var", !!d, `→ ${labels(empty)}`);
  if (d) check("abstract önerisi varsayılan İŞARETSİZ", d.checked === false, `→ checked=${d.checked}`);
  const conflictAbs = await verify(base({ abstractNote: "tamamen alakasız bir metin" }));
  check("abstract asla 'yanlış' denmiyor", !dget(conflictAbs, "Abstract"), `→ ${labels(conflictAbs)}`);
}

console.log("\n===== 6. Normalizasyon regresyonları (yanlış alarm olmamalı) =====");
{
  const cases = [
    ["pages tire farkı", { pages: "347-369" }],
    ["dil 'English' vs 'en'", { language: "English" }],
    ["ISSN tiresiz", { ISSN: "20426747" }],
    ["DOI büyük harf", { DOI: "10.1108/JHLSCM-12-2018-0078" }],
    ["tarih tam biçim", { date: "2020-07-15" }],
    ["başlık noktalama farkı", { title: "Application of fuzzy DEMATEL-ANP methods for siting refugee camps." }],
  ];
  for (const [name, over] of cases) {
    const r = await verify(base(over));
    check(name + " → çelişki yok", conflicts(r).length === 0, `→ ${labels(r)}`);
  }
}

console.log("\n===== 6b. publisher/place öğe tipine göre =====");
{
  const art = await verify(base({ publisher: "", place: "" }));
  const dp = dget(art, "Publisher");
  check("journalArticle: publisher boş → görünür ama İŞARETSİZ",
    !!dp && dp.checked === false, `→ ${JSON.stringify(dp?.checked)}`);
  const bookItem = makeItem("bookSection", {
    title: "Fuzzy Sets", bookTitle: "", publisher: "",
    DOI: "10.1142/9789814261302_0001",
  }, ["Zadeh"]);
  const bk = await verify(bookItem);
  const bp = bk.status === "ok" ? bk.diffs.find(d => d.field === "publisher") : null;
  check("bookSection: publisher boş → İŞARETLİ", !bp || bp.checked === true,
    `→ ${JSON.stringify(bp?.checked)} (status=${bk.status})`);
}

console.log("\n===== 7. Yazar kontrolleri =====");
{
  const missing = await verify(base({}, []));
  check("yazar hiç yok → yakalandı", !!dget(missing, "Authors"), `→ ${labels(missing)}`);

  const wrong = await verify(base({}, [["Abikoya", "Jelena"]]));
  const dw = dget(wrong, "Authors");
  check("yazar soyadı yanlış → yakalandı", !!dw, `→ ${labels(wrong)}`);
  if (dw) {
    check("  yanlış yazar varsayılan İŞARETSİZ", dw.checked === false);
    check("  'serious' işaretli", dw.serious === true);
  }

  const noGiven = await verify(base({}, [["Abikova", ""]]));
  const dg = dget(noGiven, "Authors");
  check("ad eksik → doldurma önerisi", !!dg && dg.note === "given names missing", `→ ${dg?.note}`);
  if (dg) {
    check("  doldurma varsayılan İŞARETLİ", dg.checked === true);
    check("  soyad korunuyor", dg.rawProposed[0].lastName === "Abikova");
    check("  ad Crossref'ten geliyor", dg.rawProposed[0].firstName.length > 0, `→ "${dg.rawProposed[0].firstName}"`);
  }

  const initials = await verify(base({}, [["Abikova", "J."]]));
  check("baş harf varsa dokunma (yanlış alarm yok)", !dget(initials, "Authors"), `→ ${labels(initials)}`);
}

console.log("\n===== 8. Kırık DOI =====");
{
  const r = await verify(base({ DOI: "10.9999/bogus-doi-xyz" }));
  check("kırık DOI işaretlendi", r.doiBroken === true);
  check("başlıkla kurtarıldı", r.status === "ok" && r.via === "title search", `→ ${r.via}`);
  const d = dget(r, "DOI");
  check("doğru DOI önerildi", d?.proposed === GT.DOI, `→ ${d?.proposed}`);
}

console.log("\n===== 9. Geri çekilmiş makale =====");
{
  const r = await verify(makeItem("journalArticle", {
    title: "Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children",
    DOI: "10.1016/S0140-6736(97)11096-0", publicationTitle: "The Lancet",
  }, ["Wakefield"]));
  check("geri çekilme uyarısı var", r.alerts.length > 0, `→ ${r.alerts.length} uyarı`);
  check("ciddi olarak işaretli", r.alerts.some(a => a.serious), `→ ${JSON.stringify(r.alerts.map(a=>a.label))}`);
}

console.log("\n===== 10. Öğe tipi uyuşmazlığı =====");
{
  const r = await verify(makeItem("journalArticle", {
    title: "Comprehensive Evaluation of Emergency Shelters in Wuhan City Based on GIS",
    DOI: "10.1109/icnisc57059.2022.00131",
  }, ["Wang"]));
  check("konferans bildirisi journalArticle olarak → uyarı",
    !!r.typeMismatch && r.typeMismatch.expected === "conferencePaper",
    `→ ${JSON.stringify(r.typeMismatch)}`);
}

console.log("\n===== 11. Uydurma referans =====");
{
  const r = await verify(makeItem("journalArticle", {
    title: "Quantum entanglement of municipal shelter allocation via hyperbolic fuzzy manifolds",
    date: "2021",
  }, ["Nonexistent"]));
  check("uydurma referans bulunamadı olarak işaretlendi", r.status === "notfound", `→ ${r.status}`);
}

console.log("\n===== 12. Öğe tipine göre alan eşleme (base field) =====");
{
  const r = await verify(makeItem("conferencePaper", {
    title: "Comprehensive Evaluation of Emergency Shelters in Wuhan City Based on GIS",
    DOI: "10.1109/icnisc57059.2022.00131", proceedingsTitle: "",
  }, ["Wang"]));
  const d = r.diffs.find(x => x.field === "proceedingsTitle");
  check("conferencePaper: container → proceedingsTitle'a eşlendi", !!d,
    `→ ${r.diffs.map(x=>x.field).join(",")}`);
  check("conferencePaper: tip uyarısı yok", !r.typeMismatch);
}

console.log("\n===== 13. REGRESYON: online-first vs sayı tarihi =====");
{
  // Crossref: issued=2020-11-15 (online), published-print=2021-08-08 (sayı)
  const mk = date => makeItem("journalArticle", {
    title: "A hierarchical flood shelter location model for walking evacuation planning",
    DOI: "10.1080/17477891.2020.1840327", date,
  }, ["Sun"]);
  const issueYear = await verify(mk("2021-08-08"));
  check("sayı tarihi (2021) → çelişki YOK", !conflicts(issueYear).some(d => d.label === "Date"),
    `→ ${labels(issueYear)}`);
  const onlineYear = await verify(mk("2020"));
  check("online tarihi (2020) → çelişki YOK", !conflicts(onlineYear).some(d => d.label === "Date"),
    `→ ${labels(onlineYear)}`);
  const bogus = await verify(mk("2015"));
  check("gerçekten yanlış yıl (2015) → çelişki VAR",
    conflicts(bogus).some(d => d.label === "Date"), `→ ${labels(bogus)}`);
}

console.log("\n===== 14. REGRESYON: basılı + elektronik ISSN =====");
{
  const both = await verify(makeItem("journalArticle", {
    title: "A hierarchical flood shelter location model for walking evacuation planning",
    DOI: "10.1080/17477891.2020.1840327", date: "2021-08-08",
    ISSN: "1747-7891, 1878-0059",
  }, ["Sun"]));
  check("iki ISSN birden → çelişki YOK", !conflicts(both).some(d => d.label === "ISSN"),
    `→ ${labels(both)}`);
  const onlyE = await verify(makeItem("journalArticle", {
    title: "A hierarchical flood shelter location model for walking evacuation planning",
    DOI: "10.1080/17477891.2020.1840327", date: "2021-08-08", ISSN: "1878-0059",
  }, ["Sun"]));
  check("sadece elektronik ISSN → çelişki YOK", !conflicts(onlyE).some(d => d.label === "ISSN"));
  const bad = await verify(makeItem("journalArticle", {
    title: "A hierarchical flood shelter location model for walking evacuation planning",
    DOI: "10.1080/17477891.2020.1840327", date: "2021-08-08", ISSN: "9999-9999",
  }, ["Sun"]));
  check("alakasız ISSN → çelişki VAR", conflicts(bad).some(d => d.label === "ISSN"));
}

console.log("\n===== 15. REGRESYON: yanlış eşleşmeye karşı koruma =====");
{
  // DOI'siz, aynı ekibin benzer başlıklı BAŞKA makalesiyle eşleşiyordu (0.878)
  const r = await verify(makeItem("journalArticle", {
    title: "Humanitarian Relief Logistics Fuzzy Planning Model for the Shelters Location Selection and Evacuation of Victims in the Disaster Region",
    date: "2024", publicationTitle: "BULLETIN OF THE GEORGIAN NATIONAL ACADEMY OF SCIENCES",
  }, ["Sirbiladze"]));
  check("zayıf eşleşme 'uncertain' olarak işaretlendi", r.status === "uncertain", `→ ${r.status}`);
  check("hiçbir alan değişikliği ÖNERİLMİYOR", !r.diffs, `→ ${r.diffs?.length} öneri`);
  check("aday kullanıcıya gösteriliyor", !!r.candidate?.DOI);

  // güçlü eşleşme hâlâ geçmeli
  const ok = await verify(makeItem("journalArticle", {
    title: "A cause and effect relationship model for location of temporary shelters in disaster operations",
    date: "2017",
  }, ["Celik"]));
  check("güçlü başlık eşleşmesi hâlâ kabul ediliyor", ok.status === "ok" && ok.via === "title search",
    `→ ${ok.status}/${ok.via} score=${ok.titleScore?.toFixed(3)}`);
}

console.log(`\n===== SONUÇ: ${stats.pass} geçti, ${stats.fail} kaldı (${netCount()} ağ çağrısı) =====`);
if (stats.fail) console.log("Kalanlar:\n - " + stats.failures.join("\n - "));
