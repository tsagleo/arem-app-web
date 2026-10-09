// =====================================================================
// covoiturageOutils.js — textes et fonctions partagés du covoiturage
// professionnel (grille tarifaire, conducteur, véhicule) — 2026-10-09.
// Séparé des composants pour respecter react-refresh/only-export-components.
// =====================================================================
import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { useLang, friendlyError } from "./shared";

export const TXT_TARIFS = {
  fr: {
    title: "Grille tarifaire du covoiturage",
    intro: "Contribution aux frais de carburant, par passager, selon la durée ESTIMÉE du trajet. Le prix est calculé et affiché au passager avant qu'il réserve, puis figé à la réservation. Le conducteur peut baisser ou offrir le trajet, jamais dépasser la grille. Le covoiturage ne doit pas générer de revenu.",
    no_grid: "Aucune grille active : chaque conducteur fixe librement son prix.",
    active_version: "Version {v} active depuis le {date}",
    tranches: "Tranches",
    from: "De (min)",
    to: "À (min)",
    amount: "Montant / passager",
    add_row: "Ajouter une tranche",
    beyond_title: "Au-delà de la dernière tranche (obligatoire)",
    beyond_base: "Montant de base",
    beyond_every: "Puis toutes les (min)",
    beyond_plus: "Ajouter",
    beyond_help: "Au-delà de {a} min : {base}, puis + {plus} toutes les {n} minutes supplémentaires.",
    options_title: "Options",
    opt_wait: "Frais d'attente (le temps d'attente au point de rendez-vous est déjà mesuré)",
    opt_wait_free: "Gratuit pendant (min)",
    opt_wait_per_min: "Puis par minute",
    opt_wait_cap: "Plafond (facultatif)",
    opt_solid: "Tarif solidaire (réduction en %)",
    opt_solid_pct: "Réduction (%)",
    opt_solid_students: "Étudiants",
    opt_solid_seniors: "Aînés",
    opt_solid_events: "Trajets vers les événements de l'association (automatique)",
    opt_real: "Frais réels déclarés par le conducteur (péage, stationnement)",
    save: "Enregistrer une nouvelle version",
    saving: "Enregistrement…",
    saved: "Grille enregistrée (nouvelle version).",
    disable: "Désactiver la grille (prix libre)",
    disable_confirm: "Désactiver la grille ? Les conducteurs fixeront de nouveau leur prix librement. L'historique est conservé.",
    history: "Historique des versions",
    history_row: "v{v} · {date} · {n} tranche(s)",
    err_empty: "Ajoutez au moins une tranche.",
    err_first: "La première tranche doit commencer à 0 minute.",
    err_gap: "Tranche {i} : elle doit commencer à {prev} min (pas de trou ni de chevauchement).",
    err_order: "Tranche {i} : la fin doit être supérieure au début.",
    err_amount: "Tranche {i} : montant manquant ou négatif.",
    err_beyond: "La tranche « au-delà » est obligatoire (montant de base, durée ≥ 1 min, montant ajouté ≥ 0).",
    err_pct: "Le pourcentage solidaire doit être entre 0 et 100.",
    preview: "Aperçu",
    preview_minutes: "Durée estimée (min)",
    preview_result: "Contribution par passager : {m}",
    sql_missing: "La grille n'est pas encore disponible : le script SQL 2026-10-09b doit être exécuté dans Supabase.",
    fuel_note: "Contribution aux frais de carburant",
  },
  en: {
    title: "Carpool price grid",
    intro: "Fuel cost contribution, per passenger, based on the ESTIMATED trip duration. The price is computed and shown to the passenger before booking, then locked at booking. Drivers may lower the price or offer the ride for free, never exceed the grid. Carpooling must not generate income.",
    no_grid: "No active grid: each driver sets their own price.",
    active_version: "Version {v} active since {date}",
    tranches: "Brackets",
    from: "From (min)",
    to: "To (min)",
    amount: "Amount / passenger",
    add_row: "Add a bracket",
    beyond_title: "Beyond the last bracket (required)",
    beyond_base: "Base amount",
    beyond_every: "Then every (min)",
    beyond_plus: "Add",
    beyond_help: "Beyond {a} min: {base}, then + {plus} every {n} additional minutes.",
    options_title: "Options",
    opt_wait: "Waiting fee (waiting time at pickup is already measured)",
    opt_wait_free: "Free for (min)",
    opt_wait_per_min: "Then per minute",
    opt_wait_cap: "Cap (optional)",
    opt_solid: "Solidarity rate (% discount)",
    opt_solid_pct: "Discount (%)",
    opt_solid_students: "Students",
    opt_solid_seniors: "Seniors",
    opt_solid_events: "Rides to the association's events (automatic)",
    opt_real: "Actual costs declared by the driver (tolls, parking)",
    save: "Save as a new version",
    saving: "Saving…",
    saved: "Grid saved (new version).",
    disable: "Disable the grid (free pricing)",
    disable_confirm: "Disable the grid? Drivers will set their own price again. History is kept.",
    history: "Version history",
    history_row: "v{v} · {date} · {n} bracket(s)",
    err_empty: "Add at least one bracket.",
    err_first: "The first bracket must start at 0 minutes.",
    err_gap: "Bracket {i}: it must start at {prev} min (no gap or overlap).",
    err_order: "Bracket {i}: the end must be greater than the start.",
    err_amount: "Bracket {i}: missing or negative amount.",
    err_beyond: "The “beyond” bracket is required (base amount, step ≥ 1 min, added amount ≥ 0).",
    err_pct: "The solidarity percentage must be between 0 and 100.",
    preview: "Preview",
    preview_minutes: "Estimated duration (min)",
    preview_result: "Contribution per passenger: {m}",
    sql_missing: "The grid is not available yet: the SQL script 2026-10-09b must be run in Supabase.",
    fuel_note: "Fuel cost contribution",
  },
};

// Message d'erreur : les refus métier levés par nos fonctions SQL
// (raise exception → code P0001) sont déjà rédigés en français clair.
export function covErr(error, t) {
  if (error?.code === "P0001" && error.message) return error.message;
  return friendlyError(error, t);
}

// Même calcul que public.covoiturage_prix_grille (SQL).
export function prixSelonGrille(grille, minutes) {
  if (!grille || minutes == null || !isFinite(minutes)) return null;
  const m = Math.max(0, Math.ceil(Number(minutes)));
  const tranches = [...(grille.tranches || [])].sort((a, b) => Number(a.de) - Number(b.de));
  let last = 0;
  for (const tr of tranches) {
    if (m <= Number(tr.a)) return { montant: Math.round(Number(tr.montant) * 100) / 100, de: Number(tr.de), a: Number(tr.a), au_dela: false, minutes: m, version: grille.version, grille_id: grille.id };
    last = Number(tr.a);
  }
  const n = Math.floor((m - last) / Math.max(1, Number(grille.au_dela_par_min) || 1));
  const montant = Number(grille.au_dela_montant) + n * Number(grille.au_dela_montant_par_tranche || 0);
  return { montant: Math.round(montant * 100) / 100, de: last, a: null, au_dela: true, tranches_sup: n, minutes: m, version: grille.version, grille_id: grille.id };
}

// Libellé lisible d'une tranche appliquée (jsonb tranche_appliquee).
export function trancheLabel(tr, lang) {
  if (!tr) return "—";
  const en = lang === "en";
  if (tr.au_dela) return en ? `beyond ${tr.de} min (v${tr.version ?? "?"})` : `au-delà de ${tr.de} min (v${tr.version ?? "?"})`;
  return en ? `${tr.de}–${tr.a} min (v${tr.version ?? "?"})` : `${tr.de} à ${tr.a} min (v${tr.version ?? "?"})`;
}

// Même validation que enregistrer_grille_tarifaire_covoiturage (SQL).
export function validerGrille(rows, beyond, options, L) {
  if (!rows.length) return L.err_empty;
  const sorted = [...rows].sort((a, b) => Number(a.de) - Number(b.de));
  let prev = 0;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.de === "" || r.a === "" || r.montant === "" || r.de == null || r.a == null || r.montant == null) return L.err_amount.replace("{i}", i + 1);
    if (Number(r.de) !== prev) return i === 0 ? L.err_first : L.err_gap.replace("{i}", i + 1).replace("{prev}", prev);
    if (!(Number(r.a) > Number(r.de))) return L.err_order.replace("{i}", i + 1);
    if (!(Number(r.montant) >= 0)) return L.err_amount.replace("{i}", i + 1);
    prev = Number(r.a);
  }
  if (beyond.montant === "" || !(Number(beyond.montant) >= 0) || !(Number(beyond.par_min) >= 1) || !(Number(beyond.plus || 0) >= 0)) return L.err_beyond;
  if (options.solidaire_actif && !(Number(options.solidaire_pct) >= 0 && Number(options.solidaire_pct) <= 100)) return L.err_pct;
  return null;
}

export const DOC_TYPES = ["permis", "assurance", "immatriculation"];

export const TXT_CONDUCTEUR = {
  fr: {
    my_driver_btn: "Ma fiche conducteur",
    title: "Ma fiche conducteur",
    intro: "Ces informations rassurent les passagers. La photo de profil est obligatoire pour publier une offre.",
    photo: "Photo de profil",
    photo_required: "Photo obligatoire pour publier une offre",
    photo_change: "Changer la photo",
    photo_add: "Ajouter une photo",
    phone: "Téléphone",
    phone_hint: "Visible seulement des passagers confirmés.",
    save: "Enregistrer",
    saved: "Enregistré.",
    vehicles: "Mon véhicule",
    vehicle_add: "Ajouter un véhicule",
    vehicle_none: "Aucun véhicule enregistré.",
    brand: "Marque",
    model: "Modèle",
    color: "Couleur",
    year: "Année",
    seats: "Places passagers",
    plate: "Plaque d'immatriculation",
    plate_hint: "Montrée seulement aux passagers dont la réservation est confirmée.",
    vehicle_photo: "Photo du véhicule (de côté, plaque non visible de préférence)",
    delete_vehicle_confirm: "Supprimer ce véhicule ?",
    documents: "Documents (facultatifs)",
    documents_intro: "À fournir seulement si le bureau vous le demande. Fichiers privés : visibles uniquement par vous et le bureau. Un rappel est envoyé 30 jours avant l'expiration.",
    doc_permis: "Permis de conduire",
    doc_assurance: "Assurance",
    doc_immatriculation: "Immatriculation",
    doc_statut_demande: "Demandé par le bureau",
    doc_statut_soumis: "En attente de contrôle",
    doc_statut_valide: "Validé",
    doc_statut_refuse: "Refusé",
    doc_none: "Non fourni",
    doc_expires: "Expire le",
    doc_expiring: "Expire bientôt",
    doc_expired: "Expiré",
    doc_upload: "Téléverser",
    doc_view: "Voir",
    doc_delete_confirm: "Supprimer ce document ?",
    verified: "Conducteur vérifié ✓",
    not_verified: "Pas encore vérifié par le bureau",
    close: "Fermer",
    sql_missing: "Fonction indisponible : le script SQL 2026-10-09b doit être exécuté dans Supabase.",
    // Bureau
    admin_title: "Conducteurs, véhicules et documents",
    admin_intro: "Contrôlez les documents puis accordez le badge « Conducteur vérifié ✓ ». Les documents sont facultatifs et demandés au cas par cas.",
    admin_empty: "Aucun conducteur pour l'instant (membre avec véhicule ou offre).",
    admin_request_docs: "Demander les documents",
    admin_request_prompt: "Message facultatif au conducteur :",
    admin_requested: "{n} document(s) demandé(s).",
    admin_validate: "Valider",
    admin_refuse: "Refuser",
    admin_refuse_prompt: "Motif du refus (facultatif) :",
    admin_grant: "Accorder « Conducteur vérifié ✓ »",
    admin_revoke: "Retirer le badge",
    admin_no_photo: "Sans photo",
    admin_no_vehicle: "Aucun véhicule",
  },
  en: {
    my_driver_btn: "My driver profile",
    title: "My driver profile",
    intro: "This information reassures passengers. A profile photo is required to publish a ride offer.",
    photo: "Profile photo",
    photo_required: "Photo required to publish an offer",
    photo_change: "Change photo",
    photo_add: "Add a photo",
    phone: "Phone",
    phone_hint: "Visible only to confirmed passengers.",
    save: "Save",
    saved: "Saved.",
    vehicles: "My vehicle",
    vehicle_add: "Add a vehicle",
    vehicle_none: "No vehicle yet.",
    brand: "Make",
    model: "Model",
    color: "Colour",
    year: "Year",
    seats: "Passenger seats",
    plate: "Licence plate",
    plate_hint: "Shown only to passengers whose booking is confirmed.",
    vehicle_photo: "Vehicle photo (side view, plate preferably hidden)",
    delete_vehicle_confirm: "Delete this vehicle?",
    documents: "Documents (optional)",
    documents_intro: "Only provide them if the board asks. Private files: visible only to you and the board. A reminder is sent 30 days before expiry.",
    doc_permis: "Driver's licence",
    doc_assurance: "Insurance",
    doc_immatriculation: "Registration",
    doc_statut_demande: "Requested by the board",
    doc_statut_soumis: "Awaiting review",
    doc_statut_valide: "Approved",
    doc_statut_refuse: "Rejected",
    doc_none: "Not provided",
    doc_expires: "Expires on",
    doc_expiring: "Expiring soon",
    doc_expired: "Expired",
    doc_upload: "Upload",
    doc_view: "View",
    doc_delete_confirm: "Delete this document?",
    verified: "Verified driver ✓",
    not_verified: "Not yet verified by the board",
    close: "Close",
    sql_missing: "Not available: the SQL script 2026-10-09b must be run in Supabase.",
    admin_title: "Drivers, vehicles and documents",
    admin_intro: "Review documents, then grant the “Verified driver ✓” badge. Documents are optional and requested case by case.",
    admin_empty: "No drivers yet (member with a vehicle or an offer).",
    admin_request_docs: "Request documents",
    admin_request_prompt: "Optional message to the driver:",
    admin_requested: "{n} document(s) requested.",
    admin_validate: "Approve",
    admin_refuse: "Reject",
    admin_refuse_prompt: "Reason (optional):",
    admin_grant: "Grant “Verified driver ✓”",
    admin_revoke: "Remove badge",
    admin_no_photo: "No photo",
    admin_no_vehicle: "No vehicle",
  },
};

export function useTxtConducteur() {
  const { lang } = useLang();
  return TXT_CONDUCTEUR[lang === "en" ? "en" : "fr"];
}

export async function openSignedFile(bucket, path) {
  if (!path) return;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) { window.alert(error?.message || "Fichier introuvable"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

// URL signée (5 min) d'une photo de véhicule, rafraîchie si le chemin change.
export function useSignedUrl(bucket, path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => { if (!cancelled) setUrl(data?.signedUrl || null); });
    return () => { cancelled = true; };
  }, [bucket, path]);
  return path ? url : null;
}

export function vehiculeLabel(v) {
  if (!v) return "";
  return [v.marque, v.modele, v.couleur, v.annee].filter(Boolean).join(" · ");
}


// Une ligne d'état par réservation, toutes données dérivées au même endroit.
export function buildEtatRow(b, offers, members, vehicules) {
  const offer = offers.find((o) => o.id === b.offer_id) || null;
  const driver = offer ? members.find((m) => m.id === offer.member_id) || null : null;
  const passenger = members.find((m) => m.id === b.passenger_member_id) || null;
  const vehicule = offer?.vehicule_id ? vehicules.find((v) => v.id === offer.vehicule_id) || null : null;
  const date = offer?.date_heure || b.created_at;
  const dureeReelleMin = b.a_bord_at && b.terminee_at ? (new Date(b.terminee_at) - new Date(b.a_bord_at)) / 60000 : null;
  const attenteMin = b.arrivee_at && b.a_bord_at ? (new Date(b.a_bord_at) - new Date(b.arrivee_at)) / 60000 : null;
  const distM = b.distance_m ?? b.distance_estimee_m ?? offer?.distance_estimee_m ?? null;
  const km = distM != null ? Number(distM) / 1000 : null;
  const montantDu = b.montant_du != null ? Number(b.montant_du) : (offer?.prix_place != null ? Number(offer.prix_place) * (b.seats_reserved || 1) : 0);
  return {
    booking: b, offer, driver, passenger, vehicule, date,
    dureeEstMin: b.duree_estimee_min ?? offer?.duree_estimee_min ?? null,
    dureeReelleMin, attenteMin, km, montantDu,
    paiement: b.paiement_statut || (montantDu > 0 ? "non_paye" : "offert"),
  };
}

