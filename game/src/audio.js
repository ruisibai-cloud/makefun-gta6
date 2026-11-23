// Sound, all synthesized with Web Audio: no audio files ship with the game.
// An engine hum that follows speed, a two-tone siren, gunshots and
// explosions from shaped noise, pickup chimes, and a small bass loop.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenOn = false;
    this.sirenTimer = 0;
    this.musicTimer = 0;
    this.musicStep = 0;
    this.started = false;
  }

  /** Create the context on a user gesture; browsers block it before then. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.started = true;
      // Engine: a low sawtooth whose pitch follows speed.
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      const engineFilter = this.ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      this.engineOsc.connect(engineFilter);
      engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);
      this.engineOsc.start();
      // Siren: a sine that alternates between two notes.
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'sine';
      this.sirenOsc.frequency.value = 720;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.ctx.destination);
      this.sirenOsc.start();
    } catch {
      this.ctx = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) {
      if (this.engineGain) this.engineGain.gain.value = 0;
      if (this.sirenGain) this.sirenGain.gain.value = 0;
    }
    return this.muted;
  }

  setEngine(speed01, inCar) {
    if (!this.ctx || this.muted) return;
    if (!inCar || speed01 <= 0.01) {
      this.engineGain.gain.value = inCar ? 0.03 : 0;
      if (this.engineOsc) this.engineOsc.frequency.value = 55;
      return;
    }
    this.engineGain.gain.value = 0.03 + speed01 * 0.05;
    this.engineOsc.frequency.value = 55 + speed01 * 130;
  }

  setSiren(on) {
    this.sirenOn = on;
  }

  blip(freq, dur, type, vol) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol || 0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  noise(dur, filterFreq, vol) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(t);
  }

  gunshot(far) {
    this.noise(0.12, far ? 900 : 2400, far ? 0.1 : 0.22);
  }

  explosion() {
    this.noise(0.7, 320, 0.5);
    this.blip(48, 0.6, 'sine', 0.4);
  }

  pickup() {
    this.blip(880, 0.09, 'sine', 0.12);
    setTimeout(() => this.blip(1320, 0.12, 'sine', 0.1), 70);
  }

  click() {
    this.blip(660, 0.06, 'square', 0.06);
  }

  carDoor() {
    this.noise(0.08, 500, 0.18);
  }

  horn() {
    this.blip(370, 0.28, 'square', 0.09);
  }

  missionDone() {
    this.blip(523, 0.12, 'sine', 0.14);
    setTimeout(() => this.blip(659, 0.12, 'sine', 0.14), 110);
    setTimeout(() => this.blip(784, 0.2, 'sine', 0.14), 220);
  }

  /** A tiny bass line, one note per step, looped while the game runs. */
  update(dt, playing) {
    if (!this.ctx || this.muted) return;
    if (this.sirenGain) {
      this.sirenTimer += dt;
      const hi = Math.floor(this.sirenTimer / 0.45) % 2 === 0;
      this.sirenOsc.frequency.value = hi ? 720 : 540;
      this.sirenGain.gain.value = this.sirenOn && playing ? 0.035 : 0;
    }
    if (!playing) return;
    this.musicTimer += dt;
    const stepDur = 0.22;
    if (this.musicTimer >= stepDur) {
      this.musicTimer -= stepDur;
      const line = [55, 0, 55, 65.4, 0, 55, 0, 49, 55, 0, 55, 65.4, 73.4, 0, 65.4, 49];
      const note = line[this.musicStep % line.length];
      this.musicStep += 1;
      if (note > 0) this.blip(note * 2, 0.2, 'triangle', 0.05);
    }
  }
}
