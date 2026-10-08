import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Copies locales non suivies par git (voir .gitignore) : pas du code de l'app.
  globalIgnores(['dist', 'Claude outputs', 'src/App-1.jsx', 'src/shared-1.jsx']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Règles « React Compiler » : elles signalent le chargement de données
      // utilisé dans toute l'app — useEffect(() => { load(); }, [load]) — et
      // les Date.now() au rendu, qui fonctionnent correctement ici. Gardées
      // en avertissement pour rester visibles sans bloquer.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  {
    // shared.jsx est volontairement la boîte à outils commune (composants +
    // fonctions + traductions) ; seul le rechargement à chaud en pâtit.
    files: ['src/shared.jsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
])
