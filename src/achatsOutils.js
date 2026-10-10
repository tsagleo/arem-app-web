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

// Confirmation visible d'une action (2026-10-10, demandé par l'utilisateur :
// « il faut une confirmation de validation ») : message vert en bas de
// l'écran pendant quelques secondes, sans dépendre de l'état React.
export function toast(texte, erreur = false) {
  try {
    const el = document.createElement("div");
    el.setAttribute("role", "status");
    el.textContent = texte;
    Object.assign(el.style, {
      position: "fixed", left: "50%", bottom: "28px", transform: "translateX(-50%)", zIndex: "3000",
      background: erreur ? "#C0392B" : "#1F8A5C", color: "white", padding: "12px 20px", borderRadius: "12px",
      fontWeight: "700", fontSize: "14.5px", boxShadow: "0 8px 30px rgba(0,0,0,.25)", maxWidth: "90vw", textAlign: "center",
      fontFamily: "inherit", transition: "opacity .4s",
    });
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; }, 2800);
    setTimeout(() => el.remove(), 3300);
  } catch { /* affichage impossible : l'action reste enregistrée */ }
}
