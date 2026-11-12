import type { HipcallConfig, HipcallRegion } from './types';

/**
 * Bölgeye göre Hipcall adresleri.
 *  - global: use.hipcall.com (İngilizce / uluslararası hesaplar)
 *  - tr:     use.hipcall.com.tr (Türkiye hesapları)
 */
export const REGION_ENDPOINTS: Record<
  HipcallRegion,
  Pick<HipcallConfig, 'authorizeUrl' | 'tokenUrl' | 'apiBaseUrl' | 'sipRealm' | 'wsUrl'>
> = {
  global: {
    authorizeUrl: 'https://use.hipcall.com/oauth/authorize',
    tokenUrl: 'https://use.hipcall.com/oauth/token',
    apiBaseUrl: 'https://use.hipcall.com/api/v3',
    sipRealm: 'sip.hipcall.com',
    wsUrl: 'wss://mgw.hipcall.com:8443',
  },
  tr: {
    authorizeUrl: 'https://use.hipcall.com.tr/oauth/authorize',
    tokenUrl: 'https://use.hipcall.com.tr/oauth/token',
    apiBaseUrl: 'https://use.hipcall.com.tr/api/v3',
    sipRealm: 'sip.hipcall.com.tr',
    wsUrl: 'wss://mgw.hipcall.com.tr:8443',
  },
};

export const DEFAULT_REGION: HipcallRegion = 'global';

export const DEFAULT_CONFIG: HipcallConfig = {
  region: DEFAULT_REGION,
  ...REGION_ENDPOINTS[DEFAULT_REGION],
  sipTokenEndpoint: '/sip/token',
  userId: undefined,
  sipCredentialsPaths: ['/sip/token', '/sip_credentials', '/me/sip_credentials'],
  clientId: '',
  redirectUri: '',
  scope: 'profile email offline_access contacts:read',
  state: 'hipcall_auth',
  storageKey: 'hipcall_sdk',
  usePKCE: true,
  registerExpires: 300,
  authMode: 'both',
  stunServers: ['stun:stun.l.google.com:19302'],
};

/**
 * Varsayılanları, seçilen bölgenin adreslerini ve kullanıcı ayarlarını birleştirir.
 * `undefined` verilen alanlar varsayılanı ezmez (örn. tanımsız bir ortam değişkeni).
 */
export function resolveConfig(config: Partial<HipcallConfig> = {}): HipcallConfig {
  const region = config.region ?? DEFAULT_REGION;
  if (!REGION_ENDPOINTS[region]) {
    throw new Error(`Geçersiz region: "${region}". "global" veya "tr" kullanın.`);
  }
  const defined = Object.fromEntries(
    Object.entries(config).filter(([, v]) => v !== undefined),
  ) as Partial<HipcallConfig>;
  return { ...DEFAULT_CONFIG, ...REGION_ENDPOINTS[region], ...defined, region };
}
