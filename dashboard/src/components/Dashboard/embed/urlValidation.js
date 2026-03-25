const INVALID_HTTP_URL_ERROR = 'Gecersiz URL. Lutfen http:// veya https:// ile baslayan bir adres girin.';
const MAX_URL_LEN = 512;

export function normalizeOptionalHttpUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return { ok: true, value: '', error: '' };
  }

  if (value.length > MAX_URL_LEN) {
    return { ok: false, value, error: `URL en fazla ${MAX_URL_LEN} karakter olabilir.` };
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, value, error: INVALID_HTTP_URL_ERROR };
    }
  } catch {
    return { ok: false, value, error: INVALID_HTTP_URL_ERROR };
  }

  return { ok: true, value, error: '' };
}

