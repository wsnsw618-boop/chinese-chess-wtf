type SoundKind = 'move' | 'capture' | 'check' | 'duel' | 'win' | 'click';

export class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (this.ctx) return this.ctx;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  play(kind: SoundKind): void {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.12, now + 0.005);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = kind === 'capture' ? 'triangle' : kind === 'duel' ? 'sine' : 'sine';
    const base =
      kind === 'move' ? 440 :
      kind === 'capture' ? 220 :
      kind === 'check' ? 660 :
      kind === 'duel' ? 330 :
      kind === 'win' ? 523 :
      600;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 0.7, now + 0.15);
    osc.connect(master);
    osc.start(now);
    osc.stop(now + 0.2);

    if (kind === 'win' || kind === 'duel') {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(base * 1.5, now + 0.05);
      osc2.frequency.exponentialRampToValueAtTime(base * 2, now + 0.3);
      gain2.gain.setValueAtTime(0.0001, now);
      gain2.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      osc2.connect(gain2).connect(ctx.destination);
      osc2.start(now + 0.05);
      osc2.stop(now + 0.35);
    }
  }
}
