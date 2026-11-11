# Hipcall WebRTC & SIP JavaScript SDK (`@hipcall/webrtc-sdk`)

> **Dil / Language:** [English (`README.md`)](./README.md) | **Türkçe**

Hipcall Bulut Santral platformu için geliştirilmiş resmi WebRTC ve SIP JavaScript/TypeScript SDK kütüphanesi ve test/geliştirme süreçleri için örnek tarayıcı Webphone uygulaması.

`@hipcall/webrtc-sdk` paketini kullanarak CRM, yardım masası (helpdesk) veya şirket içi web uygulamalarınıza doğrudan tarayıcı üzerinden sesli arama, gelen çağrı bildirimi, mikrofon susturma (mute), çağrı bekletme (hold), DTMF tuşlama ve ses çıkış cihazı seçimi özelliklerini entegre edebilirsiniz.

## Kurulum

Paketi npm üzerinden projenize ekleyin:

```bash
npm install @hipcall/webrtc-sdk
# veya
yarn add @hipcall/webrtc-sdk
# veya
pnpm add @hipcall/webrtc-sdk
```

## Hızlı Başlangıç

```ts
import { HipcallClient } from '@hipcall/webrtc-sdk';

const client = new HipcallClient({
  authorizeUrl: 'https://use.hipcall.com.tr/oauth/authorize',
  tokenUrl: 'https://use.hipcall.com.tr/oauth/token',
  apiBaseUrl: 'https://use.hipcall.com.tr/api/v3',
  wsUrl: 'wss://mgw.hipcall.com.tr:8443',
  clientId: 'YOUR_OAUTH_CLIENT_ID',
  redirectUri: 'https://app.ornek.com/callback',
  usePKCE: true,
});

// 1. Olay (Event) dinleyicilerini tanımlayın
client.on('registered', () => {
  console.log('Hipcall SIP sunucusuna bağlanıldı ve kayıt olundu');
});

client.on('incomingCall', (call) => {
  console.log('Gelen çağrı:', call.remoteNumber);
});

client.on('callConnected', (call) => {
  console.log('Çağrı bağlandı:', call.remoteNumber);
});

client.on('callEnded', () => {
  console.log('Çağrı sonlandı');
});

client.on('error', ({ code, message }) => {
  console.error(`[${code}] ${message}`);
});

// 2. OAuth 2.0 (PKCE) ile kimlik doğrulayın ve SIP bağlantısını başlatın
if (!client.isAuthenticated()) {
  const loginUrl = await client.getLoginUrlAsync();
  window.location.href = loginUrl;
} else {
  await client.connectSIP();
}
```

### OAuth 2.0 Callback Karşılama

Kullanıcı yetkilendirmeyi tamamladıktan sonra yönlendirildiği `redirectUri` sayfasında (örneğin `/callback`), dönen `code` parametresini erişim anahtarı (access token) ile takas edip SIP oturumunu başlatın:

```ts
const params = new URLSearchParams(window.location.search);
const code = params.get('code');

if (code) {
  await client.handleOAuthCallback(code);
  await client.connectSIP();
}
```

## Kimlik Doğrulama ve SIP Token Akışı

1. **OAuth 2.0 PKCE (RFC 7636):** `getLoginUrlAsync()` çağrıldığında SDK, tarayıcının Web Crypto API'sini kullanarak kriptografik bir `code_verifier` ve SHA-256 tabanlı `code_challenge` (`S256`) üretir. `handleOAuthCallback(code)` aşamasında bu `code_verifier` doğrulanmak üzere token uç noktasına gönderilir; böylece tarayıcı tarafında `client_secret` saklanmasına gerek kalmaz.
2. **Dinamik SIP Bilgileri (`POST /api/v3/sip/token`):** `connectSIP()` çağrıldığında Hipcall API üzerinden geçici SIP bilgileri (`username`, `password`, `domain` ve `wss_url`) alınır. Eğer bir `user_id` belirtilmemişse, SDK otomatik olarak `GET /api/v3/profile` uç noktasından oturum açmış kullanıcının kendi ID bilgisini tespit eder.
3. **WebSocket Üzerinden SIP Kaydı (`REGISTER`):** SDK, `wss://` adresi üzerinden JsSIP User Agent oturumunu başlatır, digest kimlik doğrulamasını tamamlar ve her 300 saniyede bir SIP kaydını yeniler.

### Manuel SIP Bilgileri ile Bağlantı (İsteğe Bağlı)

SIP kimlik bilgilerini kendi arka uç (backend) sunucunuzda çekiyorsanız, tarayıcıda OAuth akışı çalıştırmadan doğrudan istemciye iletebilirsiniz:

```ts
client.setManualCredentials({
  username: '1001',
  realm: 'hesap.sip.hipcall.com.tr',
  sipToken: 'SIP_SIFRESI_VEYA_JWT',
  wsServers: ['wss://mgw.hipcall.com.tr:8443'],
});

await client.connectSIP();
```

## Çağrı Kontrolleri ve Ses Cihazları

```ts
// Dış arama başlat
client.call('08501234567');

// Gelen çağrıyı yanıtla veya aktif çağrıyı sonlandır
client.answer();
client.hangup();

// Mikrofonu sustur / aç
const isMuted = client.toggleMute();

// Çağrıyı bekletmeye al / devam ettir (SIP re-INVITE)
const isOnHold = await client.toggleHold();

// Aktif çağrı sırasında DTMF tuşlaması gönder (RFC 2833 / SIP INFO)
client.sendDTMF('1');

// Ses çıkış cihazlarını (hoparlör / kulaklık) listele ve değiştir
const speakers = await client.getAudioOutputDevices();
if (speakers.length > 0) {
  await client.setAudioOutputDevice(speakers[0].deviceId);
}
```

## SDK Olayları (Events)

| Olay (Event) | Veri Tipi (Payload) | Açıklama |
| :--- | :--- | :--- |
| `stateChanged` | `ConnectionState` | Bağlantı durumu değiştiğinde tetiklenir (`disconnected`, `connecting`, `connected`, `registered`, `error`). |
| `registered` | `void` | `REGISTER` isteğine `SIP 200 OK` yanıtı alındığında tetiklenir. |
| `unregistered` | `void` | SIP kaydı sonlandığında tetiklenir. |
| `registrationFailed` | `{ cause: string }` | SIP kaydı reddedildiğinde tetiklenir. |
| `incomingCall` | `CallInfo` | Yeni bir gelen çağrı ulaştığında tetiklenir. |
| `callProgress` | `CallInfo` | Giden çağrı karşı tarafta çaldığında (`180 Ringing` / `183 Session Progress`) tetiklenir. |
| `callConnected` | `CallInfo` | Medya (SDP/ICE) anlaşması tamamlanıp ses akışı başladığında tetiklenir. |
| `callEnded` | `CallInfo \| null` | Çağrı sonlandırıldığında veya reddedildiğinde tetiklenir. |
| `callHoldChanged` | `{ isHeld: boolean }` | Çağrı bekletme (Hold) durumu değiştiğinde tetiklenir. |
| `callMuteChanged` | `{ isMuted: boolean }` | Mikrofon susturma (Mute) durumu değiştiğinde tetiklenir. |
| `sipLog` | `{ direction: 'IN' \| 'OUT' \| 'INFO'; message: string; timestamp: string }` | Ham SIP sinyalleşme ve tanılama logları. |
| `error` | `{ code: string; message: string; originalError?: unknown }` | OAuth, API, WebRTC veya SIP hatalarında tetiklenir. |

## Proje Dizin Yapısı

```text
├── src/
│   ├── sdk/                     # Bağımsız @hipcall/webrtc-sdk kaynak kodları
│   │   ├── HipcallClient.ts     # Olay güdümlü ana WebRTC & SIP istemcisi
│   │   ├── OAuth.ts             # OAuth 2.0 + PKCE (S256) ve SIP token istemcisi
│   │   ├── SoundEffects.ts      # Web Audio API zil sesi, arama tonu ve DTMF üreticisi
│   │   ├── EventEmitter.ts      # Tip güvenli Event Emitter
│   │   ├── types.ts             # TypeScript arayüz ve olay tipleri
│   │   ├── config.ts            # Varsayılan yapılandırma değerleri
│   │   └── index.ts             # Paket dışa aktarımları (public exports)
│   │
│   └── demo/                    # Örnek Webphone Widget ve Test Uygulaması
│       ├── main.ts              # Demo arayüz mantığı, tuş takımı ve canlı SIP log konsolu
│       └── style.css            # Demo webphone stilleri
│
├── vite.config.ts               # Geliştirme sunucusu ve yerel CORS proxy yapılandırması
├── vite.sdk.config.ts           # Kütüphane derleme yapılandırması (ESM + UMD)
├── tsconfig.json                # TypeScript yapılandırması
└── tsconfig.sdk.json            # TypeScript tip bildirim (.d.ts) üretim yapılandırması
```

## Örnek Webphone Uygulamasını Yerelde Çalıştırma

1. `.env.example` dosyasını `.env` olarak kopyalayın ve Hipcall OAuth uygulama bilgilerinizi girin:

```bash
cp .env.example .env
```

2. Bağımlılıkları yükleyin ve Vite geliştirme sunucusunu başlatın:

```bash
npm install
npm run dev
```

3. Tarayıcınızda `http://localhost:5173` adresini açın.

## SDK'yı Derleme (Build)

```bash
# TypeScript tip kontrolü
npm run typecheck

# Sadece bağımsız SDK paketini derler (dist/sdk/ altında ESM, UMD ve .d.ts dosyaları)
npm run build:sdk

# Hem örnek Webphone uygulamasını hem de bağımsız SDK paketini derler
npm run build:all
```

Derleme çıktıları `dist/sdk/` dizininde oluşturulur:
- `dist/sdk/hipcall-webrtc-sdk.es.js` (Vite, Webpack, Next.js vb. modern paketleyiciler için ES Module çıktısı)
- `dist/sdk/hipcall-webrtc-sdk.umd.js` (`<script>` etiketi ve CommonJS kullanımı için UMD çıktısı)
- `dist/sdk/types/index.d.ts` (TypeScript tip tanımlamaları)

## CI/CD ile Otomatik NPM Dağıtımı

Bu depoda yer alan `.github/workflows/publish.yml` iş akışı, yeni bir GitHub Release oluşturulduğunda veya `v*` etiketi (tag) gönderildiğinde otomatik olarak `npm run typecheck` ve `npm run build:all` adımlarını çalıştırır ve paketi `@hipcall/webrtc-sdk` adıyla npm üzerinde yayınlar. Otomatik dağıtımı etkinleştirmek için GitHub depo ayarlarından (`Settings -> Secrets and variables -> Actions`) `NPM_TOKEN` gizli anahtarını tanımlamanız yeterlidir.

## Lisans

[MIT](./LICENSE)
