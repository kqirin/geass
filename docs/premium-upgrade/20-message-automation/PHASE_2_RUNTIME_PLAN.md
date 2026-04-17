# Message Automation Phase 2 Runtime Plan

## Faz 2 Hedefi
Phase 1'de kaydedilen dashboard ayarlarını gerçek Discord event akışına bağlamak.

## Planlanan Event Entegrasyonu
- `guildMemberAdd` -> `welcome`
- `guildMemberRemove` -> `goodbye`
- `guildMemberUpdate` (boost değişimi) -> `boost`

## Çalışma Akışı
1. Guild scope ayarını yükle
2. İlgili modül `enabled` ise devam et
3. `channelId` doğrulaması yap
4. Düz mesaj ve embed şablonunu değişkenlerle resolve et
5. Kanal erişim/yetki kontrolü
6. Mesaj gönderim ve hata loglama

## Güvenlik ve Operasyon
- Event başına try/catch izolasyonu
- Rate limit ve duplicate event koruması
- Kanal bulunamaz veya erişim yoksa güvenli fallback log
- Runtime hataları panel davranışını etkilemez

## Phase 1 ile Sınır
Bu doküman plan niteliğindedir; Phase 1 kodu runtime mesaj gönderimi yapmaz.
