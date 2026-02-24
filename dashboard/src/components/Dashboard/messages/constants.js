export const MESSAGE_GROUPS = [
  {
    title: 'Genel Mesajlar',
    items: [
      { key: 'permissionDenied', label: 'Yetki Yok', desc: '', placeholder: 'bu komutu kullanamazsin, yetkin yok.' },
      { key: 'roleInsufficient', label: 'Yetersiz Rol', desc: '', placeholder: 'bu komut icin rolu yetmiyor.' },
      { key: 'roleNotConfigured', label: 'Rol Ayari Yok', desc: '', placeholder: 'bu komut icin gerekli rol ayari yapilmamis.' },
      { key: 'targetRoleHigher', label: 'Hedef Rolu Yuksek', desc: '', placeholder: 'hedef kullanicinin rolu senden yuksek.' },
      { key: 'limitReached', label: 'Limit Doldu', desc: '{limit}', placeholder: 'limit doldu. Saatlik limit: {limit}.' },
      { key: 'userNotFound', label: 'Kullanici Bulunamadi', desc: '{target}', placeholder: 'kullanici bulunamadi.' },
      { key: 'invalidUsage', label: 'Hatali Kullanim', desc: '{command}, {args}', placeholder: 'hatali kullanim. komutu dogru sekilde tekrar dene.' },
      { key: 'systemError', label: 'Sistem Hatasi', desc: '', placeholder: 'beklenmeyen bir hata olustu.' },
      { key: 'abuseLock', label: 'Yetki Askisi', desc: '{limit}', placeholder: 'asiri limit ihlali nedeniyle yetkin gecici olarak kaldirildi.' },
    ],
  },
];

export const MESSAGE_VARIABLE_HELP =
  '{target}, {reason}, {caseId}, {time}, {limit}, {amount}, {user}, {guild}, {channel}, {command}, {prefix}, {args}';

