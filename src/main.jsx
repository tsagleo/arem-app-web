import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { registerServiceWorker } from './shared'

// Mode hors-ligne / application installable (PWA), suite 84, 2026-09-28 —
// enregistré ici (au démarrage, pour TOUT le monde) plutôt que seulement
// lors d'un clic sur 🔔 (comme le faisait la suite 82 pour les
// notifications push) : c'est ce qui permet à l'application de mettre en
// cache son interface et de continuer à s'afficher hors ligne, même pour
// un utilisateur qui ne s'abonne jamais aux notifications.
registerServiceWorker();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
