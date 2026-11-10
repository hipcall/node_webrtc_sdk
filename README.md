# Hipcall WebRTC / SIP JavaScript SDK & Webphone Widget

Hipcall bulut santral sistemi için müşterilerin kendi web sitelerine ve CRM sistemlerine kolayca gömebileceği **WebRTC/SIP JavaScript SDK (`hipcall-webrtc-sdk`)** ve test/geliştirme için hazırlanmış **Örnek Webphone Widget (Demo App)**.

---

## 📦 NPM Paketi Olarak Kurulum

Hipcall resmi NPM paketi üzerinden projelerinize ekleyebilirsiniz:

```bash
npm install @hipcall/webrtc-sdk
# veya
yarn add @hipcall/webrtc-sdk
# veya
pnpm add @hipcall/webrtc-sdk
```

---

## 🚀 GitHub Actions ile Otomatik NPM Dağıtımı (CI/CD)

Proje içerisinde `.github/workflows/publish.yml` dosyası hazır olarak tanımlanmıştır:
1. Hipcall GitHub organizasyonunda bir release (etiket) yayınlandığında Action otomatik tetiklenir.
2. `npm run typecheck` ve `npm run build:all` adımlarını çalıştırarak tip ve derleme doğrulaması yapar.
3. Hipcall'un resmi `NPM_TOKEN` secret'ı ile paketi doğrudan `@hipcall/webrtc-sdk` adıyla npmjs.com üzerinde yayınlar.
4. Böylece staj sonrasında Hipcall ekibi yeni bir versiyon yayınlamak istediğinde sadece GitHub'dan yeni bir release açması yeterlidir.

---

## 📁 Proje Mimarisi

```
├── src/
│   ├── sdk/                     # Bağımsız Hipcall WebRTC SDK
│   │   ├── HipcallClient.ts     # Event-driven ana istemci (JsSIP & WebRTC sarmalayıcı)
│   │   ├── OAuth.ts             # OAuth 2.0 Code Exchange, Token & /profile yönetimi
│   │   ├── SoundEffects.ts      # Web Audio API ile dahili zil, arama tonu ve DTMF sesleri
│   │   ├── EventEmitter.ts      # Tip-güvenli hafif Event Emitter
│   │   ├── types.ts             # TypeScript arayüz ve event tipleri
│   │   ├── config.ts            # Varsayılan konfigürasyon değerleri
│   │   └── index.ts             # SDK public dışa aktarımları
│   │
│   └── demo/                    # Örnek Webphone Widget & Test Uygulaması
│       ├── main.ts              # Widget UI mantığı, dialpad ve SIP log konsolu
│       └── style.css            # Modern, koyu temalı kompakt webphone stilleri
│
├── vite.config.ts               # Dev server & CORS proxy (/hipcall-oauth/token, /hipcall-api)
├── vite.sdk.config.ts           # Bağımsız SDK kütüphane derleyicisi (ESM + UMD)
├── tsconfig.json                # Proje TypeScript ayarları
├── tsconfig.sdk.json            # SDK tip bildirim (.d.ts) üretici
└── .env                         # OAuth ve SIP proxy ayarları
```

---

## 🚀 Hızlı Başlangıç

### 1. Bağımlılıkları Yükleyin ve Başlatın
```bash
npm install
npm run dev
```
Uygulama yerelde `http://localhost:5173` üzerinde çalışmaya başlayacaktır.

---

## 🌐 ngrok ile Eşleştirme ve OAuth Testi

Hipcall OAuth 2.0 yönlendirmesi `https://envelope-footrest-flyable.ngrok-free.dev/callback` olarak tanımlıdır:

1. **ngrok Auth Token tanımlayın:**
   ```bash
   ngrok config add-authtoken <BURAYA_AUTHTOKEN>
   ```
2. **Rezerve domain ile tüneli başlatın:**
   ```bash
   ngrok http --url=envelope-footrest-flyable.ngrok-free.dev 5173
   ```
3. **Tarayıcıda ngrok adresini açın:**
   - Doğrudan `https://envelope-footrest-flyable.ngrok-free.dev` adresine gidin (*localhost üzerinden açmayın; oturum ve callback çerezleri ngrok origin'i ile eşleşir*).
4. **"Hipcall ile Giriş Yap"** butonuna basın. Yetkilendirme sonrası token otomatik takas edilir, kullanıcının SIP token'ı çekilir ve santrale `REGISTER` olunur.

---

## 🔑 SIP Token & Kimlik Doğrulama Akışı

1. **OAuth 2.0 Code Exchange:** Tarayıcı `/hipcall-oauth/token` proxy'si üzerinden token takasını güvenle yapar (`client_secret` tarayıcıya sızmaz).
2. **SIP Token Alma (`POST /api/v3/sip/token`):**
   - Header: `Authorization: Bearer <access_token>`, `Content-Type: application/json`
   - Body: `{"user_id": <userId>}`
   - **Otomatik ID Tespiti:** Kullanıcı ID boş bırakılırsa veya yetki hatası (`403 other users`) durumunda SDK otomatik olarak `GET /api/v3/profile` endpoint'inden kullanıcının kendi gerçek ID'sini öğrenip token'ı çeker.
3. **WebSocket SIP Kaydı:** `wss://sip.hipcall.com.tr:8443` üzerinden JsSIP `UA` başlatılır; Bearer Token ve digest şifresi ile periyodik (300 sn) `REGISTER` yenilenir.

---

## 🛠️ SDK Kullanımı (CRM / Web Uygulamalarına Gömme)

### Örnek Entegrasyon:
```ts
import { HipcallClient } from './sdk';

const client = new HipcallClient({
  apiBaseUrl: 'https://use.hipcall.com.tr/api/v3',
  wsUrl: 'wss://sip.hipcall.com.tr:8443',
  clientId: 'y1DUaxQVRzar-Okts8rWVkvGkAfLMJEF6e_wdyph3CM',
  redirectUri: 'https://crm.siteniz.com/callback',
});

// 1. Olay Dinleyicileri
client.on('registered', () => console.log('Santrale bağlanıldı!'));
client.on('incomingCall', (call) => console.log('Gelen arama:', call.remoteNumber));
client.on('callConnected', (call) => console.log('Çağrı bağlandı:', call));
client.on('callEnded', () => console.log('Çağrı bitti'));
client.on('sipLog', ({ direction, message }) => console.log(`[SIP ${direction}]`, message));

// 2. Bağlantı (OAuth veya Manuel)
await client.connectSIP(); // OAuth ile token çekip bağlanır
// Veya bypass/manuel mod:
client.setManualCredentials({
  username: '1001',
  realm: 'hesabiniz.sip.hipcall.com.tr',
  sipToken: '<SIP_JWT_TOKEN>',
  wsServers: ['wss://sip.hipcall.com.tr:8443']
});
await client.connectSIP();

// 3. Çağrı Kontrolleri
client.call('08501234567');   // Arama başlat
client.answer();              // Gelen çağrıyı yanıtla
client.toggleMute();          // Mikrofonu sustur / aç
await client.toggleHold();    // Çağrıyı bekletmeye al (HOLD / UNHOLD)
client.sendDTMF('5');         // Tuşlama gönder
client.hangup();              // Çağrıyı sonlandır
```

---

## 📦 Kütüphane Olarak Derleme (Standalone SDK Build)

Müşterilerinize veya CRM projelerinize bağımsız npm paketi / `<script>` kütüphanesi olarak dağıtmak için:

```bash
# Sadece SDK'yı derler (ESM, UMD ve TypeScript .d.ts dosyaları)
npm run build:sdk

# Hem Webphone Demo hem SDK kütüphanesini derler
npm run build:all
```

Çıktılar `dist/sdk/` klasöründe üretilir:
- `dist/sdk/hipcall-webrtc-sdk.es.js` (Modern ESM bundler'lar: Vite, Webpack, Next.js vb.)
- `dist/sdk/hipcall-webrtc-sdk.umd.js` (Tarayıcıda `<script src="...">` veya Node require)
- `dist/sdk/types/` (TypeScript tip tanımlamaları)
