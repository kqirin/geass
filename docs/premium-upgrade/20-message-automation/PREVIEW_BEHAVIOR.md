# Message Automation Preview Behavior

## Genel
Dashboard `Mesaj Otomasyonu` ekranında canlı önizleme Discord mesajına benzer şekilde gösterilir.

Önizleme parçaları:
- Bot adı: `GEASS`
- Düz mesaj içeriği
- Embed kartı (renkli sol çizgi)
- Embed başlık
- Embed açıklama
- Thumbnail (`thumbnailMode = user_avatar` ise)
- Büyük görsel (`imageUrl` varsa)
- Footer

## Değişken Çözümleme
Önizleme için örnek değerler:
- `{user_mention}` -> `@kirin`
- `{user_name}` -> `kirin`
- `{user_id}` -> `123456789012345678`
- `{server_name}` -> `geass ded.`
- `{server_id}` -> `999999999999999001`
- `{member_count}` -> `29`
- `{boost_count}` -> `8`
- `{date}` -> `17.04.2026`

## Fail-Safe Davranış
- Geçersiz veya boş görsel URL alanı preview'ı bozmaz, görsel bölümü gizlenir.
- Eksik alanlar güvenli varsayılan metinlerle gösterilir.
- Endpoint hatası olduğunda düzenleyici çökmez; kullanıcı hata metni ile birlikte güvenli draft görebilir.
