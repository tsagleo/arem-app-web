// =====================================================================
// sw.js — Service Worker : notifications push web + mise en cache pour
// le mode hors-ligne / installation en tant qu'application (PWA)
// =====================================================================
// 2026-09-28 (suite 82 — notifications push — puis suite 84 — mode
// hors-ligne/PWA, chantier « internationalisation », voir
// claude/internationalisation-universelle.md). Enregistré au démarrage de
// l'application (`registerServiceWorker()` dans shared.jsx, appelé depuis
// main.jsx — indépendamment de l'abonnement aux notifications push depuis
// la suite 84). Servi à la racine du site par Vite (fichiers de public/
// copiés tels quels), condition nécessaire pour qu'il contrôle toute
// l'application (scope "/").
//
// PARTIE CACHE (suite 84) — objectif volontairement limité à
// « installable + résilient », PAS de vraies données hors-ligne :
//   - Ne met en cache QUE les requêtes de MÊME ORIGINE (l'application
//     elle-même : page, scripts, styles, icônes) — jamais les appels vers
//     Supabase (autre origine), qui doivent toujours échouer normalement
//     s'il n'y a pas de réseau plutôt que de servir une donnée périmée.
//   - Stratégie « réseau d'abord, cache en secours » (network-first) :
//     tant qu'il y a du réseau, TOUJOURS la version la plus fraîche (et on
//     la met à jour dans le cache au passage) ; seulement hors ligne, on
//     sert la dernière version connue. Aucune fraîcheur perdue pendant le
//     développement (`npm run dev`) — le cache ne sert jamais tant que le
//     réseau répond.
//   - Pas de liste de fichiers à maintenir à la main : Vite change le nom
//     des fichiers JS/CSS à chaque build (empreinte dans le nom), donc on
//     alimente le cache au fur et à mesure des vraies requêtes plutôt que
//     de deviner les noms à l'avance.
//   - Résultat concret pour l'utilisateur : l'application installée
//     s'ouvre et affiche son interface même sans connexion (au lieu d'un
//     écran blanc/erreur du navigateur), pour retomber ensuite sur un
//     message clair (bannière "hors ligne", voir `OfflineBanner` dans
//     shared.jsx) dès qu'une action a besoin du serveur.
//   - PAS construit ici : consultation/modification de données réelles
//     hors ligne avec synchronisation différée — chantier séparé et
//     nettement plus lourd, volontairement exclu de cette livraison (voir
//     l'échange avec l'utilisateur, suite 84).
// =====================================================================

const CACHE_NAME = "arem-shell-v1";
const APP_SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => { /* pas bloquant si l'un de ces fichiers manque */ })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Seulement les requêtes GET de MÊME ORIGINE — exclut automatiquement
  // tous les appels vers Supabase (*.supabase.co, autre origine) et les
  // requêtes d'écriture (POST/PATCH/DELETE), qui doivent toujours passer
  // directement par le réseau, jamais par ce cache.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          // Page jamais visitée hors ligne : on retombe sur la coquille
          // de l'application (une seule page, pas de routes par URL dans
          // cette application) plutôt qu'une erreur de navigateur brute.
          if (req.mode === "navigate") return caches.match("/");
          return Response.error();
        })
      )
  );
});

// =====================================================================
// PARTIE NOTIFICATIONS PUSH (suite 82, inchangée)
// =====================================================================

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Notification", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Notification";
  const options = {
    body: data.body || "",
    icon: data.icon || undefined,
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
