import JsSIP from 'jssip';
import { TypedEmitter } from './EventEmitter';
import { resolveConfig } from './config';
import { OAuthModule, extractUserIdFromToken } from './OAuth';
import { SoundEffects } from './SoundEffects';
import type { AudioDeviceInfo, CallInfo, HipcallConfig, HipcallEvents, SipCredentials, TokenSet } from './types';

/**
 * Hipcall WebRTC/SIP SDK ana sınıfı.
 *
 *   const client = new HipcallClient({ ... });
 *   client.on('registered', () => ...);
 *   await client.setManualCredentials({ ... });  // veya loginWithOAuth() / handleOAuthCallback(code)
 *   await client.connectSIP();
 *   client.call('905551112233');
 */
export class HipcallClient extends TypedEmitter<HipcallEvents> {
  readonly config: HipcallConfig;
  private oauth: OAuthModule;
  private ua: any = null;
  private session: any = null;
  private callInfo: CallInfo | null = null;
  private creds: SipCredentials | null = null;
  private audioEl: HTMLAudioElement;
  private localStream: MediaStream | null = null;
  private _registered = false;
  readonly sounds: SoundEffects;

  constructor(config: Partial<HipcallConfig> = {}) {
    super();
    this.config = resolveConfig(config);
    this.oauth = new OAuthModule(this.config);
    this.audioEl = this.config.audioElement ?? this.createAudioElement();
    this.sounds = new SoundEffects();
  }

  // =====================================================================
  // 1) Kimlik doğrulama
  // =====================================================================

  /** Kullanıcıyı Hipcall authorize sayfasına yönlendirir (RFC 7636 PKCE destekli). */
  async loginWithOAuth(): Promise<void> {
    const url = await this.oauth.buildAuthorizeUrl();
    window.location.assign(url);
  }

  /** /callback?code=...&state=... dönüşünü işler. State kontrolü yapılır. */
  async handleOAuthCallback(code: string, state?: string | null): Promise<TokenSet> {
    if (state != null && state !== this.config.state) {
      throw new Error(`OAuth state uyuşmuyor (beklenen "${this.config.state}", gelen "${state}")`);
    }
    this.log('info', 'Authorization code token ile değiştiriliyor...');
    const tokens = await this.oauth.exchangeCode(code);
    this.log('info', "access_token alındı ve localStorage'a kaydedildi.");
    this.emit('authenticated', tokens);
    return tokens;
  }

  /**
   * Bypass / Test modu. İki şekilde kullanılabilir:
   *  - { accessToken }            -> fetchSipCredentials ile SIP bilgileri çekilir
   *  - { sipUri|username, sipToken|password, realm, wsServers } -> doğrudan SIP
   */
  setManualCredentials(input: {
    accessToken?: string;
    sipUri?: string;
    username?: string;
    sipToken?: string;
    password?: string;
    realm?: string;
    wsServers?: string[];
    displayName?: string;
  }): void {
    if (input.accessToken) {
      this.oauth.saveTokens({ access_token: input.accessToken, obtained_at: Date.now() });
      this.log('info', 'Manuel access_token ayarlandı.');
    }
    const token = input.sipToken ?? input.password;
    if (token && (input.sipUri || input.username)) {
      let username = input.username;
      let realm = input.realm;
      if (input.sipUri) {
        const m = input.sipUri.replace(/^sips?:/, '').split('@');
        username = username || m[0];
        realm = realm || m[1];
      }
      if (!username || !realm) throw new Error('username ve realm (veya tam sipUri) gerekli.');
      this.creds = {
        username,
        realm,
        sipToken: token,
        sipUri: input.sipUri?.startsWith('sip') ? input.sipUri : `sip:${username}@${realm}`,
        wsServers: input.wsServers?.length ? input.wsServers : [this.config.wsUrl],
        displayName: input.displayName,
      };
      this.log('info', `Manuel SIP bilgileri ayarlandı: ${this.creds.sipUri}`);
    } else if (!input.accessToken) {
      throw new Error('accessToken veya (sipUri/username + sipToken/password) verilmeli.');
    }
  }

  get isAuthenticated(): boolean {
    return !!this.creds || !!this.oauth.loadTokens();
  }

  logout(): void {
    this.disconnectSIP();
    this.oauth.clearTokens();
    this.creds = null;
  }

  // =====================================================================
  // 2) SIP bilgilerini çekme
  // =====================================================================
  async fetchSipCredentials(userId?: number | string): Promise<SipCredentials> {
    let tokens = this.oauth.loadTokens();
    if (!tokens) throw new Error('access_token yok. Önce OAuth girişi yapın veya setManualCredentials kullanın.');
    if (this.oauth.isExpired(tokens) && tokens.refresh_token) {
      this.log('info', 'access_token süresi dolmuş, yenileniyor...');
      tokens = await this.oauth.refresh();
    }
    const effectiveUserId =
      userId ?? this.config.userId ?? extractUserIdFromToken(tokens.access_token);

    this.log('info', `SIP kimlik bilgileri alınıyor (user_id: ${effectiveUserId ?? 'belirtilmedi'})...`);
    try {
      this.creds = await this.oauth.fetchSipCredentials(
        tokens.access_token,
        effectiveUserId,
        (m) => this.log('info', m),
      );
    } catch (e: any) {
      if (String(e.message).startsWith('401') && tokens.refresh_token) {
        this.log('info', '401 alındı, token yenilenip tekrar deneniyor...');
        tokens = await this.oauth.refresh();
        this.creds = await this.oauth.fetchSipCredentials(
          tokens.access_token,
          effectiveUserId,
          (m) => this.log('info', m),
        );
      } else {
        throw e;
      }
    }
    return this.creds;
  }

  // =====================================================================
  // 3) SIP over WebSocket + REGISTER
  // =====================================================================
  async connectSIP(options?: { userId?: number | string }): Promise<void> {
    if (!this.creds) await this.fetchSipCredentials(options?.userId);
    const c = this.creds!;
    if (this.ua) this.disconnectSIP();

    const wsUrl = c.wsServers?.[0] || this.config.wsUrl;
    const socket = this.createLoggingSocket(wsUrl);
    const mode = this.config.authMode;
    const uri = c.sipUri || `sip:${c.username}@${c.realm}`;

    const uaConfig: any = {
      sockets: [socket],
      uri,
      authorization_user: c.username,
      display_name: c.displayName,
      register: true,
      register_expires: this.config.registerExpires,
      session_timers: false,
      user_agent: 'hipcall-webrtc-sdk/0.1',
    };
    if (mode === 'password' || mode === 'both') uaConfig.password = c.sipToken;

    this.log('info', `UA oluşturuluyor: uri=${uri}, ws=${wsUrl}, authMode=${mode}`);
    this.ua = new JsSIP.UA(uaConfig);

    // REGISTER paketlerine Authorization: Bearer header'ı
    if (mode === 'bearer' || mode === 'both') {
      try {
        this.ua.registrator().setExtraHeaders(this.bearerHeaders());
      } catch (e) {
        this.log('error', 'REGISTER extra header ayarlanamadı: ' + e);
      }
    }

    this.bindUAEvents();
    this.emit('connecting');
    this.ua.start();
  }

  disconnectSIP(): void {
    if (this.session) {
      try {
        this.session.terminate();
      } catch {
        /* yoksay */
      }
    }
    if (this.ua) {
      try {
        this.ua.stop();
      } catch {
        /* yoksay */
      }
      this.ua = null;
    }
    this._registered = false;
    this.stopSounds();
  }

  get isRegistered(): boolean {
    return this._registered;
  }

  /** Sunucu 5 dk'da bir (register_expires=300) JsSIP tarafından otomatik yenilenir; elle de tetiklenebilir. */
  reRegister(): void {
    this.ua?.register();
  }

  private bearerHeaders(): string[] {
    return this.creds ? [`Authorization: Bearer ${this.creds.sipToken}`] : [];
  }

  private bindUAEvents() {
    const ua = this.ua;
    ua.on('connecting', () => this.log('info', 'WebSocket bağlanıyor...'));
    ua.on('connected', () => {
      this.log('info', 'WebSocket bağlandı.');
    });
    ua.on('disconnected', (e: any) => {
      this.log('error', `WebSocket kapandı (${e?.code ?? ''} ${e?.reason ?? ''})`);
      if (this._registered) {
        this._registered = false;
        this.emit('unregistered');
      }
      this.emit('disconnected', { error: e?.error, reason: e?.reason });
    });
    ua.on('registered', () => {
      this._registered = true;
      this.log('info', `Registered (yenileme: ${this.config.registerExpires} sn)`);
      this.emit('registered');
    });
    ua.on('unregistered', () => {
      this._registered = false;
      this.emit('unregistered');
    });
    ua.on('registrationFailed', (e: any) => {
      this._registered = false;
      const cause = e?.cause || 'unknown';
      this.log('error', `Registration failed: ${cause} ${e?.response?.status_code ?? ''}`);
      this.emit('registrationFailed', { cause, code: e?.response?.status_code });
    });
    ua.on('registrationExpiring', () => {
      this.log('info', 'Registration süresi doluyor, yenileniyor...');
    });
    ua.on('newRTCSession', (e: any) => this.onNewSession(e));
  }

  // =====================================================================
  // 4) Çağrı yönetimi
  // =====================================================================
  call(targetNumber: string, mediaStream?: MediaStream): void {
    if (!this.ua || !this._registered) throw new Error('SIP kaydı yok (registered değil).');
    if (this.session) throw new Error('Zaten aktif bir çağrı var.');
    const target = this.buildTargetUri(targetNumber);
    this.log('info', `INVITE hazırlanıyor -> ${target}`);
    const extraHeaders = this.config.authMode !== 'password' ? this.bearerHeaders() : [];

    // Salt ses araması: video track varsa kapat
    if (mediaStream) {
      mediaStream.getVideoTracks().forEach((vt) => {
        vt.stop();
        mediaStream.removeTrack(vt);
      });
    }

    this.ua.call(target, {
      mediaStream,
      mediaConstraints: { audio: true, video: false },
      pcConfig: this.pcConfig(),
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
      extraHeaders,
    });
  }

  answer(mediaStream?: MediaStream): void {
    if (!this.session || this.session.direction !== 'incoming') throw new Error('Cevaplanacak gelen çağrı yok.');
    this.stopSounds();
    if (mediaStream) {
      mediaStream.getVideoTracks().forEach((vt) => {
        vt.stop();
        mediaStream.removeTrack(vt);
      });
    }
    this.session.answer({
      mediaStream,
      mediaConstraints: { audio: true, video: false },
      pcConfig: this.pcConfig(),
      extraHeaders: this.config.authMode !== 'password' ? this.bearerHeaders() : [],
    });
  }

  /** Aktif aramayı kapatır; çalan gelen çağrıyı reddeder. */
  hangup(): void {
    this.stopSounds();
    if (!this.session) return;
    try {
      if (this.session.direction === 'incoming' && !this.session.isEstablished() && !this.session.isEnded()) {
        this.session.terminate({ status_code: 603, reason_phrase: 'Decline' });
      } else {
        this.session.terminate();
      }
    } catch (e) {
      this.log('error', 'hangup hatası: ' + e);
    }
  }

  /** @returns yeni mute durumu */
  toggleMute(): boolean {
    if (!this.session) return false;
    const muted = this.session.isMuted().audio as boolean;
    if (muted) this.session.unmute({ audio: true });
    else this.session.mute({ audio: true });
    const now = !muted;
    this.emit('muteChanged', { muted: now });
    return now;
  }

  get isMuted(): boolean {
    return !!this.session && this.session.isMuted().audio;
  }

  /** Çağrıyı beklemeye al (HOLD) */
  hold(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.session || !this.session.isEstablished()) return resolve(false);
      this.session.hold({}, () => {
        this.log('info', 'Çağrı beklemeye alındı (HOLD).');
        this.emit('holdChanged', { held: true });
        resolve(true);
      });
    });
  }

  /** Beklemedeki çağrıyı devam ettir (UNHOLD) */
  unhold(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.session || !this.session.isEstablished()) return resolve(false);
      this.session.unhold({}, () => {
        this.log('info', 'Çağrı devam ettiriliyor (UNHOLD).');
        this.emit('holdChanged', { held: false });
        resolve(true);
      });
    });
  }

  toggleHold(): Promise<boolean> {
    if (this.isHeld) return this.unhold();
    return this.hold();
  }

  get isHeld(): boolean {
    return !!this.session?.isOnHold().local;
  }

  sendDTMF(tone: string): void {
    if (this.config.enableSounds !== false) {
      this.sounds.playDTMF(tone);
    }
    if (!this.session || !this.session.isEstablished()) return;
    this.session.sendDTMF(tone, { duration: 160, interToneGap: 70 });
  }

  get currentCall(): CallInfo | null {
    return this.callInfo;
  }

  // =====================================================================
  // 5) Ses aygıtı yönetimi
  // =====================================================================
  async getAudioDevices(): Promise<AudioDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `${d.kind === 'audioinput' ? 'Mikrofon' : 'Hoparlör'} (${d.deviceId.slice(0, 5)})`,
          kind: d.kind as 'audioinput' | 'audiooutput',
        }));
    } catch {
      return [];
    }
  }

  async setAudioOutputDevice(deviceId: string): Promise<void> {
    if (typeof (this.audioEl as any).setSinkId === 'function') {
      await (this.audioEl as any).setSinkId(deviceId);
      this.log('info', `Ses çıkış aygıtı değiştirildi: ${deviceId}`);
    }
  }

  private buildTargetUri(n: string): string {
    const t = n.trim().replace(/[\s()-]/g, '');
    if (t.startsWith('sip:') || t.startsWith('sips:')) return t;
    const realm = this.creds?.realm || '';
    return `sip:${t.replace(/^\+/, '+')}@${realm}`;
  }

  private pcConfig(): RTCConfiguration {
    return { iceServers: this.config.stunServers.map((urls) => ({ urls })) };
  }

  private onNewSession(e: any) {
    const session = e.session;
    if (this.session) {
      // Meşgul: ikinci çağrıyı reddet
      if (e.originator === 'remote') {
        session.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
      }
      return;
    }
    this.session = session;
    const direction = session.direction as 'incoming' | 'outgoing';
    const ri = session.remote_identity;
    const info: CallInfo = {
      direction,
      remoteNumber: ri?.uri?.user ?? 'unknown',
      remoteName: ri?.display_name || undefined,
    };
    this.callInfo = info;

    if (session.connection) {
      this.attachPeerConnection(session.connection);
    }
    session.on('peerconnection', (pe: any) => this.attachPeerConnection(pe.peerconnection));
    session.on('sdp', (ev: any) => {
      if (ev.originator === 'local') {
        ev.sdp = cleanAudioSDP(ev.sdp);
        this.log('info', 'SDP ses paketleri PSTN/ses standartlarına uyarlandı (salt ses).');
      }
    });
    session.on('connecting', () => {
      if (direction === 'outgoing') this.emit('callConnecting', info);
    });
    session.on('sending', (ev: any) => {
      this.log('info', `SIP ${ev.request.method} paketi WebSocket üzerinden gönderiliyor...`);
    });
    let iceFallbackTimer: any = null;
    session.on('icecandidate', (ev: any) => {
      const cand = ev.candidate;
      if (cand && typeof ev.ready === 'function') {
        // STUN sunucusundan gerçek genel IP (srflx) geldiğinde hemen hazır ol
        if (cand.type === 'srflx') {
          if (iceFallbackTimer) clearTimeout(iceFallbackTimer);
          setTimeout(() => {
            try {
              ev.ready();
            } catch {}
          }, 150);
          return;
        }
        // STUN gecikirse en fazla 1000ms bekle, yerel host adayı yüzünden STUN'ı 100ms'de kesme!
        if (!iceFallbackTimer) {
          iceFallbackTimer = setTimeout(() => {
            try {
              ev.ready();
            } catch {}
          }, 1000);
        }
      }
    });
    session.on('getusermediafailed', (err: any) => {
      this.log('error', `Mikrofon erişim hatası: ${err?.message || err}`);
    });
    session.on('peerconnection:createofferfailed', (err: any) => {
      this.log('error', `WebRTC createOffer hatası: ${err?.message || err}`);
    });
    session.on('peerconnection:setlocaldescriptionfailed', (err: any) => {
      this.log('error', `WebRTC setLocalDescription hatası: ${err?.message || err}`);
    });
    session.on('progress', () => {
      this.log('info', 'Çağrı çalıyor (180/183)...');
      if (direction === 'outgoing' && this.config.enableSounds !== false) {
        this.sounds.startRingback();
      }
      this.emit('callRinging', info);
    });
    session.on('accepted', () => {
      this.stopSounds();
      this.log('info', '200 OK alındı/gönderildi.');
      if (session.connection) this.ensureRemoteAudio(session.connection);
    });
    session.on('confirmed', () => {
      this.stopSounds();
      info.startedAt = Date.now();
      this.log('info', 'Çağrı bağlandı (ACK).');
      if (session.connection) this.ensureRemoteAudio(session.connection);
      this.emit('callConnected', info);
    });
    session.on('ended', (ev: any) => this.finishCall(false, ev?.cause || 'ended'));
    session.on('failed', (ev: any) => this.finishCall(true, ev?.cause || 'failed'));
    session.on('muted', () => this.emit('muteChanged', { muted: true }));
    session.on('unmuted', () => this.emit('muteChanged', { muted: false }));
    session.on('hold', () => this.emit('holdChanged', { held: true }));
    session.on('unhold', () => this.emit('holdChanged', { held: false }));

    if (direction === 'incoming') {
      this.log('info', `Gelen çağrı: ${info.remoteNumber}`);
      if (this.config.enableSounds !== false) {
        this.sounds.startRinging();
      }
      this.emit('incomingCall', info);
    }
  }

  private stopSounds() {
    this.sounds.stopRinging();
    this.sounds.stopRingback();
  }

  private finishCall(failed: boolean, cause: string) {
    this.stopSounds();
    const call = this.callInfo!;
    this.session = null;
    this.callInfo = null;
    this.stopLocalMedia();
    this.audioEl.srcObject = null;
    this.log(failed ? 'error' : 'info', `Çağrı ${failed ? 'başarısız' : 'sona erdi'}: ${cause}`);
    if (failed) this.emit('callFailed', { call, cause });
    this.emit('callEnded', { call, cause });
  }

  private attachPeerConnection(pc: RTCPeerConnection) {
    if ((pc as any).__hipcallAttached) return;
    (pc as any).__hipcallAttached = true;

    pc.addEventListener('track', (ev: RTCTrackEvent) => {
      this.log('info', `Uzak ses akışı bağlandı (track: ${ev.track.kind}, id: ${ev.track.id})`);
      const stream = ev.streams?.[0] ?? new MediaStream([ev.track]);
      this.playRemoteStream(stream);
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      this.log('info', `WebRTC ICE Durumu: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this.ensureRemoteAudio(pc);
      }
    });
    pc.addEventListener('connectionstatechange', () => {
      this.log('info', `WebRTC Bağlantı Durumu: ${pc.connectionState}`);
    });
    // Yerel stream'i kapatabilmek için sender'lardan topla
    pc.addEventListener('negotiationneeded', () => this.captureLocal(pc));
    setTimeout(() => this.captureLocal(pc), 500);
  }

  private ensureRemoteAudio(pc: RTCPeerConnection) {
    const receivers = pc.getReceivers ? pc.getReceivers() : [];
    const audioTracks = receivers
      .map((r) => r.track)
      .filter((t): t is MediaStreamTrack => !!t && t.kind === 'audio');
    if (audioTracks.length > 0) {
      audioTracks.forEach((t) => {
        t.enabled = true;
      });
      const current = this.audioEl.srcObject as MediaStream | null;
      const currentIds = current ? current.getAudioTracks().map((t) => t.id).join(',') : '';
      const newIds = audioTracks.map((t) => t.id).join(',');
      if (!current || currentIds !== newIds) {
        this.playRemoteStream(new MediaStream(audioTracks));
      } else if (this.audioEl.paused) {
        this.audioEl.muted = false;
        this.audioEl.volume = 1.0;
        this.audioEl.play().catch((err) => {
          this.log('error', 'Ses devam ettirilemedi: ' + err);
        });
      }
    }
  }

  private playRemoteStream(stream: MediaStream) {
    stream.getAudioTracks().forEach((t) => {
      t.enabled = true;
    });
    this.audioEl.srcObject = stream;
    this.audioEl.muted = false;
    this.audioEl.volume = 1.0;
    this.audioEl
      .play()
      .then(() => {
        this.log('info', 'Uzak ses hoparlöre verildi (oynatılıyor).');
      })
      .catch((err) => {
        this.log('error', 'Ses oynatılamadı (autoplay engeli?): ' + err);
      });
  }

  private captureLocal(pc: RTCPeerConnection) {
    const tracks = pc.getSenders().map((s) => s.track).filter((t): t is MediaStreamTrack => !!t);
    if (tracks.length) this.localStream = new MediaStream(tracks);
  }

  private stopLocalMedia() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }

  /** Uzak ses akışı (varsa) */
  get remoteStream(): MediaStream | null {
    return (this.audioEl.srcObject as MediaStream) ?? null;
  }

  // =====================================================================
  // Yardımcılar
  // =====================================================================
  private createAudioElement(): HTMLAudioElement {
    const existing = document.getElementById('hipcall-remote-audio') as HTMLAudioElement | null;
    if (existing) {
      existing.muted = false;
      existing.volume = 1.0;
      return existing;
    }
    const a = document.createElement('audio');
    a.id = 'hipcall-remote-audio';
    a.autoplay = true;
    a.muted = false;
    a.volume = 1.0;
    a.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
    document.body.appendChild(a);
    return a;
  }

  /** Ham SIP mesajlarını (gelen/giden) sipLog olarak yayınlayan WebSocketInterface */
  private createLoggingSocket(url: string) {
    const socket: any = new JsSIP.WebSocketInterface(url);
    const origSend = socket.send.bind(socket);
    socket.send = (msg: string) => {
      this.log('out', String(msg));
      return origSend(msg);
    };
    let inner: ((d: any) => void) | undefined;
    Object.defineProperty(socket, 'ondata', {
      configurable: true,
      set: (fn) => {
        inner = fn;
      },
      get: () => (data: any) => {
        this.log('in', typeof data === 'string' ? data : '[binary]');
        inner?.(data);
      },
    });
    return socket;
  }

  private log(direction: HipcallEvents['sipLog']['direction'], message: string) {
    this.emit('sipLog', { direction, message, time: Date.now() });
  }
}

/**
 * WebRTC SDP'sini standart GSM/PSTN santral uyumluluğuna göre optimize eder:
 * 1) Operatörün (IMS/VoLTE) çağrıyı görüntülü arama sanmasına yol açan video eklentilerini temizler.
 * 2) Türkiye santrallerinde evrensel olan PCMA (G.711 A-law / payload 8) ve PCMU (0)'yu öne alır.
 */
export function cleanAudioSDP(sdp: string): string {
  const lines = sdp.split(/\r?\n/);
  const filteredLines: string[] = [];

  const isVirtualIp = (ip: string) =>
    ip.startsWith('10.') ||
    ip.startsWith('127.') ||
    ip.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);

  // 1) Önce STUN Public IP (srflx) adayını, yoksa gerçek fiziksel LAN IP'sini (192.168.x.x) bul
  let srflxIp: string | undefined;
  let lanIp: string | undefined;
  for (const line of lines) {
    if (line.startsWith('a=candidate:')) {
      const parts = line.split(' ');
      const ip = parts[4];
      const typ = parts[7];
      if (typ === 'srflx' && ip) {
        srflxIp = ip;
        break;
      }
      if (!lanIp && ip && !isVirtualIp(ip)) {
        lanIp = ip;
      }
    }
  }
  const bestIp = srflxIp || lanIp;

  for (let line of lines) {
    // GSM operatörlerinin (VoLTE/ViLTE) görüntülü görüşme sanmasına yol açan video eklentilerini kaldır
    if (line.includes('abs-send-time')) continue;
    if (line.includes('transport-wide-cc')) continue;
    if (line.includes('transport-cc')) continue;

    // Sanal adaptör (WSL / Hyper-V / Docker: 10.x.x.x veya 172.16-31.x.x) candidate satırlarını çıkar
    if (line.startsWith('a=candidate:') && bestIp) {
      const parts = line.split(' ');
      const candIp = parts[4];
      if (candIp && isVirtualIp(candIp)) {
        continue;
      }
    }

    // c=IN IP4 satırına her zaman STUN Public IP (veya gerçek LAN IP) yaz ki santral RTP sesini doğru adrese göndersin
    if (line.startsWith('c=IN IP4 ') && bestIp) {
      line = `c=IN IP4 ${bestIp}`;
    }

    // m=audio satırında PSTN/GSM standardı olan PCMA (8) ve PCMU (0)'yu öne al
    if (line.startsWith('m=audio ')) {
      const parts = line.split(' ');
      const prefix = parts.slice(0, 3).join(' ');
      const payloads = parts.slice(3);
      const preferred = ['8', '0', '111'];
      const reordered = [
        ...preferred.filter((p) => payloads.includes(p)),
        ...payloads.filter((p) => !preferred.includes(p)),
      ];
      line = `${prefix} ${reordered.join(' ')}`;
    }

    filteredLines.push(line);
  }

  let result = filteredLines.join('\r\n');
  if (!result.endsWith('\r\n')) result += '\r\n';
  return result;
}
