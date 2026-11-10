import type { HipcallConfig, SipCredentials, TokenSet } from './types';

/** OAuth2 (Authorization Code) + SIP credentials çekme + token saklama */
export class OAuthModule {
  constructor(private cfg: HipcallConfig) {}

  // ---------- storage ----------
  private get tokenKey() {
    return `${this.cfg.storageKey}:tokens`;
  }
  loadTokens(): TokenSet | null {
    try {
      const raw = localStorage.getItem(this.tokenKey);
      return raw ? (JSON.parse(raw) as TokenSet) : null;
    } catch {
      return null;
    }
  }
  saveTokens(t: TokenSet) {
    localStorage.setItem(this.tokenKey, JSON.stringify(t));
  }
  clearTokens() {
    localStorage.removeItem(this.tokenKey);
  }

  // ---------- authorize ----------
  buildAuthorizeUrl(): string {
    const u = new URL(this.cfg.authorizeUrl);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', this.cfg.clientId);
    u.searchParams.set('redirect_uri', this.cfg.redirectUri);
    u.searchParams.set('scope', this.cfg.scope);
    u.searchParams.set('state', this.cfg.state);
    return u.toString();
  }

  // ---------- token ----------
  private async postToken(params: Record<string, string>): Promise<TokenSet> {
    const body = new URLSearchParams({ client_id: this.cfg.clientId, ...params });
    // clientSecret yalnızca (güvensiz) doğrudan çağrı için; proxy kullanılıyorsa sunucu ekler.
    if (this.cfg.clientSecret) body.set('client_secret', this.cfg.clientSecret);
    const res = await fetch(this.cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
    const text = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* json değil */
    }
    if (!res.ok || !json.access_token) {
      throw new Error(`Token isteği başarısız (${res.status}): ${json.error_description || json.error || text.slice(0, 200)}`);
    }
    return { ...json, obtained_at: Date.now() } as TokenSet;
  }

  async exchangeCode(code: string): Promise<TokenSet> {
    const t = await this.postToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.cfg.redirectUri,
    });
    this.saveTokens(t);
    return t;
  }

  async refresh(): Promise<TokenSet> {
    const cur = this.loadTokens();
    if (!cur?.refresh_token) throw new Error('refresh_token yok');
    const t = await this.postToken({ grant_type: 'refresh_token', refresh_token: cur.refresh_token });
    if (!t.refresh_token) t.refresh_token = cur.refresh_token;
    this.saveTokens(t);
    return t;
  }

  isExpired(t: TokenSet): boolean {
    return !!t.expires_in && Date.now() > t.obtained_at + (t.expires_in - 30) * 1000;
  }

  // ---------- SIP token & credentials ----------
  /**
   * Hipcall API v3: GET /api/v3/profile
   * Kullanıcının kendi profil ve ID bilgilerini çeker.
   */
  async fetchProfile(accessToken: string, log?: (m: string) => void): Promise<any> {
    const base = this.cfg.apiBaseUrl.replace(/\/$/, '');
    const url = `${base}/profile`;
    log?.(`GET ${url} (Kullanıcı profili sorgulanıyor...)`);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json, application/vnd.api+json, */*',
      },
    });
    const text = await res.text();
    log?.(`Profile Yanıtı (${res.status}): ${text.slice(0, 300)}`);
    if (!res.ok) {
      throw new Error(`Profile alınamadı (${res.status}): ${text.slice(0, 150)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Profile yanıtı JSON değil: ' + text.slice(0, 150));
    }
  }

  /**
   * Hipcall API v3: POST /api/v3/sip/token
   * Header: Authorization: Bearer <oauth_access_token>
   * Body: { "user_id": <userId> } veya {}
   */
  async fetchSipToken(
    accessToken: string,
    userId?: number | string,
    log?: (m: string) => void,
  ): Promise<SipCredentials> {
    const base = this.cfg.apiBaseUrl.replace(/\/$/, '');
    const ep = this.cfg.sipTokenEndpoint || '/sip/token';
    const url = base + (ep.startsWith('/') ? ep : '/' + ep);
    const hasUserId = userId != null && String(userId).trim() !== '';
    const parsedUserId = hasUserId ? (!isNaN(Number(userId)) ? Number(userId) : userId) : undefined;
    const bodyObj = parsedUserId !== undefined ? { user_id: parsedUserId } : {};
    const bodyStr = JSON.stringify(bodyObj);

    log?.(`POST ${url} ${bodyStr}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, application/vnd.api+json, */*',
      },
      body: bodyStr,
    });

    const text = await res.text();
    log?.(`SIP Token Yanıtı (${res.status}): ${text.slice(0, 300)}`);

    if (!res.ok) {
      throw new Error(`SIP Token alınamadı (${res.status}): ${text.slice(0, 200)}`);
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('SIP token yanıtı JSON formatında değil: ' + text.slice(0, 200));
    }

    return normalizeCredentials(json, this.cfg.wsUrl, {
      fallbackUsername: parsedUserId !== undefined ? String(parsedUserId) : undefined,
      fallbackRealm: this.cfg.sipRealm || 'sip.hipcall.com.tr',
    });
  }

  async fetchSipCredentials(
    accessToken: string,
    userId?: number | string,
    log?: (m: string) => void,
  ): Promise<SipCredentials> {
    let currentId = userId ?? this.cfg.userId;

    // 1) Eğer bir ID belirtilmişse önce onu dene:
    if (currentId != null && String(currentId).trim() !== '') {
      try {
        return await this.fetchSipToken(accessToken, currentId, log);
      } catch (err: any) {
        log?.(`Belirtilen user_id (${currentId}) ile SIP token alınamadı: ${err.message}`);

        // Hipcall 403: "You don't have permission to generate tokens for other users"
        // Bu durumda kullanıcının kendi gerçek ID'sini /profile endpoint'inden otomatik öğrenip tekrar deneriz!
        const msg = String(err.message).toLowerCase();
        if (msg.includes('other users') || msg.includes('permission_denied') || msg.includes('403')) {
          log?.(`Kendi profilinizdeki gerçek ID sorgulanıyor (GET /profile)...`);
          try {
            const profile = await this.fetchProfile(accessToken, log);
            const myRealId =
              profile?.id ??
              profile?.data?.id ??
              profile?.user?.id ??
              profile?.user_id;

            if (myRealId && String(myRealId) !== String(currentId)) {
              log?.(`Kendi gerçek kullanıcı ID'niz bulundu: ${myRealId}. Bununla SIP Token alınıyor...`);
              return await this.fetchSipToken(accessToken, myRealId, log);
            }
          } catch (pErr: any) {
            log?.(`Profil otomatik sorgulanamadı: ${pErr.message}`);
          }
        }
      }
    } else {
      // 2) Eğer ID hiç verilmemişse, doğrudan profilden almayı dene:
      try {
        log?.(`Kullanıcı ID girilmedi, profilden sorgulanıyor...`);
        const profile = await this.fetchProfile(accessToken, log);
        const myRealId =
          profile?.id ??
          profile?.data?.id ??
          profile?.user?.id ??
          profile?.user_id;
        if (myRealId) {
          log?.(`Profil ID'si: ${myRealId}. SIP Token isteniyor...`);
          return await this.fetchSipToken(accessToken, myRealId, log);
        }
      } catch (e: any) {
        log?.(`Profil sorgulanamadı: ${e.message}`);
      }
    }

    // 3) Parametresiz ({}) POST dene
    try {
      log?.(`Gövdesiz POST /sip/token deneniyor...`);
      return await this.fetchSipToken(accessToken, undefined, log);
    } catch {
      // devam et
    }

    // 4) Fallback: eski/diğer yollar
    const base = this.cfg.apiBaseUrl.replace(/\/$/, '');
    let lastErr = '';
    const paths = this.cfg.sipCredentialsPaths || ['/sip_credentials', '/me/sip_credentials'];
    for (const path of paths) {
      if (path === '/sip/token') continue;
      const url = base + (path.startsWith('/') ? path : '/' + path);
      log?.(`GET ${url}`);
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json, application/vnd.api+json, */*',
        },
      });
      const text = await res.text();
      log?.(`Yanıt (${res.status}): ${text.slice(0, 150)}`);
      if (res.ok) {
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error('SIP credentials JSON değil: ' + text.slice(0, 200));
        }
        log?.(`SIP credentials verisi: ${text.slice(0, 500)}`);
        return normalizeCredentials(json, this.cfg.wsUrl, {
          fallbackUsername: currentId ? String(currentId) : undefined,
          fallbackRealm: this.cfg.sipRealm,
        });
      }
      lastErr = `${res.status} ${text.slice(0, 200)}`;
      if (res.status === 401) throw new Error('401 Unauthorized: ' + lastErr);
    }
    throw new Error('SIP credentials alınamadı: ' + lastErr);
  }
}

export function extractUserIdFromToken(token: string): number | string | undefined {
  try {
    const parts = token.split('.');
    if (parts.length >= 2) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.user_id ?? payload.sub ?? payload.uid ?? payload.id;
    }
  } catch {}
  return undefined;
}

const pick = (o: any, keys: string[]): string | undefined => {
  for (const k of keys) {
    if (o && (typeof o[k] === 'string' || typeof o[k] === 'number') && o[k]) {
      return String(o[k]);
    }
  }
  return undefined;
};

/** Farklı yanıt şekillerini (data/sip/credentials/token sarmalayıcıları) tek tipe çevirir. */
export function normalizeCredentials(
  json: any,
  defaultWs: string,
  fallbacks?: { fallbackUsername?: string; fallbackRealm?: string },
): SipCredentials {
  let o = json;
  for (const k of ['data', 'sip_credentials', 'sip', 'credentials', 'attributes']) {
    if (o && typeof o[k] === 'object' && !Array.isArray(o[k])) o = o[k];
  }
  if (Array.isArray(o)) o = o[0];
  const username =
    pick(o, ['sip_username', 'username', 'extension', 'user', 'number', 'sip_user', 'user_id']) ||
    fallbacks?.fallbackUsername;
  const realm =
    pick(o, ['realm', 'domain', 'sip_domain', 'sip_realm', 'host', 'sip_server', 'server']) ||
    fallbacks?.fallbackRealm ||
    'sip.hipcall.com.tr';
  const sipToken = pick(o, ['token', 'sip_token', 'jwt', 'password', 'sip_password', 'access_token']);
  const ws = pick(o, ['wss_url', 'ws_url', 'websocket_url', 'ws_server', 'wss', 'websocket']);

  if (!sipToken) {
    throw new Error(
      `SIP yanıtında token bulunamadı. Yanıt: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  if (!username) {
    throw new Error(
      `SIP kullanıcı adı/dahili bulunamadı. Yanıt: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }

  return {
    username,
    realm,
    sipToken,
    sipUri: pick(o, ['sip_uri', 'uri']) || `sip:${username}@${realm}`,
    wsServers: [ws || defaultWs],
    displayName: pick(o, ['display_name', 'name']),
  };
}

