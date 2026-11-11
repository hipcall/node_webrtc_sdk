# Hipcall WebRTC & SIP JavaScript SDK (`@hipcall/webrtc-sdk`)

> **Language / Dil:** **English** | [Türkçe (`README_TR.md`)](./README_TR.md)

Official WebRTC and SIP JavaScript/TypeScript SDK for the Hipcall Cloud PBX platform.

Use `@hipcall/webrtc-sdk` to embed voice calling, incoming call alerts, hold/mute controls, DTMF keypad input, and audio device selection directly into your CRM, helpdesk, or web application.

## Installation

```bash
npm install @hipcall/webrtc-sdk
# or
yarn add @hipcall/webrtc-sdk
# or
pnpm add @hipcall/webrtc-sdk
```

## Quick Start

```ts
import { HipcallClient } from '@hipcall/webrtc-sdk';

const client = new HipcallClient({
  authorizeUrl: 'https://use.hipcall.com/oauth/authorize',
  tokenUrl: 'https://use.hipcall.com/oauth/token',
  apiBaseUrl: 'https://use.hipcall.com/api/v3',
  wsUrl: 'wss://mgw.hipcall.com:8443',
  clientId: 'YOUR_OAUTH_CLIENT_ID',
  redirectUri: 'https://app.example.com/callback',
  usePKCE: true,
});

// 1. Register event listeners
client.on('registered', () => {
  console.log('Registered with Hipcall SIP server');
});

client.on('incomingCall', (call) => {
  console.log('Incoming call from:', call.remoteNumber);
});

client.on('callConnected', (call) => {
  console.log('Call connected:', call.remoteNumber);
});

client.on('callEnded', () => {
  console.log('Call ended');
});

client.on('error', ({ code, message }) => {
  console.error(`[${code}] ${message}`);
});

// 2. Authenticate with OAuth 2.0 (PKCE) and connect
if (!client.isAuthenticated()) {
  const loginUrl = await client.getLoginUrlAsync();
  window.location.href = loginUrl;
} else {
  await client.connectSIP();
}
```

### Handling the OAuth 2.0 Callback

On your `redirectUri` page (for example `/callback`), exchange the authorization code for an access token and start the SIP session:

```ts
const params = new URLSearchParams(window.location.search);
const code = params.get('code');

if (code) {
  await client.handleOAuthCallback(code);
  await client.connectSIP();
}
```

## Authentication and SIP Token Flow

1. **OAuth 2.0 with PKCE (RFC 7636):** Calling `getLoginUrlAsync()` generates a cryptographic `code_verifier` and SHA-256 `code_challenge` (`S256`) in the browser using the Web Crypto API. During `handleOAuthCallback(code)`, the `code_verifier` is sent to the token endpoint so browser applications never store a `client_secret`.
2. **Dynamic SIP Credentials (`POST /api/v3/sip/token`):** Calling `connectSIP()` requests temporary SIP credentials (`username`, `password`, `domain`, and `wss_url`) from the Hipcall API. If a `user_id` is not provided, the SDK automatically resolves the authenticated user's ID from `GET /api/v3/profile`.
3. **SIP over WebSocket (`REGISTER`):** The SDK initializes a JsSIP User Agent over `wss://`, completes digest authentication, and refreshes registration every 300 seconds.

### Manual SIP Credentials (Optional)

If your backend fetches SIP credentials on the server side, you can pass them directly to the client without running OAuth in the browser:

```ts
client.setManualCredentials({
  username: '1001',
  realm: 'account.sip.hipcall.com',
  sipToken: 'YOUR_SIP_PASSWORD_OR_JWT',
  wsServers: ['wss://mgw.hipcall.com:8443'],
});

await client.connectSIP();
```

## Call Controls and Audio Devices

```ts
// Place an outbound call
client.call('08501234567');

// Answer or hang up an active/incoming call
client.answer();
client.hangup();

// Mute / unmute microphone
const isMuted = client.toggleMute();

// Put call on hold / resume call (SIP re-INVITE)
const isOnHold = await client.toggleHold();

// Send DTMF tones during an active call
client.sendDTMF('1');

// List and switch audio output devices (speakers / headsets)
const speakers = await client.getAudioOutputDevices();
if (speakers.length > 0) {
  await client.setAudioOutputDevice(speakers[0].deviceId);
}
```

## SDK Events

| Event | Payload | Description |
| :--- | :--- | :--- |
| `stateChanged` | `ConnectionState` | Fired when the connection state changes (`disconnected`, `connecting`, `connected`, `registered`, `error`). |
| `registered` | `void` | Fired when `SIP 200 OK` is received for `REGISTER`. |
| `unregistered` | `void` | Fired when the SIP registration ends. |
| `registrationFailed` | `{ cause: string }` | Fired when SIP registration is rejected. |
| `incomingCall` | `CallInfo` | Fired when an inbound call arrives. |
| `callProgress` | `CallInfo` | Fired when an outbound call is ringing (`180 Ringing` / `183 Session Progress`). |
| `callConnected` | `CallInfo` | Fired when media negotiation completes and audio starts flowing. |
| `callEnded` | `CallInfo \| null` | Fired when the call is terminated or rejected. |
| `callHoldChanged` | `{ isHeld: boolean }` | Fired when the call hold state changes. |
| `callMuteChanged` | `{ isMuted: boolean }` | Fired when the microphone mute state changes. |
| `sipLog` | `{ direction, message, timestamp }` | Raw SIP signaling and diagnostic log events. |
| `error` | `{ code, message, originalError? }` | Fired on OAuth, API, WebRTC, or SIP errors. |

## Project Modules

| Path | Description |
| :--- | :--- |
| `src/sdk/HipcallClient.ts` | Main event-driven WebRTC & SIP client |
| `src/sdk/OAuth.ts` | OAuth 2.0 + PKCE (`S256`) and SIP token client |
| `src/sdk/SoundEffects.ts` | Web Audio API ringtone, ringback, and DTMF synthesizer |
| `src/sdk/EventEmitter.ts` | Type-safe event emitter |
| `src/sdk/types.ts` | Public TypeScript interfaces and event types |
| `src/sdk/config.ts` | Default configuration values |
| `src/demo/` | Sample browser webphone widget and test application |

## Running the Demo Webphone Locally

1. Copy `.env.example` to `.env` and fill in your Hipcall OAuth application credentials:

```bash
cp .env.example .env
```

2. Install dependencies and start the development server:

```bash
npm install
npm run dev
```

3. Open `http://localhost:5173` in your browser.

## Building from Source

```bash
# Type-check the project
npm run typecheck

# Build standalone SDK bundles (dist/sdk/)
npm run build:sdk

# Build both the demo app and standalone SDK
npm run build:all
```

Build outputs in `dist/sdk/`:
- `dist/sdk/hipcall-webrtc-sdk.es.js` (ES Module bundle)
- `dist/sdk/hipcall-webrtc-sdk.umd.js` (UMD / CommonJS bundle)
- `dist/sdk/types/index.d.ts` (TypeScript type declarations)

## License

[MIT](./LICENSE)
