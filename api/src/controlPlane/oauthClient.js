const OAUTH_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const OAUTH_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const OAUTH_USER_URL = 'https://discord.com/api/users/@me';
const OAUTH_USER_GUILDS_URL = 'https://discord.com/api/users/@me/guilds';

class OauthClientError extends Error {
  constructor(message, { code = 'oauth_error', statusCode = 502 } = {}) {
    super(message);
    this.name = 'OauthClientError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function toSafeFetch(fetchImpl) {
  if (typeof fetchImpl === 'function') return fetchImpl;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  return null;
}

function isConfiguredOauthClient({ clientId, clientSecret, redirectUri } = {}) {
  return Boolean(String(clientId || '').trim() && String(clientSecret || '').trim() && String(redirectUri || '').trim());
}

function createDiscordOauthClient({
  clientId = '',
  clientSecret = '',
  redirectUri = '',
  scope = 'identify',
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedClientId = String(clientId || '').trim();
  const normalizedClientSecret = String(clientSecret || '').trim();
  const normalizedRedirectUri = String(redirectUri || '').trim();
  const normalizedScope = String(scope || 'identify').trim() || 'identify';
  const fetchSafe = toSafeFetch(fetchImpl);
  const configured = isConfiguredOauthClient({
    clientId: normalizedClientId,
    clientSecret: normalizedClientSecret,
    redirectUri: normalizedRedirectUri,
  });

  function assertConfigured() {
    if (!configured) {
      throw new OauthClientError('OAuth client is not configured.', {
        code: 'oauth_not_configured',
        statusCode: 503,
      });
    }
    if (!fetchSafe) {
      throw new OauthClientError('Fetch is not available for OAuth requests.', {
        code: 'oauth_fetch_unavailable',
        statusCode: 500,
      });
    }
  }

  function buildAuthorizeUrl({ state = '' } = {}) {
    assertConfigured();
    const normalizedState = String(state || '').trim();
    if (!normalizedState) {
      throw new OauthClientError('OAuth state is required.', {
        code: 'oauth_state_required',
        statusCode: 400,
      });
    }

    const url = new URL(OAUTH_AUTHORIZE_URL);
    url.searchParams.set('client_id', normalizedClientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', normalizedRedirectUri);
    url.searchParams.set('scope', normalizedScope);
    url.searchParams.set('state', normalizedState);
    return url.toString();
  }

  async function exchangeCodeForToken({ code = '' } = {}) {
    assertConfigured();
    const normalizedCode = String(code || '').trim();
    if (!normalizedCode) {
      throw new OauthClientError('OAuth code is required.', {
        code: 'oauth_code_required',
        statusCode: 400,
      });
    }

    const body = new URLSearchParams();
    body.set('client_id', normalizedClientId);
    body.set('client_secret', normalizedClientSecret);
    body.set('grant_type', 'authorization_code');
    body.set('code', normalizedCode);
    body.set('redirect_uri', normalizedRedirectUri);

    let response;
    try {
      response = await fetchSafe(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
    } catch {
      throw new OauthClientError('OAuth token request failed.', {
        code: 'oauth_token_request_failed',
        statusCode: 502,
      });
    }

    let tokenPayload = {};
    try {
      tokenPayload = await response.json();
    } catch {
      throw new OauthClientError('OAuth token response is not valid JSON.', {
        code: 'oauth_token_response_invalid',
        statusCode: 502,
      });
    }

    if (!response.ok) {
      throw new OauthClientError('OAuth token endpoint returned an error.', {
        code: 'oauth_token_exchange_failed',
        statusCode: response.status >= 400 && response.status < 600 ? response.status : 502,
      });
    }

    const accessToken = String(tokenPayload?.access_token || '').trim();
    if (!accessToken) {
      throw new OauthClientError('OAuth token response missing access token.', {
        code: 'oauth_token_missing',
        statusCode: 502,
      });
    }

    return {
      accessToken,
      tokenType: String(tokenPayload?.token_type || 'Bearer'),
      scope: String(tokenPayload?.scope || normalizedScope),
    };
  }

  async function fetchUserIdentity({ accessToken = '' } = {}) {
    assertConfigured();
    const normalizedAccessToken = String(accessToken || '').trim();
    if (!normalizedAccessToken) {
      throw new OauthClientError('OAuth access token is required.', {
        code: 'oauth_access_token_required',
        statusCode: 500,
      });
    }

    let response;
    try {
      response = await fetchSafe(OAUTH_USER_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${normalizedAccessToken}`,
        },
      });
    } catch {
      throw new OauthClientError('OAuth user identity request failed.', {
        code: 'oauth_identity_request_failed',
        statusCode: 502,
      });
    }

    let userPayload = {};
    try {
      userPayload = await response.json();
    } catch {
      throw new OauthClientError('OAuth identity response is not valid JSON.', {
        code: 'oauth_identity_response_invalid',
        statusCode: 502,
      });
    }

    if (!response.ok) {
      throw new OauthClientError('OAuth identity endpoint returned an error.', {
        code: 'oauth_identity_failed',
        statusCode: response.status >= 400 && response.status < 600 ? response.status : 502,
      });
    }

    const id = String(userPayload?.id || '').trim();
    if (!id) {
      throw new OauthClientError('OAuth identity response missing user id.', {
        code: 'oauth_identity_missing',
        statusCode: 502,
      });
    }

    return {
      id,
      username: String(userPayload?.username || '').trim() || null,
      globalName: String(userPayload?.global_name || '').trim() || null,
      avatar: String(userPayload?.avatar || '').trim() || null,
    };
  }

  async function fetchUserGuilds({ accessToken = '' } = {}) {
    assertConfigured();
    const normalizedAccessToken = String(accessToken || '').trim();
    if (!normalizedAccessToken) {
      throw new OauthClientError('OAuth access token is required.', {
        code: 'oauth_access_token_required',
        statusCode: 500,
      });
    }

    let response;
    try {
      response = await fetchSafe(OAUTH_USER_GUILDS_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${normalizedAccessToken}`,
        },
      });
    } catch {
      throw new OauthClientError('OAuth guild membership request failed.', {
        code: 'oauth_guilds_request_failed',
        statusCode: 502,
      });
    }

    let guildPayload = [];
    try {
      guildPayload = await response.json();
    } catch {
      throw new OauthClientError('OAuth guild membership response is not valid JSON.', {
        code: 'oauth_guilds_response_invalid',
        statusCode: 502,
      });
    }

    if (!response.ok) {
      throw new OauthClientError('OAuth guild membership endpoint returned an error.', {
        code: 'oauth_guilds_failed',
        statusCode: response.status >= 400 && response.status < 600 ? response.status : 502,
      });
    }

    const guilds = Array.isArray(guildPayload)
      ? guildPayload
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const id = String(entry.id || '').trim();
            if (!id) return null;
            return {
              id,
              name: String(entry.name || '').trim() || null,
              icon: String(entry.icon || '').trim() || null,
              owner: entry.owner === true,
              permissions: String(entry.permissions || entry.permissions_new || '').trim() || '0',
            };
          })
          .filter(Boolean)
      : [];

    return guilds;
  }

  return {
    buildAuthorizeUrl,
    configured,
    exchangeCodeForToken,
    fetchUserGuilds,
    fetchUserIdentity,
  };
}

module.exports = {
  createDiscordOauthClient,
  isConfiguredOauthClient,
  OauthClientError,
};
