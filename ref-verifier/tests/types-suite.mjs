import { verify, makeItem, check, stats } from "./harness.mjs";

// Zotero'nun resmi Crossref çevirmeniyle aynı sonucu vermeli
const EXPECT_VALUE = {
  preprint:   ["repository",  "Springer Science and Business Media LLC"],  // publisher
  report:     ["institution", "Portland State University"],                // institution
  thesis:     ["university",  "จุฬาลงกรณ์มหาวิทยาลัย"],                        // institution
  book:       ["publisher",   "American Journal of Veterinary Medicine"],
};

const CASES = [
  ["conferencePaper", "10.21125/iceri.2016.0535", "proceedingsTitle"],
  ["bookSection",     "10.1007/bfb0086411",       "bookTitle"],
  ["book",            "10.5962/bhl.title.55633",  "publisher"],
  ["preprint",        "10.21203/rs.3.rs-4840802/v1", "repository"],
  ["thesis",          "10.58837/chula.the.2009.1", "university"],
  ["report",          "10.15760/etd.6294",         "institution"],
];

const CR_TITLE = {
  "10.21125/iceri.2016.0535": "EDUCATION BY ACCESS TO VISUAL INFORMATION – METHODOLOGY OF TEACHING AND LEARNING IN THE HIGHER EDUCATION",
  "10.1007/bfb0086411": "Spherical finite type submanifolds.Applications",
  "10.5962/bhl.title.55633": "Special veterinary therapy",
  "10.21203/rs.3.rs-4840802/v1": "Construct validity and reliability of the Thai version of the Patient Health Questionnaire",
  "10.58837/chula.the.2009.1": "การรับสารนิเทศด้านสุขภาพเกี่ยวกับโรคกระดูกพรุนของผู้สูงอายุ",
  "10.15760/etd.6294": "A study of the narrative skills in kindergarten children",
};

function applyDiffs(fields, diffs) {
  const out = { ...fields };
  let creators = null;
  for (const d of diffs) {
    if (d.kind === "field") out[d.field] = d.rawProposed;
    else if (d.kind === "creators") creators = d.rawProposed;
  }
  return [out, creators];
}

for (const [type, doi, expectField] of CASES) {
  console.log(`\n===== ${type} (${doi}) =====`);
  const seed = { title: CR_TITLE[doi], DOI: doi };
  const r1 = await verify(makeItem(type, seed, []));

  check("kayıt bulundu", r1.status === "ok", `→ ${r1.status}`);
  if (r1.status !== "ok") continue;
  check("DOI ile eşleşti", r1.via === "DOI", `→ ${r1.via}`);
  check("öğe tipi uyarısı yok", !r1.typeMismatch,
    `→ ${JSON.stringify(r1.typeMismatch)}`);

  const fields = r1.diffs.filter(d => d.kind === "field").map(d => d.field);
  check(`tipe özgü alan "${expectField}" önerildi`, fields.includes(expectField),
    `→ ${fields.join(", ")}`);
  if (EXPECT_VALUE[type]) {
    const [fname, val] = EXPECT_VALUE[type];
    const d = r1.diffs.find(x => x.field === fname);
    check(`${fname} değeri resmi çevirmenle aynı`, d && d.rawProposed === val,
      `→ "${d?.rawProposed}" (beklenen "${val}")`);
  }
  const journalOnly = fields.filter(f => ["journalAbbreviation","issue"].includes(f));
  check("makaleye özgü alanlar sızmadı", journalOnly.length === 0, `→ ${journalOnly}`);

  // Yakınsama: önerileri uygula, tekrar çalıştır — hiçbir çelişki kalmamalı
  const [f2, cr2] = applyDiffs(seed, r1.diffs);
  const auth2 = (cr2 || []).map(c => [c.lastName || c.name || "", c.firstName || ""]);
  check("boş yazar üretilmiyor", auth2.every(a => a[0].trim().length > 0),
    `→ ${JSON.stringify(auth2)}`);
  const r2 = await verify(makeItem(type, f2, auth2));
  const c2 = r2.diffs.filter(d => d.conflict);
  check("öneriler uygulanınca çelişki kalmıyor", c2.length === 0,
    `→ ${c2.map(d => `${d.field}:"${d.current}"→"${d.proposed}"`).join(" | ")}`);
  const g2 = r2.diffs.filter(d => !d.conflict);
  check("öneriler uygulanınca boşluk kalmıyor", g2.length === 0,
    `→ ${g2.map(d => d.field).join(", ")}`);
}

console.log("\n===== Unicode / Türkçe başlık regresyonu =====");
{
  const thai = await verify(makeItem("thesis", {
    title: CR_TITLE["10.58837/chula.the.2009.1"], DOI: "10.58837/chula.the.2009.1",
  }, []));
  check("Tayca başlık benzerliği 1.00 (a-z filtresi olsa 0 olurdu)",
    thai.titleScore > 0.99, `→ ${thai.titleScore?.toFixed(3)}`);

  const eq = (a, b) => globalThis.similarity(a, b);
  check("Şehir == Sehir", eq("Şehir Planlaması", "Sehir Planlamasi") > 0.99, `→ ${eq("Şehir Planlaması","Sehir Planlamasi").toFixed(3)}`);
  check("İstanbul == Istanbul", eq("İstanbul Üniversitesi", "Istanbul Universitesi") > 0.99);
  check("café == cafe", eq("café society", "cafe society") > 0.99);
  check("farklı Türkçe başlıklar hâlâ ayrışıyor",
    eq("Deprem sonrası barınma", "Sel sonrası tahliye") < 0.7, `→ ${eq("Deprem sonrası barınma","Sel sonrası tahliye").toFixed(3)}`);
}

console.log(`\n===== SONUÇ: ${stats.pass} geçti, ${stats.fail} kaldı =====`);
if (stats.fail) console.log("Kalanlar:\n - " + stats.failures.join("\n - "));
