# PDF Exporter (Zotero 10 eklentisi)

Seçili kayıtların PDF'lerini istediğin klasöre kopyalar — tek kayıt da olur,
toplu seçim de.

## Kurulum
`Tools → Plugins` → dişli → `Install Plugin From File…` → `pdf-exporter.xpi`

## Kullanım
Kayıtları seç → sağ tık → **Export PDFs to Folder…**
(Zotero arayüzü Türkçeyse *PDF'leri klasöre aktar…*) → klasörü seç.

## Ne yapar
- Üst kayıt seçersen altındaki PDF eklerini bulur; doğrudan PDF ekini de seçebilirsin.
  Hem üst kaydı hem onun PDF'ini seçersen dosya bir kez kopyalanır.
- PDF olmayan ekler (EPUB, snapshot, bağlantı) atlanır.
- **Dosyayı olduğu gibi kopyalar.** Adı değiştirmez: diskte hangi adla
  duruyorsa (Better BibTeX citation key ile adlandırdıysan o adla) klasöre
  aynı adla düşer. Uzantı da olduğu gibi kalır.
- Aynı ada sahip dosya varsa `(2)`, `(3)` diye numaralanır — **hiçbir dosyanın
  üzerine yazmaz**, klasörde zaten var olanların da üzerine yazmaz.

## Notlar (annotations) hakkında — bilmen gereken tek şey
Zotero, senin vurgu ve notlarını PDF dosyasının **içinde değil**, kendi
veritabanında tutar. Eklenti dosyayı birebir kopyaladığı için, Zotero içinde
yaptığın vurgular kopyada **görünmez**. Kopya, dosyanın orijinal hâlidir.

Bu çoğu durumda istenen davranıştır (paylaşırken kendi notların gitmez).
Notların da PDF'e işlenmesini istersen `bootstrap.js` başındaki tek satırı
değiştir ve yeniden paketle:

```js
const INCLUDE_ANNOTATIONS = true;
```

O zaman notu olan dosyalar Zotero'nun kendi PDF worker'ından geçer ve notlar
PDF'e çizilerek yazılır. Dosya adı iki durumda da değişmez.

## Atlananlar
İşi bitince, PDF'i olmayan kayıtlar ve diskte dosyası bulunamayan ekler tek bir
pencerede listelenir. Her şey yolunda giderse bu pencere hiç açılmaz.

## Neden eklenti gerekiyor
Zotero'nun kendi kodunda `ZoteroPane.exportSelectedFiles()` diye çok benzer bir
fonksiyon var (`zoteroPane.js:6567`, "TEMP: Quick implementation" notuyla), ama
bağlı olduğu menü öğesi `hidden="true"` — yani kullanıcıya açılmamış. Ayrıca sadece
File menüsünde olurdu, sağ tık menüsünde değil.

## Test
```bash
node tests/suite.mjs   # 24 test
```
Testler `../bootstrap.js` dosyasını doğrudan okur; PDF toplama, adlandırma,
çakışma numaralandırması ve dışa aktarma yollarını geçici bir klasörde gerçek
dosyalarla dener.

## Not
`manifest.json` içindeki `update_url` Zotero tarafından zorunlu tutuluyor; gerçek
bir güncelleme sunucusu olmadığı için yer tutucu adres var.
