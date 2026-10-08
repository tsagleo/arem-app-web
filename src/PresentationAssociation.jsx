// =====================================================================
// PresentationAssociation.jsx — Vue d'ensemble de l'association
// Page d'accueil (avant le tableau de bord / mon espace) : identité de
// l'association, vision/mission/valeurs, composition du bureau,
// quelques statistiques clés, et un aperçu de l'annuaire des adhérents.
// Purement présentatif — aucune modification possible depuis cette page
// (la modification se fait toujours depuis Gouvernance/Configuration/
// Adhérents, comme avant).
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Landmark, Users2, Images, Settings, ChevronLeft, ChevronRight, ChevronDown, Sparkles, Palette, History, CalendarDays, CheckCircle2, Circle, X, KeyRound } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, RuleBox, useLang, Table, td } from "./shared";

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

// Anniversaires du jour (suite 2026-10-06, demande explicite de
// l'utilisateur) — compare seulement le mois et le jour de
// members.date_naissance (déjà existant, saisi à l'inscription/dans la
// fiche adhérent) à la date du jour, sans tenir compte de l'année. Lu en
// découpant la chaîne "AAAA-MM-JJ" à la main plutôt que via `new
// Date(...)` : ce dernier interprète une date sans heure comme minuit UTC,
// ce qui peut la faire retomber sur la veille dans un fuseau négatif
// (Amérique) — un décalage silencieux qui aurait fait "rater" la bonne
// journée à certaines heures.
function isBirthdayToday(dateNaissance) {
  if (!dateNaissance) return false;
  const parts = String(dateNaissance).slice(0, 10).split("-");
  if (parts.length !== 3) return false;
  const mm = Number(parts[1]), dd = Number(parts[2]);
  const now = new Date();
  return mm === now.getMonth() + 1 && dd === now.getDate();
}
function firstNameOf(nom) {
  return (nom || "").trim().split(/\s+/)[0] || "";
}

// Flèches rondes superposées au diaporama (suite 2026-10-06, voir
// PhotoCarousel ci-dessous). Facteur commun pour éviter de dupliquer le
// style gauche/droite.
function carouselArrowStyle(side) {
  return {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    [side]: 10,
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "none",
    background: "rgba(13,58,99,.55)",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    backdropFilter: "blur(2px)",
  };
}

// Diaporama de la galerie d'accueil (suite 2026-10-06, revu le même jour
// à la demande explicite de l'utilisateur : voir les deux points
// ci-dessous) — remplace la simple grille de vignettes de la toute
// première version de la galerie. Une seule image affichée à la fois,
// défilement automatique toutes les 5s (en pause au survol), flèches et
// puces de navigation manuelles dès qu'il y a au moins 2 photos. Le clic
// ouvre toujours la photo en grand dans un nouvel onglet, comme avant.
// La gestion (ajout/suppression/ordre) reste une grille de vignettes
// dans Configuration — c'est l'outil d'administration, pas la vitrine.
//
// (1) Photos entièrement visibles : "object-fit: cover" recadrait (coupait
// les bords) toute photo dont le format ne correspondait pas exactement
// au cadre — remplacé par "object-fit: contain" (plus aucun recadrage),
// posé sur un fond flou agrandi de LA MÊME photo plutôt que des bandes
// noires/blanches vides (même principe que les diaporamas Instagram/
// Apple Photos pour les formats qui ne remplissent pas le cadre).
// (2) Effet de transition "Ken Burns" (lent zoom avant + point de départ
// du cadrage qui varie d'une photo à l'autre, via KENBURNS_ORIGINS, pour
// éviter un mouvement identique à chaque fois) superposé au fondu croisé
// déjà existant (ralenti de .6s à 1.1s pour un rendu plus posé) — l'effet
// de référence des logiciels de diaporama les plus utilisés (Apple
// Photos, Google Photos) pour un rendu cinématographique plutôt qu'un
// simple enchaînement statique ; recherche rapide effectuée auprès des
// bonnes pratiques du secteur avant implémentation. Désactivé
// automatiquement si la personne a demandé "réduire les animations" au
// niveau système (prefers-reduced-motion).
const KENBURNS_ORIGINS = ["50% 50%", "20% 20%", "80% 30%", "30% 80%", "80% 80%"];

function PhotoCarousel({ photos, t, lang }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (photos.length < 2 || paused) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % photos.length), 5000);
    return () => clearInterval(id);
  }, [photos.length, paused]);

  // Si une photo est supprimée pendant qu'elle est affichée, ramène
  // l'index dans les bornes plutôt que de pointer sur une case vide.
  useEffect(() => {
    if (index >= photos.length) setIndex(0);
  }, [photos.length, index]);

  if (photos.length === 0) return null;
  const photo = photos[Math.min(index, photos.length - 1)];
  const locale = lang === "en" ? "en-CA" : "fr-CA";

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{ display: "flex", flexWrap: "wrap", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 14px rgba(13,30,58,.10)" }}
      className="apercu-carousel-wrap"
    >
      <style>{`
        @keyframes apercuKenBurns { from { transform: scale(1); } to { transform: scale(1.12); } }
        .apercu-carousel-img { animation: apercuKenBurns 6.5s ease-out forwards; }
        @keyframes apercuTextFade { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .apercu-carousel-textblock { animation: apercuTextFade .5s ease; }
        @media (prefers-reduced-motion: reduce) { .apercu-carousel-img { animation: none; } .apercu-carousel-textblock { animation: none; } }
        @media (max-width: 720px) {
          .apercu-carousel-wrap { flex-direction: column; }
          .apercu-carousel-media { flex-basis: auto !important; height: 230px !important; }
          .apercu-carousel-text { flex-basis: auto !important; min-height: 0 !important; }
        }
      `}</style>

      {/* ---- Zone image : diaporama proprement dit (inchangé depuis la
          suite précédente — photos entières + effet Ken Burns). ---- */}
      <div className="apercu-carousel-media" style={{ position: "relative", flex: "1 1 60%", height: 320, background: "#10151F", minWidth: 0 }}>
        {photos.map((p, i) => {
          const active = i === index;
          return (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              title={p.legende || ""}
              style={{
                position: "absolute",
                inset: 0,
                opacity: active ? 1 : 0,
                transition: "opacity 1.1s ease-in-out",
                pointerEvents: active ? "auto" : "none",
              }}
            >
              {/* Fond flou agrandi de la même photo : comble le cadre sans
                  bandes vides quand le format de la photo ne correspond
                  pas exactement à celui du diaporama. */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute", inset: 0,
                  backgroundImage: `url(${p.url})`, backgroundSize: "cover", backgroundPosition: "center",
                  filter: "blur(28px) saturate(1.2) brightness(.55)", transform: "scale(1.15)",
                }}
              />
              {/* Image entière, jamais recadrée. key relié à "active" plutôt
                  qu'à p.id seul : force un nouveau montage (donc un
                  redémarrage de l'animation Ken Burns depuis zéro) chaque
                  fois que cette photo redevient la photo affichée. */}
              <img
                key={active ? "active" : "idle"}
                src={p.url}
                alt={p.legende || ""}
                className="apercu-carousel-img"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", transformOrigin: KENBURNS_ORIGINS[i % KENBURNS_ORIGINS.length] }}
                loading={active ? "eager" : "lazy"}
              />
            </a>
          );
        })}

        {photos.length > 1 && (
          <>
            <button type="button" onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)} aria-label={t("apercu_gallery_prev")} style={carouselArrowStyle("left")}>
              <ChevronLeft size={18} />
            </button>
            <button type="button" onClick={() => setIndex((i) => (i + 1) % photos.length)} aria-label={t("apercu_gallery_next")} style={carouselArrowStyle("right")}>
              <ChevronRight size={18} />
            </button>
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 10, display: "flex", justifyContent: "center", gap: 6 }}>
              {photos.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`${t("apercu_gallery_photo")} ${i + 1}`}
                  style={{
                    width: i === index ? 18 : 7,
                    height: 7,
                    borderRadius: 4,
                    border: "none",
                    background: i === index ? "#8F6E19" : "rgba(255,255,255,.55)",
                    cursor: "pointer",
                    padding: 0,
                    transition: "width .2s, background .2s",
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ---- Panneau latéral de texte (suite 2026-10-06, demande
          explicite de l'utilisateur) — jusqu'ici, l'espace à côté du
          diaporama n'existait pas du tout (l'image seule occupait tout
          le cadre) ; on en fait maintenant un vrai panneau de
          présentation : titre + description de la photo (ce qu'elle
          montre, quel événement…), avec un bouton optionnel si un lien a
          été renseigné (voir GalleryPhotoEditModal dans App.jsx) — conçu
          pour rester utile si l'association veut aussi présenter un
          produit ou une entreprise membre, sans module séparé. Clé
          "photo.id" sur le bloc de texte : force un nouveau montage (donc
          un fondu d'entrée) à chaque changement de photo plutôt qu'un
          remplacement brutal du texte. Jamais vide : à défaut de titre/
          description, affiche au moins le repère "Galerie" + la date. */}
      <div
        className="apercu-carousel-text"
        style={{
          flex: "1 1 40%", minWidth: 240, minHeight: 320, padding: "26px 28px",
          background: "linear-gradient(165deg, var(--primary-dark) 0%, var(--primary) 100%)",
          color: "white", display: "flex", flexDirection: "column", justifyContent: "center", gap: 10, boxSizing: "border-box",
        }}
      >
        <div key={photo.id} className="apercu-carousel-textblock" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase", color: "var(--accent)" }}>
            <Images size={13} />
            <span>{t("apercu_gallery_eyebrow")}</span>
            {photos.length > 1 && <span style={{ color: "rgba(255,255,255,.45)", fontWeight: 600 }}>· {index + 1} / {photos.length}</span>}
          </div>
          {photo.legende && (
            <h3 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 19, fontWeight: 700, margin: 0, lineHeight: 1.25 }}>{photo.legende}</h3>
          )}
          {photo.description && (
            <p style={{ fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,.82)", margin: 0, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 6, overflow: "hidden" }}>
              {photo.description}
            </p>
          )}
          {!photo.legende && !photo.description && (
            <p style={{ fontSize: 12.5, color: "rgba(255,255,255,.6)", margin: 0 }}>
              {photo.created_at ? new Date(photo.created_at).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }) : t("apercu_gallery_untitled")}
            </p>
          )}
          {photo.lien_url && (
            <a
              href={photo.lien_url}
              target="_blank"
              rel="noreferrer"
              style={{
                alignSelf: "flex-start", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 12, fontWeight: 700, color: "var(--primary-dark)", background: "var(--accent)",
                borderRadius: 999, padding: "7px 16px", textDecoration: "none",
              }}
            >
              {photo.lien_label || t("apercu_gallery_link_default")} <ArrowRight size={13} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// Aperçu de l'annuaire des adhérents (suite 2026-10-06) — remplace la
// grille de photos rondes ("boule-boule", retour explicite de
// l'utilisateur : "pas pro", pas aligné) par une vraie liste, alignée
// horizontalement (une ligne par adhérent : photo + nom + quartier),
// avec un bouton "Afficher N de plus" qui déroule le reste de la liste
// sur place plutôt que de forcer à quitter la page — garde en plus le
// lien existant vers l'annuaire complet (onglet Vie associative, pour la
// gestion : photo, compétences, bénévolat…).
function DirectoryPreviewRow({ m, isLast }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 12px",
        borderBottom: isLast ? "none" : "1px solid #F0F1F3",
      }}
    >
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--primary)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, overflow: "hidden", flexShrink: 0 }}>
        {m.photo_url ? <img src={m.photo_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(m.nom)}
      </div>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--primary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.nom}</span>
      {m.quartier && (
        <span style={{ fontSize: 12, color: "#8A93A6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160, flexShrink: 0 }}>{m.quartier}</span>
      )}
    </div>
  );
}

const DIRECTORY_PREVIEW_COUNT = 6;

export default function PresentationAssociation({ profile, association, members, fuSolde, fsSolde, activityLog, describeActivity, onContinue, continueLabel, isPremiumPlan }) {
  const { t, lang } = useLang();
  const [info, setInfo] = useState(null);
  const [boardMembers, setBoardMembers] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [directoryExpanded, setDirectoryExpanded] = useState(false);
  // Aperçu en entier de la photo d'un(e) fêté(e) du jour (suite 2026-10-06,
  // demande explicite de l'utilisateur) — membre dont la photo a été
  // cliquée dans la bannière d'anniversaire ci-dessous, ou null si aucun
  // aperçu n'est ouvert. Voir BirthdayPhotoLightbox, rendu en portail à la
  // toute fin du composant.
  const [birthdayPreview, setBirthdayPreview] = useState(null);
  const isBureau = ["bureau_president", "bureau_secretaire", "bureau_tresorier"].includes(profile.role);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: gi }, { data: bm }, photosRes, eventsRes] = await Promise.all([
      supabase.from("governance_info").select("*").eq("association_id", profile.association_id).maybeSingle(),
      supabase.from("board_members").select("*").eq("association_id", profile.association_id),
      // Table association_photos (suite 2026-10-06, galerie de l'association —
      // voir sql/2026-10-06_galerie_photos_association.sql). Échec attendu et
      // silencieux tant que ce script n'a pas été exécuté : la galerie
      // n'apparaît simplement pas, le reste de la page reste inchangé.
      supabase.from("association_photos").select("*").eq("association_id", profile.association_id).order("ordre"),
      // Prochains événements (suite 2026-10-06, implémentation de la maquette
      // "Tableau de bord — sidebar Unia") — simple aperçu des 2 prochains,
      // réutilisé ici même si le module Événements lui-même est réservé au
      // forfait Premium : savoir qu'une AG approche est utile à tout le
      // monde, et cet aperçu n'ouvre aucune fonctionnalité de gestion.
      // Échec silencieux (table/permissions) comme les photos ci-dessus.
      supabase.from("events").select("id,titre,date_debut,lieu").eq("association_id", profile.association_id).gte("date_debut", new Date().toISOString()).order("date_debut").limit(2),
    ]);
    setInfo(gi);
    setBoardMembers(bm || []);
    setPhotos(photosRes?.error ? [] : (photosRes?.data || []));
    setUpcomingEvents(eventsRes?.error ? [] : (eventsRes?.data || []));
    setLoading(false);
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);

  const activeMembers = (members || []).filter((m) => m.statut === "Actif");
  const directoryVisible = directoryExpanded ? activeMembers : activeMembers.slice(0, DIRECTORY_PREVIEW_COUNT);
  const memberName = (id) => members.find((m) => m.id === id)?.nom || "—";
  const hasVision = info && (info.vision || info.mission || info.valeurs);
  const firstName = (profile?.nom_complet || "").trim().split(/\s+/)[0] || "";
  const locale = lang === "en" ? "en-CA" : "fr-CA";

  // Anniversaires du jour (suite 2026-10-06) — voir isBirthdayToday plus
  // haut. Basé sur activeMembers (adhérents "Actif" uniquement, déjà
  // calculé ci-dessus) : un compte désactivé n'a pas à être fêté.
  // listLocale distinct de `locale` (qui reste "xx-CA" pour les dates) :
  // Intl.ListFormat attend un code de langue simple ("fr"/"en"/"ar").
  const birthdayMembers = activeMembers.filter((m) => isBirthdayToday(m.date_naissance));
  const listLocale = lang === "ar" ? "ar" : lang === "en" ? "en" : "fr";
  const birthdayNamesList = birthdayMembers.length > 1
    ? new Intl.ListFormat(listLocale, { style: "long", type: "conjunction" }).format(birthdayMembers.map((m) => m.nom))
    : "";

  // Adhérents triés par date d'adhésion décroissante (les plus récents
  // d'abord) — même source que l'annuaire (members, déjà sans les
  // "Supprimé", voir App.jsx visibleMembers) ; ceux sans date d'adhésion
  // renseignée sont simplement laissés en fin de liste plutôt
  // qu'exclus.
  const recentMembers = [...(members || [])]
    .sort((a, b) => (b.date_adhesion || "").localeCompare(a.date_adhesion || ""))
    .slice(0, 6);

  // Association réellement toute neuve (suite 2026-10-06, maquette
  // "Tableau de bord — sidebar Unia", écran d'accueil "Bienvenue") :
  // aucun adhérent en dehors du/de la président(e) qui vient de créer le
  // compte, aucune photo, aucune information de gouvernance renseignée.
  // Réservé au bureau (seul habilité à agir sur ces trois points) — un
  // simple adhérent ne verrait qu'un écran d'accueil sans aucune des
  // actions proposées, qui ne lui sont pas destinées.
  const isBrandNew = isBureau && !loading && activeMembers.length <= 1 && photos.length === 0 && !hasVision;

  return (
    <>
    <Container><Section>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        {association?.logo_url ? (
          <img src={association.logo_url} alt="" style={{ width: 64, height: 64, borderRadius: 14, objectFit: "cover", boxShadow: "0 2px 8px rgba(0,0,0,.12)" }} />
        ) : (
          <div style={{ width: 64, height: 64, borderRadius: 14, background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
            <Landmark size={28} />
          </div>
        )}
        <div>
          <h2 style={{ fontSize: 22, marginBottom: 2 }}>{association?.nom || t("org_default")}</h2>
          {association?.devise_texte && <p style={{ color: "#5B6270", fontSize: 13.5 }}>{association.devise_texte}</p>}
        </div>
      </div>

      {/* ================= SALUTATION =================
          Suite 2026-10-06 (maquette "Tableau de bord — sidebar Unia") —
          repère temporel/personnel ("Bonjour, {prénom}") au-dessus du
          contenu, plutôt que de ne montrer que le nom de l'association
          (déjà répété dans la sidebar et le fil d'Ariane juste au-dessus).
          Visible pour tout le monde, pas seulement le bureau. */}
      {firstName && (
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 24, margin: "0 0 4px", color: "var(--primary)" }}>
            {t("apercu_greeting_title").replace("{prenom}", firstName)}
          </h1>
          <p style={{ margin: 0, color: "#5B6270", fontSize: 13.5 }}>
            {t("apercu_greeting_sub").replace("{nom}", association?.nom || t("org_default"))}
          </p>
        </div>
      )}

      {/* ================= ANNIVERSAIRES DU JOUR =================
          Suite 2026-10-06, demande explicite de l'utilisateur : texte
          personnalisé le jour de l'anniversaire d'un adhérent, visible de
          tout le monde. Emplacement choisi (sur demande de suggestion) :
          cette page "Vue d'ensemble" précisément, parce que c'est la
          seule qui s'affiche systématiquement à la connexion pour LES
          TROIS rôles (bureau, responsable de rubrique, adhérent) — le
          tableau de bord et "Mon espace" sont chacun réservés à une partie
          seulement des comptes. Juste sous la salutation, puisque les deux
          sont du même registre ("ce qui se passe aujourd'hui"). Un seul
          ou plusieurs anniversaires le même jour sont gérés (liste
          formatée via Intl.ListFormat ci-dessus, correcte dans les trois
          langues). Disparaît de lui-même le lendemain (recalculé à chaque
          chargement, aucun état à nettoyer). */}
      {birthdayMembers.length > 0 && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 14, marginBottom: 22, padding: "16px 20px", borderRadius: 14,
            background: "linear-gradient(120deg, var(--accent) 0%, #8F6E19 100%)", color: "white", flexWrap: "wrap",
          }}
        >
          {/* Photo(s) de profil du/des fêté(e)s (suite 2026-10-06, demande
              explicite de l'utilisateur) — photo libre, sans badge dessus
              (retiré sur demande explicite) ; cliquable pour l'afficher en
              entier (voir birthdayPreview/BirthdayPhotoLightbox plus bas) —
              seulement si une vraie photo existe, pas pour un simple
              cercle d'initiales. Un seul anniversaire : sa photo (ou ses
              initiales à défaut) ; plusieurs le même jour : pile de photos
              qui se chevauchent (3 maximum affichées, "+N" au-delà). */}
          {birthdayMembers.length === 1 ? (
            <div
              onClick={() => birthdayMembers[0].photo_url && setBirthdayPreview(birthdayMembers[0])}
              style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,255,255,.22)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontWeight: 700, fontSize: 15, flexShrink: 0, cursor: birthdayMembers[0].photo_url ? "pointer" : "default" }}
            >
              {birthdayMembers[0].photo_url ? (
                <img src={birthdayMembers[0].photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                initials(birthdayMembers[0].nom)
              )}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              {birthdayMembers.slice(0, 3).map((m, i) => (
                <div
                  key={m.id}
                  onClick={() => m.photo_url && setBirthdayPreview(m)}
                  style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,.22)", border: "2.5px solid rgba(255,255,255,.75)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontWeight: 700, fontSize: 13, marginLeft: i === 0 ? 0 : -14, boxShadow: "0 1px 4px rgba(0,0,0,.15)", cursor: m.photo_url ? "pointer" : "default" }}
                >
                  {m.photo_url ? <img src={m.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(m.nom)}
                </div>
              ))}
              {birthdayMembers.length > 3 && (
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--primary-dark)", border: "2.5px solid rgba(255,255,255,.75)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, marginLeft: -14 }}>
                  +{birthdayMembers.length - 3}
                </div>
              )}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontFamily: "Fraunces, Georgia, serif", fontWeight: 700, fontSize: 16.5, marginBottom: 2 }}>
              {birthdayMembers.length === 1
                ? t("apercu_birthday_title_one").replace("{prenom}", firstNameOf(birthdayMembers[0].nom))
                : t("apercu_birthday_title_many").replace("{noms}", birthdayNamesList)}
            </div>
            <div style={{ fontSize: 12.5, opacity: 0.92 }}>
              {(birthdayMembers.length === 1 ? t("apercu_birthday_sub_one") : t("apercu_birthday_sub_many")).replace("{nom}", association?.nom || t("org_default"))}
            </div>
          </div>
        </div>
      )}

      {/* ================= ACCUEIL D'UNE ASSOCIATION TOUTE NEUVE =================
          Suite 2026-10-06 (maquette "Tableau de bord — sidebar Unia", écran
          "Bienvenue") — remplace, pour une association qui vient d'être
          créée, le tableau de bord encore vide (statistiques à zéro,
          annuaire presque vide) par 3 actions concrètes pour démarrer.
          Retiré de la maquette : le bouton de bascule "Démo : état vide"
          qui l'accompagnait — un simple contrôle de démonstration pour
          visualiser les deux états dans le fichier de maquette, sans
          équivalent réel ; ici, c'est l'état réel des données qui décide. */}
      {isBrandNew && (
        <Card style={{ marginBottom: 24, textAlign: "center", padding: "32px 20px" }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg, var(--accent) 0%, var(--primary) 100%)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", margin: "0 auto 16px" }}>
            <Sparkles size={24} />
          </div>
          <h2 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 20, margin: "0 0 8px" }}>{t("apercu_onboarding_title").replace("{prenom}", firstName)}</h2>
          <p style={{ color: "#5B6270", fontSize: 13.5, maxWidth: 460, margin: "0 auto 24px" }}>{t("apercu_onboarding_sub").replace("{nom}", association?.nom || t("org_default"))}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560, margin: "0 auto", textAlign: "left" }}>
            {[
              { Icon: Users2, titleKey: "apercu_onboarding_step1_title", descKey: "apercu_onboarding_step1_desc", ctaKey: "apercu_onboarding_step1_cta", target: "membres" },
              { Icon: Palette, titleKey: "apercu_onboarding_step2_title", descKey: "apercu_onboarding_step2_desc", ctaKey: "apercu_onboarding_step2_cta", target: "config" },
              { Icon: Images, titleKey: "apercu_onboarding_step3_title", descKey: "apercu_onboarding_step3_desc", ctaKey: "apercu_onboarding_step3_cta", target: "config" },
            ].map((step, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--paper, #FBF6EC)", border: "1.5px dashed #E6DFCD", borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: "white", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary)", flexShrink: 0 }}>
                  <step.Icon size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ margin: "0 0 2px", fontSize: 13.5 }}>{t(step.titleKey)}</h3>
                  <p style={{ margin: 0, fontSize: 12, color: "#5B6270" }}>{t(step.descKey)}</p>
                </div>
                <Btn variant="outline" style={{ flexShrink: 0 }} onClick={() => onContinue(step.target)}>{t(step.ctaKey)}</Btn>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ================= GALERIE DE PHOTOS (diaporama) =================
          Suite 2026-10-06 — alimentée par association_photos (voir
          sql/2026-10-06_galerie_photos_association.sql), gérée depuis
          Configuration (grille de vignettes, avec ajout/suppression/ordre
          — voir App.jsx). Ici, sur la page d'accueil, affichage en
          diaporama (PhotoCarousel ci-dessus) plutôt qu'en grille statique
          — une image en grand, défilement automatique. N'affiche rien
          tant qu'il n'y a aucune photo, SAUF pour le bureau (seul à
          pouvoir en ajouter) : un rappel discret plutôt qu'un emplacement
          vide sans explication.

          Passé en Premium (suite 2026-10-06, demande explicite de
          l'utilisateur : « Faire passer l'option de diaporama en mode
          premium ») — tant que !isPremiumPlan, le diaporama ne s'affiche
          plus du tout, qu'il y ait des photos ou non (la gestion des
          photos, dans Configuration, est elle aussi verrouillée — voir
          App.jsx). Pour le bureau seul (seul habilité à agir sur le
          forfait) : un petit rappel discret plutôt qu'un simple silence,
          avec le même bouton "Voir le forfait Premium" que partout
          ailleurs dans l'application (PremiumLocked). Pour les autres
          rôles : rien, exactement comme s'il n'y avait aucune photo. */}
      {!isPremiumPlan ? (
        isBureau ? (
          <Card style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", borderTopColor: "#C8963E" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <KeyRound size={18} color="#C8963E" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 13 }}>{t("apercu_gallery_premium_locked")}</span>
            </div>
            <Btn variant="outline" onClick={() => onContinue("config")}>{t("premium_locked_cta")}</Btn>
          </Card>
        ) : null
      ) : photos.length > 0 ? (
        <Card style={{ marginBottom: 24, padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "14px 18px 0" }}>
            <Images size={15} color="var(--primary)" />
            <h3 style={{ fontSize: 14.5 }}>{t("apercu_gallery_title")}</h3>
          </div>
          <div style={{ padding: 18 }}>
            <PhotoCarousel photos={photos} t={t} lang={lang} />
          </div>
        </Card>
      ) : isBureau ? (
        <Card style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Images size={18} color="var(--primary)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13 }}>{t("apercu_gallery_empty_bureau")}</span>
          </div>
          <Btn variant="outline" onClick={() => onContinue("config")}><Settings size={13} /> {t("apercu_gallery_empty_cta")}</Btn>
        </Card>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 24 }}>
        <Card style={{ textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: "var(--primary)" }}>{activeMembers.length}</div>
          <div style={{ fontSize: 12.5, color: "#5B6270", marginTop: 2 }}>{t("apercu_active_members")}</div>
        </Card>
        <Card style={{ textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: "var(--primary)" }}>{Number(fuSolde || 0).toFixed(2)} $</div>
          <div style={{ fontSize: 12.5, color: "#5B6270", marginTop: 2 }}>{t("dash_balance_urgence")}</div>
        </Card>
        <Card style={{ textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: "var(--primary)" }}>{Number(fsSolde || 0).toFixed(2)} $</div>
          <div style={{ fontSize: 12.5, color: "#5B6270", marginTop: 2 }}>{t("dash_balance_secours")}</div>
        </Card>
        <Card style={{ textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: "var(--primary)" }}>{boardMembers.length}</div>
          <div style={{ fontSize: 12.5, color: "#5B6270", marginTop: 2 }}>{t("gov_board_title")}</div>
        </Card>
      </div>

      {/* ================= ACTIVITÉS RÉCENTES + PROCHAINS ÉVÉNEMENTS =================
          Suite 2026-10-06 (maquette "Tableau de bord — sidebar Unia") —
          les deux widgets "pouls de l'association" au jour le jour, qui
          manquaient sur cette page (jusqu'ici purement présentative).
          "Dernières activités" réutilise le même journal que l'onglet
          Journal d'activité (describeActivityLog côté App.jsx, déjà
          réservé au bureau — vide pour tout le monde d'autre, donc la
          carte ne s'affiche que pour le bureau plutôt que montrer une
          carte vide à chacun). "Prochains événements" reste visible par
          tout le monde : savoir qu'une AG approche concerne tous les
          adhérents, même dans une association au forfait Standard (le
          module Événements lui-même reste réservé au Premium — cet
          aperçu n'ouvre aucune action de gestion). */}
      <div style={{ display: "grid", gridTemplateColumns: isBureau ? "1fr 1fr" : "1fr", gap: 18, marginBottom: 18 }} className="apercu-grid">
        {isBureau && (
          <Card>
            <h3 style={{ fontSize: 14.5, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><History size={15} /> {t("apercu_activity_title")}</h3>
            {loading ? null : (activityLog || []).length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {activityLog.slice(0, 4).map((log) => (
                  <div key={log.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.8, padding: "8px 0", borderBottom: "1px solid #F0F1F3" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{describeActivity(log)}</span>
                    <span style={{ color: "#5B6270", whiteSpace: "nowrap", flexShrink: 0 }}>{new Date(log.created_at).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))}
              </div>
            ) : (
              <RuleBox>{t("apercu_activity_empty")}</RuleBox>
            )}
          </Card>
        )}
        <Card>
          <h3 style={{ fontSize: 14.5, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><CalendarDays size={15} /> {t("apercu_events_title")}</h3>
          {loading ? null : upcomingEvents.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {upcomingEvents.map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5, padding: "8px 0", borderBottom: "1px solid #F0F1F3" }}>
                  <span>{e.titre}{e.lieu ? ` — ${e.lieu}` : ""}</span>
                  <span style={{ color: "#5B6270", whiteSpace: "nowrap", flexShrink: 0 }}>{new Date(e.date_debut).toLocaleDateString(locale, { day: "2-digit", month: "short" })}</span>
                </div>
              ))}
            </div>
          ) : (
            <RuleBox>{t("apercu_events_empty")}</RuleBox>
          )}
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 }} className="apercu-grid">
        <Card>
          <h3 style={{ fontSize: 14.5, marginBottom: 12 }}>{t("gov_vision_mission")}</h3>
          {loading ? null : hasVision ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {info.vision && <div><strong style={{ fontSize: 12.5, color: "#5B6270" }}>{t("gov_vision")}</strong><p style={{ fontSize: 13.5, marginTop: 2 }}>{info.vision}</p></div>}
              {info.mission && <div><strong style={{ fontSize: 12.5, color: "#5B6270" }}>{t("gov_mission")}</strong><p style={{ fontSize: 13.5, marginTop: 2 }}>{info.mission}</p></div>}
              {info.valeurs && <div><strong style={{ fontSize: 12.5, color: "#5B6270" }}>{t("gov_values")}</strong><p style={{ fontSize: 13.5, marginTop: 2 }}>{info.valeurs}</p></div>}
            </div>
          ) : (
            <RuleBox>{t("apercu_no_vision")}</RuleBox>
          )}
        </Card>

        <Card>
          <h3 style={{ fontSize: 14.5, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><Users2 size={15} /> {t("gov_board_title")}</h3>
          {loading ? null : boardMembers.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Photo de profil à côté de chaque membre du bureau (suite
                  2026-10-06, demande explicite de l'utilisateur) — même
                  principe que DirectoryPreviewRow plus haut : photo si
                  disponible (members.photo_url), sinon initiales sur fond
                  "--primary". board_members.member_id pointe vers members,
                  déjà reçu en prop (voir memberName ci-dessus). */}
              {boardMembers.map((b) => {
                const bm = (members || []).find((m) => m.id === b.member_id);
                return (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, padding: "6px 0", borderBottom: "1px solid #F0F1F3" }}>
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--primary)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11, overflow: "hidden", flexShrink: 0 }}>
                      {bm?.photo_url ? <img src={bm.photo_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(bm?.nom || memberName(b.member_id))}
                    </div>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bm?.nom || memberName(b.member_id)}</span>
                    <span style={{ color: "#5B6270", flexShrink: 0 }}>{b.poste}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <RuleBox>{t("apercu_board_empty")}</RuleBox>
          )}
        </Card>
      </div>

      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <h3 style={{ fontSize: 14.5 }}>{t("apercu_directory_title")}</h3>
          {activeMembers.length > 0 && <span style={{ fontSize: 12, color: "#8A93A6", flexShrink: 0 }}>{activeMembers.length}</span>}
        </div>
        {directoryVisible.length > 0 ? (
          <>
            <div style={{ borderRadius: 10, border: "1px solid #EEF0F3", overflow: "hidden" }}>
              {directoryVisible.map((m, i) => (
                <DirectoryPreviewRow key={m.id} m={m} isLast={i === directoryVisible.length - 1} />
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              {activeMembers.length > DIRECTORY_PREVIEW_COUNT ? (
                <button
                  onClick={() => setDirectoryExpanded((v) => !v)}
                  style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  {directoryExpanded ? t("apercu_directory_show_less") : t("apercu_directory_show_more").replace("{n}", activeMembers.length - DIRECTORY_PREVIEW_COUNT)}
                  <ChevronDown size={14} style={{ transform: directoryExpanded ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                </button>
              ) : <span />}
              <a href="#" onClick={(e) => { e.preventDefault(); onContinue("vieassociative"); }} style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>{t("apercu_see_all_directory")}</a>
            </div>
          </>
        ) : (
          <RuleBox>{t("apercu_directory_empty")}</RuleBox>
        )}
      </Card>

      {/* ================= DERNIERS ADHÉRENTS INSCRITS =================
          Suite 2026-10-06 (maquette "Tableau de bord — sidebar Unia") —
          même donnée que l'annuaire ci-dessus (members), simplement triée
          par date d'adhésion plutôt que par nom : répond à "qui vient de
          nous rejoindre ?" plutôt qu'à "je cherche telle personne". */}
      {recentMembers.length > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14.5, marginBottom: 12 }}>{t("apercu_recent_members_title")}</h3>
          <Table head={[t("member"), t("status"), t("va_col_joindate")]}>
            {recentMembers.map((m) => (
              <tr key={m.id}>
                <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>{m.nom}</td>
                <td style={{ ...td, display: "flex", alignItems: "center", gap: 6 }}>
                  {m.statut === "Actif" ? <CheckCircle2 size={12} color="var(--primary)" /> : <Circle size={12} color="#8A93A6" />} {m.statut === "Actif" ? t("active") : t("inactive")}
                </td>
                <td style={td}>{m.date_adhesion || "—"}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <div style={{ textAlign: "center" }}>
        <Btn onClick={() => onContinue()}>{continueLabel} <ArrowRight size={14} /></Btn>
      </div>

      <style>{`@media (max-width: 720px) { .apercu-grid { grid-template-columns: 1fr !important; } }`}</style>
    </Section></Container>
    {birthdayPreview && (
      <BirthdayPhotoLightbox member={birthdayPreview} onClose={() => setBirthdayPreview(null)} />
    )}
    </>
  );
}

// =====================================================================
// BirthdayPhotoLightbox — aperçu en entier de la photo d'un(e) fêté(e)
// (suite 2026-10-06, demande explicite de l'utilisateur) : rendu en
// portail (document.body) pour s'afficher au-dessus de tout le reste de
// la page, peu importe où la bannière d'anniversaire se trouve dans le
// DOM. Fermeture au clic sur le fond sombre, sur le bouton ✕, ou sur la
// touche Échap.
// =====================================================================
function BirthdayPhotoLightbox({ member, onClose }) {
  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(10,12,18,.82)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: "min(420px, 90vw)" }}>
        <img
          src={member.photo_url}
          alt={member.nom}
          style={{ width: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: 16, boxShadow: "0 12px 40px rgba(0,0,0,.45)" }}
        />
        <div style={{ marginTop: 14, color: "white", fontFamily: "Fraunces, Georgia, serif", fontSize: 17, fontWeight: 700, textAlign: "center" }}>
          {member.nom}
        </div>
      </div>
      <button
        onClick={onClose}
        aria-label="Fermer"
        style={{
          position: "absolute", top: 20, right: 20, width: 38, height: 38, borderRadius: "50%",
          background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.3)", color: "white",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}
      >
        <X size={18} />
      </button>
    </div>,
    document.body
  );
}
