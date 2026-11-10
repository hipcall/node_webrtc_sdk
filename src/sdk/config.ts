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
  clientId: 'y1DUaxQVRzar-Okts8rWVkvGkAfLMJEF6e_wdyph3CM',
  redirectUri: 'https://envelope-footrest-flyable.ngrok-free.dev/callback',
  scope: 'profile email offline_access contacts:read',
  state: 'staj123',
  storageKey: 'hipcall_sdk',
  registerExpires: 300,
  authMode: 'both',
  stunServers: ['stun:stun.l.google.com:19302'],
};

