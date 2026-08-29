# Reference Verifier (Zotero 10 eklentisi)

Seçili kayıtları **alan alan** Crossref ile karşılaştırır, **OpenAlex** ile ikinci
teyit alır ve yalnızca onayladığın farkları yazar.

## Kurulum
`Tools → Plugins` → dişli → `Install Plugin From File…` → `ref-verifier.xpi`

## Kullanım
Kayıtları seç → sağ tık → **Verify Metadata (Crossref)**
(Zotero arayüzü Türkçeyse *Künyeyi doğrula (Crossref)*).

## Desteklenen öğe tipleri
Makale, **konferans bildirisi**, **kitap bölümü**, **kitap**, **preprint**,
**tez** ve **rapor**. Alanlar Zotero'nun base-field eşlemesiyle tipe göre çözülür:

| Crossref | journalArticle | conferencePaper | bookSection | book | preprint | thesis | report |
|---|---|---|---|---|---|---|---|
| container-title | publicationTitle | proceedingsTitle | bookTitle | — | — | — | — |
| publisher | publisher | publisher | publisher | publisher | **repository** | publisher¹ | publisher¹ |
| institution | — | — | — | — | — | **university**¹ | **institution**¹ |
| issue | issue | issue | — | — | — | — | — |
| ISBN | — | ISBN | ISBN | ISBN | — | ISBN | ISBN |

¹ Zotero'nun resmi Crossref çevirmeniyle aynı davranış: tez ve raporda Crossref'in
`institution` alanı `publisher`'ı ezer (US Geological Survey, Portland State
University); **preprint'te ezmez** — `repository` alanına yayıncı yazılır
(bioRxiv için "Cold Spring Harbor Laboratory", Research Square için "Springer
Science and Business Media LLC"). Bu dört eşleme teste bağlandı.

O tipte bulunmayan alan hiç sorulmaz — kitaba `issue`, preprint'e `journalAbbreviation`
önerilmez. Kitapta `container-title` bilerek atlanır: Crossref orada seri adını
döndürür, kitap adını değil.

## Kontrol edilen alanlar
Başlık, konteyner (dergi / bildiri kitabı / kitap adı), volume, issue, sayfa,
tarih, DOI, yayıncı, yer, ISBN, ISSN, dergi kısaltması, dil, öz ve **yazar listesi**.

Alanlar Zotero'nun *base field* eşlemesiyle çözülür: `publicationTitle` bir
konferans bildirisinde `proceedingsTitle`, kitap bölümünde `bookTitle` olur.
Öğe tipinde bulunmayan alan atlanır.

Her alan iki yönde bakılır:
- **yanlış** — Zotero'daki değer kaynakla çelişiyor → kırmızı grup, varsayılan işaretli
- **eksik** — Zotero boş, kaynakta değer var → `missing` etiketi; sadece o öğe tipi
  için çekirdek sayılan alanlarda varsayılan işaretli

Ayrıca: **geri çekilme / düzeltme uyarıları** (Crossref'in Retraction Watch verisi),
**çözülmeyen DOI**, ve **öğe tipi uyuşmazlığı** (bildiri kitabı makale olarak
kaydedilmiş gibi) raporlanır.

## Yanlış eşleşmeye karşı koruma
DOI yoksa eşleşmeyi yalnızca başlık garanti eder. Aynı ekibin benzer başlıklı
farklı makaleleri aldatıcı derecede yüksek puan aldığı için:
- ham başlık benzerliği **≥ 0.92** → kabul edilir
- **0.84 – 0.92** → "uncertain": aday gösterilir ama **hiçbir değişiklik önerilmez**
- altı → "bulunamadı"

Yazar adı aramada sadece sıralama sinyalidir, filtre değildir (Zotero'daki yazar
hatalıysa aramayı bozmasın diye) ve kabul eşiğine etki etmez.

## Bilerek verilmiş kararlar
- **Tarih:** Crossref'in `issued`, `published-print`, `published-online` ve
  `journal-issue` tarihlerinin *hepsi* geçerli sayılır. Online-first bir makalenin
  2020 online / 2021 sayı tarihi olması hata değildir; ikisi de kabul edilir.
- **ISSN/ISBN:** küme olarak karşılaştırılır. Zotero "basılı, elektronik" ikisini
  birden tutar; herhangi biri tutuyorsa eşleşmiş sayılır.
- **Yazarlar:** yalnızca soyadlar karşılaştırılır — Crossref'in "AJ" biçimi ile
  Zotero'nun "A. J." biçimi arasındaki fark hata değildir. Soyadlar tutmuyorsa satır
  **varsayılan işaretsiz** gelir, çünkü uygulanması tüm yazar listesini değiştirir.
  Soyadlar tutuyor ama ad boşsa, adları doldurma önerisi işaretli gelir.
- **Öz:** yalnızca boşsa önerilir, asla "yanlış" denmez.
- **Öğe tipi:** sadece uyarılır, otomatik değiştirilmez (tip değişimi tüm alan
  kümesini yeniden yazar).
- **Depo/üniversite/kurum:** tez ve raporda Crossref `institution` tercih edilir,
  preprint'te `publisher` — Zotero'nun kendi çevirmeninin yaptığı ayrım.
- **Kitapta seri adı:** Crossref `container-title` bir kitapta seri adını verir;
  bu alan şimdilik hiç önerilmiyor (resmi çevirmen onu `series`'e yazar).
- **Unicode:** başlık karşılaştırması Türkçe, Tayca, Kiril ve CJK için doğru çalışır;
  aksanlar ayrıştırılıp düşürülür ("Şehir" = "Sehir", "İstanbul" = "Istanbul").
- **Boş yazar üretilmez:** Crossref'te adı eksik olan kayıtlar atlanır.

## Test durumu
**136 test geçiyor:**
- 79 birim testi — alan bozma matrisi, normalizasyon regresyonları (tire/ISSN/dil/
  büyük harf/noktalama), yazar senaryoları, kırık DOI, geri çekilme, uydurma referans
- 57 tip testi — 6 öğe tipinin her biri için gerçek Crossref kayıtlarıyla canlı
  doğrulama, tipe özgü alan eşlemesi, **yakınsama** (öneriler uygulandıktan sonra
  ikinci çalıştırmada hiçbir fark kalmamalı), Unicode/Türkçe başlık regresyonu ve
  depo/üniversite/kurum eşlemesinin resmi çevirmenle birebir uyumu

Kütüphanenin 95 gerçek kaydında yapılan taramada: 90 temiz, 2 gerçek bulgu,
1 belirsiz, 2 bulunamadı — **0 yanlış alarm**.

## Dosyalar
| Dosya | Ne işe yarar |
|---|---|
| `bootstrap.js` | Eklentinin tamamı (JavaScript, derleme adımı yok) |
| `manifest.json` | Sürüm ve Zotero uyumluluk bilgisi |
| `tests/` | 136 test + kütüphane tarayıcı — bkz. `tests/README.md` |

Değişiklik yaptıktan sonra yeniden paketlemek için, bu klasörün içinden:

```bash
zip -qr ../ref-verifier.xpi manifest.json bootstrap.js
```

Sürüm numarasını `manifest.json` içinde artırmayı unutma; Zotero aynı sürümün
üstüne kurmakta zorlanabiliyor.

## Not
`manifest.json` içindeki `update_url` Zotero tarafından zorunlu tutuluyor; gerçek
bir güncelleme sunucusu olmadığı için yer tutucu bir adres var. Otomatik güncelleme
kontrolü sessizce başarısız olur, çalışmayı etkilemez.
