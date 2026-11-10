import './style.css';
import { HipcallClient, type CallInfo } from '../sdk';

const env = import.meta.env;
const isDev = import.meta.env.DEV;

// Dev'de CORS'u aşmak için Vite proxy yolları; prod'da gerçek endpoint'ler.
const client = new HipcallClient({
  authorizeUrl: env.VITE_HIPCALL_AUTHORIZE_URL,
  tokenUrl: isDev ? '/hipcall-oauth/token' : env.VITE_HIPCALL_TOKEN_URL,
  apiBaseUrl: isDev ? '/hipcall-api' : env.VITE_HIPCALL_API_BASE_URL,
  sipCredentialsPaths: [env.VITE_HIPCALL_SIP_CREDENTIALS_PATH || '/sip_credentials', '/me/sip_credentials'],
  wsUrl: env.VITE_HIPCALL_WS_URL,
  clientId: env.VITE_HIPCALL_CLIENT_ID,
  redirectUri: env.VITE_HIPCALL_REDIRECT_URI,
  scope: env.VITE_HIPCALL_SCOPE,
  state: env.VITE_HIPCALL_STATE,
});

// ------------------------------------------------------------------ UI
const app = document.getElementById('app')!;
app.innerHTML = `
<div class="layout">
  <div class="phone">
    <div class="status"><span id="dot" class="dot"></span><span id="statusText">Disconnected</span>
      <button id="logout" class="link" hidden>Çıkış</button></div>

    <section id="viewLogin">
      <div class="tabs">
        <button class="tab active" data-tab="oauth">OAuth2</button>
        <button class="tab" data-tab="manual">Geliştirici / Manuel</button>
      </div>
      <div id="tabOauth" class="pane">
        <label>Kullanıcı ID (opsiyonel)<input id="oUserId" placeholder="Boş bırakılırsa profilden otomatik alınır" /></label>
        <button id="btnOAuth" class="btn primary wide">Hipcall ile Giriş Yap (OAuth2)</button>
        <p class="hint">Girişten sonra kullanıcının kendi SIP Token'ı otomatik çekilir.</p>
      </div>
      <div id="tabManual" class="pane" hidden>
        <label>Access Token (opsiyonel)<input id="mAccess" placeholder="OAuth access token" /></label>
        <label>SIP Kullanıcı / Dahili<input id="mUser" placeholder="1001" /></label>
        <label>SIP Realm / Domain<input id="mRealm" placeholder="firma.sip.hipcall.com.tr" /></label>
        <label>SIP JWT Token / Parola<input id="mToken" placeholder="eyJhbGciOi..." /></label>
        <label>WSS Adresi<input id="mWs" value="${env.VITE_HIPCALL_WS_URL}" /></label>
        <label>Kimlik doğrulama modu
          <select id="mMode"><option value="both">password + Bearer header</option>
          <option value="password">sadece password</option><option value="bearer">sadece Bearer header</option></select></label>
        <button id="btnManual" class="btn primary wide">SIP'e Bağlan</button>
        <p class="hint">SIP alanları boşsa Access Token ile /sip_credentials çağrılır.</p>
        <div style="margin-top:12px; padding-top:10px; border-top:1px dashed var(--line);">
          <label>API Endpoint Testi (Token ile)
            <div style="display:flex; gap:6px; margin-top:4px;">
              <input id="testEndpoint" value="/profile" placeholder="/profile veya /sip_credentials" style="margin-top:0;" />
              <button id="btnTestApi" type="button" class="btn ghost" style="padding:8px 12px; font-size:12px; white-space:nowrap;">Test Et</button>
            </div>
          </label>
        </div>
      </div>
    </section>

    <section id="viewDial" hidden>
      <input id="number" class="number" placeholder="Numara girin" />
      <div class="pad" id="pad"></div>
      <div class="row">
        <button id="btnBack" class="btn ghost">⌫</button>
        <button id="btnCall" class="btn green grow">Ara</button>
      </div>
    </section>

    <section id="viewIncoming" hidden>
      <div class="who"><div class="label">Gelen Çağrı</div><div id="inNum" class="big"></div></div>
      <div class="row">
        <button id="btnAnswer" class="btn green grow">Cevapla</button>
        <button id="btnReject" class="btn red grow">Reddet</button>
      </div>
    </section>

    <section id="viewActive" hidden>
      <div class="who"><div id="actLabel" class="label"></div><div id="actNum" class="big"></div>
        <div id="timer" class="timer">00:00</div></div>
      <div class="pad small" id="dtmfPad"></div>
      <div class="row">
        <button id="btnMute" class="btn ghost grow">Sessize Al</button>
        <button id="btnHold" class="btn ghost grow">Beklet</button>
        <button id="btnHang" class="btn red grow">Kapat</button>
      </div>
    </section>
    <div id="toast" class="toast" hidden></div>
  </div>

  <div class="console">
    <div class="console-head">SIP &amp; WebRTC Debug Konsolu
      <span><button id="logCopy" class="link">Kopyala</button><button id="logClear" class="link">Temizle</button></span></div>
    <pre id="log"></pre>
  </div>
</div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const views = ['viewLogin', 'viewDial', 'viewIncoming', 'viewActive'];
const show = (id: string) => views.forEach((v) => ($(v).hidden = v !== id));

function setStatus(text: string, cls: 'off' | 'wait' | 'on' | 'err') {
  $('statusText').textContent = text;
  $('dot').className = `dot ${cls}`;
}
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 4000);
}

// -------- log paneli
const logEl = $('log');
function appendLog(dir: string, msg: string, time = Date.now()) {
  const line = document.createElement('div');
  line.className = `l-${dir}`;
  const ts = new Date(time).toLocaleTimeString('tr-TR', { hour12: false });
  const arrow = dir === 'in' ? '◀ IN ' : dir === 'out' ? '▶ OUT' : dir === 'error' ? '✖ ERR' : '• INFO';
  const first = msg.split('\r\n')[0];
  const body = dir === 'in' || dir === 'out' ? `<details><summary>${esc(first)}</summary><pre>${esc(msg)}</pre></details>` : esc(msg);
  line.innerHTML = `<span class="ts">${ts}</span> <b>${arrow}</b> ${body}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
$('logClear').onclick = () => (logEl.innerHTML = '');
$('logCopy').onclick = () => navigator.clipboard.writeText(logEl.innerText);

// -------- dialpad
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
function buildPad(el: HTMLElement, onKey: (k: string) => void) {
  KEYS.forEach((k) => {
    const b = document.createElement('button');
    b.textContent = k;
    b.className = 'key';
    b.onclick = () => onKey(k);
    el.appendChild(b);
  });
}
const numberInput = $<HTMLInputElement>('number');
buildPad($('pad'), (k) => (numberInput.value += k));
buildPad($('dtmfPad'), (k) => client.sendDTMF(k));
$('btnBack').onclick = () => (numberInput.value = numberInput.value.slice(0, -1));
numberInput.addEventListener('keydown', (e) => e.key === 'Enter' && $('btnCall').click());

$('btnCall').onclick = async () => {
  const n = numberInput.value.trim();
  if (!n) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    client.call(n, stream);
  } catch (e: any) {
    toast(`Mikrofon hatası: ${e.message || String(e)}`);
  }
};

// -------- aktif çağrı & sayaç
let timerId: number | undefined;
function startTimer(from: number) {
  stopTimer();
  const tick = () => {
    const s = Math.floor((Date.now() - from) / 1000);
    $('timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  timerId = window.setInterval(tick, 1000);
}
function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = undefined;
  $('timer').textContent = '00:00';
}
function showActive(c: CallInfo, label: string) {
  $('actNum').textContent = c.remoteName ? `${c.remoteName} (${c.remoteNumber})` : c.remoteNumber;
  $('actLabel').textContent = label;
  $('btnMute').textContent = 'Sessize Al';
  $('btnHold').textContent = 'Beklet';
  $('btnHold').className = 'btn ghost grow';
  show('viewActive');
}

$('btnAnswer').onclick = async () => {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
    client.answer();
  } catch (e: any) {
    toast(e.message || String(e));
  }
};
$('btnReject').onclick = () => client.hangup();
$('btnHang').onclick = () => client.hangup();
$('btnMute').onclick = () => client.toggleMute();
$('btnHold').onclick = async () => {
  try {
    await client.toggleHold();
  } catch (e: any) {
    toast(e.message || String(e));
  }
};

// -------- SDK eventleri
client.on('sipLog', (l) => appendLog(l.direction, l.message, l.time));
client.on('connecting', () => setStatus('Connecting...', 'wait'));
client.on('registered', () => {
  setStatus('Registered', 'on');
  $('logout').hidden = false;
  show('viewDial');
});
client.on('unregistered', () => setStatus('Unregistered', 'off'));
client.on('disconnected', () => setStatus('Disconnected', 'off'));
client.on('registrationFailed', (e) => {
  setStatus('Registration failed', 'err');
  toast(`Kayıt başarısız: ${e.cause}${e.code ? ' (' + e.code + ')' : ''}`);
  if (!client.isRegistered) show('viewLogin');
});
client.on('incomingCall', (c) => {
  $('inNum').textContent = c.remoteName ? `${c.remoteName} (${c.remoteNumber})` : c.remoteNumber;
  show('viewIncoming');
});
client.on('callConnecting', (c) => showActive(c, 'Aranıyor...'));
client.on('callConnected', (c) => {
  showActive(c, 'Görüşülüyor');
  startTimer(c.startedAt ?? Date.now());
});
client.on('muteChanged', ({ muted }) => ($('btnMute').textContent = muted ? 'Sesi Aç' : 'Sessize Al'));
client.on('callFailed', ({ cause }) => {
  if (cause !== 'Canceled') {
    toast(`Çağrı başarısız: ${cause}`);
  }
});
client.on('callEnded', () => {
  stopTimer();
  if (client.isRegistered) show('viewDial');
});

// -------- giriş
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $('tabOauth').hidden = t.dataset.tab !== 'oauth';
    $('tabManual').hidden = t.dataset.tab !== 'manual';
  };
});
const USER_ID_KEY = 'hipcall_demo_user_id';
const savedUserId = localStorage.getItem(USER_ID_KEY);
if (savedUserId && $('oUserId')) {
  ($('oUserId') as HTMLInputElement).value = savedUserId;
}

const getUserId = (): number | string | undefined => {
  const el = $('oUserId') as HTMLInputElement | null;
  const val = el?.value.trim();
  if (val) {
    localStorage.setItem(USER_ID_KEY, val);
    return !isNaN(Number(val)) ? Number(val) : val;
  }
  localStorage.removeItem(USER_ID_KEY);
  return undefined;
};

$('btnOAuth').onclick = async () => {
  getUserId();
  await client.loginWithOAuth();
};

const FORM_KEY = 'hipcall_demo_manual';
const fields = ['mAccess', 'mUser', 'mRealm', 'mToken', 'mWs', 'mMode'];
try {
  const saved = JSON.parse(localStorage.getItem(FORM_KEY) || '{}');
  fields.forEach((f) => saved[f] && (($(f) as HTMLInputElement).value = saved[f]));
} catch {
  /* yoksay */
}

// API endpoint test butonu
const btnTestApi = $('btnTestApi');
if (btnTestApi) {
  btnTestApi.onclick = async () => {
    const manualToken = ($('mAccess') as HTMLInputElement)?.value.trim();
    const storedToken = (client as any).oauth.loadTokens()?.access_token;
    const token = manualToken || storedToken;
    if (!token) return toast('Önce Access Token girin veya OAuth girişi yapın.');
    const ep = ($('testEndpoint') as HTMLInputElement)?.value.trim() || '/profile';
    const isPost = ep.includes('/token');
    const uId = getUserId();
    const url = `${isDev ? '/hipcall-api' : env.VITE_HIPCALL_API_BASE_URL}${ep.startsWith('/') ? ep : '/' + ep}`;
    appendLog('info', `API Test: ${isPost ? 'POST' : 'GET'} ${url}`);
    try {
      const res = await fetch(url, {
        method: isPost ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, application/vnd.api+json, */*',
        },
        body: isPost ? JSON.stringify({ user_id: Number(uId) || uId }) : undefined,
      });
      const text = await res.text();
      appendLog(res.ok ? 'in' : 'error', `HTTP ${res.status} Yanıtı:\n${text}`);
    } catch (e: any) {
      appendLog('error', `İstek hatası: ${e.message}`);
    }
  };
}

async function connect(userId?: number | string) {
  try {
    setStatus('Connecting...', 'wait');
    const uId = userId ?? getUserId();
    await client.connectSIP({ userId: uId });
  } catch (e: any) {
    appendLog('error', e.message || String(e));
    setStatus('Disconnected', 'err');
    toast(e.message || String(e));
    show('viewLogin');
  }
}

$('btnManual').onclick = async () => {
  const v = (id: string) => ($(id) as HTMLInputElement).value.trim();
  localStorage.setItem(FORM_KEY, JSON.stringify(Object.fromEntries(fields.map((f) => [f, v(f)]))));
  (client.config as any).authMode = v('mMode');
  try {
    client.setManualCredentials({
      accessToken: v('mAccess') || undefined,
      username: v('mUser') || undefined,
      sipToken: v('mToken') || undefined,
      realm: v('mRealm') || undefined,
      wsServers: v('mWs') ? [v('mWs')] : undefined,
    });
  } catch (e: any) {
    return toast(e.message);
  }
  await connect();
};

$('logout').onclick = () => {
  client.logout();
  $('logout').hidden = true;
  setStatus('Disconnected', 'off');
  show('viewLogin');
};

// -------- OAuth callback & oturum devamı
(async function init() {
  setStatus('Disconnected', 'off');
  const url = new URL(location.href);
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const err = url.searchParams.get('error');
    history.replaceState({}, '', '/');
    if (err) {
      appendLog('error', `OAuth hatası: ${err} ${url.searchParams.get('error_description') ?? ''}`);
      return toast('OAuth hatası: ' + err);
    }
    if (code) {
      try {
        await client.handleOAuthCallback(code, url.searchParams.get('state'));
        await connect();
      } catch (e: any) {
        appendLog('error', e.message || String(e));
        toast(e.message || String(e));
      }
    }
    return;
  }
  if (client.isAuthenticated) {
    appendLog('info', 'Kayıtlı token bulundu, otomatik bağlanılıyor...');
    await connect();
  }
})();

