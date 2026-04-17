# Message Automation API Contract

## Endpointler

### GET `/api/dashboard/protected/message-automation`
Guild scope için mevcut mesaj otomasyonu ayarlarını döner.

Başarılı yanıt:
```json
{
  "contractVersion": 1,
  "guildId": "999999999999999001",
  "settings": {
    "welcome": {
      "enabled": false,
      "channelId": null,
      "plainMessage": "Hoş geldin {user_mention}",
      "embed": {
        "enabled": true,
        "title": "Yeni Üye",
        "description": "Sunucumuza hoş geldin, {user_mention}!",
        "color": "#7c3aed",
        "imageUrl": null,
        "thumbnailMode": "user_avatar",
        "footer": "{server_name}"
      }
    },
    "goodbye": {
      "enabled": false,
      "channelId": null,
      "plainMessage": "Güle güle {user_name}",
      "embed": {
        "enabled": true,
        "title": "Üye Ayrıldı",
        "description": "{user_name} sunucudan ayrıldı.",
        "color": "#ef4444",
        "imageUrl": null,
        "thumbnailMode": "user_avatar",
        "footer": "{server_name}"
      }
    },
    "boost": {
      "enabled": false,
      "channelId": null,
      "plainMessage": "{user_mention} sunucuyu boostladı!",
      "embed": {
        "enabled": true,
        "title": "Sunucu Boostlandı",
        "description": "Teşekkürler, {user_mention}!",
        "color": "#cc97ff",
        "imageUrl": null,
        "thumbnailMode": "user_avatar",
        "footer": "{server_name}"
      }
    }
  },
  "updatedAt": null
}
```

### PUT `/api/dashboard/protected/message-automation`
Modül bazlı patch alır. En az bir modül ve en az bir alan içermelidir.

Örnek istek:
```json
{
  "settings": {
    "welcome": {
      "enabled": true,
      "channelId": "123456789012345678",
      "embed": {
        "title": "Yeni Üye"
      }
    }
  }
}
```

Başarılı yanıt:
```json
{
  "contractVersion": 1,
  "guildId": "999999999999999001",
  "settings": {},
  "updatedAt": "2026-04-17T10:30:00.000Z",
  "mutation": {
    "type": "message_automation_settings_upsert",
    "applied": true,
    "duplicate": false
  }
}
```

## Doğrulama Kuralları
- `enabled`: `boolean`
- `channelId`: `null` veya snowflake-benzeri string
- `plainMessage`: `string` (max 2000)
- `embed.enabled`: `boolean`
- `embed.title`: `string` (max 256)
- `embed.description`: `string` (max 4096)
- `embed.color`: `#RRGGBB`
- `embed.imageUrl`: `null` veya `http/https` URL
- `embed.thumbnailMode`: `"none"` veya `"user_avatar"`
- `embed.footer`: `string` (max 2048)
- Bilinmeyen modül/alan reddedilir

## Hata Davranışı
- `400` invalid body/field/type/enum
- `401` unauthenticated
- `403` guild access denied
- `413` payload too large
- `415` unsupported media type
- `503` auth disabled veya auth not configured (global boundary davranışı)
