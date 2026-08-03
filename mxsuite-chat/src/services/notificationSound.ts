/**
 * Notification sounds generated via Web Audio API — no audio files needed.
 * Three urgency levels with distinct tones:
 *   urgent  – double-chime "ding-dong" for help requests
 *   message – soft single pop for new chat messages
 *   subtle  – quiet blip for file shares / mentions
 */

const MUTE_KEY = 'mxsuite_sound_muted';

export function isMuted(): boolean {
  return localStorage.getItem(MUTE_KEY) === 'true';
}

export function setMuted(muted: boolean) {
  localStorage.setItem(MUTE_KEY, String(muted));
}

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(frequency: number, duration: number, volume: number, delay = 0, type: OscillatorType = 'sine') {
  try {
    const ac = ctx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, ac.currentTime + delay);
    gain.gain.linearRampToValueAtTime(volume, ac.currentTime + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + duration);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(ac.currentTime + delay);
    osc.stop(ac.currentTime + delay + duration);
  } catch { /* audio not available */ }
}

/** Double-chime "ding-dong" — help requests */
export function playUrgent() {
  if (isMuted()) return;
  playTone(880, 0.25, 0.3, 0, 'sine');       // high "ding"
  playTone(660, 0.35, 0.3, 0.22, 'sine');    // lower "dong"
}

/** Soft single pop — new chat message */
export function playMessage() {
  if (isMuted()) return;
  playTone(600, 0.15, 0.15, 0, 'sine');
}

/** Quiet blip — file share / mention */
export function playSubtle() {
  if (isMuted()) return;
  playTone(500, 0.08, 0.08, 0, 'triangle');
}
