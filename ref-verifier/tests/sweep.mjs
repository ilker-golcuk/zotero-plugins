import { verify, makeItem } from "./harness.mjs";
const all = await (await fetch("http://localhost:23119/api/users/0/items/top?limit=200")).json();
const items = all.filter(i => ["journalArticle","conferencePaper","bookSection","book","preprint","thesis","report"].includes(i.data.itemType));
const g = { wrong:[], incomplete:[], flagged:[], clean:[], uncertain:[], notfound:[] };
const optCount = {};
for (const it of items) {
  const f = it.data;
  const r = await verify(makeItem(f.itemType, f, (f.creators||[]).filter(c=>c.creatorType==="author").map(c=>[c.lastName||c.name||"",c.firstName||""])));
  if (r.status==="uncertain") { g.uncertain.push([f.key,f.title,r]); continue; }
  if (r.status==="notfound") { g.notfound.push([f.key,f.title,r]); continue; }
  for (const d of r.diffs) if (!d.conflict) optCount[d.label]=(optCount[d.label]||0)+1;
  const conf = r.diffs.some(d=>d.conflict), coreGap = r.diffs.some(d=>!d.conflict&&d.checked);
  if (conf) g.wrong.push([f.key,f.title,r]);
  else if (coreGap) g.incomplete.push([f.key,f.title,r]);
  else if (r.alerts.length||r.typeMismatch) g.flagged.push([f.key,f.title,r]);
  else g.clean.push([f.key,f.title,r]);
}
console.log(`TOPLAM ${items.length} kayıt — diyalogda görünecek gruplar:`);
for (const k of Object.keys(g)) console.log(`  ${k.padEnd(11)} ${g[k].length}`);
console.log("\nİşaretsiz (opsiyonel) satır dağılımı:", JSON.stringify(optCount));
console.log("\n--- YANLIŞ ALAN BULUNANLAR ---");
for (const [k,t,r] of g.wrong) {
  console.log(`[${k}] ${(t||"").slice(0,58)}`);
  for (const d of r.diffs.filter(x=>x.conflict))
    console.log(`     ${d.label}: "${String(d.current).slice(0,58)}" → "${String(d.proposed).slice(0,58)}"${d.agrees?" [OA✓]":""}`);
}
console.log("\n--- ÇEKİRDEK BOŞLUĞU OLANLAR (ilk 3) ---");
for (const [k,t,r] of g.incomplete.slice(0,3))
  console.log(`[${k}] ${(t||"").slice(0,50)} → ${r.diffs.filter(d=>!d.conflict&&d.checked).map(d=>d.label).join(", ")}`);
