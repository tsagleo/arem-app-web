import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    // host: true — écoute sur toutes les interfaces réseau (pas seulement
    // localhost), pour pouvoir tester depuis un téléphone sur le même
    // Wi-Fi (nécessaire pour scanner un QR de carte de membre, Phase 4,
    // ou pour tester la PWA sur mobile en général). Sans danger : ça
    // n'ouvre rien vers Internet, seulement vers le réseau local.
    host: true,
  },
})
