# Testler

Hepsi Node ile çalışır, ek bağımlılık yok:

```bash
node suite.mjs        # 79 birim testi
node types-suite.mjs  # 57 öğe tipi + Unicode testi
node map.mjs          # base-field eşleme haritası (tablo basar)
node sweep.mjs        # Zotero kütüphaneni gerçek veriyle tarar (Zotero açık olmalı)
```

`harness.mjs` doğrudan `../bootstrap.js` dosyasını okur — yani testler eklentinin
gerçek kodunu çalıştırır, kopyasını değil. Alan geçerliliği için şemayı **kurulu
Zotero'dan** çıkarır (`omni.ja` içinden `schema.json`), böylece Zotero sürüm
atladığında testler de onunla birlikte güncellenir. Zotero bulunamazsa
`zotero-schema-fallback.json` kullanılır ve uyarı basar.

`http-cache.json` ilk çalıştırmada oluşur; Crossref/OpenAlex yanıtlarını saklar,
sonraki çalıştırmalar ağa çıkmaz. **Silinebilir** — hatta ara sıra silmek iyidir,
yoksa yayıncıların sonradan düzelttiği künyeleri göremezsin.

`sweep.mjs` yazma yapmaz, sadece rapor basar.
