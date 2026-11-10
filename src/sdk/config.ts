import type { HipcallConfig } from './types';

export const DEFAULT_CONFIG: HipcallConfig = {
  authorizeUrl: 'https://use.hipcall.com.tr/oauth/authorize',
  tokenUrl: 'https://use.hipcall.com.tr/oauth/token',
  apiBaseUrl: 'https://use.hipcall.com.tr/api/v3',
  sipTokenEndpoint: '/sip/token',
  userId: undefined,
  sipRealm: 'sip.hipcall.com.tr',
  sipCredentialsPaths: ['/sip/token', '/sip_credentials', '/me/sip_credentials'],
  wsUrl: 'wss://sip.hipcall.com.tr:8443',
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

