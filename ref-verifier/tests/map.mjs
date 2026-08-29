import { makeItem } from "./harness.mjs";
const BASES = ["title","publicationTitle","volume","issue","pages","date","DOI",
               "publisher","place","ISBN","ISSN","journalAbbreviation","language","abstractNote"];
const TYPES = ["journalArticle","conferencePaper","bookSection","book","preprint","thesis","report"];
console.log("base field".padEnd(20) + TYPES.map(t=>t.slice(0,13).padEnd(15)).join(""));
console.log("-".repeat(20 + TYPES.length*15));
for (const b of BASES) {
  const row = TYPES.map(t => {
    const r = globalThis.resolveField({ itemTypeID: t }, b);
    return (r === b ? "✓" : r ? "→" + r.slice(0,13) : "—").padEnd(15);
  });
  console.log(b.padEnd(20) + row.join(""));
}
