// =====================================================================
// Covoiturage.jsx — Rubrique Covoiturage entre membres (offres/demandes
// permanentes, distinctes du covoiturage événementiel déjà existant dans
// Evenements.jsx) — voir sql/2026-10-06_covoiturage.sql +
// sql/2026-10-06b_covoiturage_mise_en_relation.sql.
//
// Mise en relation réelle (suite demandée par l'utilisateur) : les
// OFFRES sont désormais RÉSERVABLES — le passager réserve N places, le
// conducteur accepte ou refuse, les places se décomptent automatiquement
// et, dès l'acceptation, les coordonnées (téléphone/courriel) des deux
// personnes se révèlent mutuellement dans l'application. Les DEMANDES
// gardent "Signaler mon intérêt" (symétrique, informel) mais affichent
// désormais aussi des offres correspondantes suggérées automatiquement.
// Une fois un trajet réservé marqué "Terminé", chacun peut noter l'autre
// (1 à 5 + commentaire).
//
// Navigation intégrée : chaque trajet propose un aperçu cartographique
// (iframe Google Maps "embed", aucune clé API) et des liens directs vers
// Google Maps / Waze / Apple Maps / OpenStreetMap pour démarrer la
// navigation en un clic — pas de carte interactive avec tracé maison
// (nécessiterait une clé API payante à ce volume), voir en-tête du
// script SQL pour le détail des simplifications assumées.
// =====================================================================
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Car, Plus, Pencil, Trash2, MapPin, Calendar, Users, Repeat, Link2, Search, Send, Leaf, Calculator, Star, Check, X, Navigation, Phone, Mail, Sparkles, Map as MapIcon, Clock, Zap, Radio, Share2, AlertTriangle, Flag, Timer, Copy, ShieldCheck, Ban, MessageCircle, UserX, Globe, CalendarClock, Settings, FileText, FolderOpen, Crosshair, Wallet, Bell, Fuel, UserCircle, BarChart3 } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "./supabaseClient";
import { enTeteOfficiel, piedsDePageOfficiels, couleurAssociation } from "./pdfOfficiel";
import GrilleTarifaireCovoiturage from "./CovoiturageTarifs";
import { FicheConducteurModal, ConducteursAdmin, VehiculePhoto, DriverAvatar } from "./CovoiturageConducteur";
import EtatsPanel, { FicheTrajetModal } from "./CovoiturageEtats";
import { prixSelonGrille, trancheLabel, covErr, vehiculeLabel, buildEtatRow, TXT_CONDUCTEUR } from "./covoiturageOutils";

// ---------- Textes du covoiturage professionnel (2026-10-09, voir
// sql/2026-10-09b_covoiturage_vehicule_tarifs.sql) — dictionnaire local
// pour ne pas toucher shared.jsx (chantiers parallèles). ----------
const TXT_PRO = {
  fr: {
    pin_btn: "Placer l'épingle sur la carte",
    pin_title: "Placez l'épingle à l'endroit exact",
    pin_help: "Faites glisser l'épingle ou touchez la carte. L'adresse est proposée automatiquement ; vous pouvez corriger le libellé (ex. « 85 Commerce St, Moncton »).",
    pin_label: "Libellé de l'adresse",
    pin_my_position: "Ma position",
    pin_confirm: "Utiliser cet endroit",
    pin_searching: "Recherche de l'adresse…",
    geo_exact: "Position exacte enregistrée",
    geo_approx: "Position approximative (numéro civique absent de la carte) — placez l'épingle pour être exact",
    est_title: "Contribution aux frais de carburant",
    est_line: "Durée estimée {min} · {km} km → tranche {tranche} : {montant} par passager",
    est_line_free: "Durée estimée {min} · {km} km",
    est_need_geo: "Choisissez une adresse suggérée ou placez l'épingle (départ et arrivée) pour calculer le prix selon la grille de l'association.",
    est_loading: "Calcul de la durée estimée…",
    price_label_grid: "Prix par passager (maximum {max})",
    price_hint_grid: "Vous pouvez baisser ou mettre 0 pour offrir le trajet, jamais dépasser la grille.",
    vehicle_label: "Véhicule",
    vehicle_none: "Ajoutez votre véhicule dans « Ma fiche conducteur » pour publier une offre.",
    photo_needed: "Une photo de profil est obligatoire pour publier une offre.",
    open_fiche: "Ouvrir ma fiche conducteur",
    per_passenger: "/ passager",
    verified_driver: "Conducteur vérifié ✓",
    res_price: "Contribution par passager",
    res_frozen: "Prix calculé sur la durée estimée et figé au moment de la réservation.",
    res_total: "Total pour {n} place(s)",
    res_solidaire: "Tarif solidaire",
    res_solid_none: "Aucun",
    res_solid_etudiant: "Étudiant(e) (-{pct} %)",
    res_solid_aine: "Aîné(e) (-{pct} %)",
    res_solid_event: "Trajet vers un événement de l'association : -{pct} % appliqué automatiquement.",
    res_wait_note: "Frais d'attente possibles : au-delà de {min} min d'attente au point de rendez-vous, {montant} par minute.",
    res_real_note: "Le conducteur peut ajouter des frais réels déclarés (péage, stationnement).",
    res_pay_note: "Paiement directement au conducteur (espèces ou Interac). L'association ne détient jamais l'argent.",
    bk_amount: "Dû : {m}",
    pay_non_paye: "Non payé", pay_declare_paye: "Déclaré payé", pay_paye: "Payé", pay_offert: "Offert",
    bk_paid_cash: "J'ai payé (espèces)",
    bk_paid_interac: "J'ai payé (Interac)",
    bk_confirm_paid: "Confirmer le paiement reçu",
    bk_unpaid: "Remettre « non payé »",
    bk_remind: "Envoyer un rappel",
    bk_reminded: "Rappel envoyé.",
    bk_lower: "Baisser / offrir",
    bk_lower_prompt: "Nouveau prix par passager (maximum {max}, 0 = offert) :",
    bk_real: "Frais réels",
    bk_real_amount_prompt: "Montant des frais réels (péage, stationnement) pour cette réservation :",
    bk_real_desc_prompt: "Nature des frais (péage, stationnement…) :",
    bk_plate: "Plaque",
    bk_fiche: "Fiche trajet",
    bk_wait_fee: "dont attente {m}",
    bk_real_fee: "dont frais réels {m}",
    tab_etats: "États",
    grid_title: "Grille de l'association",
    grid_beyond: "Au-delà de {a} min : {base}, puis + {plus} toutes les {n} min",
    grid_note: "Contribution aux frais de carburant, par passager, selon la durée estimée du trajet.",
  },
  en: {
    pin_btn: "Drop a pin on the map",
    pin_title: "Drop the pin at the exact spot",
    pin_help: "Drag the pin or tap the map. The address is suggested automatically; you can edit the label (e.g. “85 Commerce St, Moncton”).",
    pin_label: "Address label",
    pin_my_position: "My location",
    pin_confirm: "Use this spot",
    pin_searching: "Looking up the address…",
    geo_exact: "Exact position saved",
    geo_approx: "Approximate position (street number missing from the map) — drop a pin to be exact",
    est_title: "Fuel cost contribution",
    est_line: "Estimated time {min} · {km} km → bracket {tranche}: {montant} per passenger",
    est_line_free: "Estimated time {min} · {km} km",
    est_need_geo: "Pick a suggested address or drop a pin (start and destination) to compute the price from the association's grid.",
    est_loading: "Computing estimated time…",
    price_label_grid: "Price per passenger (maximum {max})",
    price_hint_grid: "You may lower it or enter 0 to offer the ride, never exceed the grid.",
    vehicle_label: "Vehicle",
    vehicle_none: "Add your vehicle in “My driver profile” to publish an offer.",
    photo_needed: "A profile photo is required to publish an offer.",
    open_fiche: "Open my driver profile",
    per_passenger: "/ passenger",
    verified_driver: "Verified driver ✓",
    res_price: "Contribution per passenger",
    res_frozen: "Price based on the estimated time and locked when you book.",
    res_total: "Total for {n} seat(s)",
    res_solidaire: "Solidarity rate",
    res_solid_none: "None",
    res_solid_etudiant: "Student (-{pct} %)",
    res_solid_aine: "Senior (-{pct} %)",
    res_solid_event: "Ride to an association event: -{pct} % applied automatically.",
    res_wait_note: "Possible waiting fee: beyond {min} min of waiting at pickup, {montant} per minute.",
    res_real_note: "The driver may add declared actual costs (tolls, parking).",
    res_pay_note: "Pay the driver directly (cash or Interac). The association never holds the money.",
    bk_amount: "Due: {m}",
    pay_non_paye: "Unpaid", pay_declare_paye: "Reported paid", pay_paye: "Paid", pay_offert: "Free",
    bk_paid_cash: "I paid (cash)",
    bk_paid_interac: "I paid (Interac)",
    bk_confirm_paid: "Confirm payment received",
    bk_unpaid: "Mark as unpaid",
    bk_remind: "Send a reminder",
    bk_reminded: "Reminder sent.",
    bk_lower: "Lower / offer",
    bk_lower_prompt: "New price per passenger (maximum {max}, 0 = free):",
    bk_real: "Actual costs",
    bk_real_amount_prompt: "Actual costs (tolls, parking) for this booking:",
    bk_real_desc_prompt: "Type of cost (toll, parking…):",
    bk_plate: "Plate",
    bk_fiche: "Ride sheet",
    bk_wait_fee: "incl. waiting {m}",
    bk_real_fee: "incl. actual costs {m}",
    tab_etats: "Statements",
    grid_title: "Association price grid",
    grid_beyond: "Beyond {a} min: {base}, then + {plus} every {n} min",
    grid_note: "Fuel cost contribution, per passenger, based on the estimated trip time.",
  },
};
function useTxtPro() {
  const { lang } = useLang();
  return TXT_PRO[lang === "en" ? "en" : "fr"];
}
import { Section, Container, Card, Btn, Field, StatCard, Pill, inputStyle, money, useLang, foldText, TEAL, TEAL_LIGHT, RED, toDatetimeLocal, datetimeLocalToISO } from "./shared";

// ---------- Suggestions de messages/signalements préétablis (volet
// Paramètres uniquement — rien n'est créé en base tant que le bureau ne
// clique pas "Ajouter" ; voir sql/2026-10-08l_covoiturage_messages_
// rapides.sql) : inspirées des situations routières les plus courantes,
// côté passager comme côté chauffeur. ----------
const QUICK_MESSAGE_SUGGESTIONS = [
  { categorie: "signalement", cible: "chauffeur", texte_key: "cov_params_sugg_embouteillage" },
  { categorie: "signalement", cible: "chauffeur", texte_key: "cov_params_sugg_travaux" },
  { categorie: "signalement", cible: "chauffeur", texte_key: "cov_params_sugg_panne" },
  { categorie: "signalement", cible: "les_deux", texte_key: "cov_params_sugg_retard" },
  { categorie: "signalement", cible: "les_deux", texte_key: "cov_params_sugg_absent" },
  { categorie: "signalement", cible: "chauffeur", texte_key: "cov_params_sugg_stationnement" },
  { categorie: "message_rapide", cible: "les_deux", texte_key: "cov_params_sugg_jarrive" },
  { categorie: "message_rapide", cible: "les_deux", texte_key: "cov_params_sugg_jattends" },
  { categorie: "message_rapide", cible: "chauffeur", texte_key: "cov_params_sugg_deux_minutes" },
  { categorie: "message_rapide", cible: "passager", texte_key: "cov_params_sugg_jarrive_bientot" },
];

const AMBER = "#8A5A00";
const AMBER_LIGHT = "#FDF3DF";
const overlay = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 };

// ---------- Géocodage gratuit (Nominatim/OpenStreetMap), sans clé ----------
// 2026-10-09 (« GPS trop approximatif ») : les recherches sont désormais
// LIMITÉES au pays de l'association (countrycodes, déduit de sa devise) et
// BIAISÉES vers sa région (viewbox autour de la dernière position connue,
// sinon de l'adresse de l'association) — fini les suggestions au Cameroun
// pour une association de Moncton. Les libellés sont courts (« 85 Commerce
// St, Moncton ») et, comme les numéros civiques manquent souvent dans
// OpenStreetMap, le bouton « Placer l'épingle sur la carte » (PinPickerModal)
// permet d'enregistrer les coordonnées EXACTES. Échec silencieux comme
// avant : sans coordonnées, le trajet reste visible au babillard.
const COUNTRY_BY_CURRENCY = { CAD: "ca", USD: "us", EUR: "fr,be,lu", CHF: "ch", GBP: "gb", XAF: "cm,ga,cg,td,cf,gq", XOF: "sn,ci,bj,bf,ml,ne,tg,gw", MAD: "ma", TND: "tn", DZD: "dz", HTG: "ht", NGN: "ng", GHS: "gh", CDF: "cd", RWF: "rw", KES: "ke" };
const DEFAULT_CENTER = { lat: 46.0878, lng: -64.7782 }; // Moncton (N.-B.)
const geoContext = { countrycodes: "ca", center: null, assocId: null };
function regionKey(assocId) { return `unia_cov_region_${assocId || "x"}`; }
function rememberRegion(pt) {
  if (!pt || pt.lat == null || pt.lng == null) return;
  geoContext.center = { lat: pt.lat, lng: pt.lng };
  try { localStorage.setItem(regionKey(geoContext.assocId), JSON.stringify(geoContext.center)); } catch { /* stockage indisponible : biais pour cette session seulement */ }
}
function nominatimBiasParams() {
  const p = { countrycodes: geoContext.countrycodes };
  const c = geoContext.center;
  // viewbox = simple préférence (bounded absent) : ~65 km autour du centre.
  if (c) p.viewbox = `${c.lng - 0.9},${c.lat + 0.6},${c.lng + 0.9},${c.lat - 0.6}`;
  return p;
}
// Libellé court construit depuis addressdetails. Si OSM n'a pas le numéro
// civique mais que le membre l'a tapé (« 85 Commerce St »), on le garde.
function shortLabel(s, typed) {
  const a = s?.address || {};
  const road = a.road || a.pedestrian || a.footway || a.residential || a.path || a.square || null;
  const typedNum = (typed || "").trim().match(/^(\d+[A-Za-z]?)\s/)?.[1];
  const num = a.house_number || (road && typedNum ? typedNum : null);
  const city = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || a.county || null;
  const first = road ? [num, road].filter(Boolean).join(" ") : (s?.name || (s?.display_name || "").split(",")[0]);
  return [first, city && city !== first ? city : null].filter(Boolean).join(", ") || s?.display_name || "";
}
async function nominatimSearch(params, signal) {
  const q = new URLSearchParams({ format: "json", addressdetails: "1", limit: "6", ...nominatimBiasParams(), ...params });
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${q.toString()}`, { headers: { "Accept-Language": "fr" }, signal });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`, { headers: { "Accept-Language": "fr" } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
async function geocodeAddress(text) {
  if (!text || !text.trim()) return null;
  const data = await nominatimSearch({ q: text.trim(), limit: "1" });
  if (data[0]?.lat && data[0]?.lon) return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
  return null;
}

// ---------- Assistant de saisie d'adresse (autocomplétion + épingle) ----------
// Recherche libre + recherche structurée (rue/ville séparées) quand le
// texte contient une virgule, résultats avec numéro civique exact en tête.
// `geo` = coordonnées actuellement retenues (affiche exact/approximatif).
function AddressAutocomplete({ value, onChange, onSelect, placeholder, geo }) {
  const P = useTxtPro();
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const boxRef = useRef(null);
  const skipNextRef = useRef(false); // évite de relancer une recherche juste après un choix

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (skipNextRef.current) { skipNextRef.current = false; return undefined; }
    if (!value || value.trim().length < 3) { setSuggestions([]); setOpen(false); return undefined; }
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const parts = value.trim().split(",").map((p) => p.trim()).filter(Boolean);
      const [freeform, structured] = await Promise.all([
        nominatimSearch({ q: value.trim() }, ctrl.signal),
        parts.length >= 2 ? nominatimSearch({ street: parts[0], city: parts[1] }, ctrl.signal) : Promise.resolve([]),
      ]);
      if (ctrl.signal.aborted) return;
      const seen = new Set();
      const deduped = [];
      for (const s of [...structured, ...freeform]) {
        const key = s.place_id ?? s.display_name;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(s);
      }
      deduped.sort((a, b) => (b.address?.house_number ? 1 : 0) - (a.address?.house_number ? 1 : 0));
      setSuggestions(deduped.slice(0, 6));
      setOpen(true);
    }, 400); // anti-rafale : une seule paire de requêtes par pause de frappe
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value]);

  useEffect(() => {
    function onClickOutside(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function pick(s) {
    const pt = { lat: Number(s.lat), lng: Number(s.lon), precise: !!s.address?.house_number };
    skipNextRef.current = true;
    onChange(shortLabel(s, value));
    onSelect(pt);
    rememberRegion(pt);
    setOpen(false);
    setSuggestions([]);
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        style={inputStyle} value={value} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { onChange(e.target.value); onSelect(null); }}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
      />
      {open && suggestions.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "white", border: "1px solid #DCE0E8", borderRadius: 10, boxShadow: "0 6px 16px rgba(0,0,0,.12)", zIndex: 20, marginTop: 4, maxHeight: 260, overflowY: "auto" }}>
          {suggestions.map((s, i) => {
            const precise = !!s.address?.house_number;
            return (
              <button key={s.place_id ?? i} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}
                style={{ display: "flex", alignItems: "flex-start", gap: 6, width: "100%", textAlign: "left", padding: "8px 10px", border: "none", background: "white", cursor: "pointer", fontSize: 12.5, borderBottom: i < suggestions.length - 1 ? "1px solid #F1F2F4" : "none" }}>
                <MapPin size={12} style={{ marginTop: 2, flexShrink: 0, color: precise ? TEAL : "#C9A227" }} />
                <span>
                  <strong style={{ fontWeight: 600 }}>{shortLabel(s, value)}</strong>
                  <span style={{ display: "block", fontSize: 10.5, color: "#8A8F98", marginTop: 1 }}>{s.display_name}</span>
                  {!precise && <span style={{ display: "block", fontSize: 10.5, color: "#C9A227", marginTop: 2 }}>{P.geo_approx}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 5 }}>
        <button type="button" onClick={() => setPinOpen(true)} style={linkBtn("var(--primary)")}><Crosshair size={12} /> {P.pin_btn}</button>
        {geo && geo.lat != null && (
          <span style={{ fontSize: 11, color: geo.precise || geo.pinned ? TEAL : "#C9A227" }}>
            {geo.precise || geo.pinned ? `✓ ${P.geo_exact}` : P.geo_approx}
          </span>
        )}
      </div>
      {pinOpen && (
        <PinPickerModal P={P} initial={geo} onClose={() => setPinOpen(false)}
          onConfirm={(label, pt) => {
            skipNextRef.current = true;
            onChange(label);
            onSelect({ ...pt, precise: true, pinned: true });
            rememberRegion(pt);
            setPinOpen(false);
          }} />
      )}
    </div>
  );
}

// ---------- Épingle déplaçable sur une carte Leaflet (OSM, sans clé) ----------
// Repère en emoji (L.divIcon) : évite les icônes Leaflet par défaut dont
// les images sont introuvables sous Vite. Géocodage inverse (Nominatim)
// pour proposer le libellé ; les coordonnées enregistrées sont celles de
// l'épingle, au mètre près.
const PIN_ICON = L.divIcon({ className: "", html: '<div style="font-size:30px;line-height:30px;text-align:center;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))">📍</div>', iconSize: [30, 30], iconAnchor: [15, 30] });
function PinPickerModal({ P, initial, onClose, onConfirm }) {
  const hasInitial = initial && initial.lat != null && initial.lng != null;
  const [start] = useState(() => (hasInitial ? { lat: initial.lat, lng: initial.lng, zoom: 17 } : { ...(geoContext.center || DEFAULT_CENTER), zoom: geoContext.center ? 14 : 12 }));
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [pt, setPt] = useState({ lat: start.lat, lng: start.lng });
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const labelEditedRef = useRef(false);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return undefined;
    const s = start;
    const map = L.map(elRef.current, { zoomControl: true }).setView([s.lat, s.lng], s.zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    const marker = L.marker([s.lat, s.lng], { draggable: true, icon: PIN_ICON }).addTo(map);
    marker.on("dragend", () => { const ll = marker.getLatLng(); labelEditedRef.current = false; setPt({ lat: ll.lat, lng: ll.lng }); });
    map.on("click", (e) => { marker.setLatLng(e.latlng); labelEditedRef.current = false; setPt({ lat: e.latlng.lat, lng: e.latlng.lng }); });
    mapRef.current = map;
    markerRef.current = marker;
    const id = setTimeout(() => { try { map.invalidateSize(); } catch { /* fenêtre déjà fermée */ } }, 60);
    return () => { clearTimeout(id); map.remove(); mapRef.current = null; markerRef.current = null; };
  }, [start]);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(async () => {
      setBusy(true);
      const r = await reverseGeocode(pt.lat, pt.lng);
      if (cancelled) return;
      if (!labelEditedRef.current) setLabel(r ? shortLabel(r, "") : `${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`);
      setBusy(false);
    }, 500);
    return () => { cancelled = true; clearTimeout(id); };
  }, [pt.lat, pt.lng]);

  function useMyPosition() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      markerRef.current?.setLatLng([ll.lat, ll.lng]);
      mapRef.current?.setView([ll.lat, ll.lng], 17);
      labelEditedRef.current = false;
      setPt(ll);
    }, () => { /* refusée : l'épingle reste déplaçable à la main */ }, { enableHighAccuracy: true, timeout: 15000 });
  }

  return (
    <div style={{ ...overlay, zIndex: 1100 }} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 18, maxWidth: 560, width: "100%", maxHeight: "92vh", overflowY: "auto" }}>
        <h3 style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 8, fontSize: 16 }}><Crosshair size={16} color={TEAL} /> {P.pin_title}</h3>
        <p style={{ fontSize: 12, color: "#5B6270", marginBottom: 10 }}>{P.pin_help}</p>
        <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid #DCE0E8", height: 320, marginBottom: 10 }}>
          <div ref={elRef} style={{ width: "100%", height: "100%" }} />
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <button type="button" onClick={useMyPosition} style={linkBtn(TEAL)}><Navigation size={12} /> {P.pin_my_position}</button>
          <span style={{ fontSize: 11, color: "#8A8F98" }}>{pt.lat.toFixed(5)}, {pt.lng.toFixed(5)}</span>
          {busy && <span style={{ fontSize: 11, color: "#8A8F98" }}>{P.pin_searching}</span>}
        </div>
        <Field label={P.pin_label}>
          <input style={inputStyle} value={label} onChange={(e) => { labelEditedRef.current = true; setLabel(e.target.value); }} />
        </Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn variant="outline" onClick={onClose}><X size={13} /></Btn>
          <Btn onClick={() => onConfirm(label.trim() || `${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`, pt)}><Check size={13} /> {P.pin_confirm}</Btn>
        </div>
      </div>
    </div>
  );
}

// ---------- Navigation intégrée (sans clé API) ----------
function osmSearchUrl(from, to) { return `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${from} à ${to}`)}`; }
function googleMapsDirUrl(from, to) { return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=driving`; }
function googleMapsEmbedUrl(from, to) { return `https://www.google.com/maps?saddr=${encodeURIComponent(from)}&daddr=${encodeURIComponent(to)}&output=embed`; }
function wazeUrl(to) { return `https://waze.com/ul?q=${encodeURIComponent(to)}&navigate=yes`; }
function appleMapsUrl(from, to) { return `https://maps.apple.com/?saddr=${encodeURIComponent(from)}&daddr=${encodeURIComponent(to)}&dirflg=d`; }

// ---------- Correspondance automatique demande ↔ offres ----------
function routeTokens(s) { return new Set(foldText(s || "").split(/[^a-z0-9]+/).filter((w) => w.length > 2)); }
function overlapCount(a, b) { let n = 0; for (const w of a) if (b.has(w)) n++; return n; }
function matchScoreFor(request, offer) {
  const score = overlapCount(routeTokens(request.point_depart), routeTokens(offer.point_depart)) * 2
    + overlapCount(routeTokens(request.point_arrivee), routeTokens(offer.point_arrivee)) * 2;
  if (score === 0) return 0;
  const days = Math.abs(new Date(request.date_heure) - new Date(offer.date_heure)) / 86400000;
  return score - Math.min(days, 6);
}

function formatDateTime(iso, lang) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(lang === "en" ? "en-CA" : "fr-CA", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
}

export default function Covoiturage({ profile, isBureau, association }) {
  const { t, lang } = useLang();
  const devise = association?.devise_monetaire || "CAD";
  const [offers, setOffers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [events, setEvents] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [tab, setTab] = useState("offres"); // "offres" | "demandes" | "reservations"
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null); // { kind: "offre"|"demande", row }
  const [reserving, setReserving] = useState(null); // { offer, requestId }
  const [rating, setRating] = useState(null); // { booking, counterpartId, counterpartNom }
  const [expandedMap, setExpandedMap] = useState(null); // id de l'offre/demande dont l'itinéraire est ouvert
  const [dispatchRounds, setDispatchRounds] = useState([]); // propositions de dispatch en attente (association entière, filtrées par rôle à l'affichage)
  const [livePositions, setLivePositions] = useState([]); // dernières positions en direct connues (association entière, filtrées par RLS)
  const [sharing, setSharing] = useState(null); // { booking } — modale de partage de trajet
  const [reportingIncident, setReportingIncident] = useState(null); // { booking } — modale de signalement
  const [trackingBookingId, setTrackingBookingId] = useState(null); // réservation pour laquelle JE partage ma position (conducteur)
  const watchIdRef = useRef(null);
  const [beacons, setBeacons] = useState([]); // disponibilités immédiates actives (association entière)
  const [showAvailability, setShowAvailability] = useState(false);
  const [messages, setMessages] = useState([]); // messagerie in-app liée aux réservations (Phase A, suite 2026-10-08)
  const [eventFilter, setEventFilter] = useState(""); // filtre "covoiturage événementiel dédié" (Phase B)
  const [prefill, setPrefill] = useState(null); // pré-remplissage de CreateRideModal depuis un événement
  const [incidents, setIncidents] = useState([]); // signalements (panneau Administration, suite 2026-10-08)
  const [adminMemberSearch, setAdminMemberSearch] = useState(""); // recherche dans le registre des membres (Administration)
  const [quickMessages, setQuickMessages] = useState([]); // messages/signalements préétablis (volet Paramètres, suite 2026-10-08)
  // Covoiturage professionnel (2026-10-09, sql/2026-10-09b) : grille
  // tarifaire active, véhicules, plaques (filtrées par RLS : seulement les
  // miennes, celles de mes trajets confirmés, ou toutes pour le bureau),
  // documents (les miens, ou tous pour le bureau).
  const P = useTxtPro();
  const [proSql, setProSql] = useState(false); // false tant que sql/2026-10-09b n'a pas été exécuté
  const [grille, setGrille] = useState(null);
  const [vehicules, setVehicules] = useState([]);
  const [plaques, setPlaques] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [showFiche, setShowFiche] = useState(false);
  const [ficheBooking, setFicheBooking] = useState(null);

  // Contexte régional du géocodage : pays (selon la devise) + centre
  // (dernière position retenue, sinon adresse de l'association).
  useEffect(() => {
    geoContext.assocId = profile.association_id;
    geoContext.countrycodes = COUNTRY_BY_CURRENCY[(association?.devise_monetaire || "CAD").toUpperCase()] || "ca";
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(regionKey(profile.association_id)) || "null"); } catch { /* stockage indisponible */ }
    if (stored?.lat != null) { geoContext.center = stored; return; }
    geoContext.center = null;
    if (association?.adresse) geocodeAddress(association.adresse).then((pt) => { if (pt) rememberRegion(pt); });
  }, [profile.association_id, association?.devise_monetaire, association?.adresse]);

  function reportError(error) {
    if (error) {
      console.error("[Covoiturage]", error);
      const msg = covErr(error, t);
      setErrorMsg(msg);
      if (error.code === "P0001") window.alert(msg); // refus métier (prix au-dessus de la grille, photo manquante…)
      return true;
    }
    return false;
  }

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    const [offerRes, requestRes, evRes, bookingRes, ratingRes, memberRes, dispatchRes, posRes, beaconRes, msgRes, incidentRes, quickMsgRes] = await Promise.all([
      supabase.from("carpool_offers").select("*").eq("association_id", profile.association_id).order("date_heure"),
      supabase.from("carpool_requests").select("*").eq("association_id", profile.association_id).order("date_heure"),
      supabase.from("events").select("id,titre,lieu,date_debut").eq("association_id", profile.association_id),
      supabase.from("carpool_bookings").select("*").eq("association_id", profile.association_id).order("created_at", { ascending: false }),
      supabase.from("carpool_ratings").select("*").eq("association_id", profile.association_id),
      supabase.from("members").select("id,nom,telephone,email,photo_url,covoiturage_verifie,covoiturage_suspendu,covoiturage_suspendu_motif").eq("association_id", profile.association_id),
      supabase.from("carpool_dispatch_rounds").select("*").eq("association_id", profile.association_id).eq("statut", "en_attente"),
      supabase.from("carpool_live_positions").select("*").eq("association_id", profile.association_id),
      supabase.from("carpool_availability_beacons").select("*").eq("association_id", profile.association_id).eq("statut", "active"),
      // Messagerie in-app (Phase A, suite 2026-10-08) : requête tolérante
      // comme les autres, vide tant que sql/2026-10-08e n'a pas été exécuté.
      supabase.from("carpool_messages").select("*").eq("association_id", profile.association_id).order("created_at"),
      // Signalements (panneau Administration, suite 2026-10-08) — requête
      // tolérante comme les autres, vide tant que sql/2026-10-08k n'a pas
      // été exécuté. RLS (carpool_incidents select bureau) limite déjà la
      // lecture au bureau ; un membre ordinaire reçoit juste une liste
      // vide sans erreur.
      supabase.from("carpool_incidents").select("*").eq("association_id", profile.association_id).order("created_at", { ascending: false }),
      // Messages/signalements préétablis (volet Paramètres, suite 2026-
      // 10-08) — requête tolérante comme les autres, vide tant que
      // sql/2026-10-08l n'a pas été exécuté.
      supabase.from("carpool_quick_messages").select("*").eq("association_id", profile.association_id).order("ordre"),
    ]);
    // Covoiturage professionnel (sql/2026-10-09b) — tolérant comme le reste.
    const [grilleRes, vehRes, plaqueRes, docRes] = await Promise.all([
      supabase.from("carpool_tarif_grilles").select("*").eq("association_id", profile.association_id).eq("actif", true).maybeSingle(),
      supabase.from("carpool_vehicules").select("*").eq("association_id", profile.association_id),
      supabase.from("carpool_vehicule_plaques").select("*").eq("association_id", profile.association_id),
      supabase.from("carpool_documents_conducteur").select("*").eq("association_id", profile.association_id),
    ]);
    setProSql(!grilleRes?.error);
    setGrille(grilleRes?.error ? null : (grilleRes.data || null));
    setVehicules(vehRes?.error ? [] : (vehRes.data || []));
    setPlaques(plaqueRes?.error ? [] : (plaqueRes.data || []));
    setDocuments(docRes?.error ? [] : (docRes.data || []));
    // Requêtes tolérantes : listes vides tant que les scripts SQL n'ont
    // pas été exécutés, plutôt que de faire échouer tout le module.
    setOffers(offerRes?.error ? [] : (offerRes.data || []));
    setRequests(requestRes?.error ? [] : (requestRes.data || []));
    setEvents(evRes?.error ? [] : (evRes.data || []));
    setBookings(bookingRes?.error ? [] : (bookingRes.data || []));
    setRatings(ratingRes?.error ? [] : (ratingRes.data || []));
    setMembers(memberRes?.error ? [] : (memberRes.data || []));
    setDispatchRounds(dispatchRes?.error ? [] : (dispatchRes.data || []));
    setLivePositions(posRes?.error ? [] : (posRes.data || []));
    // Double filtre défensif sur l'expiration (statut = 'active' côté
    // requête ci-dessus + expires_at côté client) : le job de nettoyage
    // (expirer_balises_disponibilite) ne tourne que toutes les 5 minutes,
    // une balise peut donc rester "active" en base quelques minutes après
    // son heure réelle d'expiration.
    setBeacons(beaconRes?.error ? [] : (beaconRes.data || []).filter((b) => new Date(b.expires_at) > new Date()));
    setMessages(msgRes?.error ? [] : (msgRes.data || []));
    setIncidents(incidentRes?.error ? [] : (incidentRes.data || []));
    setQuickMessages(quickMsgRes?.error ? [] : (quickMsgRes.data || []));
    setLoading(false);
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);
  // Rafraîchissement silencieux périodique (8s) — remplace une souscription
  // temps réel (postgres_changes) pour éviter toute dépendance à la
  // configuration Realtime/RLS du projet Supabase, pas vérifiable depuis
  // ce script ; suffisant à l'échelle d'une association pour que le
  // dispatch automatique, le suivi en direct et les réservations reçues
  // paraissent "quasi temps réel" sans websocket dédié.
  useEffect(() => {
    const id = setInterval(() => { load(true); }, 8000);
    return () => clearInterval(id);
  }, [load]);

  const activeOffers = offers.filter((o) => o.statut === "active");
  const activeRequests = requests.filter((r) => r.statut === "active");
  const participantsCount = useMemo(() => {
    const ids = new Set([...offers.map((o) => o.member_id), ...requests.map((r) => r.member_id)]);
    return ids.size;
  }, [offers, requests]);

  const offerOwnerOf = useCallback((offerId) => offers.find((o) => o.id === offerId)?.member_id, [offers]);
  const myBookingsSent = useMemo(() => bookings.filter((b) => b.passenger_member_id === profile.member_id), [bookings, profile.member_id]);
  const myBookingsReceived = useMemo(() => bookings.filter((b) => offerOwnerOf(b.offer_id) === profile.member_id), [bookings, offerOwnerOf, profile.member_id]);
  const pendingReceivedCount = myBookingsReceived.filter((b) => b.statut === "en_attente").length;
  const myBeacon = useMemo(() => beacons.find((b) => b.member_id === profile.member_id), [beacons, profile.member_id]);
  const otherBeacons = useMemo(() => beacons.filter((b) => b.member_id !== profile.member_id), [beacons, profile.member_id]);

  const ratingStats = useCallback((memberId) => {
    const rs = ratings.filter((r) => r.rated_member_id === memberId);
    if (!rs.length) return null;
    return { avg: rs.reduce((s, r) => s + r.note, 0) / rs.length, count: rs.length };
  }, [ratings]);
  // Statistiques de timing d'un conducteur (voir sql/2026-10-08c_systeme_
  // chrono_trajet.sql) — moyenne sur ses trajets terminés, calculée
  // directement à partir des réservations déjà chargées (en_route_at/
  // a_bord_at/terminee_at), sans fonction SQL dédiée.
  const driverTimingStats = useCallback((memberId) => {
    const done = bookings.filter((b) => offerOwnerOf(b.offer_id) === memberId && b.statut === "terminee" && b.en_route_at && b.a_bord_at && b.terminee_at);
    if (!done.length) return null;
    const avgPickupSec = done.reduce((s, b) => s + (new Date(b.a_bord_at) - new Date(b.en_route_at)) / 1000, 0) / done.length;
    const avgDureeSec = done.reduce((s, b) => s + (new Date(b.terminee_at) - new Date(b.a_bord_at)) / 1000, 0) / done.length;
    return { avgPickupSec, avgDureeSec, count: done.length };
  }, [bookings, offerOwnerOf]);
  const myRatingFor = useCallback((bookingId) => ratings.find((r) => r.booking_id === bookingId && r.rater_member_id === profile.member_id), [ratings, profile.member_id]);
  const memberContact = useCallback((memberId) => members.find((m) => m.id === memberId), [members]);
  const me = useMemo(() => members.find((m) => m.id === profile.member_id) || null, [members, profile.member_id]);
  const myVehicles = useMemo(() => vehicules.filter((v) => v.member_id === profile.member_id && v.actif !== false), [vehicules, profile.member_id]);
  const vehiculeFor = useCallback((id) => (id ? vehicules.find((v) => v.id === id) || null : null), [vehicules]);
  const plaqueFor = useCallback((id) => (id ? plaques.find((p) => p.vehicule_id === id)?.plaque || null : null), [plaques]);
  // Avis textuels (carpool_ratings.commentaire existe depuis sql/2026-10-
  // 06b mais n'était jamais affiché) — les plus récents d'abord.
  const commentsFor = useCallback((memberId) => ratings.filter((r) => r.rated_member_id === memberId && r.commentaire && r.commentaire.trim()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [ratings]);
  // Politique de fiabilité (Phase A, sql/2026-10-08e) : absences et
  // annulations tardives d'un membre EN TANT QUE PASSAGER — affichées au
  // conducteur avant qu'il n'accepte une réservation du même membre.
  const reliabilityIssues = useCallback((memberId) => bookings.filter((b) => b.passenger_member_id === memberId && (b.no_show || b.annulation_tardive)).length, [bookings]);
  const messagesFor = useCallback((bookingId) => messages.filter((m) => m.booking_id === bookingId), [messages]);
  // Covoiturage événementiel dédié (Phase B) : événements à venir, pour
  // le nouveau bandeau "Covoiturage pour vos événements" — events.date_debut
  // provient de la table events (App.jsx l'utilise de la même façon).
  const upcomingEvents = useMemo(() => events.filter((e) => e.date_debut && new Date(e.date_debut) >= new Date()).sort((a, b) => new Date(a.date_debut) - new Date(b.date_debut)), [events]);
  const eventLinkCount = useCallback((eventId) => offers.filter((o) => o.event_id === eventId).length + requests.filter((r) => r.event_id === eventId).length, [offers, requests]);
  // Impact collectif (Phase C) — distance_m (sql/2026-10-08g) n'existe que
  // sur les réservations terminées depuis ce script (+ rattrapage SQL pour
  // celles déjà terminées avant) ; estimation volontairement simple
  // (0,2 kg CO2/km évité par place occupée), affichée comme telle.
  const impact = useMemo(() => {
    const done = bookings.filter((b) => b.statut === "terminee" && b.distance_m != null);
    const totalKm = done.reduce((s, b) => s + (Number(b.distance_m) / 1000) * (b.seats_reserved || 1), 0);
    return { trips: done.length, totalKm, co2Kg: totalKm * 0.2 };
  }, [bookings]);
  // Panneau Administration (suite 2026-10-08, claude/covoiturage-
  // administration-rapport-proposition.md) — « les États » demandés par
  // Léo : décompte par statut de toutes les réservations (pas seulement
  // les miennes), signalements ouverts, badges, fiabilité à l'échelle de
  // l'association. Tout provient de données déjà chargées (incidents est
  // la seule nouvelle requête, sql/2026-10-08k) — aucun calcul lourd.
  const adminStats = useMemo(() => {
    const bookingsByStatut = {};
    for (const b of bookings) bookingsByStatut[b.statut] = (bookingsByStatut[b.statut] || 0) + 1;
    return {
      openIncidents: incidents.filter((i) => (i.statut || "ouvert") === "ouvert").length,
      traitedIncidents: incidents.filter((i) => i.statut === "traite").length,
      verifiedCount: members.filter((m) => m.covoiturage_verifie).length,
      suspendedCount: members.filter((m) => m.covoiturage_suspendu).length,
      bookingsByStatut,
      noShowCount: bookings.filter((b) => b.no_show).length,
      lateCancelCount: bookings.filter((b) => b.annulation_tardive).length,
      totalBookings: bookings.length,
      totalOffers: offers.length,
      totalRequests: requests.length,
    };
  }, [incidents, members, bookings, offers, requests]);
  const incidentContext = useCallback((incident) => {
    const booking = bookings.find((b) => b.id === incident.booking_id);
    const offer = booking ? offers.find((o) => o.id === booking.offer_id) : null;
    const reporter = members.find((m) => m.id === incident.reporter_member_id);
    return { booking, offer, reporterNom: reporter?.nom || "—" };
  }, [bookings, offers, members]);
  const adminFilteredMembers = useMemo(() => {
    const q = foldText(adminMemberSearch.trim());
    return members.filter((m) => !q || foldText(m.nom || "").includes(q));
  }, [members, adminMemberSearch]);
  const BOOKING_STATUTS_ORDER = ["en_attente", "acceptee", "en_route", "arrivee", "a_bord", "terminee", "refusee", "annulee"];
  // Interrupteur général des messages/signalements préétablis — tant que
  // sql/2026-10-08l n'a pas été exécuté, association.covoiturage_
  // messages_rapides_actif n'existe pas encore : undefined se comporte
  // comme "actif" par défaut (cohérent avec la valeur par défaut true en
  // base), mais la liste restera simplement vide (aucun modèle chargé)
  // tant que le script SQL n'a pas tourné.
  const messagesRapidesActif = association?.covoiturage_messages_rapides_actif !== false;
  // Registre complet des courses (volet Administration, suite 2026-10-08,
  // claude/covoiturage-registre-messages-carte-parametres-proposition.md)
  // — TOUTES les réservations quel que soit le statut (faites ou non),
  // avec le dossier chauffeur complet (identité, fiabilité, note moyenne,
  // historique, signalements). Rien de nouveau à charger : tout provient
  // des données déjà en mémoire.
  const registreRows = useMemo(() => {
    return bookings.map((b) => {
      const offer = offers.find((o) => o.id === b.offer_id) || null;
      const driver = offer ? members.find((m) => m.id === offer.member_id) || null : null;
      const passenger = members.find((m) => m.id === b.passenger_member_id) || null;
      const attenteSec = b.arrivee_at && b.a_bord_at ? (new Date(b.a_bord_at) - new Date(b.arrivee_at)) / 1000 : null;
      const dureeSec = b.a_bord_at && b.terminee_at ? (new Date(b.terminee_at) - new Date(b.a_bord_at)) / 1000 : null;
      const rowIncidents = incidents.filter((i) => i.booking_id === b.id);
      return { booking: b, offer, driver, passenger, attenteSec, dureeSec, incidents: rowIncidents };
    }).sort((a, b2) => new Date(b2.booking.created_at) - new Date(a.booking.created_at));
  }, [bookings, offers, members, incidents]);
  // Dossier complet d'un chauffeur — identité, fiabilité, note moyenne,
  // historique de toutes ses courses (faites ou non) et tous les
  // signalements le concernant (qu'il en soit l'auteur ou le sujet).
  const buildDriverDossier = useCallback((memberId) => {
    const member = members.find((m) => m.id === memberId) || null;
    const rows = registreRows.filter((r) => r.driver?.id === memberId);
    const stats = ratingStats(memberId);
    const completed = rows.filter((r) => r.booking.statut === "terminee").length;
    const cancelled = rows.filter((r) => r.booking.statut === "annulee" || r.booking.statut === "refusee").length;
    const noShow = rows.filter((r) => r.booking.no_show).length;
    const driverIncidents = incidents.filter((i) => rows.some((r) => r.booking.id === i.booking_id));
    return { member, rows, stats, completed, cancelled, noShow, incidents: driverIncidents };
  }, [members, registreRows, ratingStats, incidents]);

  const matchesForRequest = useCallback((request) => {
    return activeOffers
      .filter((o) => o.member_id !== request.member_id && o.places_disponibles > 0)
      .map((o) => ({ offer: o, score: matchScoreFor(request, o) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [activeOffers]);

  const filteredOffers = activeOffers.filter((o) => (!eventFilter || o.event_id === eventFilter) && (!search.trim() || foldText(`${o.point_depart} ${o.point_arrivee} ${o.notes || ""} ${o.member_nom || ""}`).includes(foldText(search))));
  const filteredRequests = activeRequests.filter((r) => (!eventFilter || r.event_id === eventFilter) && (!search.trim() || foldText(`${r.point_depart} ${r.point_arrivee} ${r.notes || ""} ${r.member_nom || ""}`).includes(foldText(search))));

  function eventTitre(id) { return events.find((e) => e.id === id)?.titre; }

  // form.departGeo/arriveeGeo : coordonnées déjà connues si l'utilisateur
  // a choisi une suggestion de l'assistant de saisie d'adresse
  // (AddressAutocomplete ci-dessus) — on évite alors un appel Nominatim
  // redondant, sinon on géocode le texte comme avant.
  async function createOffer(form) {
    const [depart, arrivee] = await Promise.all([
      form.departGeo ? Promise.resolve(form.departGeo) : geocodeAddress(form.point_depart),
      form.arriveeGeo ? Promise.resolve(form.arriveeGeo) : geocodeAddress(form.point_arrivee),
    ]);
    // Durée ESTIMÉE (itinéraire OSRM, repli à vol d'oiseau) : base du prix
    // selon la grille de l'association, recalculé et plafonné en base.
    let eta = form.eta || null;
    if (!eta && depart && arrivee) eta = await fetchRouteEta(depart.lat, depart.lng, arrivee.lat, arrivee.lng);
    const pro = proSql ? {
      vehicule_id: form.vehicule_id || null,
      duree_estimee_min: eta ? Math.round((eta.durationSec / 60) * 10) / 10 : null,
      distance_estimee_m: eta ? Math.round(eta.distanceM) : null,
    } : {};
    const { data, error } = await supabase.from("carpool_offers").insert({
      ...pro,
      association_id: profile.association_id, member_id: profile.member_id, member_nom: profile.nom_complet,
      point_depart: form.point_depart.trim(), point_arrivee: form.point_arrivee.trim(),
      date_heure: datetimeLocalToISO(form.date_heure), recurrence: form.recurrence, places_disponibles: Number(form.places_disponibles) || 1,
      prix_place: form.prix_place === "" ? null : Number(form.prix_place), event_id: form.event_id || null, notes: form.notes.trim() || null,
      depart_lat: depart?.lat ?? null, depart_lng: depart?.lng ?? null, arrivee_lat: arrivee?.lat ?? null, arrivee_lng: arrivee?.lng ?? null,
      pref_non_fumeur: !!form.pref_non_fumeur, pref_musique: !!form.pref_musique, pref_animaux: !!form.pref_animaux,
    }).select().single();
    if (reportError(error)) return false;
    setOffers((p) => [...p, data]); return true;
  }
  async function createRequest(form) {
    const [depart, arrivee] = await Promise.all([
      form.departGeo ? Promise.resolve(form.departGeo) : geocodeAddress(form.point_depart),
      form.arriveeGeo ? Promise.resolve(form.arriveeGeo) : geocodeAddress(form.point_arrivee),
    ]);
    const { data, error } = await supabase.from("carpool_requests").insert({
      association_id: profile.association_id, member_id: profile.member_id, member_nom: profile.nom_complet,
      point_depart: form.point_depart.trim(), point_arrivee: form.point_arrivee.trim(),
      date_heure: datetimeLocalToISO(form.date_heure), places_demandees: Number(form.places_demandees) || 1,
      event_id: form.event_id || null, notes: form.notes.trim() || null,
      depart_lat: depart?.lat ?? null, depart_lng: depart?.lng ?? null, arrivee_lat: arrivee?.lat ?? null, arrivee_lng: arrivee?.lng ?? null,
    }).select().single();
    if (reportError(error)) return false;
    setRequests((p) => [...p, data]);
    if (data && form.dispatch_auto) await lancerDispatch(data.id);
    return true;
  }
  async function updateRow(kind, id, patch) {
    const table = kind === "offre" ? "carpool_offers" : "carpool_requests";
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    if (reportError(error)) return;
    await load();
  }
  // Relance le géocodage (Nominatim) pour un trajet dont le départ et/ou
  // l'arrivée n'avait pas pu être localisé à la création (adresse mal
  // formulée, service temporairement indisponible…) — sans cela la ligne
  // reste invisible du matching pondéré ET du dispatch/balises, qui
  // exigent tous deux des coordonnées (voir commentaire sur geocodeAddress
  // plus haut). Ne retente que les champs encore manquants.
  async function retryGeocode(kind, row) {
    const needDepart = row.depart_lat == null;
    const needArrivee = row.arrivee_lat == null;
    if (!needDepart && !needArrivee) return;
    const [depart, arrivee] = await Promise.all([
      needDepart ? geocodeAddress(row.point_depart) : Promise.resolve(undefined),
      needArrivee ? geocodeAddress(row.point_arrivee) : Promise.resolve(undefined),
    ]);
    const patch = {};
    if (needDepart) { patch.depart_lat = depart?.lat ?? null; patch.depart_lng = depart?.lng ?? null; }
    if (needArrivee) { patch.arrivee_lat = arrivee?.lat ?? null; patch.arrivee_lng = arrivee?.lng ?? null; }
    const table = kind === "offre" ? "carpool_offers" : "carpool_requests";
    const { error } = await supabase.from(table).update(patch).eq("id", row.id);
    if (reportError(error)) return;
    if ((needDepart && patch.depart_lat == null) || (needArrivee && patch.arrivee_lat == null)) {
      window.alert(t("cov_geocode_retry_still_failed"));
    }
    await load();
  }
  async function deleteRow(kind, id) {
    if (!window.confirm(t("cov_confirm_delete"))) return;
    const table = kind === "offre" ? "carpool_offers" : "carpool_requests";
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (reportError(error)) return;
    if (kind === "offre") setOffers((p) => p.filter((o) => o.id !== id));
    else setRequests((p) => p.filter((r) => r.id !== id));
  }
  async function signalerInteretDemande(id) {
    const message = window.prompt(t("cov_interest_prompt")) || "";
    const { data, error } = await supabase.rpc("signaler_interet_demande_covoiturage", { p_request_id: id, p_message: message || null });
    if (reportError(error)) return;
    const status = data?.[0]?.status;
    if (status === "notifie") alert(t("cov_interest_sent"));
    else if (status === "propre_demande") alert(t("cov_interest_own"));
    else alert(t("cov_interest_failed"));
  }
  // Acceptation directe d'une demande (sans attendre le dispatch
  // automatique ni une simple notification) — voir sql/2026-10-08_
  // acceptation_directe_demande.sql. Crée immédiatement une réservation
  // "acceptee" (coordonnées mutuellement révélées dans Réservations),
  // exactement comme une acceptation de proposition de dispatch, mais
  // déclenchée manuellement par n'importe quel membre depuis le babillard.
  async function accepterDemande(id, nomDemandeur) {
    if (!window.confirm(t("cov_accept_request_confirm").replace("{nom}", nomDemandeur || "—"))) return;
    const { data, error } = await supabase.rpc("accepter_demande_covoiturage", { p_request_id: id });
    if (reportError(error)) return;
    const status = data?.[0]?.status;
    if (status === "ok") { alert(t("cov_accept_request_success")); await load(); }
    else if (status === "propre_demande") alert(t("cov_accept_request_own"));
    else alert(t("cov_accept_request_failed"));
  }

  // ---------- Vérification / modération par le bureau (Phase A) ----------
  async function toggleVerifieMembre(memberId, nomMembre, next) {
    if (!window.confirm((next ? t("cov_verify_confirm_on") : t("cov_verify_confirm_off")).replace("{nom}", nomMembre || "—"))) return;
    const { error } = await supabase.rpc("verifier_membre_covoiturage", { p_member_id: memberId, p_verifie: next });
    if (reportError(error)) return;
    await load(true);
  }
  async function toggleSuspendreMembre(memberId, nomMembre, next) {
    const motif = next ? (window.prompt(t("cov_suspend_motif_prompt")) || "") : null;
    if (!window.confirm((next ? t("cov_suspend_confirm_on") : t("cov_suspend_confirm_off")).replace("{nom}", nomMembre || "—"))) return;
    const { error } = await supabase.rpc("suspendre_covoiturage", { p_member_id: memberId, p_suspendu: next, p_motif: motif || null });
    if (reportError(error)) return;
    await load(true);
  }
  // ---------- Signalements — panneau Administration (suite 2026-10-08) ----------
  async function traiterSignalement(incidentId) {
    const note = window.prompt(t("cov_admin_incident_note_prompt")) || null;
    if (!window.confirm(t("cov_admin_incident_confirm_traite"))) return;
    const { error } = await supabase.rpc("traiter_signalement_covoiturage", { p_incident_id: incidentId, p_note: note });
    if (reportError(error)) return;
    await load(true);
  }
  async function signalerAbsence(bookingId) {
    if (!window.confirm(t("cov_noshow_confirm"))) return;
    const { data, error } = await supabase.rpc("signaler_absence_covoiturage", { p_booking_id: bookingId });
    if (reportError(error)) return;
    const status = data?.[0]?.status;
    if (status === "ok") await load();
    else alert(t("cov_booking_action_failed"));
  }
  // ---------- Messages/signalements préétablis — volet Paramètres (suite
  // 2026-10-08) ----------
  async function toggleMessagesRapides(next) {
    const { error } = await supabase.rpc("configurer_messages_rapides_covoiturage", { p_actif: next });
    if (reportError(error)) return;
    await load(true);
  }
  async function addQuickMessage(categorie, cible, texte) {
    if (!texte || !texte.trim()) return;
    const { error } = await supabase.from("carpool_quick_messages").insert({
      association_id: profile.association_id, categorie, cible, texte: texte.trim(), ordre: quickMessages.length,
    });
    if (reportError(error)) return;
    await load(true);
  }
  async function toggleQuickMessageActif(id, next) {
    const { error } = await supabase.from("carpool_quick_messages").update({ actif: next }).eq("id", id);
    if (reportError(error)) return;
    await load(true);
  }
  async function deleteQuickMessage(id) {
    if (!window.confirm(t("cov_params_delete_confirm"))) return;
    const { error } = await supabase.from("carpool_quick_messages").delete().eq("id", id);
    if (reportError(error)) return;
    setQuickMessages((p) => p.filter((m) => m.id !== id));
  }
  // ---------- Messagerie in-app liée à une réservation (Phase A) ----------
  async function sendCarpoolMessage(bookingId, text) {
    if (!text || !text.trim()) return;
    const { error } = await supabase.from("carpool_messages").insert({
      association_id: profile.association_id, booking_id: bookingId, sender_member_id: profile.member_id, message: text.trim(),
    });
    if (reportError(error)) return;
    await load(true);
  }

  async function reserve(offerId, seats, message, requestId, solidaire) {
    // Réservation avec prix figé (sql/2026-10-09b) ; repli sur l'ancienne
    // fonction tant que le script n'a pas été exécuté.
    const base = { p_offer_id: offerId, p_seats: seats, p_message: message || null, p_request_id: requestId || null };
    let { data, error } = proSql
      ? await supabase.rpc("reserver_trajet_covoiturage_tarif", { ...base, p_solidaire_motif: solidaire || null })
      : await supabase.rpc("reserver_trajet_covoiturage", base);
    if (error && proSql && (error.code === "PGRST202" || /reserver_trajet_covoiturage_tarif/.test(error.message || ""))) {
      ({ data, error } = await supabase.rpc("reserver_trajet_covoiturage", base));
    }
    if (reportError(error)) return false;
    const status = data?.[0]?.status;
    if (status === "ok") { await load(); return true; }
    if (status === "propre_offre") alert(t("cov_interest_own"));
    else if (status === "places_insuffisantes") alert(t("cov_reserve_failed_places"));
    else if (status === "deja_reserve") alert(t("cov_reserve_failed_already"));
    else alert(t("cov_reserve_failed_generic"));
    return false;
  }
  // ---------- Prix figé, frais et paiement entre membres (sql/2026-10-09b) ----------
  // L'application enregistre seulement payé / non payé + rappels ;
  // l'argent passe directement du passager au conducteur.
  async function rpcPro(name, args, okMsg) {
    const { error } = await supabase.rpc(name, args);
    if (reportError(error)) return false;
    if (okMsg) window.alert(okMsg);
    await load(true);
    return true;
  }
  const paymentActions = {
    onPayment: (bookingId, statut, mode) => rpcPro("marquer_paiement_covoiturage", { p_booking_id: bookingId, p_statut: statut, p_mode: mode || null }),
    onRemind: (bookingId) => rpcPro("rappeler_paiement_covoiturage", { p_booking_id: bookingId }, P.bk_reminded),
    onLowerPrice: (booking) => {
      const max = booking.prix_grille_unitaire ?? booking.prix_unitaire;
      const v = window.prompt(P.bk_lower_prompt.replace("{max}", money(max ?? 0, devise)), String(booking.prix_unitaire ?? ""));
      if (v === null || v.trim() === "") return;
      const n = Number(v.replace(",", "."));
      if (!isFinite(n) || n < 0) return;
      rpcPro("ajuster_prix_covoiturage", { p_booking_id: booking.id, p_prix_unitaire: n });
    },
    onRealCosts: (booking) => {
      const v = window.prompt(P.bk_real_amount_prompt, String(booking.frais_reels || ""));
      if (v === null || v.trim() === "") return;
      const n = Number(v.replace(",", "."));
      if (!isFinite(n) || n < 0) return;
      const desc = n > 0 ? window.prompt(P.bk_real_desc_prompt, booking.frais_reels_description || "") : "";
      if (desc === null) return;
      rpcPro("declarer_frais_reels_covoiturage", { p_booking_id: booking.id, p_montant: n, p_description: desc || null });
    },
    onOpenFiche: (booking) => setFicheBooking(booking),
  };
  async function respondBooking(bookingId, accepter) {
    const { data, error } = await supabase.rpc("repondre_reservation_covoiturage", { p_booking_id: bookingId, p_accepter: accepter });
    if (reportError(error)) return;
    const status = data?.[0]?.status;
    if (status === "ok") await load();
    else if (status === "places_insuffisantes") alert(t("cov_reserve_failed_places"));
    else alert(t("cov_booking_action_failed"));
  }
  async function cancelBooking(bookingId) {
    if (!window.confirm(t("cov_booking_confirm_cancel"))) return;
    const { data, error } = await supabase.rpc("annuler_reservation_covoiturage", { p_booking_id: bookingId });
    if (reportError(error)) return;
    const status = data?.[0]?.status;
    if (status === "ok") await load();
    else alert(t("cov_booking_action_failed"));
  }
  // Suppression définitive — volontairement limitée aux statuts terminaux
  // (terminee/refusee/annulee) côté policy RLS (sql/2026-10-07c_covoiturage_
  // suppression_reservations.sql) : une réservation encore active doit
  // passer par "Annuler" ci-dessus, jamais être supprimée directement.
  async function deleteBooking(bookingId) {
    if (!window.confirm(t("cov_booking_confirm_delete"))) return;
    const { error } = await supabase.from("carpool_bookings").delete().eq("id", bookingId);
    if (reportError(error)) return;
    setBookings((p) => p.filter((b) => b.id !== bookingId));
    setRatings((p) => p.filter((r) => r.booking_id !== bookingId));
  }
  async function submitRating(bookingId, note, commentaire) {
    const { data, error } = await supabase.rpc("noter_covoiturage", { p_booking_id: bookingId, p_note: note, p_commentaire: commentaire || null });
    if (reportError(error)) return false;
    const status = data?.[0]?.status;
    if (status === "ok") { await load(); return true; }
    alert(t("cov_rate_failed"));
    return false;
  }

  // ---------- Disponibilité immédiate (balise, sans trajet A→B précis) ----------
  async function activerDisponibilite({ lat, lng, dureeMinutes, radiusKm, sansLimite }) {
    const { data, error } = await supabase.rpc("activer_disponibilite_covoiturage", {
      p_lat: lat, p_lng: lng, p_duree_minutes: dureeMinutes, p_radius_km: sansLimite ? null : radiusKm, p_sans_limite: !!sansLimite,
    });
    if (reportError(error)) return false;
    const status = data?.[0]?.status;
    if (status === "ok") { await load(true); return true; }
    alert(t("cov_available_now_failed"));
    return false;
  }
  async function desactiverDisponibilite() {
    const { error } = await supabase.rpc("desactiver_disponibilite_covoiturage");
    if (reportError(error)) return;
    await load(true);
    alert(t("cov_available_now_stopped"));
  }

  // ---------- Dispatch automatique (mise en relation) ----------
  async function lancerDispatch(requestId) {
    const { data, error } = await supabase.rpc("lancer_dispatch_covoiturage", { p_request_id: requestId });
    if (reportError(error)) return;
    const status = data?.[0]?.status;
    if (status === "ok") await load(true);
    else if (status === "aucun_candidat") alert(t("cov_dispatch_no_candidate"));
    else if (status === "deja_en_cours") { /* une proposition est déjà en cours, rien à faire */ }
  }
  async function repondreDispatch(roundId, accepter) {
    const { data, error } = await supabase.rpc("repondre_dispatch_covoiturage", { p_round_id: roundId, p_accepter: accepter });
    if (reportError(error)) return;
    const status = data?.[0]?.status;
    if (status === "ok" || status === "refuse_suivant") await load(true);
    else if (status === "places_insuffisantes") alert(t("cov_reserve_failed_places"));
    else alert(t("cov_booking_action_failed"));
  }

  // ---------- Cycle de vie de la course ----------
  async function avancerEtape(bookingId, etape) {
    const { data, error } = await supabase.rpc("avancer_etape_covoiturage", { p_booking_id: bookingId, p_etape: etape });
    if (reportError(error)) return;
    const status = data?.[0]?.status;
    if (status === "ok") await load(true);
    else alert(t("cov_booking_action_failed"));
    if (etape === "terminee" && trackingBookingId === bookingId) stopSharingPosition();
  }

  // ---------- Suivi en direct (le conducteur partage sa position) ----------
  function startSharingPosition(bookingId) {
    if (!navigator.geolocation) { alert(t("cov_live_unsupported")); return; }
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    setTrackingBookingId(bookingId);
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        await supabase.rpc("maj_position_covoiturage", { p_booking_id: bookingId, p_lat: pos.coords.latitude, p_lng: pos.coords.longitude });
        load(true);
      },
      () => { /* position refusée/indisponible — l'utilisateur reste maître du bouton Arrêter */ },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }
  function stopSharingPosition() {
    if (watchIdRef.current != null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
    setTrackingBookingId(null);
  }
  useEffect(() => () => { if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current); }, []);

  // ---------- Partage de trajet + signalement ----------
  async function genererLienPartage(bookingId) {
    const { data, error } = await supabase.rpc("generer_lien_partage_covoiturage", { p_booking_id: bookingId });
    if (reportError(error)) return;
    const token = data?.[0]?.token;
    if (token) setSharing({ bookingId, token });
    else alert(t("cov_booking_action_failed"));
  }
  async function signalerIncident(bookingId, description) {
    const { error } = await supabase.from("carpool_incidents").insert({
      association_id: profile.association_id, booking_id: bookingId, reporter_member_id: profile.member_id, description,
    });
    if (reportError(error)) return false;
    return true;
  }

  if (loading) return <Container><Section><p style={{ color: "#686F7D" }}>{t("loading")}</p></Section></Container>;

  return (
    <Container>
      <Section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><Car size={22} color={TEAL} /> {t("nav_carpool")}</h2>
            <p style={{ color: "#686F7D", fontSize: 13.5, maxWidth: 560, margin: 0 }}>{t("cov_intro")}</p>
          </div>
          {profile.member_id && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {myBeacon ? (
                <Btn variant="outline" onClick={desactiverDisponibilite}><Radio size={14} color={TEAL} /> {t("cov_available_now_active_until").replace("{heure}", formatDateTime(myBeacon.expires_at, lang))}</Btn>
              ) : (
                <Btn variant="outline" onClick={() => setShowAvailability(true)}><Radio size={14} /> {t("cov_available_now_btn")}</Btn>
              )}
              <Btn variant="outline" onClick={() => setShowFiche(true)}><UserCircle size={14} /> {TXT_CONDUCTEUR[lang === "en" ? "en" : "fr"].my_driver_btn}</Btn>
              <Btn onClick={() => setShowCreate(true)}><Plus size={14} /> {t("cov_new_btn")}</Btn>
            </div>
          )}
        </div>

        {errorMsg && <p style={{ color: RED, fontSize: 13, marginBottom: 14 }}>{errorMsg}</p>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 20 }}>
          <StatCard label={t("cov_stat_offers")} value={activeOffers.length} icon={Car} accent={TEAL} />
          <StatCard label={t("cov_stat_requests")} value={activeRequests.length} icon={Users} />
          <StatCard label={t("cov_stat_available_now")} value={otherBeacons.length} icon={Radio} accent={otherBeacons.length > 0 ? TEAL : undefined} />
          <StatCard label={t("cov_stat_participants")} value={participantsCount} icon={Users} />
          <StatCard label={t("cov_stat_pending_bookings")} value={pendingReceivedCount} icon={Clock} accent={pendingReceivedCount > 0 ? AMBER : undefined} />
        </div>

        {/* Phase C, sql/2026-10-08g : tableau de bord d'impact collectif —
            n'apparaît que lorsqu'il y a au moins un trajet terminé avec
            distance connue, pour ne pas afficher une vitrine vide. */}
        {impact.trips > 0 && (
          <div style={{ background: "linear-gradient(135deg,#0D3A63,#145A8A)", borderRadius: 14, padding: "16px 20px", marginBottom: 20, color: "white" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, marginBottom: 10, opacity: 0.9 }}><Globe size={14} /> {t("cov_impact_title")}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
              <div><div style={{ fontSize: 22, fontWeight: 700 }}>{impact.trips}</div><div style={{ fontSize: 11.5, opacity: 0.85 }}>{t("cov_impact_trips")}</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 700 }}>{Math.round(impact.totalKm)}</div><div style={{ fontSize: 11.5, opacity: 0.85 }}>{t("cov_impact_km")}</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 700 }}>{Math.round(impact.co2Kg)}</div><div style={{ fontSize: 11.5, opacity: 0.85 }}>{t("cov_impact_co2")}</div></div>
            </div>
            <div style={{ fontSize: 10.5, opacity: 0.7, marginTop: 8 }}>{t("cov_impact_note")}</div>
          </div>
        )}

        {/* Phase B, covoiturage événementiel dédié : un trajet créé depuis
            ici arrive pré-rempli (destination/horaire de l'événement). */}
        {upcomingEvents.length > 0 && (
          <div style={{ background: "#EEF1F8", borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1F3864", display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}><CalendarClock size={13} /> {t("cov_events_section_title")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {upcomingEvents.slice(0, 5).map((ev) => (
                <div key={ev.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", background: "white", borderRadius: 10, padding: "8px 12px" }}>
                  <div style={{ fontSize: 12.5 }}>
                    <strong>{ev.titre}</strong>
                    <span style={{ color: "#5B6270" }}> · {formatDateTime(ev.date_debut, lang)}{ev.lieu ? ` · ${ev.lieu}` : ""}</span>
                    {eventLinkCount(ev.id) > 0 && <span style={{ marginLeft: 8, color: TEAL, fontWeight: 600 }}>{t("cov_events_link_count").replace("{n}", eventLinkCount(ev.id))}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Btn variant="outline" style={{ padding: "5px 10px", fontSize: 11.5 }} onClick={() => { setPrefill({ kind: "offre", event_id: ev.id, point_arrivee: ev.lieu || "", date_heure: toDatetimeLocal(ev.date_debut) }); setShowCreate(true); }}>{t("cov_events_offer_btn")}</Btn>
                    <Btn variant="outline" style={{ padding: "5px 10px", fontSize: 11.5 }} onClick={() => { setPrefill({ kind: "demande", event_id: ev.id, point_arrivee: ev.lieu || "", date_heure: toDatetimeLocal(ev.date_debut) }); setShowCreate(true); }}>{t("cov_events_request_btn")}</Btn>
                    {eventLinkCount(ev.id) > 0 && <button onClick={() => setEventFilter((p) => (p === ev.id ? "" : ev.id))} style={linkBtn(eventFilter === ev.id ? RED : "var(--primary)")}>{eventFilter === ev.id ? t("cov_events_filter_clear") : t("cov_events_filter_btn")}</button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {otherBeacons.length > 0 && (
          <div style={{ background: TEAL_LIGHT, borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: TEAL, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}><Radio size={13} /> {t("cov_available_now_section_title")}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {otherBeacons.map((b) => (
                <Pill key={b.id} color={TEAL} bg="white">
                  {b.member_nom} — {b.radius_km != null ? t("cov_available_now_radius_badge").replace("{km}", b.radius_km) : t("cov_available_now_radius_badge_none")}
                </Pill>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setTab("offres")} style={tabBtn(tab === "offres")}>{t("cov_tab_offers")} ({filteredOffers.length})</button>
            <button onClick={() => setTab("demandes")} style={tabBtn(tab === "demandes")}>{t("cov_tab_requests")} ({filteredRequests.length})</button>
            <button onClick={() => setTab("reservations")} style={tabBtn(tab === "reservations")}>
              {t("cov_tab_bookings")} ({bookings.length}){pendingReceivedCount > 0 && <span style={{ marginLeft: 6, background: AMBER, color: "white", borderRadius: 999, fontSize: 10.5, padding: "1px 6px" }}>{pendingReceivedCount}</span>}
            </button>
            <button onClick={() => setTab("etats")} style={tabBtn(tab === "etats")}><BarChart3 size={12} style={{ marginRight: 4 }} /> {P.tab_etats}</button>
            {isBureau && (
              <button onClick={() => setTab("administration")} style={tabBtn(tab === "administration")}>
                {t("cov_tab_admin")}{adminStats.openIncidents > 0 && <span style={{ marginLeft: 6, background: RED, color: "white", borderRadius: 999, fontSize: 10.5, padding: "1px 6px" }}>{adminStats.openIncidents}</span>}
              </button>
            )}
            {isBureau && (
              <button onClick={() => setTab("parametres")} style={tabBtn(tab === "parametres")}>
                <Settings size={12} style={{ marginRight: 4 }} /> {t("cov_tab_settings")}
              </button>
            )}
          </div>
          {(tab === "offres" || tab === "demandes") && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "white", border: "1.5px solid #DCE0E8", borderRadius: 999, padding: "7px 14px", flex: "1 1 220px", maxWidth: 320 }}>
              <Search size={14} color="#9AA2B5" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("cov_search_placeholder")} style={{ border: "none", outline: "none", fontSize: 13, flex: 1 }} />
            </div>
          )}
          {(tab === "offres" || tab === "demandes") && eventFilter && (
            <Pill color="#1F3864" bg="#EEF1F8">
              {t("cov_events_filter_active").replace("{titre}", events.find((e) => e.id === eventFilter)?.titre || "—")}
              <button onClick={() => setEventFilter("")} style={{ background: "none", border: "none", cursor: "pointer", marginLeft: 6, color: "#1F3864" }}>✕</button>
            </Pill>
          )}
        </div>

        {tab === "administration" ? (
          <>
          <div style={{ marginBottom: 28 }}>
            <ConducteursAdmin members={members} offers={offers} vehicules={vehicules} plaques={plaques} documents={documents}
              onToggleVerify={toggleVerifieMembre} onChanged={() => load(true)} />
          </div>
          <AdministrationPanel t={t} lang={lang} devise={devise} association={association}
            adminStats={adminStats} incidents={incidents} incidentContext={incidentContext}
            onTraiterSignalement={traiterSignalement}
            members={adminFilteredMembers} memberSearch={adminMemberSearch} onMemberSearch={setAdminMemberSearch}
            onToggleVerify={toggleVerifieMembre} onToggleSuspend={toggleSuspendreMembre}
            bookingStatutOrder={BOOKING_STATUTS_ORDER}
            registreRows={registreRows} buildDriverDossier={buildDriverDossier}
          />
          </>
        ) : tab === "parametres" ? (
          <>
            <ParametresPanel t={t}
              quickMessages={quickMessages} messagesRapidesActif={messagesRapidesActif}
              onToggleMessagesRapides={toggleMessagesRapides}
              onAddQuickMessage={addQuickMessage} onToggleQuickMessageActif={toggleQuickMessageActif} onDeleteQuickMessage={deleteQuickMessage}
            />
            <GrilleTarifaireCovoiturage profile={profile} association={association} onSaved={() => load(true)} />
          </>
        ) : tab === "etats" ? (
          <EtatsPanel t={t} lang={lang} devise={devise} profile={profile} isBureau={isBureau} association={association}
            bookings={bookings} offers={offers} members={members} vehicules={vehicules} />
        ) : tab === "reservations" ? (
          <BookingsPanel t={t} lang={lang} devise={devise}
            received={myBookingsReceived} sent={myBookingsSent}
            offers={offers} profile={profile}
            memberContact={memberContact} myRatingFor={myRatingFor}
            onRespond={respondBooking} onCancel={cancelBooking} onDeleteBooking={deleteBooking}
            onRate={(booking, counterpartId, counterpartNom) => setRating({ booking, counterpartId, counterpartNom })}
            candidateDispatchRounds={dispatchRounds.filter((d) => offerOwnerOf(d.offer_id) === profile.member_id)}
            offerFor={(id) => offers.find((o) => o.id === id)}
            requestFor={(id) => requests.find((req) => req.id === id)}
            onRespondDispatch={repondreDispatch}
            livePositions={livePositions}
            trackingBookingId={trackingBookingId}
            onStartSharing={startSharingPosition}
            onStopSharing={stopSharingPosition}
            onAdvanceStep={avancerEtape}
            onShare={genererLienPartage}
            onReportIncident={(booking) => setReportingIncident({ booking, role: booking.passenger_member_id === profile.member_id ? "passager" : "chauffeur" })}
            onSignalAbsence={signalerAbsence}
            messagesFor={messagesFor}
            onSendMessage={sendCarpoolMessage}
            quickMessages={quickMessages}
            messagesRapidesActif={messagesRapidesActif}
            pro={{ P, devise, vehiculeFor, plaqueFor, fraisReelsActif: !!grille?.frais_reels_actif, ...paymentActions }}
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(260px,1fr)", gap: 20, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {tab === "offres" && filteredOffers.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{t("cov_offers_empty")}</p>}
              {tab === "offres" && filteredOffers.map((o) => (
                <RideCard key={o.id} kind="offre" row={o} t={t} lang={lang} devise={devise}
                  isOwn={o.member_id === profile.member_id} isBureau={isBureau}
                  eventTitre={eventTitre(o.event_id)} ratingStats={ratingStats(o.member_id)} comments={commentsFor(o.member_id)} timingStats={driverTimingStats(o.member_id)}
                  memberVerified={memberContact(o.member_id)?.covoiturage_verifie} memberSuspended={memberContact(o.member_id)?.covoiturage_suspendu} memberSuspendedMotif={memberContact(o.member_id)?.covoiturage_suspendu_motif}
                  mapOpen={expandedMap === o.id} onToggleMap={() => setExpandedMap((p) => (p === o.id ? null : o.id))}
                  onReserve={() => setReserving({ offer: o })}
                  onDelete={() => deleteRow("offre", o.id)}
                  onToggleStatut={() => updateRow("offre", o.id, { statut: o.statut === "active" ? "complete" : "active" })}
                  onEdit={() => setEditing({ kind: "offre", row: o })}
                  onRetryGeocode={() => retryGeocode("offre", o)}
                  onToggleVerify={toggleVerifieMembre} onToggleSuspend={toggleSuspendreMembre}
                  pro={{ P, vehicule: vehiculeFor(o.vehicule_id), photoUrl: memberContact(o.member_id)?.photo_url }}
                />
              ))}
              {tab === "demandes" && filteredRequests.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{t("cov_requests_empty")}</p>}
              {tab === "demandes" && filteredRequests.map((r) => (
                <RideCard key={r.id} kind="demande" row={r} t={t} lang={lang} devise={devise}
                  isOwn={r.member_id === profile.member_id} isBureau={isBureau}
                  eventTitre={eventTitre(r.event_id)}
                  memberVerified={memberContact(r.member_id)?.covoiturage_verifie} memberSuspended={memberContact(r.member_id)?.covoiturage_suspendu} memberSuspendedMotif={memberContact(r.member_id)?.covoiturage_suspendu_motif}
                  reliability={reliabilityIssues(r.member_id)}
                  mapOpen={expandedMap === r.id} onToggleMap={() => setExpandedMap((p) => (p === r.id ? null : r.id))}
                  onInterest={() => signalerInteretDemande(r.id)}
                  onAccept={() => accepterDemande(r.id, r.member_nom)}
                  onDelete={() => deleteRow("demande", r.id)}
                  onToggleStatut={() => updateRow("demande", r.id, { statut: r.statut === "active" ? "comblee" : "active" })}
                  onEdit={() => setEditing({ kind: "demande", row: r })}
                  matches={matchesForRequest(r)}
                  onReserveMatch={(offer) => setReserving({ offer, requestId: r.id })}
                  dispatchRound={dispatchRounds.find((d) => d.request_id === r.id)}
                  onLaunchDispatch={() => lancerDispatch(r.id)}
                  onRetryGeocode={() => retryGeocode("demande", r)}
                  onToggleVerify={toggleVerifieMembre} onToggleSuspend={toggleSuspendreMembre}
                />
              ))}
            </div>
            {grille ? <GrilleSummary P={P} grille={grille} devise={devise} /> : <CostShareCalculator t={t} devise={devise} />}
          </div>
        )}
      </Section>

      {showFiche && (
        <FicheConducteurModal profile={profile} me={me} vehicules={vehicules} plaques={plaques} documents={documents}
          onClose={() => setShowFiche(false)} onChanged={() => load(true)} />
      )}
      {ficheBooking && (
        <FicheTrajetModal lang={lang} devise={devise} row={buildEtatRow(ficheBooking, offers, members, vehicules)} onClose={() => setFicheBooking(null)} />
      )}
      {showCreate && (
        <CreateRideModal t={t} events={events} prefill={prefill} onClose={() => { setShowCreate(false); setPrefill(null); }}
          pro={{ P, proSql, grille, devise, me, myVehicles, onOpenFiche: () => setShowFiche(true) }}
          onCreateOffer={async (f) => { if (await createOffer(f)) { setShowCreate(false); setPrefill(null); } }}
          onCreateRequest={async (f) => { if (await createRequest(f)) { setShowCreate(false); setPrefill(null); } }}
        />
      )}
      {editing && (
        <EditRideModal t={t} editing={editing} onClose={() => setEditing(null)}
          pro={{ P, proSql, grille, devise, myVehicles }}
          onSave={async (patch) => { await updateRow(editing.kind, editing.row.id, patch); setEditing(null); }}
        />
      )}
      {reserving && (
        <ReserveModal t={t} devise={devise} offer={reserving.offer} onClose={() => setReserving(null)}
          pro={{ P, grille, vehicule: vehiculeFor(reserving.offer.vehicule_id) }}
          onSubmit={async (seats, message, solidaire) => { if (await reserve(reserving.offer.id, seats, message, reserving.requestId, solidaire)) { setReserving(null); alert(t("cov_reserve_sent")); } }}
        />
      )}
      {rating && (
        <RatingModal t={t} counterpartNom={rating.counterpartNom} onClose={() => setRating(null)}
          onSubmit={async (note, commentaire) => { if (await submitRating(rating.booking.id, note, commentaire)) setRating(null); }}
        />
      )}
      {sharing && <ShareTripModal t={t} token={sharing.token} onClose={() => setSharing(null)} />}
      {reportingIncident && (
        <IncidentModal t={t} onClose={() => setReportingIncident(null)}
          quickMessages={messagesRapidesActif ? quickMessages.filter((m) => m.categorie === "signalement" && m.actif && (m.cible === reportingIncident.role || m.cible === "les_deux")) : []}
          onSubmit={async (description) => { if (await signalerIncident(reportingIncident.booking.id, description)) { setReportingIncident(null); alert(t("cov_incident_sent")); } }}
        />
      )}
      {showAvailability && (
        <AvailabilityModal t={t} onClose={() => setShowAvailability(false)}
          onSubmit={async (params) => { if (await activerDisponibilite(params)) setShowAvailability(false); }}
        />
      )}
    </Container>
  );
}

function tabBtn(active) {
  return { fontWeight: 600, fontSize: 13, color: active ? "#fff" : "#5B6270", background: active ? "var(--primary)" : "transparent", border: active ? "none" : "1px solid #DCE0E8", borderRadius: 999, padding: "8px 16px", cursor: "pointer", display: "inline-flex", alignItems: "center" };
}
function linkBtn(color) {
  return { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color, background: "none", border: "none", cursor: "pointer", padding: 0 };
}

// ---------- Navigation intégrée : liens + aperçu cartographique ----------
function NavLinks({ t, from, to, mapOpen, onToggleMap }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={onToggleMap} style={linkBtn("var(--primary)")}><MapIcon size={12} /> {mapOpen ? t("cov_nav_hide_map") : t("cov_nav_show_map")}</button>
        <a href={googleMapsDirUrl(from, to)} target="_blank" rel="noreferrer" style={navIconLink}><Navigation size={11} /> Google Maps</a>
        <a href={wazeUrl(to)} target="_blank" rel="noreferrer" style={navIconLink}><Navigation size={11} /> Waze</a>
        <a href={appleMapsUrl(from, to)} target="_blank" rel="noreferrer" style={navIconLink}><Navigation size={11} /> Apple Maps</a>
        <a href={osmSearchUrl(from, to)} target="_blank" rel="noreferrer" style={navIconLink}>{t("cov_open_map")}</a>
      </div>
      {mapOpen && (
        <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid #DCE0E8", height: 220 }}>
          <iframe title="itineraire" src={googleMapsEmbedUrl(from, to)} width="100%" height="100%" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        </div>
      )}
    </div>
  );
}
const navIconLink = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#5B6270", textDecoration: "none" };

function RatingBadge({ stats }) {
  if (!stats) return null;
  return <Pill color={AMBER} bg={AMBER_LIGHT}><Star size={11} style={{ marginRight: 3 }} fill={AMBER} /> {stats.avg.toFixed(1)} ({stats.count})</Pill>;
}
// Badge "temps d'arrivée moyen" d'un conducteur — voir sql/2026-10-08c_
// systeme_chrono_trajet.sql — calculé sur ses trajets terminés, pour
// comparer les conducteurs entre eux (demande explicite de l'utilisateur).
function TimingBadge({ t, stats }) {
  if (!stats) return null;
  return (
    <Pill color={TEAL} bg={TEAL_LIGHT}>
      <Clock size={11} style={{ marginRight: 3 }} /> {t("cov_timer_avg_pickup_badge").replace("{min}", Math.round(stats.avgPickupSec / 60))}
    </Pill>
  );
}

// Préférences de trajet (Phase A, sql/2026-10-08e) — cases à cocher
// réutilisées par CreateRideModal et EditRideModal pour une offre.
function PreferencesFields({ t, form, setForm }) {
  return (
    <Field label={t("cov_field_preferences")}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={!!form.pref_non_fumeur} onChange={(e) => setForm((p) => ({ ...p, pref_non_fumeur: e.target.checked }))} /> {t("cov_pref_non_fumeur")}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={!!form.pref_musique} onChange={(e) => setForm((p) => ({ ...p, pref_musique: e.target.checked }))} /> {t("cov_pref_musique")}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={!!form.pref_animaux} onChange={(e) => setForm((p) => ({ ...p, pref_animaux: e.target.checked }))} /> {t("cov_pref_animaux")}
        </label>
      </div>
    </Field>
  );
}

// Badge "vérifié par le bureau" (Phase A) — déclaratif, voir
// verifier_membre_covoiturage dans sql/2026-10-08e.
function VerifiedBadge({ t, verified }) {
  if (!verified) return null;
  return <Pill color={TEAL} bg={TEAL_LIGHT}><ShieldCheck size={11} style={{ marginRight: 3 }} /> {t("cov_verified_badge")}</Pill>;
}

function RideCard({ kind, row, t, lang, devise, isOwn, isBureau, eventTitre, ratingStats, comments, timingStats, memberVerified, memberSuspended, memberSuspendedMotif, reliability, mapOpen, onToggleMap, onReserve, onInterest, onAccept, onDelete, onToggleStatut, onEdit, matches, onReserveMatch, dispatchRound, onLaunchDispatch, onRetryGeocode, onToggleVerify, onToggleSuspend, pro }) {
  const isOffer = kind === "offre";
  const geoManquant = row.depart_lat == null;
  return (
    <Card style={{ borderTopColor: isOffer ? TEAL : "var(--primary)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {isOffer && pro && <DriverAvatar photoUrl={pro.photoUrl} nom={row.member_nom} size={30} />}
            <div style={{ fontSize: 13, fontWeight: 700, color: "#182233" }}>{row.member_nom || "—"}</div>
            {isOffer && pro && memberVerified
              ? <Pill color={TEAL} bg={TEAL_LIGHT}><ShieldCheck size={11} style={{ marginRight: 3 }} /> {pro.P.verified_driver}</Pill>
              : <VerifiedBadge t={t} verified={memberVerified} />}
            {isOffer && <RatingBadge stats={ratingStats} />}
            {isOffer && <TimingBadge t={t} stats={timingStats} />}
            {memberSuspended && <Pill color={RED} bg="#FCEAEA"><Ban size={11} style={{ marginRight: 3 }} /> {t("cov_suspended_badge")}</Pill>}
            {!isOffer && reliability > 0 && <Pill color={AMBER} bg={AMBER_LIGHT}><AlertTriangle size={11} style={{ marginRight: 3 }} /> {t("cov_reliability_warning").replace("{n}", reliability)}</Pill>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 600, margin: "6px 0 4px", flexWrap: "wrap" }}>
            <MapPin size={14} color={isOffer ? TEAL : "var(--primary)"} /> {row.point_depart} → {row.point_arrivee}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "#5B6270", marginBottom: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Calendar size={12} /> {formatDateTime(row.date_heure, lang)}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Users size={12} /> {isOffer ? t("cov_seats_left").replace("{n}", row.places_disponibles) : t("cov_seats_wanted").replace("{n}", row.places_demandees)}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {isOffer && row.recurrence !== "aucune" && <Pill color={TEAL} bg={TEAL_LIGHT}><Repeat size={11} style={{ marginRight: 3 }} />{t("cov_recurrence_" + row.recurrence)}</Pill>}
            {isOffer && row.prix_place != null && (
              row.prix_grille != null && pro
                ? <Pill color={TEAL} bg={TEAL_LIGHT}><Fuel size={11} style={{ marginRight: 3 }} />{Number(row.prix_place) === 0 ? pro.P.pay_offert : `${money(row.prix_place, devise)} ${pro.P.per_passenger}`}</Pill>
                : <Pill color="#182233" bg="#F1F2F4">{money(row.prix_place, devise)} {t("cov_per_seat")}</Pill>
            )}
            {isOffer && row.duree_estimee_min != null && <Pill color="#182233" bg="#F1F2F4"><Clock size={11} style={{ marginRight: 3 }} />≈ {formatDuration(row.duree_estimee_min * 60)}{row.distance_estimee_m != null ? ` · ${(row.distance_estimee_m / 1000).toFixed(1)} km` : ""}</Pill>}
            {isOffer && row.pref_non_fumeur && <Pill color="#182233" bg="#F1F2F4">{t("cov_pref_non_fumeur")}</Pill>}
            {isOffer && row.pref_musique && <Pill color="#182233" bg="#F1F2F4">{t("cov_pref_musique")}</Pill>}
            {isOffer && row.pref_animaux && <Pill color="#182233" bg="#F1F2F4">{t("cov_pref_animaux")}</Pill>}
            {eventTitre && <Pill color="#1F3864" bg="#EEF1F8"><Link2 size={11} style={{ marginRight: 3 }} />{eventTitre}</Pill>}
            {row.statut !== "active" && <Pill color="#8A8F98" bg="#F1F2F4">{t("cov_statut_" + row.statut)}</Pill>}
          </div>
          {isOffer && row.recurrence !== "aucune" && <div style={{ fontSize: 11, color: "#8A8F98", marginTop: -6, marginBottom: 8 }}>{t("cov_recurrence_auto_note")}</div>}
          {isOffer && pro?.vehicule && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#182233", background: "#F6F8FA", borderRadius: 10, padding: "6px 10px", marginBottom: 10 }}>
              <VehiculePhoto path={pro.vehicule.photo_path} size={48} />
              <span><Car size={12} style={{ verticalAlign: -2, marginRight: 4 }} />{vehiculeLabel(pro.vehicule)}</span>
            </div>
          )}
          {memberSuspended && isBureau && memberSuspendedMotif && <div style={{ fontSize: 11.5, color: RED, marginBottom: 8 }}>{t("cov_suspend_motif_label")} {memberSuspendedMotif}</div>}
          {row.notes && <div style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 10 }}>{row.notes}</div>}
          {isOffer && comments && comments.length > 0 && (
            <div style={{ background: "#F6F8FA", borderRadius: 10, padding: "8px 10px", marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#5B6270" }}>{t("cov_reviews_title")}</div>
              {comments.slice(0, 2).map((c) => (
                <div key={c.id} style={{ fontSize: 12, color: "#182233", fontStyle: "italic" }}>« {c.commentaire} » <span style={{ color: AMBER, fontStyle: "normal" }}>({c.note}/5)</span></div>
              ))}
            </div>
          )}

          {isOwn && geoManquant && (
            <div style={{ background: AMBER_LIGHT, borderRadius: 10, padding: "8px 12px", marginBottom: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <AlertTriangle size={14} color={AMBER} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: "#182233", flex: 1 }}>{t("cov_geocode_missing_warning")}</span>
              {onRetryGeocode && <button onClick={onRetryGeocode} style={linkBtn(AMBER)}><Repeat size={11} /> {t("cov_geocode_retry_btn")}</button>}
            </div>
          )}

          {!isOffer && matches && matches.length > 0 && (
            <div style={{ background: TEAL_LIGHT, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: TEAL, display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}><Sparkles size={12} /> {t("cov_matches_title")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {matches.map(({ offer }) => (
                  <div key={offer.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, flexWrap: "wrap" }}>
                    <span>{offer.member_nom} — {offer.point_depart} → {offer.point_arrivee} <span style={{ color: "#5B6270" }}>· {formatDateTime(offer.date_heure, lang)}</span></span>
                    <Btn variant="outline" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => onReserveMatch(offer)}>{t("cov_reserve_btn")}</Btn>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <NavLinks t={t} from={row.point_depart} to={row.point_arrivee} mapOpen={mapOpen} onToggleMap={onToggleMap} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {isOffer && !isOwn && row.statut === "active" && row.places_disponibles > 0 && <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12 }} onClick={onReserve}><Send size={12} /> {t("cov_reserve_btn")}</Btn>}
            {!isOffer && !isOwn && row.statut === "active" && <Btn style={{ padding: "6px 12px", fontSize: 12 }} onClick={onAccept}><Check size={12} /> {t("cov_accept_request_btn")}</Btn>}
            {!isOffer && !isOwn && row.statut === "active" && <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12 }} onClick={onInterest}><Send size={12} /> {t("cov_interest_btn")}</Btn>}
            {!isOffer && isOwn && row.statut === "active" && (
              dispatchRound ? (
                <Pill color={TEAL} bg={TEAL_LIGHT}><Timer size={11} style={{ marginRight: 3 }} /> {t("cov_dispatch_searching")}</Pill>
              ) : (
                <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12 }} onClick={onLaunchDispatch}><Zap size={12} /> {t("cov_dispatch_launch_btn")}</Btn>
              )
            )}
            {(isOwn || isBureau) && (
              <>
                <button onClick={onToggleStatut} style={linkBtn("var(--primary)")}>{row.statut === "active" ? t("cov_mark_done") : t("cov_mark_active")}</button>
                <button onClick={onEdit} style={linkBtn("var(--primary)")}><Pencil size={11} /> {t("action_edit")}</button>
                <button onClick={onDelete} style={linkBtn(RED)}><Trash2 size={11} /> {t("action_delete")}</button>
              </>
            )}
            {isBureau && !isOwn && (
              <>
                <button onClick={() => onToggleVerify(row.member_id, row.member_nom, !memberVerified)} style={linkBtn(TEAL)}><ShieldCheck size={11} /> {memberVerified ? t("cov_verify_remove_btn") : t("cov_verify_add_btn")}</button>
                <button onClick={() => onToggleSuspend(row.member_id, row.member_nom, !memberSuspended)} style={linkBtn(memberSuspended ? TEAL : RED)}><Ban size={11} /> {memberSuspended ? t("cov_suspend_lift_btn") : t("cov_suspend_btn")}</button>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------- Réservations (mise en relation) ----------
function bookingStatutColor(statut) {
  if (statut === "acceptee" || statut === "terminee") return { color: TEAL, bg: TEAL_LIGHT };
  if (statut === "refusee" || statut === "annulee") return { color: RED, bg: "#FCEAEA" };
  return { color: AMBER, bg: AMBER_LIGHT };
}

function ContactReveal({ t, contact }) {
  if (!contact) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "#182233", background: "#F6F8FA", borderRadius: 8, padding: "8px 10px", marginTop: 6 }}>
      <strong style={{ color: TEAL }}>{t("cov_booking_contact_title")} :</strong>
      {contact.telephone && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Phone size={12} /> {contact.telephone}</span>}
      {contact.email && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Mail size={12} /> {contact.email}</span>}
      {!contact.telephone && !contact.email && <span style={{ color: "#8A8F98" }}>—</span>}
    </div>
  );
}

// Prochaine étape du cycle de vie d'une course acceptée — null une fois
// terminée (plus aucun bouton à afficher).
function nextStep(statut) {
  if (statut === "acceptee") return "en_route";
  if (statut === "en_route") return "arrivee";
  if (statut === "arrivee") return "a_bord";
  if (statut === "a_bord") return "terminee";
  return null;
}
function minutesAgo(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}
function livePositionEmbedUrl(lat, lng) { return `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`; }

// ---------- Système de chrono / timing (voir sql/2026-10-08c_systeme_
// chrono_trajet.sql) ----------
// Formate une durée en secondes en texte lisible ("3 min 12 s" / "1 h 08").
function formatDuration(seconds) {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} h ${String(min).padStart(2, "0")}`;
  return sec > 0 && min < 10 ? `${min} min ${sec} s` : `${min} min`;
}
// Distance à vol d'oiseau (mètres) — repli quand le routage réel
// (OSRM) est indisponible, même esprit que le géocodage Nominatim :
// gratuit, sans clé, best-effort.
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// Estime le temps de trajet routier entre deux points via le service
// public gratuit OSRM (aucune clé, pas d'engagement de disponibilité —
// demandé explicitement par l'utilisateur plutôt qu'une simple
// estimation à vol d'oiseau). Si le service échoue ou est trop lent,
// repli silencieux sur une estimation à vitesse moyenne urbaine
// (35 km/h) plutôt que de bloquer l'affichage — l'origine du chiffre
// (source: "osrm" | "estimation") est renvoyée pour que l'interface
// l'étiquette honnêtement.
async function fetchRouteEta(fromLat, fromLng, toLat, toLng) {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 6000);
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error("osrm_http_" + res.status);
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route || route.duration == null) throw new Error("osrm_no_route");
    return { durationSec: route.duration, distanceM: route.distance, source: "osrm" };
  } catch {
    const distanceM = haversineMeters(fromLat, fromLng, toLat, toLng);
    const durationSec = distanceM / ((35 * 1000) / 3600);
    return { durationSec, distanceM, source: "estimation" };
  }
}
// Trajet en direct sur la carte (suite 2026-10-08, claude/covoiturage-
// registre-messages-carte-parametres-proposition.md) : même service
// OSRM que fetchRouteEta ci-dessus, mais avec overview=full&geometries=
// geojson pour obtenir le TRACÉ réel, pas seulement sa durée. Best-effort
// comme tout le reste de ce fichier : renvoie null si OSRM échoue ou ne
// répond pas à temps, pour que l'appelant retombe simplement sur
// l'ancien affichage ponctuel (aucune carte n'est pire qu'une carte qui
// ne charge jamais).
async function fetchRouteGeometry(fromLat, fromLng, toLat, toLng) {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 6000);
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error("osrm_http_" + res.status);
    const data = await res.json();
    const route = data?.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (!route || !Array.isArray(coords) || coords.length < 2) throw new Error("osrm_no_geometry");
    // GeoJSON renvoie [lng, lat] — Leaflet attend [lat, lng].
    return { coords: coords.map(([lng, lat]) => [lat, lng]), distanceM: route.distance, durationSec: route.duration };
  } catch {
    return null;
  }
}
// Phase du cycle de vie d'une course en cours + coordonnées de la cible
// de routage correspondante — factorisé ici pour être partagé entre
// TripTimer (ETA textuelle) et RouteMap (tracé) ci-dessous, afin de ne
// jamais les laisser diverger.
function phaseOf(statut) { return statut === "en_route" ? "en_route" : statut === "arrivee" ? "arrivee" : statut === "a_bord" ? "a_bord" : null; }
function targetForPhase(phase, offer) {
  if (phase === "en_route") return { lat: offer?.depart_lat, lng: offer?.depart_lng };
  if (phase === "a_bord") return { lat: offer?.arrivee_lat, lng: offer?.arrivee_lng };
  return { lat: null, lng: null };
}
// Carte Leaflet + OpenStreetMap (gratuit, sans clé API, cohérent avec
// OSRM/Nominatim déjà utilisés ailleurs dans ce fichier) affichant le
// tracé réel du trajet en cours — visible au chauffeur comme au passager
// (demande explicite de l'utilisateur, "si possible"). Marqueurs en
// cercles pleins (L.circleMarker) plutôt que L.marker par défaut : évite
// le problème classique des icônes Leaflet introuvables sous un bundler
// comme Vite (chemins d'images cassés), sans dépendance supplémentaire.
// Repli silencieux : si le tracé OSRM échoue, le composant ne rend rien
// et l'appelant garde l'ancien affichage ponctuel (Google Maps embed).
function RouteMap({ t, fromLat, fromLng, toLat, toLng, fallback }) {
  const [geo, setGeo] = useState(undefined); // undefined = en cours, null = échec, objet = succès
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (fromLat == null || fromLng == null || toLat == null || toLng == null) { setGeo(null); return; }
    let cancelled = false;
    setGeo(undefined);
    fetchRouteGeometry(fromLat, fromLng, toLat, toLng).then((r) => { if (!cancelled) setGeo(r); });
    return () => { cancelled = true; };
  }, [fromLat, fromLng, toLat, toLng]);

  useEffect(() => {
    if (!elRef.current || !geo) return;
    if (!mapRef.current) {
      mapRef.current = L.map(elRef.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mapRef.current);
    }
    const map = mapRef.current;
    if (layerRef.current) { layerRef.current.remove(); }
    const group = L.layerGroup();
    const line = L.polyline(geo.coords, { color: TEAL, weight: 5, opacity: 0.85 });
    line.addTo(group);
    L.circleMarker([fromLat, fromLng], { radius: 7, color: TEAL, fillColor: TEAL, fillOpacity: 1, weight: 2 }).addTo(group);
    L.circleMarker([toLat, toLng], { radius: 7, color: AMBER, fillColor: AMBER, fillOpacity: 1, weight: 2 }).addTo(group);
    group.addTo(map);
    layerRef.current = group;
    setTimeout(() => { try { map.invalidateSize(); map.fitBounds(line.getBounds(), { padding: [22, 22] }); } catch { /* conteneur pas encore mesurable — sans conséquence */ } }, 0);
  }, [geo, fromLat, fromLng, toLat, toLng]);

  useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } }, []);

  if (!geo) return fallback || null; // en cours de chargement ou échec OSRM — repli éventuel fourni par l'appelant
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #DCE0E8", height: 190 }}>
        <div ref={elRef} style={{ width: "100%", height: "100%" }} />
      </div>
      <div style={{ fontSize: 10.5, color: "#8A8F98", marginTop: 3 }}>{t("cov_routemap_note")}</div>
    </div>
  );
}
// Chrono en direct : temps écoulé depuis `since`, qui défile seconde par
// seconde (indépendant du rafraîchissement périodique des données).
function LiveElapsed({ since }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!since) return null;
  return <span>{formatDuration((Date.now() - new Date(since).getTime()) / 1000)}</span>;
}
// Bloc chrono affiché pendant (en_route/a_bord, avec ETA en direct) et
// après (terminee, durées finales figées) une course — visible par le
// conducteur ET le passager, indépendamment du rôle.
// Au-delà de cette distance (mètres), la position partagée est presque
// certainement hors contexte par rapport au trajet (mauvais appareil,
// position simulée/de test, GPS d'ordinateur situé ailleurs qu'au
// terrain réel...) plutôt qu'un vrai trajet de covoiturage local — même
// un long trajet intervilles réaliste (ex. Douala–Yaoundé, ~250 km)
// reste largement sous ce seuil. Repéré en test réel : un compte
// partageant sa position depuis un autre continent que le trajet
// affiché produisait une estimation "à vol d'oiseau" de plusieurs jours,
// ce qui semblait être une erreur de calcul alors que le calcul était
// juste — c'est la donnée d'entrée (position GPS) qui n'avait pas de
// sens pour ce trajet. Mieux vaut le signaler clairement que d'afficher
// un chiffre absurde sans explication.
const IMPLAUSIBLE_DISTANCE_M = 1000000;

function TripTimer({ t, booking, offer, livePosition }) {
  const [eta, setEta] = useState(null); // { durationSec, distanceM, source }
  // Phase "arrivee" (nouvelle étape, suite 2026-10-08 : le conducteur est
  // arrivé au point de rendez-vous mais le passager n'est pas encore à
  // bord) n'a pas de cible de routage — le conducteur est déjà sur place,
  // il ne reste qu'une attente, pas un trajet à estimer.
  const phase = phaseOf(booking.statut);
  const { lat: targetLat, lng: targetLng } = targetForPhase(phase, offer);

  useEffect(() => {
    if (!phase || !livePosition || targetLat == null || targetLng == null) { setEta(null); return; }
    let cancelled = false;
    fetchRouteEta(livePosition.lat, livePosition.lng, targetLat, targetLng).then((r) => { if (!cancelled) setEta(r); });
    return () => { cancelled = true; };
  }, [phase, livePosition?.lat, livePosition?.lng, targetLat, targetLng]);

  if (booking.statut === "terminee") {
    // Avec arrivee_at (nouvelles réservations) : trois segments distincts
    // (conduite vers le passager / attente au point de rendez-vous /
    // durée du trajet). Sans arrivee_at (réservations antérieures à ce
    // chantier) : repli sur l'ancien calcul à deux segments.
    const tempsArrivee = booking.en_route_at && booking.arrivee_at ? (new Date(booking.arrivee_at) - new Date(booking.en_route_at)) / 1000 : null;
    const tempsAttente = booking.arrivee_at && booking.a_bord_at ? (new Date(booking.a_bord_at) - new Date(booking.arrivee_at)) / 1000 : null;
    const pickupLegacy = !booking.arrivee_at && booking.en_route_at && booking.a_bord_at ? (new Date(booking.a_bord_at) - new Date(booking.en_route_at)) / 1000 : null;
    const pickup = tempsArrivee ?? pickupLegacy;
    const duree = booking.a_bord_at && booking.terminee_at ? (new Date(booking.terminee_at) - new Date(booking.a_bord_at)) / 1000 : null;
    if (pickup == null && tempsAttente == null && duree == null) return null;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "#5B6270", background: "#F6F8FA", borderRadius: 8, padding: "7px 10px", marginTop: 6, marginBottom: 6 }}>
        {pickup != null && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={12} /> {t("cov_timer_final_pickup").replace("{time}", formatDuration(pickup))}</span>}
        {tempsAttente != null && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={12} /> {t("cov_timer_final_attente").replace("{time}", formatDuration(tempsAttente))}</span>}
        {duree != null && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={12} /> {t("cov_timer_final_duration").replace("{time}", formatDuration(duree))}</span>}
      </div>
    );
  }

  if (!phase) return null;
  const since = phase === "en_route" ? booking.en_route_at : phase === "arrivee" ? booking.arrivee_at : booking.a_bord_at;
  const sinceLabelKey = phase === "en_route" ? "cov_timer_since_enroute" : phase === "arrivee" ? "cov_timer_since_arrived" : "cov_timer_since_aboard";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: TEAL, background: TEAL_LIGHT, borderRadius: 8, padding: "7px 10px", marginTop: 6, marginBottom: 6 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600 }}>
        <Clock size={12} /> {t(sinceLabelKey)} <LiveElapsed since={since} />
      </span>
      {eta && eta.distanceM > IMPLAUSIBLE_DISTANCE_M ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: AMBER }}>
          <AlertTriangle size={12} /> {t("cov_timer_position_implausible")}
        </span>
      ) : eta && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Navigation size={12} /> {t("cov_timer_eta_label").replace("{time}", formatDuration(eta.durationSec)).replace("{km}", Math.round(eta.distanceM / 1000))}
          <span style={{ fontSize: 10.5, color: "#8A8F98" }}>({t(eta.source === "osrm" ? "cov_timer_eta_via_route" : "cov_timer_eta_approx")})</span>
        </span>
      )}
    </div>
  );
}

// Messagerie in-app liée à une réservation (Phase A, sql/2026-10-08e) —
// permet d'échanger AVANT l'acceptation (donc avant la révélation des
// coordonnées via ContactReveal) sans jamais exposer le numéro de
// téléphone. Repliée par défaut pour ne pas alourdir chaque réservation.
function MessageThread({ t, messages, myMemberId, onSend, quickMessages, messagesRapidesActif, role }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  async function submit() {
    if (!text.trim()) return;
    setSending(true);
    await onSend(text.trim());
    setText("");
    setSending(false);
  }
  // Réponses rapides préétablies (suite 2026-10-08) — cible = "chauffeur"
  // côté conducteur, "passager" côté passager, "les_deux" toujours
  // proposé. Clic insère le texte dans le champ (pas d'envoi direct) pour
  // laisser la possibilité de relire/ajuster avant d'envoyer.
  const cible = role === "conducteur" ? "chauffeur" : "passager";
  const quickOptions = messagesRapidesActif ? (quickMessages || []).filter((m) => m.categorie === "message_rapide" && m.actif && (m.cible === cible || m.cible === "les_deux")) : [];
  return (
    <div style={{ marginTop: 6, marginBottom: 6 }}>
      <button onClick={() => setOpen((p) => !p)} style={linkBtn("var(--primary)")}>
        <MessageCircle size={12} /> {t("cov_messages_toggle").replace("{n}", messages.length)}
      </button>
      {open && (
        <div style={{ background: "#F6F8FA", borderRadius: 10, padding: "10px 12px", marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 160, overflowY: "auto" }}>
            {messages.length === 0 && <p style={{ fontSize: 11.5, color: "#8A8F98", fontStyle: "italic", margin: 0 }}>{t("cov_messages_empty")}</p>}
            {messages.map((m) => (
              <div key={m.id} style={{ fontSize: 12, alignSelf: m.sender_member_id === myMemberId ? "flex-end" : "flex-start", background: m.sender_member_id === myMemberId ? TEAL_LIGHT : "white", border: "1px solid #DCE0E8", borderRadius: 8, padding: "5px 9px", maxWidth: "85%" }}>
                {m.message}
              </div>
            ))}
          </div>
          {quickOptions.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              <span style={{ fontSize: 10.5, color: "#8A8F98", width: "100%" }}>{t("cov_messages_quickreplies_label")}</span>
              {quickOptions.map((m) => (
                <button key={m.id} type="button" onClick={() => setText(m.texte)}
                  style={{ fontSize: 11.5, color: TEAL, background: "white", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "4px 10px", cursor: "pointer" }}>
                  {m.texte}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <input style={{ ...inputStyle, flex: 1, padding: "7px 10px" }} value={text} placeholder={t("cov_messages_placeholder")}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
            <Btn style={{ padding: "7px 12px", fontSize: 12 }} onClick={submit} disabled={sending || !text.trim()}><Send size={12} /></Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function BookingRow({ t, lang, devise, booking, offer, role, memberContact, myRating, onRespond, onCancel, onRate, livePosition, isTracking, onStartSharing, onStopSharing, onAdvanceStep, onShare, onReportIncident, onDeleteBooking, onSignalAbsence, messages, myMemberId, onSendMessage, quickMessages, messagesRapidesActif, pro }) {
  const sc = bookingStatutColor(booking.statut);
  const counterpartId = role === "conducteur" ? booking.passenger_member_id : offer?.member_id;
  const counterpartNom = role === "conducteur" ? booking.passenger_nom : offer?.member_nom;
  const enCours = booking.statut === "en_route" || booking.statut === "arrivee" || booking.statut === "a_bord";
  const engagee = booking.statut === "acceptee" || enCours;
  const step = nextStep(booking.statut);
  // Trajet en direct sur la carte (suite 2026-10-08) — visible au
  // chauffeur comme au passager pendant "en_route"/"a_bord" (pendant
  // "arrivee" le conducteur est déjà sur place, rien à tracer). Repli
  // silencieux (RouteMap ne rend rien) si le tracé OSRM échoue.
  const ridePhase = phaseOf(booking.statut);
  const rideTarget = targetForPhase(ridePhase, offer);
  // Prix figé à la réservation (sql/2026-10-09b) : absent des réservations
  // plus anciennes ou tant que le script n'a pas été exécuté.
  const hasFrozenPrice = !!pro && booking.montant_du != null && (booking.prix_unitaire != null || Number(booking.montant_du) > 0);
  const actif = !["refusee", "annulee", "en_attente"].includes(booking.statut);
  const payable = hasFrozenPrice && actif && (Number(booking.montant_du) > 0 || booking.paiement_statut === "offert");
  const payColor = booking.paiement_statut === "paye" || booking.paiement_statut === "offert" ? { c: TEAL, bg: TEAL_LIGHT }
    : booking.paiement_statut === "declare_paye" ? { c: "#1F3864", bg: "#EEF1F8" } : { c: AMBER, bg: AMBER_LIGHT };
  const unpaid = payable && Number(booking.montant_du) > 0 && (booking.paiement_statut === "non_paye" || booking.paiement_statut === "declare_paye");
  const vehicule = pro?.vehiculeFor(offer?.vehicule_id);
  const plaque = pro?.plaqueFor(offer?.vehicule_id);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, width: "100%" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#182233", marginBottom: 2 }}>{counterpartNom || "—"}</div>
          {offer && <div style={{ fontSize: 12.5, color: "#5B6270", display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}><MapPin size={12} /> {offer.point_depart} → {offer.point_arrivee} <span>· {formatDateTime(offer.date_heure, lang)}</span></div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <Pill color={sc.color} bg={sc.bg}>{t("cov_booking_statut_" + booking.statut)}</Pill>
            <Pill color="#182233" bg="#F1F2F4">{t("cov_booking_seats").replace("{n}", booking.seats_reserved)}</Pill>
            {hasFrozenPrice ? (
              <>
                <Pill color="#182233" bg="#F1F2F4"><Fuel size={11} style={{ marginRight: 3 }} />{pro.P.bk_amount.replace("{m}", money(booking.montant_du, devise))}</Pill>
                {payable && <Pill color={payColor.c} bg={payColor.bg}><Wallet size={11} style={{ marginRight: 3 }} />{pro.P["pay_" + booking.paiement_statut] || booking.paiement_statut}</Pill>}
              </>
            ) : offer?.prix_place != null && <Pill color="#182233" bg="#F1F2F4">{money(offer.prix_place * booking.seats_reserved, devise)}</Pill>}
          </div>
          {hasFrozenPrice && (
            <div style={{ fontSize: 11.5, color: "#5B6270", marginBottom: 6 }}>
              {booking.prix_unitaire != null && `${money(booking.prix_unitaire, devise)} ${pro.P.per_passenger}`}
              {booking.tranche_appliquee && ` · ${trancheLabel(booking.tranche_appliquee, lang)}`}
              {Number(booking.frais_attente) > 0 && ` · ${pro.P.bk_wait_fee.replace("{m}", money(booking.frais_attente, devise))}`}
              {Number(booking.frais_reels) > 0 && ` · ${pro.P.bk_real_fee.replace("{m}", money(booking.frais_reels, devise))}${booking.frais_reels_description ? ` (${booking.frais_reels_description})` : ""}`}
            </div>
          )}
          {booking.message && <div style={{ fontSize: 12, color: "#5B6270", fontStyle: "italic", marginBottom: 6 }}>« {booking.message} »</div>}
          {engagee && <ContactReveal t={t} contact={memberContact(counterpartId)} />}
          {role === "passager" && vehicule && (engagee || booking.statut === "terminee") && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, background: "#F6F8FA", borderRadius: 8, padding: "6px 10px", marginTop: 6 }}>
              <VehiculePhoto path={vehicule.photo_path} size={44} />
              <span>{vehiculeLabel(vehicule)}{plaque && <> · {pro.P.bk_plate} : <strong>{plaque}</strong></>}</span>
            </div>
          )}
          <TripTimer t={t} booking={booking} offer={offer} livePosition={livePosition} />
          {!["refusee", "annulee", "terminee"].includes(booking.statut) && (
            <MessageThread t={t} messages={messages} myMemberId={myMemberId} onSend={(text) => onSendMessage(booking.id, text)}
              quickMessages={quickMessages} messagesRapidesActif={messagesRapidesActif} role={role} />
          )}

          {role === "conducteur" && enCours && (
            <div style={{ marginTop: 8 }}>
              {livePosition && rideTarget.lat != null && rideTarget.lng != null && (
                <RouteMap t={t} fromLat={livePosition.lat} fromLng={livePosition.lng} toLat={rideTarget.lat} toLng={rideTarget.lng} />
              )}
              {isTracking ? (
                <button onClick={onStopSharing} style={linkBtn(RED)}><Radio size={12} /> {t("cov_live_stop_btn")}</button>
              ) : (
                <button onClick={() => onStartSharing(booking.id)} style={linkBtn(TEAL)}><Radio size={12} /> {t("cov_live_start_btn")}</button>
              )}
              {isTracking && <div style={{ fontSize: 11, color: TEAL, marginTop: 4 }}>{t("cov_live_sharing_badge")}</div>}
            </div>
          )}
          {role === "passager" && enCours && (
            <div style={{ marginTop: 8, background: "#F6F8FA", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: TEAL, display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}><Radio size={12} /> {t("cov_live_position_title")}</div>
              {livePosition ? (
                <>
                  {rideTarget.lat != null && rideTarget.lng != null ? (
                    <RouteMap t={t} fromLat={livePosition.lat} fromLng={livePosition.lng} toLat={rideTarget.lat} toLng={rideTarget.lng}
                      fallback={(
                        <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #DCE0E8", height: 160, marginBottom: 6 }}>
                          <iframe title="position" src={livePositionEmbedUrl(livePosition.lat, livePosition.lng)} width="100%" height="100%" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                        </div>
                      )} />
                  ) : (
                    <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #DCE0E8", height: 160, marginBottom: 6 }}>
                      <iframe title="position" src={livePositionEmbedUrl(livePosition.lat, livePosition.lng)} width="100%" height="100%" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: "#8A8F98" }}>{minutesAgo(livePosition.updated_at) === 0 ? t("cov_live_position_updated_now") : t("cov_live_position_updated").replace("{min}", minutesAgo(livePosition.updated_at))}</div>
                </>
              ) : (
                <p style={{ fontSize: 12, color: "#8A8F98", margin: 0 }}>{t("cov_live_no_position")}</p>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
            {role === "conducteur" && booking.statut === "en_attente" && (
              <>
                <Btn style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => onRespond(booking.id, true)}><Check size={12} /> {t("cov_booking_accept_btn")}</Btn>
                <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => onRespond(booking.id, false)}><X size={12} /> {t("cov_booking_refuse_btn")}</Btn>
              </>
            )}
            {role === "conducteur" && step && (
              <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => onAdvanceStep(booking.id, step)}>
                <Check size={12} /> {t("cov_step_" + step + "_btn")}
              </Btn>
            )}
            {role === "conducteur" && (booking.statut === "acceptee" || booking.statut === "en_route" || booking.statut === "arrivee") && (
              <button onClick={() => onSignalAbsence(booking.id)} style={linkBtn(AMBER)}><UserX size={11} /> {t("cov_noshow_btn")}</button>
            )}
            {(booking.statut === "en_attente" || booking.statut === "acceptee") && (
              <button onClick={() => onCancel(booking.id)} style={linkBtn(RED)}><Trash2 size={11} /> {t("cov_booking_cancel_btn")}</button>
            )}
            {(booking.statut === "terminee" || booking.statut === "refusee" || booking.statut === "annulee") && (
              <button onClick={() => onDeleteBooking(booking.id)} style={linkBtn(RED)}><Trash2 size={11} /> {t("action_delete")}</button>
            )}
            {engagee && (
              <>
                <button onClick={() => onShare(booking.id)} style={linkBtn("var(--primary)")}><Share2 size={11} /> {t("cov_share_btn")}</button>
                <button onClick={() => onReportIncident(booking)} style={linkBtn(AMBER)}><AlertTriangle size={11} /> {t("cov_incident_btn")}</button>
              </>
            )}
            {booking.statut === "terminee" && !myRating && (
              <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => onRate(booking, counterpartId, counterpartNom)}><Star size={12} /> {t("cov_rate_btn")}</Btn>
            )}
            {booking.statut === "terminee" && myRating && (
              <span style={{ fontSize: 12, color: AMBER, display: "inline-flex", alignItems: "center", gap: 4 }}><Star size={12} fill={AMBER} /> {myRating.note}/5</span>
            )}
            {/* Paiement entre membres : l'app enregistre seulement payé / non payé. */}
            {role === "passager" && unpaid && booking.paiement_statut === "non_paye" && (
              <>
                <button onClick={() => pro.onPayment(booking.id, "declare_paye", "especes")} style={linkBtn(TEAL)}><Wallet size={11} /> {pro.P.bk_paid_cash}</button>
                <button onClick={() => pro.onPayment(booking.id, "declare_paye", "interac")} style={linkBtn(TEAL)}><Wallet size={11} /> {pro.P.bk_paid_interac}</button>
              </>
            )}
            {role === "conducteur" && unpaid && (
              <>
                <button onClick={() => pro.onPayment(booking.id, "paye", booking.paiement_mode)} style={linkBtn(TEAL)}><Check size={11} /> {pro.P.bk_confirm_paid}</button>
                {booking.statut === "terminee" && <button onClick={() => pro.onRemind(booking.id)} style={linkBtn(AMBER)}><Bell size={11} /> {pro.P.bk_remind}</button>}
              </>
            )}
            {role === "conducteur" && hasFrozenPrice && booking.paiement_statut === "paye" && (
              <button onClick={() => pro.onPayment(booking.id, "non_paye", null)} style={linkBtn("#8A8F98")}>{pro.P.bk_unpaid}</button>
            )}
            {role === "conducteur" && hasFrozenPrice && booking.paiement_statut !== "paye" && !["refusee", "annulee"].includes(booking.statut) && Number(booking.prix_unitaire) > 0 && (
              <button onClick={() => pro.onLowerPrice(booking)} style={linkBtn("var(--primary)")}><Pencil size={11} /> {pro.P.bk_lower}</button>
            )}
            {role === "conducteur" && hasFrozenPrice && pro.fraisReelsActif && actif && booking.paiement_statut !== "paye" && (
              <button onClick={() => pro.onRealCosts(booking)} style={linkBtn("var(--primary)")}><Plus size={11} /> {pro.P.bk_real}</button>
            )}
            {hasFrozenPrice && actif && (
              <button onClick={() => pro.onOpenFiche(booking)} style={linkBtn("var(--primary)")}><FileText size={11} /> {pro.P.bk_fiche}</button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------- Propositions automatiques (dispatch) reçues par un conducteur ----------
function DispatchProposalRow({ t, lang, round, request, onRespond }) {
  return (
    <Card style={{ borderTopColor: TEAL }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: TEAL, marginBottom: 6 }}><Zap size={12} /> {t("cov_dispatch_proposals_title")}</div>
      <div style={{ fontSize: 13, marginBottom: 4 }}>{t("cov_dispatch_proposal_desc").replace("{nom}", request?.member_nom || "—")}</div>
      {request && <div style={{ fontSize: 12.5, color: "#5B6270", display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}><MapPin size={12} /> {request.point_depart} → {request.point_arrivee} <span>· {formatDateTime(request.date_heure, lang)}</span></div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Btn style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => onRespond(round.id, true)}><Check size={12} /> {t("cov_dispatch_accept_btn")}</Btn>
        <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => onRespond(round.id, false)}><X size={12} /> {t("cov_dispatch_refuse_btn")}</Btn>
      </div>
    </Card>
  );
}

function BookingsPanel({
  t, lang, devise, received, sent, offers, profile, memberContact, myRatingFor, onRespond, onCancel, onRate, onDeleteBooking,
  candidateDispatchRounds, offerFor: offerForProp, requestFor, onRespondDispatch,
  livePositions, trackingBookingId, onStartSharing, onStopSharing, onAdvanceStep, onShare, onReportIncident,
  onSignalAbsence, messagesFor, onSendMessage, quickMessages, messagesRapidesActif, pro,
}) {
  function offerFor(id) { return offers.find((o) => o.id === id); }
  function positionFor(bookingId) { return (livePositions || []).find((p) => p.booking_id === bookingId); }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {candidateDispatchRounds && candidateDispatchRounds.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {candidateDispatchRounds.map((round) => (
            <DispatchProposalRow key={round.id} t={t} lang={lang} round={round} offer={offerForProp ? offerForProp(round.offer_id) : offerFor(round.offer_id)} request={requestFor ? requestFor(round.request_id) : null} onRespond={onRespondDispatch} />
          ))}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 20 }}>
        <div>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>{t("cov_booking_received_title")}</h3>
          {received.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{t("cov_booking_empty_received")}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {received.map((b) => (
              <BookingRow key={b.id} t={t} lang={lang} devise={devise} booking={b} offer={offerFor(b.offer_id)} role="conducteur"
                memberContact={memberContact} myRating={myRatingFor(b.id)} onRespond={onRespond} onCancel={onCancel} onRate={onRate} onDeleteBooking={onDeleteBooking}
                livePosition={positionFor(b.id)} isTracking={trackingBookingId === b.id}
                onStartSharing={onStartSharing} onStopSharing={onStopSharing} onAdvanceStep={onAdvanceStep} onShare={onShare} onReportIncident={onReportIncident}
                onSignalAbsence={onSignalAbsence} messages={messagesFor(b.id)} myMemberId={profile.member_id} onSendMessage={onSendMessage}
                quickMessages={quickMessages} messagesRapidesActif={messagesRapidesActif} pro={pro} />
            ))}
          </div>
        </div>
        <div>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>{t("cov_booking_sent_title")}</h3>
          {sent.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{t("cov_booking_empty_sent")}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sent.map((b) => (
              <BookingRow key={b.id} t={t} lang={lang} devise={devise} booking={b} offer={offerFor(b.offer_id)} role="passager"
                memberContact={memberContact} myRating={myRatingFor(b.id)} onRespond={onRespond} onCancel={onCancel} onRate={onRate} onDeleteBooking={onDeleteBooking}
                livePosition={positionFor(b.id)} isTracking={trackingBookingId === b.id}
                onStartSharing={onStartSharing} onStopSharing={onStopSharing} onAdvanceStep={onAdvanceStep} onShare={onShare} onReportIncident={onReportIncident}
                onSignalAbsence={onSignalAbsence} messages={messagesFor(b.id)} myMemberId={profile.member_id} onSendMessage={onSendMessage}
                quickMessages={quickMessages} messagesRapidesActif={messagesRapidesActif} pro={pro} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Panneau Administration (réservé au bureau) — suite 2026-10-08, voir
// claude/covoiturage-administration-rapport-proposition.md. Consolide ce
// qui était jusqu'ici invisible ou dispersé : les signalements (écrits
// mais jamais affichés nulle part), le registre des membres (badges
// accessibles seulement depuis un trajet actif visible à l'écran), et
// l'historique complet des transactions avec un décompte par statut
// (« les États » demandés) — rien de tout ça n'était consultable avant.
// =====================================================================
function AdministrationPanel({
  t, lang, devise, association, adminStats, incidents, incidentContext, onTraiterSignalement,
  members, memberSearch, onMemberSearch, onToggleVerify, onToggleSuspend,
  bookingStatutOrder, registreRows, buildDriverDossier,
}) {
  const openIncidents = incidents.filter((i) => (i.statut || "ouvert") === "ouvert");
  const treatedIncidents = incidents.filter((i) => i.statut === "traite");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
        <StatCard label={t("cov_admin_stat_offers")} value={adminStats.totalOffers} icon={Car} accent={TEAL} />
        <StatCard label={t("cov_admin_stat_requests")} value={adminStats.totalRequests} icon={Users} />
        <StatCard label={t("cov_admin_stat_bookings")} value={adminStats.totalBookings} icon={Clock} />
        <StatCard label={t("cov_admin_stat_verified")} value={adminStats.verifiedCount} icon={ShieldCheck} accent={TEAL} />
        <StatCard label={t("cov_admin_stat_suspended")} value={adminStats.suspendedCount} icon={Ban} accent={adminStats.suspendedCount > 0 ? RED : undefined} />
        <StatCard label={t("cov_admin_stat_open_incidents")} value={adminStats.openIncidents} icon={AlertTriangle} accent={adminStats.openIncidents > 0 ? AMBER : TEAL} />
      </div>

      <div>
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>{t("cov_admin_incidents_title")}</h3>
        {incidents.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{t("cov_admin_incidents_empty")}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[...openIncidents, ...treatedIncidents].map((inc) => {
            const ctx = incidentContext(inc);
            return (
              <Card key={inc.id} style={{ borderTopColor: inc.statut === "traite" ? TEAL : AMBER }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 2 }}>
                      {ctx.offer ? `${ctx.offer.point_depart} → ${ctx.offer.point_arrivee}` : "—"} · {formatDateTime(inc.created_at, lang)}
                    </div>
                    <div style={{ fontSize: 12, color: "#8A8F98", marginBottom: 6 }}>{t("cov_admin_incident_reported_by").replace("{nom}", ctx.reporterNom)}</div>
                    <p style={{ fontSize: 13, margin: 0 }}>{inc.description}</p>
                    {inc.statut === "traite" && (
                      <p style={{ fontSize: 11.5, color: TEAL, marginTop: 6 }}>
                        {t("cov_admin_incident_traite_le").replace("{date}", formatDateTime(inc.traite_le, lang))}
                        {inc.note_resolution ? ` — ${inc.note_resolution}` : ""}
                      </p>
                    )}
                  </div>
                  <Pill color={inc.statut === "traite" ? TEAL : AMBER} bg={inc.statut === "traite" ? TEAL_LIGHT : AMBER_LIGHT}>
                    {t(inc.statut === "traite" ? "cov_admin_incident_statut_traite" : "cov_admin_incident_statut_ouvert")}
                  </Pill>
                </div>
                {inc.statut !== "traite" && (
                  <Btn variant="outline" style={{ marginTop: 10, padding: "6px 12px", fontSize: 12 }} onClick={() => onTraiterSignalement(inc.id)}>
                    <Check size={12} /> {t("cov_admin_incident_traiter_btn")}
                  </Btn>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>{t("cov_admin_members_title")}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "white", border: "1.5px solid #DCE0E8", borderRadius: 999, padding: "7px 14px", maxWidth: 320, marginBottom: 12 }}>
          <Search size={14} color="#9AA2B5" />
          <input value={memberSearch} onChange={(e) => onMemberSearch(e.target.value)} placeholder={t("cov_admin_members_search_placeholder")} style={{ border: "none", outline: "none", fontSize: 13, flex: 1 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {members.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: "white", borderRadius: 10, padding: "8px 14px", border: "1px solid #E4E6EA" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{m.nom}</span>
                {m.covoiturage_verifie && <VerifiedBadge t={t} verified />}
                {m.covoiturage_suspendu && <Pill color={RED} bg="#FCEAEA">{t("cov_suspended_badge")}</Pill>}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => onToggleVerify(m.id, m.nom, !m.covoiturage_verifie)} style={linkBtn(m.covoiturage_verifie ? "#8A8F98" : TEAL)}>
                  <ShieldCheck size={12} /> {t(m.covoiturage_verifie ? "cov_verify_remove_btn" : "cov_verify_add_btn")}
                </button>
                <button onClick={() => onToggleSuspend(m.id, m.nom, !m.covoiturage_suspendu)} style={linkBtn(m.covoiturage_suspendu ? TEAL : RED)}>
                  <Ban size={12} /> {t(m.covoiturage_suspendu ? "cov_suspend_lift_btn" : "cov_suspend_btn")}
                </button>
              </div>
            </div>
          ))}
          {members.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{t("cov_admin_members_empty")}</p>}
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>{t("cov_admin_states_title")}</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {bookingStatutOrder.map((s) => (
            <Pill key={s} color={bookingStatutColor(s).color} bg={bookingStatutColor(s).bg}>
              {t("cov_booking_statut_" + s)} : {adminStats.bookingsByStatut[s] || 0}
            </Pill>
          ))}
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12.5, color: "#5B6270" }}>
          <span>{t("cov_admin_reliability_noshow").replace("{n}", adminStats.noShowCount)}</span>
          <span>{t("cov_admin_reliability_latecancel").replace("{n}", adminStats.lateCancelCount)}</span>
        </div>
      </div>

      <RegistreCourses t={t} lang={lang} devise={devise} association={association} rows={registreRows} bookingStatutOrder={bookingStatutOrder} buildDriverDossier={buildDriverDossier} />
    </div>
  );
}

// =====================================================================
// Registre complet des courses + dossier chauffeur (suite 2026-10-08,
// claude/covoiturage-registre-messages-carte-parametres-proposition.md)
// — demande explicite de Léo : "un rapport complet de toutes les courses
// effectuées ou non [...] une sorte de dossier complet du chauffeur".
// Toutes les réservations (quel que soit le statut), filtrables, avec
// adresses, temps d'attente/durée effective et signalements liés.
// =====================================================================
function RegistreCourses({ t, lang, association, rows, bookingStatutOrder, buildDriverDossier }) {
  const [statutFilter, setStatutFilter] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dossierId, setDossierId] = useState(null);
  const [exporting, setExporting] = useState(false);

  const filtered = useMemo(() => {
    const q = foldText(driverSearch.trim());
    return rows.filter((r) => {
      if (statutFilter && r.booking.statut !== statutFilter) return false;
      if (q && !foldText(r.driver?.nom || "").includes(q)) return false;
      const d = r.booking.created_at ? r.booking.created_at.slice(0, 10) : "";
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });
  }, [rows, statutFilter, driverSearch, fromDate, toDate]);

  async function exportPdf() {
    setExporting(true);
    try { await exportRegistrePdf(filtered, t, lang, association); }
    catch (e) { console.error("[Covoiturage registre PDF]", e); window.alert(t("cov_registre_pdf_failed")); }
    finally { setExporting(false); }
  }

  const dossier = dossierId ? buildDriverDossier(dossierId) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>{t("cov_admin_registre_title")}</h3>
        <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12 }} onClick={exportPdf} disabled={exporting || filtered.length === 0}>
          <FileText size={13} /> {exporting ? t("loading") : t("cov_admin_registre_export_btn")}
        </Btn>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <select style={{ ...inputStyle, width: "auto", padding: "7px 10px", fontSize: 12.5 }} value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)}>
          <option value="">{t("cov_admin_registre_filter_statut_all")}</option>
          {bookingStatutOrder.map((s) => <option key={s} value={s}>{t("cov_booking_statut_" + s)}</option>)}
        </select>
        <input style={{ ...inputStyle, width: "auto", padding: "7px 10px", fontSize: 12.5 }} value={driverSearch} onChange={(e) => setDriverSearch(e.target.value)} placeholder={t("cov_admin_registre_filter_driver_placeholder")} />
        <input type="date" style={{ ...inputStyle, width: "auto", padding: "7px 10px", fontSize: 12.5 }} value={fromDate} onChange={(e) => setFromDate(e.target.value)} title={t("cov_admin_registre_filter_from")} />
        <input type="date" style={{ ...inputStyle, width: "auto", padding: "7px 10px", fontSize: 12.5 }} value={toDate} onChange={(e) => setToDate(e.target.value)} title={t("cov_admin_registre_filter_to")} />
      </div>
      {filtered.length === 0 ? (
        <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{t("cov_admin_registre_empty")}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#8A8F98", fontSize: 11 }}>
                <th style={{ padding: "6px 8px" }}>{t("cov_admin_registre_col_date")}</th>
                <th style={{ padding: "6px 8px" }}>{t("cov_admin_registre_col_driver")}</th>
                <th style={{ padding: "6px 8px" }}>{t("cov_admin_registre_col_passenger")}</th>
                <th style={{ padding: "6px 8px" }}>{t("cov_admin_registre_col_route")}</th>
                <th style={{ padding: "6px 8px" }}>{t("cov_admin_registre_col_statut")}</th>
                <th style={{ padding: "6px 8px" }}>{t("cov_admin_registre_col_attente")}</th>
                <th style={{ padding: "6px 8px" }}>{t("cov_admin_registre_col_duree")}</th>
                <th style={{ padding: "6px 8px" }}>{t("cov_admin_registre_col_incidents")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ booking, offer, driver, passenger, attenteSec, dureeSec, incidents: rowIncidents }) => {
                const sc = bookingStatutColor(booking.statut);
                return (
                  <tr key={booking.id} style={{ borderTop: "1px solid #F1F2F4" }}>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{formatDateTime(booking.created_at, lang)}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {driver ? (
                        <button onClick={() => setDossierId(driver.id)} style={linkBtn(TEAL)}>{driver.nom}</button>
                      ) : "—"}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{passenger?.nom || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{offer ? `${offer.point_depart} → ${offer.point_arrivee}` : "—"}</td>
                    <td style={{ padding: "6px 8px" }}><Pill color={sc.color} bg={sc.bg}>{t("cov_booking_statut_" + booking.statut)}</Pill></td>
                    <td style={{ padding: "6px 8px" }}>{attenteSec != null ? formatDuration(attenteSec) : "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{dureeSec != null ? formatDuration(dureeSec) : "—"}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {rowIncidents.length === 0 ? "—" : (
                        <Pill color={rowIncidents.some((i) => (i.statut || "ouvert") === "ouvert") ? AMBER : TEAL} bg={rowIncidents.some((i) => (i.statut || "ouvert") === "ouvert") ? AMBER_LIGHT : TEAL_LIGHT}>
                          {rowIncidents.length}
                        </Pill>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {dossier && <DriverDossierModal t={t} lang={lang} dossier={dossier} onClose={() => setDossierId(null)} />}
    </div>
  );
}

// ---------- Dossier complet d'un chauffeur ----------
function DriverDossierModal({ t, lang, dossier, onClose }) {
  const { member, rows, stats, completed, cancelled, noShow, incidents: driverIncidents } = dossier;
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 640, width: "100%", maxHeight: "86vh", overflowY: "auto" }}>
        <h3 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><FolderOpen size={16} color={TEAL} /> {t("cov_dossier_title").replace("{nom}", member?.nom || "—")}</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <VerifiedBadge t={t} verified={member?.covoiturage_verifie} />
          {member?.covoiturage_suspendu && <Pill color={RED} bg="#FCEAEA"><Ban size={11} style={{ marginRight: 3 }} /> {t("cov_suspended_badge")}</Pill>}
          <RatingBadge stats={stats} />
        </div>
        <ContactReveal t={t} contact={member} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10, margin: "14px 0" }}>
          <StatCard label={t("cov_dossier_stat_completed")} value={completed} icon={Check} accent={TEAL} />
          <StatCard label={t("cov_dossier_stat_cancelled")} value={cancelled} icon={X} />
          <StatCard label={t("cov_dossier_stat_noshow")} value={noShow} icon={UserX} accent={noShow > 0 ? AMBER : undefined} />
        </div>
        <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("cov_dossier_rides_title")}</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16, maxHeight: 180, overflowY: "auto" }}>
          {rows.map(({ booking, offer, passenger }) => {
            const sc = bookingStatutColor(booking.statut);
            return (
              <div key={booking.id} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", background: "#F6F8FA", borderRadius: 8, padding: "6px 10px" }}>
                <span>{formatDateTime(booking.created_at, lang)} · {offer ? `${offer.point_depart} → ${offer.point_arrivee}` : "—"} {passenger ? `· ${passenger.nom}` : ""}</span>
                <Pill color={sc.color} bg={sc.bg}>{t("cov_booking_statut_" + booking.statut)}</Pill>
              </div>
            );
          })}
          {rows.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 12.5 }}>{t("cov_admin_registre_empty")}</p>}
        </div>
        <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("cov_dossier_incidents_title")}</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {driverIncidents.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 12.5 }}>{t("cov_dossier_no_incidents")}</p>}
          {driverIncidents.map((inc) => (
            <div key={inc.id} style={{ fontSize: 12, background: "#F6F8FA", borderRadius: 8, padding: "6px 10px" }}>
              <div>{inc.description}</div>
              {inc.statut === "traite" && <div style={{ color: TEAL, fontSize: 11, marginTop: 3 }}>{t("cov_admin_incident_traite_le").replace("{date}", formatDateTime(inc.traite_le, lang))}{inc.note_resolution ? ` — ${inc.note_resolution}` : ""}</div>}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn variant="outline" onClick={onClose}>{t("cov_dossier_close")}</Btn>
        </div>
      </div>
    </div>
  );
}

// PDF à la demande du registre filtré (distinct du rapport annuel) — même
// convention d'import dynamique que RapportAnnuel.jsx.
async function exportRegistrePdf(rows, t, lang, association) {
  // Même convention que RapportAnnuel.jsx/buildPdf : jspdf-autotable v5
  // exporte une fonction autonome (autoTableMod.default), PAS une méthode
  // greffée sur doc — doc.autoTable(...) n'existe plus dans cette version
  // et échouait silencieusement (TypeError non affiché à l'utilisateur).
  let jsPDFmod, autoTableMod;
  try {
    [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  } catch {
    window.alert(t("rap_missing_deps"));
    return;
  }
  const { jsPDF } = jsPDFmod;
  const autoTable = autoTableMod.default;
  // Unité « pt » (au lieu des mm par défaut) : celle de l'en-tête officiel.
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  // Logo + mentions légales (pdfOfficiel.js) : demande de l'utilisateur
  // (2026-10-09), sur tous les documents générés, pour leur authenticité.
  const yDebut = await enTeteOfficiel(doc, association, {
    titre: t("cov_registre_pdf_title"),
    sousTitre: t("cov_registre_pdf_generated_on").replace("{date}", formatDateTime(new Date().toISOString(), lang)),
  });
  const body = rows.map(({ booking, offer, driver, passenger, attenteSec, dureeSec, incidents: rowIncidents }) => [
    formatDateTime(booking.created_at, lang),
    driver?.nom || "—",
    passenger?.nom || "—",
    offer ? `${offer.point_depart} → ${offer.point_arrivee}` : "—",
    t("cov_booking_statut_" + booking.statut),
    attenteSec != null ? formatDuration(attenteSec) : "—",
    dureeSec != null ? formatDuration(dureeSec) : "—",
    String(rowIncidents.length),
  ]);
  autoTable(doc, {
    startY: yDebut,
    head: [[
      t("cov_admin_registre_col_date"), t("cov_admin_registre_col_driver"), t("cov_admin_registre_col_passenger"),
      t("cov_admin_registre_col_route"), t("cov_admin_registre_col_statut"), t("cov_admin_registre_col_attente"),
      t("cov_admin_registre_col_duree"), t("cov_admin_registre_col_incidents"),
    ]],
    body,
    styles: { fontSize: 7.5 },
    headStyles: { fillColor: couleurAssociation(association) },
    margin: { left: 40, right: 40 },
  });
  piedsDePageOfficiels(doc, association, { texte: t("cov_registre_pdf_title"), libellePage: (p, n) => `${p} / ${n}` });
  doc.save(`registre-covoiturage-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// =====================================================================
// Volet de paramétrage du covoiturage (suite 2026-10-08, réservé au
// bureau) — demande explicite de Léo : "on configure également un volet
// de paramétrage pour le covoiturage complet". Héberge aujourd'hui la
// gestion des messages/signalements préétablis (section 2 de la
// proposition) ; emplacement naturel pour tout réglage futur propre au
// covoiturage de l'association (le réglage d'accès/facturation du
// module reste chez le Super-Admin — niveau différent, pas dupliqué ici).
// =====================================================================
function ParametresPanel({ t, quickMessages, messagesRapidesActif, onToggleMessagesRapides, onAddQuickMessage, onToggleQuickMessageActif, onDeleteQuickMessage }) {
  const [categorie, setCategorie] = useState("signalement");
  const [cible, setCible] = useState("les_deux");
  const [texte, setTexte] = useState("");
  const [saving, setSaving] = useState(false);

  async function submitAdd() {
    if (!texte.trim()) return;
    setSaving(true);
    await onAddQuickMessage(categorie, cible, texte);
    setTexte("");
    setSaving(false);
  }

  const existingTextes = new Set(quickMessages.map((m) => foldText(m.texte)));
  const suggestionsToAdd = QUICK_MESSAGE_SUGGESTIONS.filter((s) => !existingTextes.has(foldText(t(s.texte_key))));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 720 }}>
      <div style={{ background: "white", border: "1px solid #E4E6EA", borderRadius: 12, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>{t("cov_params_toggle_label")}</div>
          <div style={{ fontSize: 12, color: "#5B6270" }}>{t("cov_params_title")}</div>
        </div>
        <Btn variant={messagesRapidesActif ? "outline" : undefined} style={{ padding: "6px 14px", fontSize: 12 }} onClick={() => onToggleMessagesRapides(!messagesRapidesActif)}>
          {messagesRapidesActif ? t("cov_params_toggle_on") : t("cov_params_toggle_off")}
        </Btn>
      </div>

      {suggestionsToAdd.length > 0 && (
        <div>
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("cov_params_suggestions_title")}</h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {suggestionsToAdd.map((s) => (
              <button key={s.texte_key} type="button" onClick={() => onAddQuickMessage(s.categorie, s.cible, t(s.texte_key))}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: TEAL, background: TEAL_LIGHT, border: "none", borderRadius: 999, padding: "6px 12px", cursor: "pointer" }}>
                <Plus size={11} /> {t(s.texte_key)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("cov_params_list_title")}</h4>
        {quickMessages.length === 0 ? (
          <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{t("cov_params_list_empty")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {quickMessages.map((m) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: "white", borderRadius: 10, padding: "8px 14px", border: "1px solid #E4E6EA" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                  <Pill color="#182233" bg="#F1F2F4">{t(m.categorie === "signalement" ? "cov_params_categorie_signalement" : "cov_params_categorie_message_rapide")}</Pill>
                  <Pill color={TEAL} bg={TEAL_LIGHT}>{t("cov_params_cible_" + m.cible)}</Pill>
                  <span style={{ fontSize: 13 }}>{m.texte}</span>
                  {!m.actif && <Pill color="#8A8F98" bg="#F1F2F4">{t("cov_params_toggle_actif_off")}</Pill>}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => onToggleQuickMessageActif(m.id, !m.actif)} style={linkBtn(m.actif ? "#8A8F98" : TEAL)}>
                    {m.actif ? t("cov_params_toggle_actif_off") : t("cov_params_toggle_actif_on")}
                  </button>
                  <button onClick={() => onDeleteQuickMessage(m.id)} style={linkBtn(RED)}><Trash2 size={12} /> {t("action_delete")}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("cov_params_add_form_title")}</h4>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <select style={{ ...inputStyle, width: "auto" }} value={categorie} onChange={(e) => setCategorie(e.target.value)}>
            <option value="signalement">{t("cov_params_categorie_signalement")}</option>
            <option value="message_rapide">{t("cov_params_categorie_message_rapide")}</option>
          </select>
          <select style={{ ...inputStyle, width: "auto" }} value={cible} onChange={(e) => setCible(e.target.value)}>
            <option value="les_deux">{t("cov_params_cible_les_deux")}</option>
            <option value="passager">{t("cov_params_cible_passager")}</option>
            <option value="chauffeur">{t("cov_params_cible_chauffeur")}</option>
          </select>
          <input style={{ ...inputStyle, flex: "1 1 220px" }} value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={t("cov_params_add_texte_placeholder")} />
          <Btn onClick={submitAdd} disabled={saving || !texte.trim()}><Plus size={13} /> {saving ? t("loading") : t("cov_params_add_btn")}</Btn>
        </div>
      </div>
    </div>
  );
}

// Réservation : la contribution par passager (calculée sur la durée
// estimée selon la grille) est affichée AVANT de réserver ; elle sera
// figée en base au moment de la réservation (sql/2026-10-09b).
function ReserveModal({ t, devise, offer, onClose, onSubmit, pro }) {
  const [seats, setSeats] = useState(1);
  const [message, setMessage] = useState("");
  const [solidaire, setSolidaire] = useState("");
  const [saving, setSaving] = useState(false);
  const max = offer.places_disponibles || 1;
  const nSeats = Math.min(max, Math.max(1, Number(seats) || 1));
  const P = pro?.P;
  const g = pro?.grille && offer.grille_id ? pro.grille : null; // options de la grille active (si l'offre a été tarifée)
  const eventAuto = !!(g && g.solidaire_actif && g.solidaire_evenements && offer.event_id && Number(g.solidaire_pct) > 0);
  const solidOptions = g && g.solidaire_actif && Number(g.solidaire_pct) > 0 && !eventAuto
    ? [...(g.solidaire_etudiants ? ["etudiant"] : []), ...(g.solidaire_aines ? ["aine"] : [])] : [];
  const pct = g ? Number(g.solidaire_pct) : 0;
  let unit = offer.prix_place != null ? Number(offer.prix_place) : null;
  if (unit != null && (eventAuto || (solidaire && solidOptions.includes(solidaire)))) unit = Math.round(unit * (1 - pct / 100) * 100) / 100;
  async function submit() { setSaving(true); await onSubmit(nSeats, message, solidaire || null); setSaving(false); }
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 440, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ marginBottom: 6 }}>{t("cov_reserve_modal_title")}</h3>
        <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 6 }}>{offer.point_depart} → {offer.point_arrivee}</p>
        {pro?.vehicule && <p style={{ fontSize: 12, color: "#5B6270", marginBottom: 10 }}><Car size={12} style={{ verticalAlign: -2 }} /> {vehiculeLabel(pro.vehicule)}</p>}
        <Field label={t("cov_reserve_seats_label")}><input type="number" min="1" max={max} style={inputStyle} value={seats} onChange={(e) => setSeats(e.target.value)} /></Field>
        {P && offer.prix_grille != null && unit != null ? (
          <div style={{ background: TEAL_LIGHT, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 12.5 }}>
            <div style={{ fontWeight: 700, color: TEAL, display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><Fuel size={13} /> {P.est_title}</div>
            <div>{P.res_price} : <strong>{unit === 0 ? P.pay_offert : money(unit, devise)}</strong>{offer.duree_estimee_min != null && <span style={{ color: "#5B6270" }}> · ≈ {formatDuration(offer.duree_estimee_min * 60)}</span>}{offer.tranche_appliquee && <span style={{ color: "#5B6270" }}> · {trancheLabel(offer.tranche_appliquee)}</span>}</div>
            <div>{P.res_total.replace("{n}", nSeats)} : <strong>{money(unit * nSeats, devise)}</strong></div>
            <div style={{ fontSize: 11, color: "#5B6270", marginTop: 4 }}>{P.res_frozen}</div>
            {eventAuto && <div style={{ fontSize: 11.5, color: TEAL, marginTop: 4 }}>{P.res_solid_event.replace("{pct}", pct)}</div>}
            {g?.attente_actif && Number(g.attente_montant_par_min) > 0 && <div style={{ fontSize: 11, color: "#5B6270", marginTop: 4 }}>{P.res_wait_note.replace("{min}", g.attente_franchise_min).replace("{montant}", money(g.attente_montant_par_min, devise))}</div>}
            {g?.frais_reels_actif && <div style={{ fontSize: 11, color: "#5B6270", marginTop: 2 }}>{P.res_real_note}</div>}
            <div style={{ fontSize: 11, color: "#5B6270", marginTop: 2 }}>{P.res_pay_note}</div>
          </div>
        ) : offer.prix_place != null && (
          <p style={{ fontSize: 12, color: "#5B6270", marginBottom: 10 }}>{t("cov_per_seat")} : {money(offer.prix_place, devise)} · {t("cov_calc_total")} : {money(offer.prix_place * nSeats, devise)}</p>
        )}
        {P && solidOptions.length > 0 && (
          <Field label={P.res_solidaire}>
            <select style={inputStyle} value={solidaire} onChange={(e) => setSolidaire(e.target.value)}>
              <option value="">{P.res_solid_none}</option>
              {solidOptions.map((o) => <option key={o} value={o}>{P["res_solid_" + o].replace("{pct}", pct)}</option>)}
            </select>
          </Field>
        )}
        <Field label={t("cov_reserve_message_label")}><textarea style={{ ...inputStyle, minHeight: 60 }} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
          <Btn onClick={submit} disabled={saving}>{saving ? t("loading") : t("cov_reserve_submit")}</Btn>
        </div>
      </div>
    </div>
  );
}

// Résumé de la grille de l'association (colonne de droite du babillard,
// à la place du calculateur au km quand une grille est active).
function GrilleSummary({ P, grille, devise }) {
  const tranches = [...(grille.tranches || [])].sort((a, b) => Number(a.de) - Number(b.de));
  const lastA = tranches.length ? Number(tranches[tranches.length - 1].a) : 0;
  return (
    <Card>
      <h3 style={{ fontSize: 13.5, display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}><Fuel size={15} color={TEAL} /> {P.grid_title}</h3>
      <p style={{ fontSize: 11.5, color: "#8A8F98", marginBottom: 10 }}>{P.grid_note}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {tranches.map((r) => (
          <div key={`${r.de}-${r.a}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span>{r.de}–{r.a} min</span><strong>{money(r.montant, devise)}</strong>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11.5, color: "#5B6270", marginTop: 8 }}>
        {P.grid_beyond.replace("{a}", lastA).replace("{base}", money(grille.au_dela_montant, devise)).replace("{plus}", money(grille.au_dela_montant_par_tranche, devise)).replace("{n}", grille.au_dela_par_min)}
      </p>
      <p style={{ fontSize: 11, color: "#8A8F98", marginTop: 8, display: "flex", gap: 6, alignItems: "flex-start" }}><Leaf size={13} color={TEAL} style={{ flexShrink: 0, marginTop: 1 }} /> {P.res_pay_note}</p>
    </Card>
  );
}

// Estimation affichée dans le formulaire d'offre : durée estimée (OSRM),
// tranche et prix maximal par passager selon la grille.
function OfferEstimate({ P, devise, grille, eta, loading, hasGeo }) {
  if (!hasGeo) return grille ? <p style={{ fontSize: 11.5, color: AMBER, marginBottom: 12 }}>{P.est_need_geo}</p> : null;
  if (loading) return <p style={{ fontSize: 11.5, color: "#8A8F98", marginBottom: 12 }}>{P.est_loading}</p>;
  if (!eta) return null;
  const min = formatDuration(eta.durationSec);
  const km = (eta.distanceM / 1000).toFixed(1);
  const prix = grille ? prixSelonGrille(grille, eta.durationSec / 60) : null;
  return (
    <div style={{ background: TEAL_LIGHT, borderRadius: 10, padding: "8px 12px", marginBottom: 12, fontSize: 12.5 }}>
      <div style={{ fontWeight: 700, color: TEAL, display: "flex", alignItems: "center", gap: 6 }}><Fuel size={13} /> {P.est_title}</div>
      <div>{prix
        ? P.est_line.replace("{min}", min).replace("{km}", km).replace("{tranche}", trancheLabel(prix)).replace("{montant}", money(prix.montant, devise))
        : P.est_line_free.replace("{min}", min).replace("{km}", km)}</div>
    </div>
  );
}

// Durée estimée recalculée dès que départ ET arrivée ont des coordonnées.
function useRouteEstimate(departGeo, arriveeGeo) {
  const [state, setState] = useState({ eta: null, loading: false });
  const key = departGeo && arriveeGeo ? `${departGeo.lat},${departGeo.lng};${arriveeGeo.lat},${arriveeGeo.lng}` : "";
  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    const [a, b] = key.split(";").map((s) => s.split(",").map(Number));
    Promise.resolve().then(() => { if (!cancelled) setState({ eta: null, loading: true }); });
    fetchRouteEta(a[0], a[1], b[0], b[1]).then((r) => { if (!cancelled) setState({ eta: r, loading: false }); });
    return () => { cancelled = true; };
  }, [key]);
  return key ? state : { eta: null, loading: false };
}

function RatingModal({ t, counterpartNom, onClose, onSubmit }) {
  const [note, setNote] = useState(5);
  const [commentaire, setCommentaire] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit() { setSaving(true); await onSubmit(note, commentaire); setSaving(false); }
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 420, width: "100%" }}>
        <h3 style={{ marginBottom: 6 }}>{t("cov_rate_modal_title")}</h3>
        <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 14 }}>{counterpartNom}</p>
        <Field label={t("cov_rate_note_label")}>
          <div style={{ display: "flex", gap: 6 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setNote(n)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                <Star size={22} color={AMBER} fill={n <= note ? AMBER : "none"} />
              </button>
            ))}
          </div>
        </Field>
        <Field label={t("cov_rate_comment_label")}><textarea style={{ ...inputStyle, minHeight: 60 }} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} /></Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
          <Btn onClick={submit} disabled={saving}>{saving ? t("loading") : t("cov_rate_submit")}</Btn>
        </div>
      </div>
    </div>
  );
}

// ---------- Partage public du suivi d'un trajet (?suivi=<jeton>) ----------
function ShareTripModal({ t, token, onClose }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/?suivi=${token}`;
  function copy() {
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 440, width: "100%" }}>
        <h3 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><Share2 size={16} color={TEAL} /> {t("cov_share_modal_title")}</h3>
        <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 14 }}>{t("cov_share_modal_desc")}</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#F6F8FA", borderRadius: 10, padding: "8px 10px", marginBottom: 14 }}>
          <input readOnly value={url} onFocus={(e) => e.target.select()} style={{ ...inputStyle, border: "none", background: "transparent", flex: 1, fontSize: 12 }} />
          <button onClick={copy} style={linkBtn(TEAL)}><Copy size={13} /> {copied ? t("cov_share_copied") : t("cov_share_copy_btn")}</button>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn variant="outline" onClick={onClose}>{t("action_close")}</Btn>
        </div>
      </div>
    </div>
  );
}

// ---------- Signalement d'un problème ----------
function IncidentModal({ t, onClose, onSubmit, quickMessages }) {
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!description.trim()) return;
    setSaving(true);
    await onSubmit(description.trim());
    setSaving(false);
  }
  const options = quickMessages || [];
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 440, width: "100%" }}>
        <h3 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><AlertTriangle size={16} color={AMBER} /> {t("cov_incident_modal_title")}</h3>
        <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 14 }}>{t("cov_incident_modal_desc")}</p>
        {options.length > 0 && (
          <Field label={t("cov_incident_quickmsg_label")}>
            <select style={inputStyle} defaultValue="" onChange={(e) => { if (e.target.value) setDescription(e.target.value); }}>
              <option value="">{t("cov_incident_quickmsg_custom_option")}</option>
              {options.map((m) => <option key={m.id} value={m.texte}>{m.texte}</option>)}
            </select>
          </Field>
        )}
        <Field label={t("cov_incident_modal_title")}>
          <textarea style={{ ...inputStyle, minHeight: 90 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("cov_incident_placeholder")} />
        </Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
          <Btn onClick={submit} disabled={saving || !description.trim()}><Flag size={13} /> {saving ? t("loading") : t("cov_incident_submit_btn")}</Btn>
        </div>
      </div>
    </div>
  );
}

// ---------- Disponibilité immédiate (balise, sans trajet A→B précis) ----------
const DURATION_OPTIONS = [30, 60, 120, 240, 480];
function AvailabilityModal({ t, onClose, onSubmit }) {
  const [coords, setCoords] = useState(null); // { lat, lng }
  const [locBusy, setLocBusy] = useState(false);
  const [locMsg, setLocMsg] = useState("");
  const [address, setAddress] = useState("");
  const [radiusMode, setRadiusMode] = useState("auto"); // "auto" | "custom" | "none"
  const [customRadius, setCustomRadius] = useState(15);
  const [duree, setDuree] = useState(120);
  const [saving, setSaving] = useState(false);

  function useGpsPosition() {
    if (!navigator.geolocation) { setLocMsg(t("cov_available_now_location_unsupported")); return; }
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocMsg(""); setLocBusy(false); },
      () => { setLocMsg(t("cov_available_now_location_denied")); setLocBusy(false); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }
  async function useAddress() {
    if (!address.trim()) return;
    setLocBusy(true);
    const found = await geocodeAddress(address);
    if (found) { setCoords(found); setLocMsg(""); } else setLocMsg(t("cov_available_now_location_denied"));
    setLocBusy(false);
  }
  async function submit() {
    if (!coords) { setLocMsg(t("cov_available_now_location_missing")); return; }
    setSaving(true);
    await onSubmit({
      lat: coords.lat, lng: coords.lng, dureeMinutes: duree,
      radiusKm: radiusMode === "custom" ? Number(customRadius) || 15 : undefined,
      sansLimite: radiusMode === "none",
    });
    setSaving(false);
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 460, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><Radio size={16} color={TEAL} /> {t("cov_available_now_modal_title")}</h3>
        <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 14 }}>{t("cov_available_now_modal_desc")}</p>

        <Field label={t("cov_available_now_location_label")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Btn variant="outline" style={{ alignSelf: "flex-start" }} onClick={useGpsPosition} disabled={locBusy}>
              <MapPin size={13} /> {coords ? t("cov_available_now_location_gps_btn") + " ✓" : t("cov_available_now_location_gps_btn")}
            </Btn>
            <div style={{ fontSize: 11.5, color: "#8A8F98" }}>{t("cov_available_now_location_fallback_label")}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={inputStyle} value={address} onChange={(e) => setAddress(e.target.value)} />
              <Btn variant="outline" onClick={useAddress} disabled={locBusy || !address.trim()}><Search size={13} /></Btn>
            </div>
            {locMsg && <div style={{ fontSize: 11.5, color: RED }}>{locMsg}</div>}
            {coords && !locMsg && <div style={{ fontSize: 11.5, color: TEAL }}>✓ {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</div>}
          </div>
        </Field>

        <Field label={t("cov_available_now_radius_label")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
              <input type="radio" checked={radiusMode === "auto"} onChange={() => setRadiusMode("auto")} /> {t("cov_available_now_radius_auto")}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
              <input type="radio" checked={radiusMode === "custom"} onChange={() => setRadiusMode("custom")} /> {t("cov_available_now_radius_custom")}
            </label>
            {radiusMode === "custom" && (
              <div style={{ marginLeft: 24, display: "flex", alignItems: "center", gap: 8 }}>
                <input type="number" min="1" max="200" style={{ ...inputStyle, width: 90 }} value={customRadius} onChange={(e) => setCustomRadius(e.target.value)} />
                <span style={{ fontSize: 12, color: "#5B6270" }}>{t("cov_available_now_radius_custom_input_label")}</span>
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
              <input type="radio" checked={radiusMode === "none"} onChange={() => setRadiusMode("none")} /> {t("cov_available_now_radius_none")}
            </label>
          </div>
        </Field>

        <Field label={t("cov_available_now_duration_label")}>
          <select style={inputStyle} value={duree} onChange={(e) => setDuree(Number(e.target.value))}>
            {DURATION_OPTIONS.map((min) => <option key={min} value={min}>{t("cov_available_now_duration_" + min)}</option>)}
          </select>
        </Field>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
          <Btn onClick={submit} disabled={saving}><Radio size={13} /> {saving ? t("loading") : t("cov_available_now_submit_btn")}</Btn>
        </div>
      </div>
    </div>
  );
}

// ---------- Calculateur de partage des frais (purement côté client) ----------
function CostShareCalculator({ t, devise }) {
  const [distance, setDistance] = useState("");
  const [tarif, setTarif] = useState("0.15");
  const [passengers, setPassengers] = useState("3");
  const d = Number(distance) || 0, tk = Number(tarif) || 0, p = Math.max(1, Number(passengers) || 1);
  const total = d * tk, perPerson = total / p;
  return (
    <Card>
      <h3 style={{ fontSize: 13.5, display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}><Calculator size={15} color={TEAL} /> {t("cov_calc_title")}</h3>
      <p style={{ fontSize: 11.5, color: "#8A8F98", marginBottom: 14 }}>{t("cov_calc_desc")}</p>
      <Field label={t("cov_calc_distance")}><input type="number" min="0" style={inputStyle} value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="22" /></Field>
      <Field label={t("cov_calc_rate")}><input type="number" min="0" step="0.01" style={inputStyle} value={tarif} onChange={(e) => setTarif(e.target.value)} /></Field>
      <Field label={t("cov_calc_passengers")}><input type="number" min="1" style={inputStyle} value={passengers} onChange={(e) => setPassengers(e.target.value)} /></Field>
      <div style={{ borderTop: "1px dashed #DCE0E8", marginTop: 8, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#5B6270" }}><span>{t("cov_calc_total")}</span><span>{money(total, devise)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700 }}><span>{t("cov_calc_per_person")}</span><span>{money(perPerson, devise)}</span></div>
      </div>
      <p style={{ fontSize: 11, color: "#8A8F98", marginTop: 12, display: "flex", gap: 6, alignItems: "flex-start" }}><Leaf size={13} color={TEAL} style={{ flexShrink: 0, marginTop: 1 }} /> {t("cov_calc_eco_note")}</p>
    </Card>
  );
}

// ---------- Création ----------
function CreateRideModal({ t, events, prefill, onClose, onCreateOffer, onCreateRequest, pro }) {
  // prefill (Phase B, covoiturage événementiel dédié) : { kind, event_id,
  // point_arrivee, date_heure } — reçu quand le trajet est créé depuis le
  // bandeau "Covoiturage pour vos événements" plutôt que depuis le bouton
  // générique "Nouveau trajet".
  const [kind, setKind] = useState(prefill?.kind || "offre");
  const [form, setForm] = useState({
    point_depart: "", point_arrivee: prefill?.point_arrivee || "", date_heure: prefill?.date_heure || "",
    recurrence: "aucune", places_disponibles: 1, places_demandees: 1, prix_place: "",
    event_id: prefill?.event_id || "", notes: "", dispatch_auto: false,
    pref_non_fumeur: false, pref_musique: false, pref_animaux: false,
  });
  const [departGeo, setDepartGeo] = useState(null); // coordonnées exactes si une suggestion a été choisie (AddressAutocomplete)
  const [arriveeGeo, setArriveeGeo] = useState(null);
  const [saving, setSaving] = useState(false);
  const { P, proSql, grille, devise, me, myVehicles = [], onOpenFiche } = pro || {};
  const [vehiculeId, setVehiculeId] = useState("");
  const selectedVehiculeId = vehiculeId || myVehicles[0]?.id || "";
  const { eta, loading: etaLoading } = useRouteEstimate(departGeo, arriveeGeo);
  const prixMax = grille && eta ? prixSelonGrille(grille, eta.durationSec / 60)?.montant : null;
  // Conducteur identifié (sql/2026-10-09b) : photo + véhicule requis pour une offre.
  const missingPhoto = kind === "offre" && proSql && !me?.photo_url;
  const missingVehicle = kind === "offre" && proSql && myVehicles.length === 0;
  const prixTropHaut = kind === "offre" && prixMax != null && form.prix_place !== "" && Number(form.prix_place) > prixMax;
  async function submit() {
    if (!form.point_depart.trim() || !form.point_arrivee.trim() || !form.date_heure) return;
    if (missingPhoto || missingVehicle || prixTropHaut) return;
    setSaving(true);
    const payload = { ...form, departGeo, arriveeGeo, eta, vehicule_id: selectedVehiculeId || null };
    if (kind === "offre") await onCreateOffer(payload); else await onCreateRequest(payload);
    setSaving(false);
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ marginBottom: 14 }}>{t("cov_new_btn")}</h3>
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <button onClick={() => setKind("offre")} style={tabBtn(kind === "offre")}>{t("cov_tab_offers_singular")}</button>
          <button onClick={() => setKind("demande")} style={tabBtn(kind === "demande")}>{t("cov_tab_requests_singular")}</button>
        </div>
        <Field label={t("cov_field_from")}>
          <AddressAutocomplete t={t} value={form.point_depart} placeholder={t("cov_field_address_placeholder")}
            onChange={(v) => setForm((p) => ({ ...p, point_depart: v }))} onSelect={setDepartGeo} geo={departGeo} />
        </Field>
        <Field label={t("cov_field_to")}>
          <AddressAutocomplete t={t} value={form.point_arrivee} placeholder={t("cov_field_address_placeholder")}
            onChange={(v) => setForm((p) => ({ ...p, point_arrivee: v }))} onSelect={setArriveeGeo} geo={arriveeGeo} />
        </Field>
        <Field label={t("cov_field_datetime")}><input type="datetime-local" style={inputStyle} value={form.date_heure} onChange={(e) => setForm((p) => ({ ...p, date_heure: e.target.value }))} /></Field>
        {kind === "offre" ? (
          <>
            <Field label={t("cov_field_recurrence")}>
              <select style={inputStyle} value={form.recurrence} onChange={(e) => setForm((p) => ({ ...p, recurrence: e.target.value }))}>
                <option value="aucune">{t("cov_recurrence_aucune")}</option>
                <option value="hebdomadaire">{t("cov_recurrence_hebdomadaire")}</option>
                <option value="quotidien_ouvrable">{t("cov_recurrence_quotidien_ouvrable")}</option>
              </select>
            </Field>
            {P && (missingPhoto || missingVehicle) && (
              <div style={{ background: AMBER_LIGHT, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 12.5 }}>
                {missingPhoto && <div style={{ display: "flex", gap: 6, alignItems: "center" }}><AlertTriangle size={13} color={AMBER} /> {P.photo_needed}</div>}
                {missingVehicle && <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}><AlertTriangle size={13} color={AMBER} /> {P.vehicle_none}</div>}
                <button type="button" onClick={onOpenFiche} style={{ ...linkBtn("var(--primary)"), marginTop: 6 }}><UserCircle size={12} /> {P.open_fiche}</button>
              </div>
            )}
            {P && myVehicles.length > 0 && (
              <Field label={P.vehicle_label}>
                <select style={inputStyle} value={selectedVehiculeId} onChange={(e) => setVehiculeId(e.target.value)}>
                  {myVehicles.map((v) => <option key={v.id} value={v.id}>{vehiculeLabel(v)}</option>)}
                </select>
              </Field>
            )}
            <Field label={t("cov_field_seats")}><input type="number" min="1" style={inputStyle} value={form.places_disponibles} onChange={(e) => setForm((p) => ({ ...p, places_disponibles: e.target.value }))} /></Field>
            {P && <OfferEstimate P={P} devise={devise} grille={grille} eta={eta} loading={etaLoading} hasGeo={!!(departGeo && arriveeGeo)} />}
            <Field label={P && prixMax != null ? P.price_label_grid.replace("{max}", money(prixMax, devise)) : t("cov_field_price")}>
              <input type="number" min="0" max={prixMax ?? undefined} step="0.01" style={{ ...inputStyle, ...(prixTropHaut ? { borderColor: RED } : {}) }} value={form.prix_place} onChange={(e) => setForm((p) => ({ ...p, prix_place: e.target.value }))} placeholder={prixMax != null ? String(prixMax) : t("cov_field_price_placeholder")} />
            </Field>
            {P && grille && <p style={{ fontSize: 11, color: prixTropHaut ? RED : "#8A8F98", marginTop: -8, marginBottom: 12 }}>{P.price_hint_grid}</p>}
            <PreferencesFields t={t} form={form} setForm={setForm} />
          </>
        ) : (
          <>
            <Field label={t("cov_field_seats_wanted")}><input type="number" min="1" style={inputStyle} value={form.places_demandees} onChange={(e) => setForm((p) => ({ ...p, places_demandees: e.target.value }))} /></Field>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#182233", background: TEAL_LIGHT, borderRadius: 10, padding: "10px 12px", marginBottom: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={form.dispatch_auto} onChange={(e) => setForm((p) => ({ ...p, dispatch_auto: e.target.checked }))} />
              <span><strong style={{ display: "flex", alignItems: "center", gap: 5 }}><Zap size={13} color={TEAL} /> {t("cov_dispatch_auto_label")}</strong>{t("cov_dispatch_auto_help")}</span>
            </label>
          </>
        )}
        {events.length > 0 && (
          <Field label={t("cov_field_event_link")}>
            <select style={inputStyle} value={form.event_id} onChange={(e) => setForm((p) => ({ ...p, event_id: e.target.value }))}>
              <option value="">{t("cov_field_event_none")}</option>
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.titre}</option>)}
            </select>
          </Field>
        )}
        <Field label={t("cov_field_notes")}><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
          <Btn onClick={submit} disabled={saving || missingPhoto || missingVehicle || prixTropHaut}>{saving ? t("loading") : t("action_publish")}</Btn>
        </div>
      </div>
    </div>
  );
}

function EditRideModal({ t, editing, onClose, onSave, pro }) {
  const isOffer = editing.kind === "offre";
  const row = editing.row;
  const [form, setForm] = useState({
    point_depart: row.point_depart, point_arrivee: row.point_arrivee,
    date_heure: toDatetimeLocal(row.date_heure),
    places_disponibles: row.places_disponibles || 1, places_demandees: row.places_demandees || 1,
    prix_place: row.prix_place ?? "", notes: row.notes || "",
    pref_non_fumeur: !!row.pref_non_fumeur, pref_musique: !!row.pref_musique, pref_animaux: !!row.pref_animaux,
  });
  const [departGeo, setDepartGeo] = useState(null); // coordonnées exactes si une suggestion a été choisie (AddressAutocomplete)
  const [arriveeGeo, setArriveeGeo] = useState(null);
  const [saving, setSaving] = useState(false);
  const [vehiculeId, setVehiculeId] = useState(row.vehicule_id || "");
  async function submit() {
    setSaving(true);
    // Le géocodage n'est refait que si le texte départ/arrivée a changé —
    // inutile de resolliciter Nominatim pour une simple modification de
    // prix ou de notes. Si une suggestion de AddressAutocomplete a été
    // choisie, ses coordonnées sont déjà connues — pas besoin de
    // regéocoder dans ce cas non plus.
    const departChanged = form.point_depart !== row.point_depart || !!departGeo;
    const arriveeChanged = form.point_arrivee !== row.point_arrivee || !!arriveeGeo;
    const [depart, arrivee] = await Promise.all([
      !departChanged ? Promise.resolve(undefined) : (departGeo ? Promise.resolve(departGeo) : geocodeAddress(form.point_depart)),
      !arriveeChanged ? Promise.resolve(undefined) : (arriveeGeo ? Promise.resolve(arriveeGeo) : geocodeAddress(form.point_arrivee)),
    ]);
    const geo = {};
    if (departChanged) { geo.depart_lat = depart?.lat ?? null; geo.depart_lng = depart?.lng ?? null; }
    if (arriveeChanged) { geo.arrivee_lat = arrivee?.lat ?? null; geo.arrivee_lng = arrivee?.lng ?? null; }
    // Offre : nouvelle durée estimée si l'itinéraire a changé (le prix
    // maximal est alors recalculé en base selon la grille active).
    if (isOffer && pro?.proSql) {
      if (departChanged || arriveeChanged) {
        const dLat = departChanged ? geo.depart_lat : row.depart_lat, dLng = departChanged ? geo.depart_lng : row.depart_lng;
        const aLat = arriveeChanged ? geo.arrivee_lat : row.arrivee_lat, aLng = arriveeChanged ? geo.arrivee_lng : row.arrivee_lng;
        const eta = dLat != null && aLat != null ? await fetchRouteEta(dLat, dLng, aLat, aLng) : null;
        geo.duree_estimee_min = eta ? Math.round((eta.durationSec / 60) * 10) / 10 : null;
        geo.distance_estimee_m = eta ? Math.round(eta.distanceM) : null;
      }
      if (vehiculeId !== (row.vehicule_id || "")) geo.vehicule_id = vehiculeId || null;
    }
    await onSave(isOffer
      ? { point_depart: form.point_depart, point_arrivee: form.point_arrivee, date_heure: datetimeLocalToISO(form.date_heure), places_disponibles: Number(form.places_disponibles) || 1, prix_place: form.prix_place === "" ? null : Number(form.prix_place), notes: form.notes.trim() || null, pref_non_fumeur: !!form.pref_non_fumeur, pref_musique: !!form.pref_musique, pref_animaux: !!form.pref_animaux, ...geo }
      : { point_depart: form.point_depart, point_arrivee: form.point_arrivee, date_heure: datetimeLocalToISO(form.date_heure), places_demandees: Number(form.places_demandees) || 1, notes: form.notes.trim() || null, ...geo }
    );
    setSaving(false);
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ marginBottom: 14 }}>{t("action_edit")}</h3>
        <Field label={t("cov_field_from")}>
          <AddressAutocomplete t={t} value={form.point_depart} placeholder={t("cov_field_address_placeholder")}
            onChange={(v) => setForm((p) => ({ ...p, point_depart: v }))} onSelect={setDepartGeo} geo={departGeo} />
        </Field>
        <Field label={t("cov_field_to")}>
          <AddressAutocomplete t={t} value={form.point_arrivee} placeholder={t("cov_field_address_placeholder")}
            onChange={(v) => setForm((p) => ({ ...p, point_arrivee: v }))} onSelect={setArriveeGeo} geo={arriveeGeo} />
        </Field>
        <Field label={t("cov_field_datetime")}><input type="datetime-local" style={inputStyle} value={form.date_heure} onChange={(e) => setForm((p) => ({ ...p, date_heure: e.target.value }))} /></Field>
        {isOffer ? (
          <>
            <Field label={t("cov_field_seats")}><input type="number" min="1" style={inputStyle} value={form.places_disponibles} onChange={(e) => setForm((p) => ({ ...p, places_disponibles: e.target.value }))} /></Field>
            {pro?.myVehicles?.length > 0 && (
              <Field label={pro.P.vehicle_label}>
                <select style={inputStyle} value={vehiculeId} onChange={(e) => setVehiculeId(e.target.value)}>
                  <option value="">—</option>
                  {pro.myVehicles.map((v) => <option key={v.id} value={v.id}>{vehiculeLabel(v)}</option>)}
                </select>
              </Field>
            )}
            <Field label={row.prix_grille != null && pro ? pro.P.price_label_grid.replace("{max}", money(row.prix_grille, pro.devise)) : t("cov_field_price")}><input type="number" min="0" max={row.prix_grille ?? undefined} step="0.01" style={inputStyle} value={form.prix_place} onChange={(e) => setForm((p) => ({ ...p, prix_place: e.target.value }))} /></Field>
            {row.prix_grille != null && pro && <p style={{ fontSize: 11, color: "#8A8F98", marginTop: -8, marginBottom: 12 }}>{pro.P.price_hint_grid}</p>}
            <PreferencesFields t={t} form={form} setForm={setForm} />
          </>
        ) : (
          <Field label={t("cov_field_seats_wanted")}><input type="number" min="1" style={inputStyle} value={form.places_demandees} onChange={(e) => setForm((p) => ({ ...p, places_demandees: e.target.value }))} /></Field>
        )}
        <Field label={t("cov_field_notes")}><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
          <Btn onClick={submit} disabled={saving}>{saving ? t("loading") : t("action_save")}</Btn>
        </div>
      </div>
    </div>
  );
}
