# Hipcall WebRTC & SIP JavaScript SDK (`@hipcall/webrtc-sdk`)

> **Dil / Language:** [English (`README.md`)](./README.md) | **Türkçe**

[Hipcall](https://www.hipcall.com.tr) Bulut Santral platformu için geliştirilmiş resmi WebRTC ve SIP JavaScript/TypeScript SDK kütüphanesi.

`@hipcall/webrtc-sdk` paketini kullanarak CRM, yardım masası (helpdesk) veya web uygulamalarınıza doğrudan tarayıcı üzerinden sesli arama, gelen çağrı bildirimi, mikrofon susturma (mute), çağrı bekletme (hold), DTMF tuşlama ve ses çıkış cihazı seçimi özelliklerini entegre edebilirsiniz.

## Kurulum

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
  region: 'tr', // 'tr' = use.hipcall.com.tr, 'global' = use.hipcall.com
  clientId: 'YOUR_OAUTH_CLIENT_ID',
  redirectUri: 'https://app.ornek.com/callback',
  usePKCE: true,
});

// 1. Olay (Event) dinleyicilerini tanımlayın
client.on('registered', () => {
  console.log('Hipcall SIP sunucusuna kayıt olundu');
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

client.on('registrationFailed', ({ cause, code }) => {
  console.error('Kayıt başarısız:', cause, code);
});

client.on('callFailed', ({ cause }) => {
  console.error('Çağrı başarısız:', cause);
});

// 2. OAuth 2.0 (PKCE) ile kimlik doğrulayın ve bağlanın
if (!client.isAuthenticated) {
  await client.loginWithOAuth(); // Hipcall giriş sayfasına yönlendirir
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
  window.history.replaceState({}, document.title, '/'); // kod tek kullanımlık
  await client.handleOAuthCallback(code, params.get('state'));
  await client.connectSIP();
}
```

## Bölgeler

Hipcall'un iki ayrı sunucu grubu var. Hangisini kullanacağınızı `region` ayarıyla seçin:

| `region` | API ve giriş | SIP realm | WebSocket |
| :--- | :--- | :--- | :--- |
| `'global'` (varsayılan) | `https://use.hipcall.com` | `sip.hipcall.com` | `wss://mgw.hipcall.com:8443` |
| `'tr'` | `https://use.hipcall.com.tr` | `sip.hipcall.com.tr` | `wss://mgw.hipcall.com.tr:8443` |

Varsayılan bölge `global` olduğu için Türkiye hesaplarında `region: 'tr'` vermeyi unutmayın. Adres alanlarını (`authorizeUrl`, `tokenUrl`, `apiBaseUrl`, `sipRealm`, `wsUrl`) kendiniz verirseniz bölge varsayılanının yerine onlar kullanılır. `POST /api/v3/sip/token` cevabında `wss_url` gelirse SDK o adrese bağlanır.

## Kimlik Doğrulama ve SIP Token Akışı

1. **OAuth 2.0 PKCE (RFC 7636):** `loginWithOAuth()` çağrıldığında SDK, tarayıcının Web Crypto API'sini kullanarak kriptografik bir `code_verifier` ve SHA-256 tabanlı `code_challenge` (`S256`) üretir. `handleOAuthCallback(code, state)` aşamasında bu `code_verifier` doğrulanmak üzere token uç noktasına gönderilir; böylece tarayıcıda `client_secret` saklanmaz.
2. **Dinamik SIP Bilgileri (`POST /api/v3/sip/token`):** `connectSIP()` çağrıldığında Hipcall API üzerinden geçici SIP bilgileri (`sip_username`, `sip_realm`, `sip_token` ve `wss_url`) alınır. Bir `user_id` belirtilmemişse oturum açmış kullanıcının kendi SIP bilgileri döner.
3. **WebSocket Üzerinden SIP Kaydı (`REGISTER`):** SDK, `wss://` adresi üzerinden JsSIP User Agent oturumunu başlatır, kimlik doğrulamasını tamamlar ve SIP kaydını süresi dolmadan yeniler (varsayılan `registerExpires`: 300 sn).

### Manuel SIP Bilgileri ile Bağlantı (İsteğe Bağlı)

SIP kimlik bilgilerini kendi arka uç (backend) sunucunuzda çekiyorsanız, tarayıcıda OAuth akışı çalıştırmadan doğrudan istemciye iletebilirsiniz:

```ts
client.setManualCredentials({
  username: '1001',
  realm: 'sip.hipcall.com.tr',
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

// Aktif çağrı sırasında DTMF tuşlaması gönder
client.sendDTMF('1');

// Ses çıkış cihazlarını (hoparlör / kulaklık) listele ve değiştir
const speakers = (await client.getAudioDevices()).filter((d) => d.kind === 'audiooutput');
if (speakers.length > 0) {
  await client.setAudioOutputDevice(speakers[0].deviceId);
}
```

## SDK Olayları (Events)

| Olay (Event) | Veri Tipi (Payload) | Açıklama |
| :--- | :--- | :--- |
| `authenticated` | `TokenSet` | OAuth2 token takası tamamlandığında tetiklenir. |
| `connecting` | `void` | WebSocket bağlantısı başlatıldığında tetiklenir. |
| `registered` | `void` | `REGISTER` isteğine `200 OK` alındığında tetiklenir. |
| `unregistered` | `void` | SIP kaydı sonlandığında tetiklenir. |
| `registrationFailed` | `{ cause: string; code?: number }` | SIP kaydı reddedildiğinde tetiklenir. |
| `disconnected` | `{ error?: boolean; reason?: string }` | WebSocket bağlantısı kapandığında tetiklenir. |
| `incomingCall` | `CallInfo` | Gelen çağrı ulaştığında tetiklenir. |
| `callConnecting` | `CallInfo` | Giden arama başlatıldığında tetiklenir. |
| `callRinging` | `CallInfo` | Karşı taraf çaldığında (`180` / `183`) tetiklenir. |
| `callConnected` | `CallInfo` | Görüşme başlayıp ses akışı kurulduğunda tetiklenir. |
| `callFailed` | `{ call: CallInfo; cause: string }` | Çağrı bağlanmadan düştüğünde veya reddedildiğinde tetiklenir. |
| `callEnded` | `{ call: CallInfo; cause: string }` | Çağrı bittiğinde tetiklenir (`callFailed` sonrasında da). |
| `muteChanged` | `{ muted: boolean }` | Mikrofon susturma durumu değiştiğinde tetiklenir. |
| `holdChanged` | `{ held: boolean }` | Bekletme durumu değiştiğinde tetiklenir. |
| `sipLog` | `{ direction, message, time }` | Ham SIP mesajları ve SDK logları. |

## Proje Modülleri

| Dosya / Dizin | Açıklama |
| :--- | :--- |
| `src/sdk/HipcallClient.ts` | Olay güdümlü ana WebRTC & SIP istemcisi |
| `src/sdk/OAuth.ts` | OAuth 2.0 + PKCE (`S256`) ve SIP token istemcisi |
| `src/sdk/SoundEffects.ts` | Web Audio API zil sesi, arama tonu ve DTMF üreticisi |
| `src/sdk/EventEmitter.ts` | Tip güvenli Event Emitter |
| `src/sdk/types.ts` | TypeScript arayüz ve olay tipleri |
| `src/sdk/config.ts` | Varsayılan yapılandırma değerleri |
| `src/demo/` | Örnek tarayıcı Webphone uygulaması |

## Örnek Webphone Uygulamasını Yerelde Çalıştırma

1. `.env.example` dosyasını `.env` olarak kopyalayın ve Hipcall OAuth uygulama bilgilerinizi girin:

```bash
cp .env.example .env
```

2. Bağımlılıkları yükleyin ve geliştirme sunucusunu başlatın:

```bash
npm install
npm run dev
```

3. Tarayıcınızda `http://localhost:5173` adresini açın.

## Kaynak Koddan Derleme (Build)

```bash
# TypeScript tip kontrolü
npm run typecheck

# Sadece bağımsız SDK paketini derler (dist/sdk/)
npm run build:sdk

# Hem örnek Webphone uygulamasını hem de SDK paketini derler
npm run build:all
```

Derleme çıktıları `dist/sdk/` dizininde oluşturulur:
- `dist/sdk/hipcall-webrtc-sdk.es.js` (ES Module çıktısı)
- `dist/sdk/hipcall-webrtc-sdk.umd.js` (UMD / CommonJS çıktısı)
- `dist/sdk/types/index.d.ts` (TypeScript tip tanımlamaları)

## Dokümantasyon ve Kaynaklar

- [Hipcall Geliştirici Portalı](https://developers.hipcall.com.tr/) — Resmi rehberler, API referansları ve entegrasyon dokümantasyonu.
- [Hipcall](https://www.hipcall.com.tr) — Bulut santral, çağrı merkezi ve CRM platformu.

## Lisans

[MIT](./LICENSE)

---

Developed by [Hipcall](https://www.hipcall.com.tr) • [Hipcall Geliştirici Portalı](https://developers.hipcall.com.tr/)
