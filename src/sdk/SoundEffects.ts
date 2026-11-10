/**
 * Web Audio API ile harici mp3/ses dosyasına ihtiyaç duymadan
 * zil sesi, arama tonu (ringback) ve DTMF bip sesleri üreten yardımcı.
 */
export class SoundEffects {
  private ctx: AudioContext | null = null;
  private ringOsc1: OscillatorNode | null = null;
  private ringOsc2: OscillatorNode | null = null;
  private ringInterval: number | undefined;

  private getContext(): AudioContext | null {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** Gelen çağrı zili (Avrupa standardı çift ton: 440Hz + 480Hz, 1s açık / 2s sessiz) */
  startRinging(): void {
    this.stopRinging();
    const ctx = this.getContext();
    if (!ctx) return;

    const playBurst = () => {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.frequency.setValueAtTime(440, now);
      osc2.frequency.setValueAtTime(480, now);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.05);
      gain.gain.setValueAtTime(0.18, now + 1.2);
      gain.gain.linearRampToValueAtTime(0, now + 1.25);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.25);
      osc2.stop(now + 1.25);
    };

    playBurst();
    this.ringInterval = window.setInterval(playBurst, 3500);
  }

  stopRinging(): void {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = undefined;
    }
    try {
      this.ringOsc1?.stop();
      this.ringOsc2?.stop();
    } catch {}
    this.ringOsc1 = null;
    this.ringOsc2 = null;
  }

  /** Karşı taraf aranırken çalan ringback tonu (440Hz + 480Hz, 1.5s açık / 3s sessiz) */
  startRingback(): void {
    this.stopRingback();
    const ctx = this.getContext();
    if (!ctx) return;

    const playBurst = () => {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.frequency.setValueAtTime(440, now);
      osc2.frequency.setValueAtTime(480, now);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
      gain.gain.setValueAtTime(0.12, now + 1.5);
      gain.gain.linearRampToValueAtTime(0, now + 1.55);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.55);
      osc2.stop(now + 1.55);
    };

    playBurst();
    this.ringInterval = window.setInterval(playBurst, 4500);
  }

  stopRingback(): void {
    this.stopRinging();
  }

  /** DTMF frekans çiftleri (ITU-T Q.23 standardı) */
  playDTMF(tone: string): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const dtmfFreqs: Record<string, [number, number]> = {
      '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
      '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
      '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
      '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
    };

    const freqs = dtmfFreqs[tone.toUpperCase()];
    if (!freqs) return;

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.frequency.setValueAtTime(freqs[0], now);
    osc2.frequency.setValueAtTime(freqs[1], now);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
    gain.gain.setValueAtTime(0.15, now + 0.12);
    gain.gain.linearRampToValueAtTime(0, now + 0.14);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.14);
    osc2.stop(now + 0.14);
  }
}

