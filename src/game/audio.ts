// Synthesised sound effects and music (no audio files to ship). Sound plays only when both the
// platform's audio setting and the in-game toggle allow it, and the context is suspended while the
// game is paused.

type Ctx = AudioContext;

// Background music: a soft eight-bar arpeggio over C - Am - F - G, one note per eighth.
const NOTE: Record<string, number> = {
  F2: 87.31, G2: 98.0, A2: 110.0, C3: 130.81,
  E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25,
};
const MELODY = [
  'C5 - G4 - E4 - G4 -', 'A4 - E4 - C5 - E4 -', 'A4 - F4 - C5 - F4 -', 'B4 - G4 - D5 - G4 B4',
  'E5 - C5 - G4 - C5 -', 'E5 - C5 - A4 - C5 -', 'C5 - A4 - F4 - A4 C5', 'D5 - B4 - G4 - - -',
].flatMap((bar) => bar.split(' '));
const BASS = ['C3', 'A2', 'F2', 'G2'];
/** Seconds per eighth note (100 beats a minute). */
const EIGHTH = 0.3;
/** How far ahead notes are scheduled, so a slow frame never leaves a gap. */
const LOOKAHEAD = 0.5;

export class Sfx {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private scratch: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private enabled = true;
  private paused = false;
  private music: GainNode | null = null;
  private musicStep = 0;
  private musicAt = 0;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (!this.enabled || this.paused) return;
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = (seed / 0x3fffffff - 1) * 0.9;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.drawEnd();
    this.applyState();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.drawEnd();
    this.applyState();
  }

  private applyState(): void {
    if (!this.ctx) return;
    if (this.enabled && !this.paused) void this.ctx.resume().catch(() => {});
    else void this.ctx.suspend().catch(() => {});
  }

  private ready(): Ctx | null {
    if (!this.enabled || this.paused || !this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, vol: number, q = 1, type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ready();
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** Keeps the background music going: call every frame. Schedules the next half second of notes. */
  musicTick(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    if (!this.music) {
      const soft = ctx.createBiquadFilter();
      soft.type = 'lowpass';
      soft.frequency.value = 2200;
      this.music = ctx.createGain();
      this.music.gain.value = 0.2;
      this.music.connect(soft).connect(this.master);
      this.musicAt = ctx.currentTime + 0.2;
    }
    // After the tab was hidden or the game paused for long, pick up from now instead of catching up.
    if (this.musicAt < ctx.currentTime) this.musicAt = ctx.currentTime + 0.05;
    while (this.musicAt < ctx.currentTime + LOOKAHEAD) {
      const step = this.musicStep;
      const note = NOTE[MELODY[step]];
      if (note) this.pluck(ctx, note, this.musicAt, 0.55, 'triangle', 0.22);
      if (step % 4 === 0) this.pluck(ctx, NOTE[BASS[Math.floor(step / 8) % BASS.length]], this.musicAt, 0.9, 'sine', 0.3);
      this.musicStep = (step + 1) % MELODY.length;
      this.musicAt += EIGHTH;
    }
  }

  private pluck(ctx: Ctx, freq: number, t: number, dur: number, type: OscillatorType, vol: number): void {
    if (!this.music) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  click(): void {
    this.tone(660, 0.06, 'triangle', 0.25, 880);
  }

  hit(strength: number): void {
    const v = Math.min(0.5, 0.05 + strength * 0.03);
    this.tone(180 + Math.min(strength, 12) * 18, 0.07, 'sine', v, 90);
    this.burst(0.05, 1800, v * 0.6, 0.8);
  }

  bounce(): void {
    this.tone(220, 0.22, 'square', 0.12, 660);
    this.tone(330, 0.18, 'sine', 0.2, 990);
  }

  sink(): void {
    this.tone(520, 0.09, 'sine', 0.35, 260);
    this.tone(260, 0.16, 'sine', 0.3, 140, 0.07);
  }

  win(stars: number): void {
    const notes = [523, 659, 784, 1047];
    for (let i = 0; i < 2 + stars - 1; i++) this.tone(notes[i], 0.22, 'triangle', 0.25, undefined, 0.12 * i + 0.25);
  }

  /** A short rising run for a new unlock. */
  unlockJingle(): void {
    for (let i = 0; i < 4; i++) this.tone(660 + i * 110, 0.12, 'triangle', 0.2, undefined, 0.07 * i);
  }

  starPop(i: number): void {
    this.tone(784 + i * 196, 0.15, 'triangle', 0.22, 1568 + i * 200);
  }

  fail(): void {
    this.tone(300, 0.25, 'triangle', 0.22, 120);
  }

  splash(): void {
    this.burst(0.45, 900, 0.5, 0.6, 'lowpass');
    this.tone(400, 0.2, 'sine', 0.12, 180);
  }

  drawStart(): void {
    const ctx = this.ready();
    if (!ctx || !this.master || !this.noise || this.scratch) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.scratch = { src, gain, filter };
  }

  /** speed: world units per second of the finger. */
  drawMove(speed: number): void {
    if (!this.scratch || !this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.min(0.22, speed * 0.02);
    this.scratch.gain.gain.setTargetAtTime(v, t, 0.03);
    this.scratch.filter.frequency.setTargetAtTime(1800 + Math.min(speed, 20) * 120, t, 0.05);
  }

  drawEnd(): void {
    if (!this.scratch) return;
    const { src, gain } = this.scratch;
    this.scratch = null;
    try {
      if (this.ctx) gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      src.stop(this.ctx ? this.ctx.currentTime + 0.1 : 0);
    } catch {
      /* already stopped */
    }
  }
}
