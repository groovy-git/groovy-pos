// Scan feedback: short beep + vibration (vibration works on Android, ignored on iOS).
let ctx;
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, ms, type = "sine", gain = 0.18) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g);
  g.connect(a.destination);
  const t = a.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  o.start(t);
  o.stop(t + ms / 1000);
}

export function beepOk() {
  tone(1480, 110, "square", 0.08);
  navigator.vibrate?.(40);
}

export function beepError() {
  tone(220, 260, "sawtooth", 0.12);
  navigator.vibrate?.([80, 60, 80]);
}

// call once from a user gesture so iOS allows sound later
export function unlockAudio() {
  audio();
}
