/** Hipcall sunucu bölgesi: global = use.hipcall.com, tr = use.hipcall.com.tr */
export type HipcallRegion = 'global' | 'tr';

export interface HipcallConfig {
  /**
   * Hangi Hipcall sunucularının kullanılacağı (varsayılan: 'global').
   * Adres alanlarını (authorizeUrl, tokenUrl, apiBaseUrl, sipRealm, wsUrl) ayrıca verirseniz onlar geçerli olur.
   */
  region?: HipcallRegion;
  authorizeUrl: string;
  /** Token endpoint. Tarayıcıdan CORS sorunu olursa proxy yolu (örn. /hipcall-oauth/token) verin. */
  tokenUrl: string;
  apiBaseUrl: string;
  /** SIP Token endpoint yolu (varsayılan: /sip/token) */
  sipTokenEndpoint: string;
  /** Dinamik kullanıcı ID'si (örn. 4200) */
  userId?: number | string;
  /** Varsayılan SIP Realm/Domain (global: sip.hipcall.com, tr: sip.hipcall.com.tr) */
  sipRealm?: string;
  /** Eski/alternatif yollar (fallback için) */
  sipCredentialsPaths?: string[];
  wsUrl: string;
  clientId: string;
  /** Önerilmez: secret'ı tarayıcıya koymayın, sunucu proxy'si kullanın. */
  clientSecret?: string;
  redirectUri: string;
  scope: string;
  state: string;
  storageKey: string;
  /** RFC 7636 PKCE desteği (varsayılan: true). Client Secret olmadan güvenli tarayıcı OAuth akışı sağlar. */
  usePKCE?: boolean;
  /** REGISTER süresi (sn) */
  registerExpires: number;
  /**
   * password: token'ı SIP digest parolası olarak kullan
   * bearer:   Authorization: Bearer <token> extra header
   * both:     ikisi birden
   */
  authMode: 'password' | 'bearer' | 'both';
  stunServers: string[];
  /** Uzak ses için kullanılacak <audio> elementi (yoksa otomatik oluşturulur) */
  audioElement?: HTMLAudioElement;
  /** Dahili zil ve DTMF ses efektlerini etkinleştir (varsayılan: true) */
  enableSounds?: boolean;
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  /** epoch ms */
  obtained_at: number;
}

export interface SipCredentials {
  /** örn. 1001 */
  username: string;
  /** SIP domain / realm */
  realm: string;
  /** sip:1001@realm (verilmezse üretilir) */
  sipUri?: string;
  /** SIP JWT / token / parola */
  sipToken: string;
  wsServers?: string[];
  displayName?: string;
}

export type CallDirection = 'outgoing' | 'incoming';

export interface CallInfo {
  direction: CallDirection;
  remoteNumber: string;
  remoteName?: string;
  startedAt?: number;
}

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

export interface HipcallEvents {
  registered: void;
  unregistered: void;
  registrationFailed: { cause: string; code?: number };
  connecting: void;
  disconnected: { error?: boolean; reason?: string };
  incomingCall: CallInfo;
  callConnecting: CallInfo;
  callRinging: CallInfo;
  callConnected: CallInfo;
  callEnded: { call: CallInfo; cause: string };
  callFailed: { call: CallInfo; cause: string };
  muteChanged: { muted: boolean };
  holdChanged: { held: boolean };
  sipLog: { direction: 'in' | 'out' | 'info' | 'error'; message: string; time: number };
  authenticated: TokenSet;
}
