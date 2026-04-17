# Message Automation - Phase 1 Plan

## Amaç
Dashboard üzerinden yönetilebilen Mesaj Otomasyonu ayarlarını eklemek:
- Hoş Geldin Mesajı
- Hoşça Kal Mesajı
- Boost Mesajı

Bu fazda sadece ayar yönetimi + önizleme vardır. Discord runtime event gönderimi yoktur.

## Kapsam
- Korumalı API endpointleri:
  - `GET /api/dashboard/protected/message-automation`
  - `PUT /api/dashboard/protected/message-automation`
- Guild scope tabanlı ayar saklama
- Dashboard sekmesi: `Mesaj Otomasyonu`
- Canlı Discord tarzı önizleme
- Değişken çözümleme:
  - `{user_mention}`, `{user_name}`, `{user_id}`, `{server_name}`, `{server_id}`, `{member_count}`, `{boost_count}`, `{date}`

## Güvenlik ve Doğrulama
- Bilinmeyen modül ve alanlar reddedilir
- Tip kontrolleri zorunlu
- `channelId` snowflake-benzeri numeric format
- `color` yalnızca `#RRGGBB`
- `imageUrl` yalnızca `http/https`
- Uzun metinlerde güvenli uzunluk limiti

## Faz Dışı
- `guildMemberAdd`, `guildMemberRemove`, `guildMemberUpdate` listener entegrasyonu
- Bot runtime mesaj gönderimi
- Dosya yükleme
