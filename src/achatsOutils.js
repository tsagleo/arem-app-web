// Outils des achats groupés (2026-10-10) : signal sonore et vibration à la remise.
export function bip(ok) {
  try {
    if (navigator.vibrate) navigator.vibrate(ok ? 120 : [80, 60, 80]);
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination);
    o.start(); setTimeout(() => { o.stop(); ctx.close(); }, ok ? 160 : 350);
  } catch { /* son indisponible */ }
}
