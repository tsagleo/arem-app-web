// =====================================================================
// VieAssociative.jsx — Anniversaires, annuaire des membres, fil d'actualité
// Développé par Omnia Trade Solutions
// =====================================================================
// Refonte « réseau social interne » (2026-09-29), à la demande de
// l'utilisateur : les 3 rubriques (anniversaires, annuaire, fil
// d'actualité) sont maintenant présentées comme un menu de rubriques
// déroulantes (toutes repliées à l'arrivée sur l'onglet), l'encadré
// "Nouvelles" (annonces) a été complètement retiré — les Annonces ont déjà
// leur propre onglet — et le fil d'actualité se rapproche d'un vrai réseau
// social interne : réactions enrichies (6 emojis, palette au clic),
// publications épinglées par le Bureau, sondages intégrés à une
// publication, mentions @adhérent, et un repère "Nouveau" pour les
// publications reçues depuis la dernière visite. Voir
// sql/2026-09-29_vieassociative_reseau_social.sql pour la partie base de
// données (réactions élargies, colonne posts.epingle, tables de sondage,
// compteur de nouveauté).
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Cake, Search, Send, Pencil, Trash2, MoreVertical, Maximize2, Upload, Clock,
  MessageCircle, Video, Mic, ChevronDown, Users, Pin, BarChart3, X, Smile, Eye,
  Repeat2, Plus, Calendar, Flag, MapPin, PartyPopper,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Table, td, inputStyle, useLang, friendlyError, foldText, RED, TEAL, toDatetimeLocal } from "./shared";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function initials(name) {
  return (name || "").split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

// Avatar du fil d'actualité (2026-09-29, suite « refonte Vie associative ») —
// même principe que le composant Avatar de App.jsx (photo réelle quand
// disponible, sinon initiales), repris ici en local puisque ce fichier a
// son propre helper "initials" et n'a pas accès aux membres de la même
// façon. Les publications/commentaires ne conservent que le NOM de
// l'auteur (auteur_nom), pas son id d'adhérent — la photo est donc
// retrouvée par correspondance de nom exact avec l'annuaire (members).
// Cas limite assumé : deux adhérents portant exactement le même nom
// afficheraient la même photo ; comportement de repli (initiales) inchangé
// si aucune correspondance ou aucune photo.
function FeedAvatar({ photoUrl, name, size = 26, fontSize }) {
  const fs = fontSize || Math.max(9, Math.round(size * 0.38));
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "linear-gradient(155deg, var(--primary), var(--primary-dark))", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: fs, flexShrink: 0, overflow: "hidden", boxShadow: "0 2px 7px rgba(31,56,100,.25)" }}>
      {photoUrl ? <img src={photoUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (initials(name) || "?")}
    </div>
  );
}

// Badge "Bureau" (2026-09-29, 4e vague) — posts.auteur_est_bureau est
// dénormalisée à l'insertion (capturée depuis la prop isBureau de l'auteur
// au moment de la publication), exactement comme auteur_nom : un membre qui
// rejoint/quitte le Bureau plus tard ne change pas le badge de ses
// publications passées, ce qui est le comportement voulu (reflète le
// statut réel au moment de la publication officielle).
function BureauBadge({ t }) {
  return (
    <span style={{ fontSize: 8.5, fontWeight: 700, color: "var(--primary)", background: "rgba(31,56,100,.1)", borderRadius: 999, padding: "1px 6px", textTransform: "uppercase", letterSpacing: 0.3 }}>
      {t("va_bureau_badge")}
    </span>
  );
}

// Tiroir animé générique (2026-09-29) — remplace un montage/démontage React
// abrupt par une vraie animation d'ouverture/fermeture, sans mesurer quoi
// que ce soit en JavaScript (technique CSS Grid : gridTemplateRows passe de
// "0fr" à "1fr", le contenu reste toujours dans le DOM). Réutilisé pour les
// 3 rubriques du menu ET pour chaque bloc de commentaires.
function Collapsible({ open, children }) {
  return (
    <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows 0.28s ease" }}>
      <div style={{ overflow: "hidden", minHeight: 0 }}>{children}</div>
    </div>
  );
}

// En-tête de rubrique déroulante (menu Vie associative, 2026-09-29).
function RubriqueHeader({ icon: Icon, label, count, alert, open, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
        background: open ? "linear-gradient(135deg, var(--primary), var(--primary-dark))" : "white",
        color: open ? "white" : "#242832",
        border: open ? "1px solid transparent" : "1px solid rgba(31,56,100,0.08)",
        borderRadius: 12, cursor: "pointer",
        boxShadow: open ? "0 4px 16px rgba(31,56,100,.18)" : "0 1px 4px rgba(31,56,100,.06)",
        textAlign: "left", fontFamily: "inherit", boxSizing: "border-box",
      }}
    >
      <div style={{ width: 34, height: 34, borderRadius: "50%", background: open ? "rgba(255,255,255,.2)" : "var(--accent-bg, #EEF1F5)", color: open ? "white" : "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={16} />
      </div>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{label}</span>
      {alert > 0 && (
        <span style={{ fontSize: 10.5, fontWeight: 700, background: RED, color: "white", borderRadius: 999, padding: "2px 8px" }}>{alert}</span>
      )}
      {count != null && (
        <span style={{ fontSize: 11, fontWeight: 700, background: open ? "rgba(255,255,255,.22)" : "var(--accent-bg, #EEF1F5)", color: open ? "white" : "var(--primary)", borderRadius: 999, padding: "2px 9px" }}>{count}</span>
      )}
      <ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s ease", flexShrink: 0 }} />
    </button>
  );
}

const photoMenuItemStyle = {
  display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "10px 14px",
  background: "none", border: "none", textAlign: "left", fontSize: 12.5, color: "#333", cursor: "pointer",
};

export default function VieAssociative({ profile, isBureau, onFeedOpened }) {
  const [members, setMembers] = useState([]);
  const [posts, setPosts] = useState([]);
  const [comments, setComments] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [polls, setPolls] = useState([]);
  const [pollOptions, setPollOptions] = useState([]);
  const [pollVotes, setPollVotes] = useState([]);
  const [postViews, setPostViews] = useState([]);
  const [postImages, setPostImages] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [statusViews, setStatusViews] = useState([]);
  // ---------- 4e vague (2026-09-29) : événements liés, signalements ----------
  // events/event_rsvps existent déjà (module Événements) — réutilisés ici en
  // LECTURE + RSVP simple, à la façon dont Evenements.jsx maintient son
  // propre état local plutôt que de le partager entre composants (même
  // choix que pour interac_payment_claims dans ce fichier). post_flags est
  // une table neuve (v4) : repli sur [] tant que la migration n'a pas été
  // exécutée, comme post_views/post_images/member_statuses ci-dessus.
  const [events, setEvents] = useState([]);
  const [eventRsvpsList, setEventRsvpsList] = useState([]);
  const [postFlags, setPostFlags] = useState([]);
  const [viewingMemberProfile, setViewingMemberProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // ---------- Chargement différé du fil (2026-09-29, perf) ----------
  // Les données du fil (posts, commentaires, réactions, sondages, statuts,
  // événements, signalements) ne sont chargées qu'à la PREMIÈRE ouverture
  // de la rubrique Fil d'actualité (voir toggleSection ci-dessous), pas dès
  // l'arrivée sur l'onglet — beaucoup de visites n'ouvrent que Anniversaires
  // ou Annuaire, qui ne dépendent que de `members` (chargé, lui, tout de
  // suite). `feedLoading` ne bloque donc plus toute la page (voir `loading`
  // ci-dessus, qui ne dépend plus que de `members`), seulement le contenu
  // de la rubrique Fil pendant son premier chargement.
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const { t, lang } = useLang();

  // ---------- Menu des rubriques (2026-09-29) ----------
  // Toutes repliées à l'arrivée sur l'onglet : l'utilisateur voit d'abord
  // la liste des 3 rubriques, puis clique pour ouvrir celle qui l'intéresse.
  const [openSections, setOpenSections] = useState({});

  // ---------- Menu d'actions sur la photo de profil (annuaire) ----------
  // Remplace l'ancienne croix rouge posée sur la photo : la photo reste
  // totalement libre/visible, toutes les actions passent par un petit
  // bouton "⋮" à côté, avec un menu (voir en grand / changer / supprimer).
  const [photoMenuId, setPhotoMenuId] = useState(null);
  const [photoMenuPos, setPhotoMenuPos] = useState({ top: 0, left: 0 });
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [uploadTargetId, setUploadTargetId] = useState(null);
  const fileInputRef = useRef(null);

  // Anniversaires et Annuaire ne dépendent que de `members` — chargé tout
  // de suite, indépendamment du fil (voir loadFeed ci-dessous).
  const loadMembers = useCallback(async () => {
    setLoading(true);
    const { data: mem } = await supabase.from("members").select("*").order("nom");
    setMembers((mem || []).filter((m) => m.statut !== "Supprimé"));
    setLoading(false);
  }, []);
  useEffect(() => { loadMembers(); }, [loadMembers]);

  // Données du fil — chargées à la demande (voir toggleSection ci-dessous),
  // pas au montage du composant (perf, 2026-09-29). Les publications sont
  // récupérées d'abord (elles seules donnent les post_id nécessaires pour
  // borner les requêtes post_comments/post_reactions à ce qui est
  // réellement affiché, au lieu de tout l'historique de l'association —
  // ça coûte un aller-retour réseau de plus, mais évite qu'un ancien
  // commentaire/réaction disparaisse silencieusement au-delà d'une limite
  // fixe une fois l'association plus active).
  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    const { data: p } = await supabase.from("posts").select("*").eq("association_id", profile.association_id).order("created_at", { ascending: false }).limit(50);
    const postIds = (p || []).map((po) => po.id);
    const [cmRes, rxRes, { data: pl }, { data: plo }, { data: plv }, viewsRes, imagesRes, statusesRes, statusViewsRes, eventsRes, eventRsvpsRes, flagsRes] = await Promise.all([
      postIds.length > 0
        ? supabase.from("post_comments").select("*").in("post_id", postIds).order("created_at", { ascending: true })
        : Promise.resolve({ data: [] }),
      postIds.length > 0
        ? supabase.from("post_reactions").select("*").in("post_id", postIds)
        : Promise.resolve({ data: [] }),
      supabase.from("post_polls").select("*").eq("association_id", profile.association_id),
      supabase.from("post_poll_options").select("*").eq("association_id", profile.association_id).order("position"),
      supabase.from("post_poll_votes").select("*").eq("association_id", profile.association_id),
      // Tables optionnelles tant que les migrations v2/v3/v4 n'ont pas été
      // exécutées — on avale l'erreur pour ne pas casser le reste du fil
      // (voir sql/2026-09-29_vieassociative_reseau_social_v2.sql, _v3.sql et _v4.sql).
      supabase.from("post_views").select("*").eq("association_id", profile.association_id).limit(3000).then((r) => r, () => ({ data: [] })),
      supabase.from("post_images").select("*").eq("association_id", profile.association_id).order("position").then((r) => r, () => ({ data: [] })),
      supabase.from("member_statuses").select("*").eq("association_id", profile.association_id).gt("expires_at", new Date().toISOString()).order("created_at").then((r) => r, () => ({ data: [] })),
      supabase.from("status_views").select("*").eq("association_id", profile.association_id).then((r) => r, () => ({ data: [] })),
      // events/event_rsvps existent déjà (module Événements) — repris ici en
      // lecture seule + RSVP simple pour l'intégration "publication → événement".
      supabase.from("events").select("*").eq("association_id", profile.association_id).then((r) => r, () => ({ data: [] })),
      supabase.from("event_rsvps").select("*").eq("association_id", profile.association_id).then((r) => r, () => ({ data: [] })),
      supabase.from("post_flags").select("*").eq("association_id", profile.association_id).then((r) => r, () => ({ data: [] })),
    ]);
    setPosts(p || []);
    setComments(cmRes?.data || []); setReactions(rxRes?.data || []);
    setPolls(pl || []); setPollOptions(plo || []); setPollVotes(plv || []);
    setPostViews(viewsRes?.data || []);
    setPostImages(imagesRes?.data || []);
    setStatuses(statusesRes?.data || []);
    setStatusViews(statusViewsRes?.data || []);
    setEvents(eventsRes?.data || []);
    setEventRsvpsList(eventRsvpsRes?.data || []);
    setPostFlags(flagsRes?.data || []);
    setFeedLoading(false);
    setFeedLoaded(true);
  }, [profile.association_id]);

  // ---------- Repère de nouveauté (2026-09-29) ----------
  // Récupère la dernière visite ENREGISTRÉE (avant celle-ci) pour savoir ce
  // qui est "nouveau" — voir mark_section_viewed ci-dessous, qui avance ce
  // repère seulement quand la rubrique Fil d'actualité est dépliée (pas à
  // la simple ouverture de l'onglet, puisque tout est replié par défaut).
  const [feedLastViewedAt, setFeedLastViewedAt] = useState(null);
  const feedMarkedRef = useRef(false);
  const feedLoadStartedRef = useRef(false);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("section_views").select("last_viewed_at")
        .eq("profile_id", profile.id).eq("section", "vieassociative").maybeSingle();
      setFeedLastViewedAt(data?.last_viewed_at ? new Date(data.last_viewed_at) : null);
    })();
  }, [profile.id]);

  function toggleSection(key) {
    setOpenSections((prev) => {
      const willOpen = !prev[key];
      if (key === "fil" && willOpen) {
        if (!feedMarkedRef.current) {
          feedMarkedRef.current = true;
          // Correctif 2026-10-07 (signalé par l'utilisateur : le badge "3"
          // persistait sur Vie associative et sur la cloche 🔔 même après
          // avoir tout lu) — même classe de bug que celui déjà corrigé pour
          // les demandes de suppression/rattachement (voir resume-unia.md,
          // addendum 2026-10-06) : l'appel RPC direct met bien à jour
          // section_views côté base (le compteur repartirait à 0 après un
          // rechargement complet de la page), mais ne touche jamais l'état
          // React déjà chargé dans useUnreadCounts() — le badge restait donc
          // figé pour le reste de la session. onFeedOpened (passé par
          // App.jsx) appelle maintenant markViewed("vieassociative"), qui
          // fait le même appel RPC ET met immédiatement le compteur local à
          // zéro, comme pour les 6 autres rubriques à badge de menu.
          if (onFeedOpened) onFeedOpened();
          else supabase.rpc("mark_section_viewed", { p_section: "vieassociative" });
        }
        // Chargement différé (2026-09-29, perf) : les données du fil ne
        // sont demandées qu'à cette toute première ouverture de la rubrique.
        if (!feedLoadStartedRef.current) {
          feedLoadStartedRef.current = true;
          loadFeed();
        }
      }
      return { ...prev, [key]: willOpen };
    });
  }

  // ---------- Statut de lecture ("vu par X personnes", 2026-09-29, 2e vague) ----------
  // Approximation volontairement simple (pas d'IntersectionObserver) : dès
  // que le fil est déplié, on marque comme "vues" toutes les publications
  // actuellement chargées — cohérent avec le principe déjà utilisé pour le
  // repère de nouveauté juste au-dessus. Dédoublonné en session via
  // viewedPostIdsRef pour ne pas ré-écrire à chaque re-render.
  const viewedPostIdsRef = useRef(new Set());
  useEffect(() => {
    if (!openSections.fil || !posts.length) return;
    const toMark = posts.filter((p) => !viewedPostIdsRef.current.has(p.id));
    if (toMark.length === 0) return;
    toMark.forEach((p) => viewedPostIdsRef.current.add(p.id));
    const rows = toMark.map((p) => ({
      post_id: p.id, association_id: profile.association_id, member_profile_id: profile.id, viewer_nom: profile.nom_complet,
    }));
    supabase.from("post_views").upsert(rows, { onConflict: "post_id,member_profile_id", ignoreDuplicates: true }).then(({ error }) => {
      if (error) return;
      setPostViews((prev) => {
        const key = (v) => `${v.post_id}:${v.member_profile_id}`;
        const existing = new Set(prev.map(key));
        const fresh = rows.filter((r) => !existing.has(key(r))).map((r) => ({ ...r, id: `local-${r.post_id}`, viewed_at: new Date().toISOString() }));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    });
  }, [openSections.fil, posts, profile.association_id, profile.id, profile.nom_complet]);

  // ---------- Anniversaires ----------
  function daysUntilBirthday(dateNaissance) {
    if (!dateNaissance) return null;
    const today = new Date();
    const bday = new Date(dateNaissance);
    const next = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
    if (next < today) next.setFullYear(today.getFullYear() + 1);
    return Math.ceil((next - today) / 864e5);
  }
  const upcomingBirthdays = members
    .filter((m) => m.date_naissance)
    .map((m) => ({ ...m, joursRestants: daysUntilBirthday(m.date_naissance) }))
    .sort((a, b) => a.joursRestants - b.joursRestants)
    .slice(0, 10);

  // ---------- Anniversaires intégrés au fil (2026-09-29, 4e vague) ----------
  // Volontairement indépendante de daysUntilBirthday() ci-dessus : cette
  // dernière compare un "next" minuit à un "today" à l'heure courante, ce qui
  // fait passer un anniversaire du jour même à "dans 365 jours" une fois
  // minuit passé (bug préexistant, hors scope ici) — ne compare donc QUE le
  // mois et le jour, sans jamais construire de date "prochaine occurrence".
  function isBirthdayToday(dateNaissance) {
    if (!dateNaissance) return false;
    const d = new Date(dateNaissance);
    const today = new Date();
    return d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  }
  const birthdayMembersToday = members.filter((m) => isBirthdayToday(m.date_naissance));
  function wishBirthday(m) {
    const msg = t("va_birthday_wish_text").replace("{nom}", m.nom);
    setNewPost((prev) => (prev.trim() ? `${prev} ${msg}` : msg));
    requestAnimationFrame(() => postInputRef.current?.focus());
  }

  async function saveBirthday(memberId, date) {
    await supabase.from("members").update({ date_naissance: date || null }).eq("id", memberId);
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, date_naissance: date } : m)));
  }

  // ---------- Annuaire ----------
  const filteredMembers = members.filter((m) =>
    !search || m.nom.toLowerCase().includes(search.toLowerCase()) ||
    (m.competences || "").toLowerCase().includes(search.toLowerCase()) ||
    (m.quartier || "").toLowerCase().includes(search.toLowerCase())
  );
  async function updateDirectoryField(memberId, field, value) {
    await supabase.from("members").update({ [field]: value }).eq("id", memberId);
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, [field]: value } : m)));
  }

 async function uploadPhoto(memberId, file) {
    if (!file) return;
    const targetName = members.find((m) => m.id === memberId)?.nom || "";
    if (!window.confirm(t("va_confirm_upload_photo").replace("{nom}", targetName))) return;
    const path = `${memberId}/${Date.now()}_${file.name}`;
    const { error: uploadErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (uploadErr) { alert("Erreur de téléversement : " + friendlyError(uploadErr, t)); return; }
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    await updateDirectoryField(memberId, "photo_url", urlData.publicUrl);
  }

  async function removePhoto(memberId) {
    await updateDirectoryField(memberId, "photo_url", null);
  }

  // Photo de l'utilisateur courant (retrouvée via profile.member_id, comme
  // dans App.jsx) pour l'avatar de la barre de composition, et recherche
  // par nom pour les avatars des autres auteurs dans le fil (voir
  // FeedAvatar ci-dessus pour la limite de cette approche).
  // Lookup par nom mémorisé (2026-09-29, perf) — memberByName() est appelée
  // une fois par avatar affiché (chaque publication, commentaire, réponse,
  // republication, story...), potentiellement des dizaines de fois par
  // rendu ; une Map reconstruite seulement quand `members` change évite de
  // refaire un .find() linéaire à chaque appel.
  const membersByNameMap = React.useMemo(() => {
    const map = new Map();
    for (const m of members) if (m.nom) map.set(m.nom, m);
    return map;
  }, [members]);
  const meMember = members.find((m) => m.id === profile.member_id);
  const memberByName = (nom) => membersByNameMap.get(nom);

  // Regex des mentions "@Nom Complet" mémorisé (2026-09-29, perf) — cette
  // regex (noms triés du plus long au plus court, pour qu'un nom composé
  // comme "Jean Tremblay" soit reconnu en entier plutôt que juste "Jean")
  // ne dépend que de `members` : la reconstruire à chaque publication/
  // commentaire affiché (renderMentions étant appelée une fois par bloc de
  // texte visible) était le point le plus coûteux du fil sur une grosse
  // association. Le flag "g" oblige à réinitialiser lastIndex avant chaque
  // utilisation (voir renderMentions ci-dessous), puisque c'est maintenant
  // le MÊME objet regex réutilisé pour tous les textes d'un même rendu.
  const mentionRegex = React.useMemo(() => {
    const names = members.map((m) => m.nom).filter(Boolean).sort((a, b) => b.length - a.length);
    if (names.length === 0) return null;
    const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(`@(${escaped.join("|")})(?![\\p{L}\\p{N}])`, "gu");
  }, [members]);

  // Rendu du contenu d'une publication/commentaire avec les mentions
  // "@Nom Complet" mises en évidence (2026-09-29). Reconnaît les noms EXACTS
  // de l'annuaire.
  function renderMentions(text) {
    if (!text || !mentionRegex) return text;
    mentionRegex.lastIndex = 0;
    const parts = [];
    let last = 0, m, key = 0;
    while ((m = mentionRegex.exec(text))) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      parts.push(
        <span key={`men-${key++}`} style={{ color: "var(--primary)", fontWeight: 700, background: "rgba(31,56,100,.08)", borderRadius: 4, padding: "0 3px" }}>
          @{m[1]}
        </span>
      );
      last = mentionRegex.lastIndex;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  // ---------- Fil d'actualité (style clavardage / réseau social) ----------
  // Suite 58 (2026-09-11) : ouvert à tous les adhérents (plus seulement
  // le Bureau), images sur publications + commentaires, réactions
  // rapides et commentaires — voir sql/2026-09-11g_fil_actualite_interactif.sql.
  // Suite « refonte réseau social » (2026-09-29) : réactions enrichies,
  // publications épinglées, sondages intégrés, mentions — voir
  // sql/2026-09-29_vieassociative_reseau_social.sql.
  // Brouillon sauvegardé automatiquement (2026-09-29, 4e vague) : purement
  // côté client (localStorage), pour ne rien perdre si l'onglet se ferme ou
  // se recharge avant l'envoi — jamais synchronisé entre appareils.
  const draftKey = `va_draft_${profile.id}`;
  const [newPost, setNewPost] = useState(() => {
    try { return localStorage.getItem(draftKey) || ""; } catch { return ""; }
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (newPost.trim()) localStorage.setItem(draftKey, newPost);
        else localStorage.removeItem(draftKey);
      } catch { /* stockage indisponible (navigation privée, quota...) : on ignore */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [newPost, draftKey]);
  const [newPostImage, setNewPostImage] = useState("");
  const [uploadingPostImage, setUploadingPostImage] = useState(false);
  // Album photo (2026-09-29, 3e vague) : jusqu'à 6 images par publication.
  // newPostImage (ci-dessus) reste utilisée pour la 1re image sélectionnée,
  // par simplicité avec le code existant (aperçu, etc.) ; newPostImages
  // porte les images SUPPLÉMENTAIRES (2e à 6e) — voir publishPost().
  const [newPostImages, setNewPostImages] = useState([]);
  const [scheduledDate, setScheduledDate] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [hoveredPostId, setHoveredPostId] = useState(null);
  const [reactionPickerFor, setReactionPickerFor] = useState(null);
  const [pollDraft, setPollDraft] = useState(null);
  const [mentionQuery, setMentionQuery] = useState(null);
  // Partage / republication (2026-09-29, 3e vague) : publication d'origine
  // en cours de partage (avec commentaire optionnel dans newPost).
  const [repostTarget, setRepostTarget] = useState(null);
  // Publication → événement en un clic (2026-09-29, 4e vague) : réservé au
  // Bureau, exactement comme la création d'événement dans Evenements.jsx
  // (policy RLS "events insert" : and is_bureau()) — volontairement limité
  // aux événements gratuits (pas de champ prix ici), le tarif/paiement en
  // ligne restant géré uniquement depuis l'onglet Événements.
  const [eventComposerOpen, setEventComposerOpen] = useState(false);
  const [eventDraft, setEventDraft] = useState({ titre: "", date_debut: "", lieu: "", capacite_max: "" });
  const feedEndRef = useRef(null);
  const postImageInputRef = useRef(null);
  const postInputRef = useRef(null);

  // ---------- Statuts du jour ("stories" 24h, 2026-09-29, 3e vague) ----------
  const [statusComposerOpen, setStatusComposerOpen] = useState(false);
  const [statusComposerText, setStatusComposerText] = useState("");
  const [statusComposerImage, setStatusComposerImage] = useState("");
  const [uploadingStatusImage, setUploadingStatusImage] = useState(false);
  const [viewingStatusGroup, setViewingStatusGroup] = useState(null); // { memberKey, index }
  const statusImageInputRef = useRef(null);

  // Groupées par auteur (le plus récent en premier au sein d'un groupe),
  // ma propre bulle toujours en premier dans la barre.
  const statusGroups = React.useMemo(() => {
    const byMember = {};
    for (const s of statuses) {
      const key = s.member_profile_id;
      if (!byMember[key]) byMember[key] = [];
      byMember[key].push(s);
    }
    Object.values(byMember).forEach((arr) => arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
    const entries = Object.entries(byMember).map(([key, items]) => ({ key, items }));
    entries.sort((a, b) => {
      if (a.key === profile.id) return -1;
      if (b.key === profile.id) return 1;
      return new Date(b.items[b.items.length - 1].created_at) - new Date(a.items[a.items.length - 1].created_at);
    });
    return entries;
  }, [statuses, profile.id]);

  async function addStatus() {
    if (!statusComposerText.trim() && !statusComposerImage) return;
    const { data, error } = await supabase.from("member_statuses").insert({
      association_id: profile.association_id, member_profile_id: profile.id, auteur_nom: profile.nom_complet,
      type: statusComposerImage ? "image" : "texte",
      contenu: statusComposerText.trim() || null,
      image_url: statusComposerImage || null,
    }).select().single();
    if (error) { alert(friendlyError(error, t)); return; }
    setStatuses((prev) => [...prev, data]);
    setStatusComposerText(""); setStatusComposerImage(""); setStatusComposerOpen(false);
  }

  async function deleteStatus(statusId) {
    const { error } = await supabase.from("member_statuses").delete().eq("id", statusId);
    if (error) { alert(friendlyError(error, t)); return; }
    setStatuses((prev) => prev.filter((s) => s.id !== statusId));
    setViewingStatusGroup(null);
  }

  function markStatusViewed(status) {
    if (status.member_profile_id === profile.id) return;
    if (statusViews.some((v) => v.status_id === status.id && v.viewer_profile_id === profile.id)) return;
    const row = { status_id: status.id, association_id: profile.association_id, viewer_profile_id: profile.id, viewer_nom: profile.nom_complet };
    setStatusViews((prev) => [...prev, { ...row, id: `local-${status.id}`, viewed_at: new Date().toISOString() }]);
    supabase.from("status_views").upsert(row, { onConflict: "status_id,viewer_profile_id", ignoreDuplicates: true });
  }

  // ---------- Indicateur « en train d'écrire… » (2026-09-29, 3e vague) ----------
  // Supabase Realtime (presence) — jamais utilisé ailleurs dans cette appli.
  // Écrit défensivement : si Realtime n'est pas activé sur le projet, le
  // canal échoue silencieusement (voir status !== "SUBSCRIBED" ci-dessous)
  // et le reste du fil continue de fonctionner normalement, simplement sans
  // cet indicateur.
  const [typingUsers, setTypingUsers] = useState([]);
  const typingChannelRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  useEffect(() => {
    let channel;
    try {
      channel = supabase.channel(`va-typing-${profile.association_id}`, { config: { presence: { key: profile.id } } });
      channel.on("presence", { event: "sync" }, () => {
        try {
          const state = channel.presenceState();
          const names = Object.entries(state)
            .filter(([key]) => key !== profile.id)
            .flatMap(([, metas]) => metas)
            .filter((m) => m?.typing)
            .map((m) => m.nom);
          setTypingUsers([...new Set(names)]);
        } catch {
          // Realtime indisponible ou format inattendu : on ignore.
        }
      });
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          typingChannelRef.current = channel;
          try { await channel.track({ nom: profile.nom_complet, typing: false }); } catch { /* ignore */ }
        }
      });
    } catch {
      // Realtime non disponible sur ce projet : l'indicateur reste
      // simplement inactif, sans casser le reste du fil d'actualité.
    }
    return () => {
      typingChannelRef.current = null;
      if (channel) supabase.removeChannel(channel);
    };
  }, [profile.association_id, profile.id, profile.nom_complet]);

  function signalTyping() {
    const channel = typingChannelRef.current;
    if (!channel) return;
    channel.track({ nom: profile.nom_complet, typing: true }).catch(() => {});
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      channel.track({ nom: profile.nom_complet, typing: false }).catch(() => {});
    }, 3000);
  }
  function clearTyping() {
    const channel = typingChannelRef.current;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (channel) channel.track({ nom: profile.nom_complet, typing: false }).catch(() => {});
  }

  // Réutilise le bucket "avatars" (déjà public/non cloisonné, même choix
  // que pour les annonces en suite 57), sous posts/<association_id>/...
  async function uploadFeedImage(file, subfolder = "") {
    if (!file) return null;
    const path = `posts/${profile.association_id}/${subfolder}${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (error) { alert("Erreur de téléversement : " + friendlyError(error, t)); return null; }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    return data.publicUrl;
  }

  // ---------- Vidéo + message vocal (suite 59, 2026-09-11) ----------
  // Fichiers plus volumineux que les images : bucket dédié "posts-media"
  // (limite de taille définie côté base de données, voir
  // sql/2026-09-11h_fil_actualite_voix_video.sql), même convention de
  // chemin que uploadFeedImage. "key" identifie où va la pièce jointe :
  // "__post__" pour la publication principale, sinon l'id de la
  // publication commentée — ce même "key" sert aussi pour l'enregistrement
  // vocal en cours (une seule personne ne peut enregistrer qu'à un
  // endroit à la fois).
  const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
  const MAX_VOICE_SECONDS = 120;
  const [videoByKey, setVideoByKey] = useState({});
  const [uploadingVideoKey, setUploadingVideoKey] = useState(null);
  const [audioByKey, setAudioByKey] = useState({});
  const [uploadingAudioKey, setUploadingAudioKey] = useState(null);
  const [recordingKey, setRecordingKey] = useState(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingSecondsRef = useRef(0);
  const recordingTimerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const mediaStreamRef = useRef(null);
  const postVideoInputRef = useRef(null);
  const commentVideoInputRef = useRef(null);
  const commentVideoTargetRef = useRef(null);

  async function uploadFeedMedia(file, subfolder = "") {
    if (!file) return null;
    const path = `${profile.association_id}/${subfolder}${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("posts-media").upload(path, file, { upsert: true });
    if (error) { alert("Erreur de téléversement : " + friendlyError(error, t)); return null; }
    const { data } = supabase.storage.from("posts-media").getPublicUrl(path);
    return data.publicUrl;
  }

  function clearAttachment(setMap, key) {
    setMap((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }

  async function handleVideoSelected(file, key) {
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) { alert(t("va_video_too_large")); return; }
    setUploadingVideoKey(key);
    const url = await uploadFeedMedia(file, key === "__post__" ? "" : "comments/");
    setUploadingVideoKey(null);
    if (url) setVideoByKey((prev) => ({ ...prev, [key]: url }));
  }

  async function startRecording(key) {
    if (recordingKey) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        mediaStreamRef.current?.getTracks().forEach((tr) => tr.stop());
        mediaStreamRef.current = null;
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" });
        const duration = recordingSecondsRef.current;
        const ext = (mr.mimeType || "audio/webm").includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: blob.type });
        setUploadingAudioKey(key);
        const url = await uploadFeedMedia(file, key === "__post__" ? "" : "comments/");
        setUploadingAudioKey(null);
        if (url) setAudioByKey((prev) => ({ ...prev, [key]: { url, duration } }));
      };
      mr.start();
      setRecordingKey(key);
      recordingSecondsRef.current = 0;
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingSeconds(recordingSecondsRef.current);
        if (recordingSecondsRef.current >= MAX_VOICE_SECONDS) stopRecording();
      }, 1000);
    } catch (err) {
      alert("Impossible d'accéder au microphone : " + err.message);
    }
  }

  function stopRecording() {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    mediaRecorderRef.current?.stop();
    setRecordingKey(null);
  }

  function cancelRecording() {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    mediaStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    mediaStreamRef.current = null;
    setRecordingKey(null);
  }

  function formatDuration(sec) {
    const s = Math.max(0, sec | 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // ---------- Mentions @adhérent (2026-09-29) ----------
  // Autocomplétion sur la barre de composition principale : dès qu'on tape
  // "@", propose les adhérents correspondants ; cliquer insère "@Nom
  // complet " dans le texte. Limite assumée : le nom complet doit être
  // choisi dans la liste (pas tapé à la main jusqu'au bout), sinon la
  // recherche s'arrête au premier espace.
  function handlePostInputChange(e) {
    const val = e.target.value;
    const pos = e.target.selectionStart ?? val.length;
    setNewPost(val);
    const uptoCaret = val.slice(0, pos);
    const m = /@([^\s@]{0,25})$/.exec(uptoCaret);
    setMentionQuery(m ? m[1] : null);
    if (val.trim()) signalTyping(); else clearTyping();
  }
  // Zone de saisie extensible (2026-09-29) : la barre de composition s'agrandit
  // avec le texte saisi (jusqu'à une hauteur max, au-delà de laquelle elle
  // défile) au lieu de rester une ligne étroite qui cache le message.
  useEffect(() => {
    const el = postInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [newPost]);
  const mentionSuggestions = mentionQuery !== null
    ? members.filter((m) => foldText(m.nom).includes(foldText(mentionQuery))).slice(0, 6)
    : [];
  function insertMention(member) {
    const el = postInputRef.current;
    const pos = el ? (el.selectionStart ?? newPost.length) : newPost.length;
    const before = newPost.slice(0, pos);
    const after = newPost.slice(pos);
    const replacedBefore = before.replace(/@([^\s@]{0,25})$/, `@${member.nom} `);
    setNewPost(replacedBefore + after);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      const p2 = replacedBefore.length;
      el?.setSelectionRange(p2, p2);
    });
  }

 async function publishPost() {
    const video_url = videoByKey["__post__"] || null;
    const audio = audioByKey["__post__"];
    const pollOptsDraft = pollDraft ? pollDraft.options.map((o) => o.trim()).filter(Boolean) : [];
    const hasPoll = !!(pollDraft && pollDraft.question.trim() && pollOptsDraft.length >= 2);
    // Publication → événement (2026-09-29, 4e vague) : un événement lié peut
    // porter la publication à lui seul, même sans texte propre — comme un
    // partage/republication.
    const hasEvent = isBureau && eventComposerOpen && eventDraft.titre.trim() && eventDraft.date_debut;
    if (!repostTarget && !hasEvent && !newPost.trim() && !newPostImage && !video_url && !audio && !hasPoll) return;
    let linkedEventId = null;
    if (hasEvent) {
      const { data: newEv, error: evErr } = await supabase.from("events").insert({
        association_id: profile.association_id, titre: eventDraft.titre.trim(),
        description: newPost.trim() || null, lieu: eventDraft.lieu.trim() || null,
        date_debut: new Date(eventDraft.date_debut).toISOString(),
        capacite_max: eventDraft.capacite_max ? Number(eventDraft.capacite_max) : null,
        prix: 0,
      }).select().single();
      if (evErr) { alert(t("va_event_create_error") + " " + friendlyError(evErr, t)); return; }
      setEvents((prev) => [...prev, newEv]);
      linkedEventId = newEv.id;
    }
    const { data, error } = await supabase.from("posts").insert({
      association_id: profile.association_id, auteur_id: profile.id, auteur_nom: profile.nom_complet, contenu: newPost,
      image_url: newPostImage || null, video_url,
      audio_url: audio?.url || null, audio_duration: audio?.duration || null,
      date_publication: scheduledDate ? new Date(scheduledDate).toISOString() : new Date().toISOString(),
      reposted_from_id: repostTarget?.id || null,
      auteur_est_bureau: isBureau, event_id: linkedEventId,
    }).select().single();
    if (error) { alert(friendlyError(error, t)); return; }
    if (hasPoll) {
      const { data: poll, error: pollErr } = await supabase.from("post_polls").insert({
        post_id: data.id, association_id: profile.association_id, question: pollDraft.question.trim(),
      }).select().single();
      if (!pollErr && poll) {
        const { data: opts } = await supabase.from("post_poll_options").insert(
          pollOptsDraft.map((texte, position) => ({ poll_id: poll.id, association_id: profile.association_id, texte, position }))
        ).select();
        setPolls((prev) => [...prev, poll]);
        setPollOptions((prev) => [...prev, ...(opts || [])]);
      } else if (pollErr) {
        alert(friendlyError(pollErr, t));
      }
    }
    // Album photo (2026-09-29, 3e vague) : la 1re image est déjà sur
    // posts.image_url (ci-dessus, compatible avec l'existant) — les images
    // supplémentaires vont dans post_images.
    if (newPostImages.length > 0) {
      const { data: imgs, error: imgErr } = await supabase.from("post_images").insert(
        newPostImages.map((url, position) => ({ post_id: data.id, association_id: profile.association_id, url, position: position + 1 }))
      ).select();
      if (!imgErr) setPostImages((prev) => [...prev, ...(imgs || [])]);
    }
    setPosts((p) => [data, ...p].sort((a, b) => new Date(b.date_publication) - new Date(a.date_publication)));
    setNewPost(""); setNewPostImage(""); setNewPostImages([]);
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    clearAttachment(setVideoByKey, "__post__");
    clearAttachment(setAudioByKey, "__post__");
    setScheduledDate(""); setShowSchedule(false);
    setPollDraft(null);
    setRepostTarget(null);
    setEventComposerOpen(false);
    setEventDraft({ titre: "", date_debut: "", lieu: "", capacite_max: "" });
    clearTyping();
  }
  function handleComposerKeyDown(e) {
    if (mentionQuery !== null && mentionSuggestions.length > 0 && e.key === "Enter") { e.preventDefault(); insertMention(mentionSuggestions[0]); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); publishPost(); }
  }

  async function deletePost(postId) {
    if (!window.confirm(t("va_confirm_delete_post"))) return;
    const { error } = await supabase.from("posts").delete().eq("id", postId);
    if (error) { alert(friendlyError(error, t)); return; }
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }
  const [editingPost, setEditingPost] = useState(null);
  async function updatePost(postId, contenu, datePublication) {
    const { error } = await supabase.from("posts").update({ contenu, date_publication: datePublication }).eq("id", postId);
    if (error) { alert(friendlyError(error, t)); return; }
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, contenu, date_publication: datePublication } : p)));
    setEditingPost(null);
  }

  // ---------- Publications épinglées (2026-09-29, Bureau) ----------
  async function togglePin(postId, current) {
    const { error } = await supabase.from("posts").update({ epingle: !current }).eq("id", postId);
    if (error) { alert(friendlyError(error, t)); return; }
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, epingle: !current } : p)));
  }

  // ---------- RSVP sur un événement lié (2026-09-29, 4e vague) ----------
  // Même logique que rsvpToEvent() dans Evenements.jsx, reprise ici en
  // local (état eventRsvpsList) puisque ce fichier ne partage pas son état
  // avec ce module — volontairement limitée aux événements gratuits
  // (prix = 0, garanti par publishPost() ci-dessus qui crée toujours
  // l'événement avec prix: 0) : un événement payant devrait passer par le
  // parcours de paiement de l'onglet Événements, pas par ce raccourci.
  async function rsvpFeedEvent(eventId, statut) {
    if (!profile.member_id) return;
    const existing = eventRsvpsList.find((r) => r.event_id === eventId && r.member_id === profile.member_id);
    if (existing) {
      const { error } = await supabase.from("event_rsvps").update({ statut }).eq("id", existing.id);
      if (error) { alert(friendlyError(error, t)); return; }
      setEventRsvpsList((prev) => prev.map((r) => (r.id === existing.id ? { ...r, statut } : r)));
    } else {
      const { data, error } = await supabase.from("event_rsvps").insert({
        event_id: eventId, association_id: profile.association_id, member_id: profile.member_id, statut,
      }).select().single();
      if (error) { alert(friendlyError(error, t)); return; }
      setEventRsvpsList((prev) => [...prev, data]);
    }
  }

  // ---------- Sondage intégré à une publication (2026-09-29) ----------
  async function votePoll(pollId, optionId, closed) {
    if (closed) return;
    const mine = pollVotes.find((v) => v.poll_id === pollId && v.member_profile_id === profile.id);
    if (mine && mine.option_id === optionId) {
      const { error } = await supabase.from("post_poll_votes").delete().eq("id", mine.id);
      if (error) { alert(friendlyError(error, t)); return; }
      setPollVotes((prev) => prev.filter((v) => v.id !== mine.id));
      return;
    }
    if (mine) {
      const { data, error } = await supabase.from("post_poll_votes").update({ option_id: optionId }).eq("id", mine.id).select().single();
      if (error) { alert(friendlyError(error, t)); return; }
      setPollVotes((prev) => prev.map((v) => (v.id === mine.id ? data : v)));
      return;
    }
    const { data, error } = await supabase.from("post_poll_votes").insert({
      poll_id: pollId, option_id: optionId, association_id: profile.association_id, member_profile_id: profile.id,
    }).select().single();
    if (error) { alert(friendlyError(error, t)); return; }
    setPollVotes((prev) => [...prev, data]);
  }

  // ---------- Réactions (👍❤️😂😮😢🙏, 2026-09-29) ----------
  async function toggleReaction(postId, emoji) {
    const mine = reactions.find((r) => r.post_id === postId && r.member_profile_id === profile.id);
    if (mine && mine.emoji === emoji) {
      const { error } = await supabase.from("post_reactions").delete().eq("id", mine.id);
      if (error) { alert(friendlyError(error, t)); return; }
      setReactions((prev) => prev.filter((r) => r.id !== mine.id));
      return;
    }
    if (mine) {
      const { data, error } = await supabase.from("post_reactions").update({ emoji }).eq("id", mine.id).select().single();
      if (error) { alert(friendlyError(error, t)); return; }
      setReactions((prev) => prev.map((r) => (r.id === mine.id ? data : r)));
      return;
    }
    const { data, error } = await supabase.from("post_reactions").insert({
      post_id: postId, association_id: profile.association_id, member_profile_id: profile.id, emoji,
    }).select().single();
    if (error) { alert(friendlyError(error, t)); return; }
    setReactions((prev) => [...prev, data]);
  }

  // ---------- Bouton « signaler » (2026-09-29, 4e vague) ----------
  // Frictionless — aucune confirmation, cohérent avec le retrait des
  // confirmations décidé plus haut pour le fil : un seul clic suffit, le
  // bouton se transforme immédiatement (voir le rendu) pour donner une
  // confirmation visuelle sans bloquer l'interaction. Un adhérent ne peut
  // signaler qu'une fois le même contenu (index unique côté base de
  // données) ; les signalements ne sont visibles qu'au Bureau (post_flags,
  // voir sql v4) — pas de tableau de modération dédié pour ce MVP.
  function alreadyFlaggedByMe(postId, commentId) {
    return postFlags.some((f) => f.reporter_profile_id === profile.id && (postId ? f.post_id === postId : f.comment_id === commentId));
  }
  async function flagContent(postId, commentId) {
    if (alreadyFlaggedByMe(postId, commentId)) return;
    const row = {
      association_id: profile.association_id, post_id: postId || null, comment_id: commentId || null,
      reporter_profile_id: profile.id, reporter_nom: profile.nom_complet,
    };
    setPostFlags((prev) => [...prev, { ...row, id: `local-${postId || commentId}` }]);
    const { data, error } = await supabase.from("post_flags").insert(row).select().single();
    if (error) {
      // Repli silencieux si la migration v4 n'a pas encore été exécutée —
      // on retire l'entrée optimiste plutôt que d'afficher une erreur pour
      // une action secondaire.
      setPostFlags((prev) => prev.filter((f) => f.id !== `local-${postId || commentId}`));
      console.error(error);
      return;
    }
    setPostFlags((prev) => prev.map((f) => (f.id === `local-${postId || commentId}` ? data : f)));
  }

  // ---------- Commentaires ----------
  const [openComments, setOpenComments] = useState({});
  const [newCommentText, setNewCommentText] = useState({});
  const [newCommentImage, setNewCommentImage] = useState({});
  const [uploadingCommentImageFor, setUploadingCommentImageFor] = useState(null);
  const commentImageInputRef = useRef(null);
  const commentImageTargetRef = useRef(null);
  const commentInputRefs = useRef({});
  // ---------- Réponses aux commentaires (2026-09-29) ----------
  // Fil imbriqué sur un seul niveau (façon Instagram/Facebook) : répondre à
  // une réponse rattache quand même au commentaire d'origine (parent_comment_id
  // pointe toujours vers le commentaire "racine"), pour éviter une pile de
  // niveaux illisible sur un petit écran. { [postId]: { id, auteur_nom } | undefined }
  const [replyTarget, setReplyTarget] = useState({});
  function rootCommentId(c) {
    return c.parent_comment_id || c.id;
  }

  async function publishComment(postId) {
    const contenu = (newCommentText[postId] || "").trim();
    const image_url = newCommentImage[postId] || null;
    const video_url = videoByKey[postId] || null;
    const audio = audioByKey[postId];
    if (!contenu && !image_url && !video_url && !audio) return;
    const parent_comment_id = replyTarget[postId]?.id || null;
    const { data, error } = await supabase.from("post_comments").insert({
      post_id: postId, association_id: profile.association_id, auteur_id: profile.id,
      auteur_nom: profile.nom_complet, contenu, image_url, video_url,
      audio_url: audio?.url || null, audio_duration: audio?.duration || null,
      parent_comment_id,
    }).select().single();
    if (error) { alert(friendlyError(error, t)); return; }
    setComments((prev) => [...prev, data]);
    setNewCommentText((prev) => ({ ...prev, [postId]: "" }));
    setNewCommentImage((prev) => ({ ...prev, [postId]: "" }));
    clearAttachment(setVideoByKey, postId);
    clearAttachment(setAudioByKey, postId);
    setReplyTarget((prev) => ({ ...prev, [postId]: undefined }));
    const el = commentInputRefs.current[postId];
    if (el) el.style.height = "auto";
  }

  async function deleteComment(commentId) {
    if (!window.confirm(t("va_confirm_delete_comment"))) return;
    const { error } = await supabase.from("post_comments").delete().eq("id", commentId);
    if (error) { alert(friendlyError(error, t)); return; }
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  }

  // Messages visibles (le Bureau voit aussi les publications programmées à venir),
  // triés du plus ancien au plus récent pour un affichage façon clavardage.
  const orderedPosts = posts
    .filter((p) => isBureau || new Date(p.date_publication || p.created_at) <= new Date())
    .slice()
    .sort((a, b) => new Date(a.date_publication || a.created_at) - new Date(b.date_publication || b.created_at));

  const pinnedPosts = orderedPosts.filter((p) => p.epingle).slice().reverse();

  // Premier message non vu depuis la dernière visite (pour le repère
  // "Nouveau") — jamais mes propres publications. Identifié par id (et non
  // par index) pour rester correct même quand la liste affichée est filtrée
  // par la recherche/les filtres ci-dessous.
  const firstUnseenPost = feedLastViewedAt
    ? orderedPosts.find((p) => p.auteur_id !== profile.id && new Date(p.date_publication || p.created_at) > feedLastViewedAt)
    : null;
  const unseenCount = feedLastViewedAt
    ? orderedPosts.filter((p) => p.auteur_id !== profile.id && new Date(p.date_publication || p.created_at) > feedLastViewedAt).length
    : 0;

  // ---------- Recherche et filtres dans le fil (2026-09-29) ----------
  const [feedSearch, setFeedSearch] = useState("");
  const [feedFilter, setFeedFilter] = useState("all"); // all | poll | media | pinned
  const visiblePosts = orderedPosts.filter((p) => {
    if (feedFilter === "poll" && !polls.some((pl) => pl.post_id === p.id)) return false;
    if (feedFilter === "media" && !(p.image_url || p.video_url || p.audio_url)) return false;
    if (feedFilter === "pinned" && !p.epingle) return false;
    if (feedSearch.trim()) {
      const needle = foldText(feedSearch);
      const hay = foldText(`${p.contenu || ""} ${p.auteur_nom || ""}`);
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const feedIsFiltered = !!feedSearch.trim() || feedFilter !== "all";

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: "end" });
  }, [orderedPosts.length]);

  // Marque le statut actuellement affiché dans la visionneuse comme "vu"
  // (voir markStatusViewed plus haut) — effet plutôt qu'un appel pendant le
  // rendu, pour ne pas déclencher de mise à jour d'état en plein rendu.
  useEffect(() => {
    if (!viewingStatusGroup) return;
    const group = statusGroups.find((g) => g.key === viewingStatusGroup.memberKey);
    const status = group?.items[viewingStatusGroup.index];
    if (status) markStatusViewed(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingStatusGroup, statusGroups]);

  function dayLabel(dateVal) {
    const d = new Date(dateVal);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(d, today)) return t("va_day_today");
    if (sameDay(d, yesterday)) return t("va_day_yesterday");
    return d.toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA", { day: "numeric", month: "long", year: "numeric" });
  }

  if (loading) return <Container><Section><p>{t("loading")}</p></Section></Container>;

  return (
    <Container><Section>
      <h2 style={{ marginBottom: 6 }}>{t("nav_community")}</h2>
      <p style={{ fontSize: 12.5, color: "#8A93A6", marginBottom: 18 }}>{t("va_rubriques_intro")}</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* ---------- Rubrique : Anniversaires ---------- */}
        <div>
          <RubriqueHeader
            icon={Cake} label={t("va_birthdays_title")} count={upcomingBirthdays.length}
            open={!!openSections.anniv} onClick={() => toggleSection("anniv")}
          />
          <Collapsible open={!!openSections.anniv}>
            <div style={{ paddingTop: 14 }}>
              <Table head={[t("member"), t("va_col_birthdate"), t("va_col_days_until"), ...(isBureau ? [t("va_col_edit")] : [])]}>
                {upcomingBirthdays.map((m) => (
                  <tr key={m.id}>
                    <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>{m.nom}</td>
                    <td style={td}>{new Date(m.date_naissance).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA", { day: "numeric", month: "long" })}</td>
                    <td style={td}>{m.joursRestants === 0 ? t("va_today") : `${m.joursRestants} ${t("va_days_suffix")}`}</td>
                    {isBureau && <td style={td}><input type="date" defaultValue={m.date_naissance} onBlur={(e) => saveBirthday(m.id, e.target.value)} style={{ ...inputStyle, padding: "3px 6px", fontSize: 11 }} /></td>}
                  </tr>
                ))}
                {upcomingBirthdays.length === 0 && <tr><td colSpan={4} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("va_no_birthdate")}</td></tr>}
              </Table>
              {isBureau && members.some((m) => !m.date_naissance) && (
                <Card style={{ marginTop: 14, maxWidth: 460 }}>
                  <h4 style={{ fontSize: 13, marginBottom: 10 }}>{t("va_add_missing_birthdate")}</h4>
                  {members.filter((m) => !m.date_naissance).map((m) => (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 13 }}>{m.nom}</span>
                      <input type="date" onBlur={(e) => saveBirthday(m.id, e.target.value)} style={{ ...inputStyle, width: 150, padding: "4px 8px" }} />
                    </div>
                  ))}
                </Card>
              )}
            </div>
          </Collapsible>
        </div>

        {/* ---------- Rubrique : Annuaire ---------- */}
        <div>
          <RubriqueHeader
            icon={Users} label={t("va_directory_title")} count={members.length}
            open={!!openSections.annuaire} onClick={() => toggleSection("annuaire")}
          />
          <Collapsible open={!!openSections.annuaire}>
            <div style={{ paddingTop: 14 }}>
              <input style={{ ...inputStyle, maxWidth: 340, marginBottom: 14 }} placeholder={t("va_search_placeholder")} value={search} onChange={(e) => setSearch(e.target.value)} />
              <Table head={[t("va_col_photo"), t("va_col_name"), t("va_col_birthdate2"), t("va_col_joindate"), t("va_col_address"), t("va_col_skills"), t("va_col_volunteer")]}>
                {filteredMembers.map((m) => (
                  <tr key={m.id}>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div
                          style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--primary)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.15)", flexShrink: 0, cursor: m.photo_url ? "pointer" : "default" }}
                          onClick={() => m.photo_url && setLightboxUrl(m.photo_url)}
                        >
                          {m.photo_url ? <img src={m.photo_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(m.nom)}
                        </div>
                        {isBureau && (
                          <div style={{ position: "relative" }}>
                            <button
                              onClick={(e) => {
                                if (photoMenuId === m.id) { setPhotoMenuId(null); return; }
                                const rect = e.currentTarget.getBoundingClientRect();
                                setPhotoMenuPos({ top: rect.bottom + 4, left: rect.left });
                                setPhotoMenuId(m.id);
                              }}
                              title={t("va_photo_options")}
                              style={{ width: 22, height: 22, borderRadius: "50%", background: photoMenuId === m.id ? "#F0F0F0" : "none", border: "none", color: "#686F7D", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }}
                            >
                              <MoreVertical size={15} />
                            </button>
                            {photoMenuId === m.id && createPortal(
                              <>
                                {/* Rendu via portail (document.body) : le tableau ci-dessus a un overflow
                                    (défilement horizontal) qui, en CSS, force aussi le clipping vertical —
                                    sans portail, ce menu était coupé/invisible sur la dernière ligne du tableau. */}
                                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 2000 }} onClick={() => setPhotoMenuId(null)} />
                                <div style={{ position: "fixed", top: photoMenuPos.top, left: photoMenuPos.left, background: "white", borderRadius: 8, boxShadow: "0 4px 18px rgba(31,56,100,0.18)", minWidth: 190, zIndex: 2001, overflow: "hidden", border: "1px solid #EEE" }}>
                                  {m.photo_url && (
                                    <button onClick={() => { setLightboxUrl(m.photo_url); setPhotoMenuId(null); }} style={photoMenuItemStyle}>
                                      <Maximize2 size={13} /> {t("va_view_photo")}
                                    </button>
                                  )}
                                  <button onClick={() => { setUploadTargetId(m.id); setPhotoMenuId(null); fileInputRef.current?.click(); }} style={photoMenuItemStyle}>
                                    <Upload size={13} /> {m.photo_url ? t("va_change_photo") : t("va_add_photo")}
                                  </button>
                                  {m.photo_url && (
                                    <button
                                      onClick={() => { setPhotoMenuId(null); if (window.confirm(t("va_confirm_remove_photo"))) removePhoto(m.id); }}
                                      style={{ ...photoMenuItemStyle, color: RED }}
                                    >
                                      <Trash2 size={13} /> {t("va_remove_photo")}
                                    </button>
                                  )}
                                </div>
                              </>,
                              document.body
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>{m.nom}</td>
                    <td style={td}>{m.date_naissance || "—"}</td>
                    <td style={td}>{m.date_adhesion || "—"}</td>
                    {isBureau ? (
                      <>
                        <td style={td}><input style={{ ...inputStyle, fontSize: 11.5, padding: "4px 6px" }} placeholder={t("va_address_placeholder")} defaultValue={m.quartier || ""} onBlur={(e) => updateDirectoryField(m.id, "quartier", e.target.value)} /></td>
                        <td style={td}><input style={{ ...inputStyle, fontSize: 11.5, padding: "4px 6px" }} placeholder={t("va_skills_placeholder")} defaultValue={m.competences || ""} onBlur={(e) => updateDirectoryField(m.id, "competences", e.target.value)} /></td>
                      </>
                    ) : (
                      <>
                        <td style={td}>{m.quartier || "—"}</td>
                        <td style={td}>{m.competences || t("va_skills_not_provided")}</td>
                      </>
                    )}
                    {/* Non modifiable ici, quel que soit le rôle : reflète simplement l'enregistrement
                        existant. La modification se fait via "Modifier l'adhérent" dans l'onglet Adhérents. */}
                    <td style={td}><input type="checkbox" checked={!!m.disponible_benevolat} disabled readOnly /></td>
                  </tr>
                ))}
              </Table>
              <input
                type="file" accept="image/*" ref={fileInputRef} style={{ display: "none" }}
                onChange={(e) => { const file = e.target.files?.[0]; if (uploadTargetId && file) uploadPhoto(uploadTargetId, file); e.target.value = ""; }}
              />
            </div>
          </Collapsible>
        </div>

        {/* ---------- Rubrique : Fil d'actualité ---------- */}
        <div>
          <RubriqueHeader
            icon={MessageCircle} label={t("va_feed_title")} count={orderedPosts.length} alert={unseenCount}
            open={!!openSections.fil} onClick={() => toggleSection("fil")}
          />
          <Collapsible open={!!openSections.fil}>
            <div style={{ paddingTop: 14 }}>
              {feedLoading && !feedLoaded ? (
                <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13, textAlign: "center", margin: "20px 0" }}>{t("loading")}</p>
              ) : (
              <div style={{ background: "white", borderRadius: 14, boxShadow: "0 6px 24px rgba(31,56,100,0.12)", border: "1px solid rgba(31,56,100,0.06)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {/* Anniversaires intégrés au fil (2026-09-29, 4e vague) — bandeau visible
                    de tous, tant qu'au moins un membre a son anniversaire aujourd'hui. */}
                {birthdayMembersToday.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px", background: "linear-gradient(135deg, #FFF3E0, #FFF8EC)", borderBottom: "1px solid #F3E7D2" }}>
                    {birthdayMembersToday.map((m) => (
                      <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#8A6D3B" }}>
                        <PartyPopper size={15} style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{t("va_birthday_today_banner").replace("{nom}", m.nom)}</span>
                        <button
                          onClick={() => wishBirthday(m)}
                          style={{ fontSize: 11, fontWeight: 700, color: "white", background: "#D6A03B", border: "none", borderRadius: 999, padding: "4px 11px", cursor: "pointer", flexShrink: 0 }}
                        >
                          {t("va_birthday_wish_btn")}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Statuts du jour (2026-09-29, 3e vague) — bandeau de bulles façon
                    "stories", visibles 24h. Ma bulle "+" toujours en premier. */}
                <div style={{ display: "flex", gap: 12, overflowX: "auto", padding: "12px 14px", borderBottom: "1px solid rgba(31,56,100,0.06)" }}>
                  {(() => {
                    const mine = statusGroups.find((g) => g.key === profile.id);
                    return (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0, cursor: "pointer" }} onClick={() => (mine ? setViewingStatusGroup({ memberKey: profile.id, index: 0 }) : setStatusComposerOpen(true))}>
                        <div style={{ position: "relative", width: 48, height: 48 }}>
                          {mine ? (
                            <div style={{ width: 48, height: 48, borderRadius: "50%", padding: 2, background: "linear-gradient(135deg, var(--accent), var(--primary))" }}>
                              <div style={{ width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden", border: "2px solid white", background: "#EEE" }}>
                                <FeedAvatar photoUrl={meMember?.photo_url} name={profile?.nom_complet || t("va_a_member")} size={42} fontSize={13} />
                              </div>
                            </div>
                          ) : (
                            <FeedAvatar photoUrl={meMember?.photo_url} name={profile?.nom_complet || t("va_a_member")} size={48} fontSize={15} />
                          )}
                          <div onClick={(e) => { e.stopPropagation(); setStatusComposerOpen(true); }} style={{ position: "absolute", bottom: -2, right: -2, width: 18, height: 18, borderRadius: "50%", background: "var(--primary)", border: "2px solid white", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Plus size={11} />
                          </div>
                        </div>
                        <span style={{ fontSize: 9.5, color: "#8A93A6", maxWidth: 54, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mine ? t("va_status_mine") : t("va_status_add")}</span>
                      </div>
                    );
                  })()}
                  {statusGroups.filter((g) => g.key !== profile.id).map((g) => {
                    const last = g.items[g.items.length - 1];
                    const allSeen = g.items.every((s) => statusViews.some((v) => v.status_id === s.id && v.viewer_profile_id === profile.id));
                    return (
                      <div key={g.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0, cursor: "pointer" }} onClick={() => setViewingStatusGroup({ memberKey: g.key, index: 0 })}>
                        <div style={{ width: 48, height: 48, borderRadius: "50%", padding: 2, background: allSeen ? "#DADFE5" : "linear-gradient(135deg, var(--accent), var(--primary))" }}>
                          <div style={{ width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden", border: "2px solid white", background: "#EEE" }}>
                            {last.type === "image" && last.image_url ? (
                              <img src={last.image_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                              <FeedAvatar photoUrl={memberByName(last.auteur_nom)?.photo_url} name={last.auteur_nom || t("va_a_member")} size={42} fontSize={13} />
                            )}
                          </div>
                        </div>
                        <span style={{ fontSize: 9.5, color: "#5A6270", maxWidth: 54, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(last.auteur_nom || t("va_a_member")).split(" ")[0]}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid rgba(31,56,100,0.06)", flexWrap: "wrap" }}>
                  <div style={{ position: "relative", flex: "1 1 180px", minWidth: 140 }}>
                    <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#AAB2BE", pointerEvents: "none" }} />
                    <input
                      style={{ ...inputStyle, padding: "6px 10px 6px 30px", fontSize: 12.5, width: "100%", boxSizing: "border-box" }}
                      placeholder={t("va_feed_search_placeholder")}
                      value={feedSearch}
                      onChange={(e) => setFeedSearch(e.target.value)}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {[
                      ["all", t("va_feed_filter_all")],
                      ["poll", t("va_feed_filter_poll")],
                      ["media", t("va_feed_filter_media")],
                      ["pinned", t("va_feed_filter_pinned")],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setFeedFilter(key)}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: "5px 11px", borderRadius: 999, cursor: "pointer",
                          border: feedFilter === key ? "1px solid var(--primary)" : "1px solid #E1E5EA",
                          background: feedFilter === key ? "var(--primary)" : "white",
                          color: feedFilter === key ? "white" : "#5A6270",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {pinnedPosts.length > 0 && (
                  <div style={{ padding: "8px 16px", background: "#FFF8EE", borderBottom: "1px solid #F3E7D2", display: "flex", flexDirection: "column", gap: 4 }}>
                    {pinnedPosts.slice(0, 2).map((pp) => (
                      <div key={pp.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#8A6D3B" }}>
                        <Pin size={11} style={{ flexShrink: 0 }} />
                        <span style={{ fontWeight: 700 }}>{pp.auteur_nom || t("va_a_member")} :</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{pp.contenu || t("va_pinned_media_fallback")}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div
                  className="va-feed-wall"
                  style={{
                    maxHeight: 480,
                    overflowY: "auto",
                    padding: "18px 18px 6px",
                    background: `
                      radial-gradient(circle at 10% 4%, color-mix(in srgb, var(--accent) 22%, transparent) 0%, transparent 42%),
                      radial-gradient(circle at 92% 96%, color-mix(in srgb, var(--primary) 16%, transparent) 0%, transparent 46%),
                      radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--accent) 7%, transparent) 0%, transparent 65%),
                      linear-gradient(160deg, #FAFCFB 0%, #F1F5F3 55%, #E9EFEC 100%)
                    `,
                    backgroundBlendMode: "normal",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {visiblePosts.length === 0 && (
                    <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13, textAlign: "center", margin: "30px 0" }}>
                      {feedIsFiltered ? t("va_feed_no_results") : t("va_feed_empty")}
                    </p>
                  )}
                  {visiblePosts.map((p, idx) => {
                    const isMine = p.auteur_id === profile.id;
                    const isFuture = new Date(p.date_publication || p.created_at) > new Date();
                    const isEditing = editingPost === p.id;
                    const prevPost = visiblePosts[idx - 1];
                    const showDayDivider = !prevPost || new Date(prevPost.date_publication || prevPost.created_at).toDateString() !== new Date(p.date_publication || p.created_at).toDateString();
                    const showUnseenDivider = !!firstUnseenPost && p.id === firstUnseenPost.id;
                    const postPoll = polls.find((pl) => pl.post_id === p.id);
                    const postPollOptions = postPoll ? pollOptions.filter((o) => o.poll_id === postPoll.id).sort((a, b) => a.position - b.position) : [];
                    const postPollVotes = postPoll ? pollVotes.filter((v) => v.poll_id === postPoll.id) : [];
                    const myPollVote = postPoll ? postPollVotes.find((v) => v.member_profile_id === profile.id) : null;
                    // Album photo (2026-09-29, 3e vague) : posts.image_url + post_images.
                    const albumUrls = [
                      ...(p.image_url ? [p.image_url] : []),
                      ...postImages.filter((im) => im.post_id === p.id).sort((a, b) => a.position - b.position).map((im) => im.url),
                    ];
                    // Partage / republication (2026-09-29, 3e vague).
                    const repostedPost = p.reposted_from_id ? posts.find((op) => op.id === p.reposted_from_id) : null;
                    // Publication → événement (2026-09-29, 4e vague).
                    const postEvent = p.event_id ? events.find((ev) => ev.id === p.event_id) : null;
                    const postEventConfirmed = postEvent ? eventRsvpsList.filter((r) => r.event_id === postEvent.id && r.statut === "confirme").length : 0;
                    const myEventRsvp = postEvent ? eventRsvpsList.find((r) => r.event_id === postEvent.id && r.member_id === profile.member_id) : null;
                    // Signalements (2026-09-29, 4e vague) — visibles au Bureau uniquement.
                    const postFlagCount = postFlags.filter((f) => f.post_id === p.id).length;
                    const iFlaggedThisPost = alreadyFlaggedByMe(p.id, null);
                    return (
                      <React.Fragment key={p.id}>
                        {showDayDivider && (
                          <div style={{ textAlign: "center", margin: "10px 0" }}>
                            <span style={{ fontSize: 10.5, background: "white", color: "#888", padding: "3px 12px", borderRadius: 999, fontWeight: 600, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>{dayLabel(p.date_publication || p.created_at)}</span>
                          </div>
                        )}
                        {showUnseenDivider && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 6px" }}>
                            <div style={{ flex: 1, height: 1, background: "var(--accent)" }} />
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: 0.4 }}>{t("va_new_divider")}</span>
                            <div style={{ flex: 1, height: 1, background: "var(--accent)" }} />
                          </div>
                        )}
                        <div
                          style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start", alignItems: "flex-end", gap: 8 }}
                          onMouseEnter={() => setHoveredPostId(p.id)}
                          onMouseLeave={() => setHoveredPostId((h) => (h === p.id ? null : h))}
                        >
                          {!isMine && (
                            <div style={{ cursor: memberByName(p.auteur_nom) ? "pointer" : "default" }} onClick={() => memberByName(p.auteur_nom) && setViewingMemberProfile(memberByName(p.auteur_nom).id)}>
                              <FeedAvatar photoUrl={memberByName(p.auteur_nom)?.photo_url} name={p.auteur_nom || t("va_a_member")} size={26} fontSize={10} />
                            </div>
                          )}
                          <div style={{ maxWidth: "76%" }}>
                            {!isMine && (
                              <div
                                style={{ fontSize: 10.5, fontWeight: 700, color: "var(--primary)", marginBottom: 2, marginLeft: 4, display: "flex", alignItems: "center", gap: 4, cursor: memberByName(p.auteur_nom) ? "pointer" : "default" }}
                                onClick={() => memberByName(p.auteur_nom) && setViewingMemberProfile(memberByName(p.auteur_nom).id)}
                              >
                                {p.auteur_nom || t("va_a_member")}
                                {p.auteur_est_bureau && <BureauBadge t={t} />}
                              </div>
                            )}
                            {isEditing ? (
                              <div style={{ background: "white", borderRadius: 14, padding: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }}>
                                <EditPostForm post={p} onSave={updatePost} onCancel={() => setEditingPost(null)} t={t} inputStyle={inputStyle} isBureau={isBureau} />
                              </div>
                            ) : (() => {
                              const hasWideMedia = albumUrls.length > 0 || p.video_url;
                              return (
                              <div style={{
                                background: isMine ? "var(--primary)" : "white",
                                color: isMine ? "white" : "#333",
                                padding: hasWideMedia ? 6 : "9px 13px",
                                borderRadius: isMine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                                fontSize: 13.5, lineHeight: 1.5, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", wordBreak: "break-word",
                              }}>
                                {p.epingle && (
                                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9.5, fontWeight: 700, opacity: 0.8, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 }}>
                                    <Pin size={10} /> {t("va_pinned_label")}
                                  </div>
                                )}
                                {p.reposted_from_id && (
                                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9.5, fontWeight: 700, opacity: 0.8, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 }}>
                                    <Repeat2 size={11} /> {t("va_reposted_label")}
                                  </div>
                                )}
                                {albumUrls.length === 1 && (
                                  <img
                                    src={albumUrls[0]} alt="" loading="lazy" onClick={() => setLightboxUrl(albumUrls[0])}
                                    style={{ display: "block", width: "100%", maxHeight: 260, objectFit: "cover", borderRadius: 12, cursor: "pointer", marginBottom: (p.contenu || p.video_url || p.audio_url || postPoll) ? 6 : 0 }}
                                  />
                                )}
                                {albumUrls.length > 1 && (
                                  <div style={{
                                    display: "grid",
                                    gridTemplateColumns: albumUrls.length === 2 ? "1fr 1fr" : "1fr 1fr 1fr",
                                    gap: 3, marginBottom: (p.contenu || p.video_url || p.audio_url || postPoll) ? 6 : 0,
                                  }}>
                                    {albumUrls.slice(0, 6).map((url, i) => (
                                      <div key={url + i} style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 8, overflow: "hidden", cursor: "pointer" }} onClick={() => setLightboxUrl(url)}>
                                        <img src={url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                        {i === 5 && albumUrls.length > 6 && (
                                          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700 }}>
                                            +{albumUrls.length - 6}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {p.video_url && (
                                  <video
                                    src={p.video_url} controls
                                    style={{ display: "block", width: "100%", maxHeight: 260, borderRadius: 12, background: "#000", marginBottom: (p.contenu || p.audio_url || postPoll) ? 6 : 0 }}
                                  />
                                )}
                                {p.audio_url && (
                                  <audio src={p.audio_url} controls style={{ display: "block", width: 220, maxWidth: "100%", marginBottom: (p.contenu || postPoll) ? 6 : 0 }} />
                                )}
                                {p.contenu && <div style={hasWideMedia ? { padding: "0 6px" } : undefined}>{renderMentions(p.contenu)}</div>}
                                {p.reposted_from_id && (
                                  <div style={{
                                    marginTop: p.contenu ? 6 : 0, border: `1px solid ${isMine ? "rgba(255,255,255,.3)" : "#E1E5EC"}`, borderRadius: 10, padding: 8,
                                    background: isMine ? "rgba(255,255,255,.08)" : "#FAFBFC",
                                  }}>
                                    {repostedPost ? (
                                      <>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                          <FeedAvatar photoUrl={memberByName(repostedPost.auteur_nom)?.photo_url} name={repostedPost.auteur_nom || t("va_a_member")} size={18} fontSize={7.5} />
                                          <span style={{ fontSize: 10.5, fontWeight: 700 }}>{repostedPost.auteur_nom || t("va_a_member")}</span>
                                          {repostedPost.auteur_est_bureau && <BureauBadge t={t} />}
                                        </div>
                                        {repostedPost.image_url && (
                                          <img src={repostedPost.image_url} alt="" loading="lazy" onClick={() => setLightboxUrl(repostedPost.image_url)} style={{ display: "block", width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 8, cursor: "pointer", marginBottom: repostedPost.contenu ? 4 : 0 }} />
                                        )}
                                        {repostedPost.contenu && <div style={{ fontSize: 12, opacity: 0.9 }}>{renderMentions(repostedPost.contenu)}</div>}
                                      </>
                                    ) : (
                                      <div style={{ fontSize: 11.5, fontStyle: "italic", opacity: 0.7 }}>{t("va_reposted_unavailable")}</div>
                                    )}
                                  </div>
                                )}
                                {postEvent && (
                                  <div style={{
                                    marginTop: p.contenu ? 8 : 0, borderRadius: 10, padding: 10,
                                    background: isMine ? "rgba(255,255,255,.12)" : "#F4F7F6",
                                  }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                                      <Calendar size={12} /> {postEvent.titre}
                                    </div>
                                    <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 2 }}>
                                      {new Date(postEvent.date_debut).toLocaleString(lang === "en" ? "en-CA" : "fr-CA", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                                    </div>
                                    {postEvent.lieu && (
                                      <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                                        <MapPin size={10} /> {postEvent.lieu}
                                      </div>
                                    )}
                                    <div style={{ fontSize: 10.5, opacity: 0.75, marginBottom: 6 }}>
                                      {t("va_event_rsvp_count").replace("{n}", postEventConfirmed)}
                                      {postEvent.capacite_max ? ` / ${postEvent.capacite_max}` : ""}
                                    </div>
                                    <div style={{ display: "flex", gap: 6 }}>
                                      <button
                                        onClick={() => rsvpFeedEvent(postEvent.id, "confirme")}
                                        style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "4px 11px", cursor: "pointer", border: `1px solid ${myEventRsvp?.statut === "confirme" ? TEAL : "#CCC"}`, background: myEventRsvp?.statut === "confirme" ? TEAL : "white", color: myEventRsvp?.statut === "confirme" ? "white" : "#666" }}
                                      >
                                        {t("va_event_rsvp_yes")}
                                      </button>
                                      <button
                                        onClick={() => rsvpFeedEvent(postEvent.id, "decline")}
                                        style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "4px 11px", cursor: "pointer", border: `1px solid ${myEventRsvp?.statut === "decline" ? RED : "#CCC"}`, background: myEventRsvp?.statut === "decline" ? RED : "white", color: myEventRsvp?.statut === "decline" ? "white" : "#666" }}
                                      >
                                        {t("va_event_rsvp_no")}
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {postPoll && (
                                  <div style={{ marginTop: p.contenu ? 8 : 0, background: isMine ? "rgba(255,255,255,.12)" : "#F4F7F6", borderRadius: 10, padding: 10 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
                                      <BarChart3 size={12} /> {postPoll.question}
                                    </div>
                                    {postPollOptions.map((opt) => {
                                      const votes = postPollVotes.filter((v) => v.option_id === opt.id).length;
                                      const total = postPollVotes.length;
                                      const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
                                      const mineOpt = myPollVote?.option_id === opt.id;
                                      return (
                                        <button
                                          key={opt.id} onClick={() => votePoll(postPoll.id, opt.id, postPoll.closed)} disabled={postPoll.closed}
                                          style={{ display: "block", width: "100%", textAlign: "left", position: "relative", overflow: "hidden", border: `1px solid ${mineOpt ? TEAL : (isMine ? "rgba(255,255,255,.35)" : "#DDD")}`, borderRadius: 8, padding: "6px 10px", marginBottom: 5, background: isMine ? "rgba(255,255,255,.06)" : "white", cursor: postPoll.closed ? "default" : "pointer", fontSize: 12, color: isMine ? "white" : "#333", boxSizing: "border-box" }}
                                        >
                                          <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: mineOpt ? "rgba(46,204,113,.28)" : (isMine ? "rgba(255,255,255,.15)" : "rgba(31,56,100,.08)"), transition: "width .3s" }} />
                                          <div style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 8 }}>
                                            <span>{mineOpt && "✓ "}{opt.texte}</span>
                                            <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
                                          </div>
                                        </button>
                                      );
                                    })}
                                    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{t("va_poll_votes_count").replace("{n}", postPollVotes.length)}</div>
                                  </div>
                                )}
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, justifyContent: "flex-end", padding: hasWideMedia ? "0 6px" : 0 }}>
                                  {isFuture && <Clock size={10} style={{ opacity: 0.7 }} title={t("va_scheduled_pill")} />}
                                  <span style={{ fontSize: 9.5, opacity: 0.7 }}>{new Date(p.date_publication || p.created_at).toLocaleTimeString(lang === "en" ? "en-CA" : "fr-CA", { hour: "2-digit", minute: "2-digit" })}</span>
                                </div>
                              </div>
                              );
                            })()}
                            {!isEditing && (isBureau || isMine) && hoveredPostId === p.id && (
                              <div style={{ display: "flex", gap: 5, marginTop: 3, justifyContent: isMine ? "flex-end" : "flex-start" }}>
                                {isBureau && (
                                  <button onClick={() => togglePin(p.id, p.epingle)} title={p.epingle ? t("va_unpin_btn") : t("va_pin_btn")} style={{ width: 20, height: 20, borderRadius: "50%", background: p.epingle ? "#FFF3E0" : "white", border: `1px solid ${p.epingle ? "#E0A94A" : "#DDD"}`, color: p.epingle ? "#8A5A00" : "#686F7D", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                                    <Pin size={10} />
                                  </button>
                                )}
                                <button onClick={() => setEditingPost(p.id)} title={t("va_edit_btn")} style={{ width: 20, height: 20, borderRadius: "50%", background: "white", border: "1px solid #DDD", color: "var(--primary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                                  <Pencil size={10} />
                                </button>
                                <button onClick={() => deletePost(p.id)} title={t("va_delete_post_btn")} style={{ width: 20, height: 20, borderRadius: "50%", background: "white", border: `1px solid ${RED}`, color: RED, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            )}
                            {!isEditing && (() => {
                              const postReactions = reactions.filter((r) => r.post_id === p.id);
                              const postComments = comments.filter((c) => c.post_id === p.id);
                              const topLevelComments = postComments.filter((c) => !c.parent_comment_id);
                              const mineReaction = postReactions.find((r) => r.member_profile_id === profile.id);
                              return (
                                <div style={{ marginTop: 4 }}>
                                  <div style={{ display: "flex", gap: 5, alignItems: "center", justifyContent: isMine ? "flex-end" : "flex-start" }}>
                                    {REACTION_EMOJIS.filter((e) => postReactions.some((r) => r.emoji === e)).map((emoji) => {
                                      const count = postReactions.filter((r) => r.emoji === emoji).length;
                                      const mine = mineReaction?.emoji === emoji;
                                      return (
                                        <button
                                          key={emoji} onClick={() => toggleReaction(p.id, emoji)}
                                          style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 3, background: mine ? "#EEF3F1" : "white", border: `1px solid ${mine ? TEAL : "#DDD"}`, borderRadius: 999, padding: "1px 8px", cursor: "pointer", color: mine ? TEAL : "#777" }}
                                        >
                                          <span>{emoji}</span>{count > 0 && <span style={{ fontWeight: 600 }}>{count}</span>}
                                        </button>
                                      );
                                    })}
                                    <div style={{ position: "relative" }}>
                                      <button
                                        onClick={() => setReactionPickerFor((cur) => (cur === p.id ? null : p.id))}
                                        title={t("va_react_add")}
                                        style={{ width: 22, height: 22, borderRadius: "50%", background: mineReaction ? "#EEF3F1" : "white", border: `1px solid ${mineReaction ? TEAL : "#DDD"}`, color: mineReaction ? TEAL : "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                                      >
                                        <Smile size={12} />
                                      </button>
                                      {reactionPickerFor === p.id && (
                                        <>
                                          <div style={{ position: "fixed", inset: 0, zIndex: 1500 }} onClick={() => setReactionPickerFor(null)} />
                                          <div style={{ position: "absolute", bottom: "120%", ...(isMine ? { right: 0 } : { left: 0 }), background: "white", borderRadius: 999, boxShadow: "0 4px 16px rgba(0,0,0,.18)", padding: "5px 7px", display: "flex", gap: 4, zIndex: 1501, border: "1px solid #EEE" }}>
                                            {REACTION_EMOJIS.map((emoji) => (
                                              <button key={emoji} onClick={() => { toggleReaction(p.id, emoji); setReactionPickerFor(null); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 17, padding: "2px 3px", borderRadius: 6, lineHeight: 1 }}>{emoji}</button>
                                            ))}
                                          </div>
                                        </>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => setOpenComments((o) => ({ ...o, [p.id]: !o[p.id] }))}
                                      style={{ fontSize: 11, fontWeight: 600, background: openComments[p.id] ? "#EEF1F5" : "none", border: "1px solid transparent", borderColor: openComments[p.id] ? "#E1E5EC" : "transparent", color: "#6B7280", cursor: "pointer", padding: "2px 8px", borderRadius: 999, display: "flex", alignItems: "center", gap: 3 }}
                                    >
                                      {postComments.length > 0 ? t("va_comments_view").replace("{n}", postComments.length) : t("va_comments_add")}
                                      <ChevronDown size={12} style={{ transform: openComments[p.id] ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }} />
                                    </button>
                                    {!p.reposted_from_id && (
                                      <button
                                        onClick={() => {
                                          setRepostTarget({ id: p.id });
                                          requestAnimationFrame(() => postInputRef.current?.focus());
                                        }}
                                        title={t("va_repost_btn")}
                                        style={{ fontSize: 11, fontWeight: 600, background: "none", border: "1px solid transparent", color: "#6B7280", cursor: "pointer", padding: "2px 8px", borderRadius: 999, display: "flex", alignItems: "center", gap: 3 }}
                                      >
                                        <Repeat2 size={13} />
                                      </button>
                                    )}
                                    {!isMine && (
                                      <button
                                        onClick={() => flagContent(p.id, null)}
                                        disabled={iFlaggedThisPost}
                                        title={iFlaggedThisPost ? t("va_flag_done") : t("va_flag_btn")}
                                        style={{ fontSize: 11, fontWeight: 600, background: "none", border: "1px solid transparent", color: iFlaggedThisPost ? RED : "#6B7280", cursor: iFlaggedThisPost ? "default" : "pointer", padding: "2px 8px", borderRadius: 999, display: "flex", alignItems: "center", gap: 3 }}
                                      >
                                        <Flag size={12} />
                                        {isBureau && postFlagCount > 0 && <span style={{ fontWeight: 700 }}>{postFlagCount}</span>}
                                      </button>
                                    )}
                                  </div>
                                  {isMine && (() => {
                                    const viewers = postViews.filter((v) => v.post_id === p.id && v.member_profile_id !== profile.id);
                                    if (viewers.length === 0) return null;
                                    const names = viewers.map((v) => v.viewer_nom || t("va_a_member")).join(", ");
                                    return (
                                      <div title={names} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#AEB4BF", marginTop: 3, justifyContent: "flex-end" }}>
                                        <Eye size={10} />
                                        <span>{t("va_seen_by").replace("{n}", viewers.length)}</span>
                                      </div>
                                    );
                                  })()}
                                  {/* Commentaires « déroulants » (2026-09-29) — toujours présents dans le
                                      DOM, c'est la hauteur (CSS Grid) qui s'anime pour un vrai effet de
                                      tiroir, via le composant Collapsible partagé plus haut. */}
                                  <div style={{ maxWidth: 340, marginTop: openComments[p.id] ? 6 : 0 }}>
                                    <Collapsible open={!!openComments[p.id]}>
                                      <div style={{ background: isMine ? "#F4F7F6" : "#FAFAFA", borderRadius: 10, padding: 8 }}>
                                        {topLevelComments.map((c) => {
                                          const replies = postComments.filter((r) => r.parent_comment_id === c.id);
                                          const renderOne = (cm, isReply) => (
                                            <div key={cm.id} style={{ display: "flex", gap: 6, marginBottom: isReply ? 6 : 8, alignItems: "flex-start", marginLeft: isReply ? 26 : 0 }}>
                                              <FeedAvatar photoUrl={memberByName(cm.auteur_nom)?.photo_url} name={cm.auteur_nom || t("va_a_member")} size={isReply ? 17 : 20} fontSize={isReply ? 7 : 8} />
                                              <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--primary)" }}>{cm.auteur_nom || t("va_a_member")}</div>
                                                {cm.image_url && (
                                                  <img src={cm.image_url} alt="" loading="lazy" onClick={() => setLightboxUrl(cm.image_url)} style={{ maxWidth: 140, maxHeight: 140, objectFit: "cover", borderRadius: 8, marginTop: 3, cursor: "pointer", display: "block" }} />
                                                )}
                                                {cm.video_url && (
                                                  <video src={cm.video_url} controls style={{ maxWidth: 200, maxHeight: 160, borderRadius: 8, marginTop: 3, display: "block", background: "#000" }} />
                                                )}
                                                {cm.audio_url && (
                                                  <audio src={cm.audio_url} controls style={{ display: "block", width: 200, maxWidth: "100%", marginTop: 3 }} />
                                                )}
                                                {cm.contenu && <div style={{ fontSize: 12, color: "#333", marginTop: (cm.image_url || cm.video_url || cm.audio_url) ? 3 : 0, wordBreak: "break-word" }}>{renderMentions(cm.contenu)}</div>}
                                                <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                                                  <button
                                                    onClick={() => setReplyTarget((prev) => ({ ...prev, [p.id]: { id: rootCommentId(cm), auteur_nom: cm.auteur_nom } }))}
                                                    style={{ fontSize: 9.5, fontWeight: 600, color: "#8A93A6", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                                                  >
                                                    {t("va_reply_btn")}
                                                  </button>
                                                  {cm.auteur_id !== profile.id && (
                                                    <button
                                                      onClick={() => flagContent(null, cm.id)}
                                                      disabled={alreadyFlaggedByMe(null, cm.id)}
                                                      style={{ fontSize: 9.5, fontWeight: 600, color: alreadyFlaggedByMe(null, cm.id) ? RED : "#8A93A6", background: "none", border: "none", cursor: alreadyFlaggedByMe(null, cm.id) ? "default" : "pointer", padding: 0 }}
                                                    >
                                                      {alreadyFlaggedByMe(null, cm.id) ? t("va_flag_done") : t("va_flag_btn")}
                                                    </button>
                                                  )}
                                                </div>
                                              </div>
                                              {(isBureau || cm.auteur_id === profile.id) && (
                                                <button onClick={() => deleteComment(cm.id)} title={t("va_delete_comment_btn")} style={{ background: "none", border: "none", color: RED, cursor: "pointer", padding: 0, flexShrink: 0 }}>
                                                  <Trash2 size={11} />
                                                </button>
                                              )}
                                            </div>
                                          );
                                          return (
                                            <React.Fragment key={c.id}>
                                              {renderOne(c, false)}
                                              {replies.map((r) => renderOne(r, true))}
                                            </React.Fragment>
                                          );
                                        })}
                                        {replyTarget[p.id] && (
                                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "var(--primary)", background: "#EEF1F5", borderRadius: 999, padding: "3px 9px", marginBottom: 6, width: "fit-content" }}>
                                            <span>{t("va_reply_to").replace("{name}", replyTarget[p.id].auteur_nom || t("va_a_member"))}</span>
                                            <button onClick={() => setReplyTarget((prev) => ({ ...prev, [p.id]: undefined }))} style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", padding: 0, display: "flex" }}>
                                              <X size={11} />
                                            </button>
                                          </div>
                                        )}
                                        {newCommentImage[p.id] && (
                                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                            <img src={newCommentImage[p.id]} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6 }} />
                                            <button onClick={() => setNewCommentImage((prev) => ({ ...prev, [p.id]: "" }))} style={{ fontSize: 10, color: RED, background: "none", border: "none", cursor: "pointer", padding: 0 }}>{t("va_remove_image")}</button>
                                          </div>
                                        )}
                                        {videoByKey[p.id] && (
                                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                            <Video size={13} style={{ color: "#888" }} />
                                            <span style={{ fontSize: 10, color: "#666" }}>{t("va_video_attached")}</span>
                                            <button onClick={() => clearAttachment(setVideoByKey, p.id)} style={{ fontSize: 10, color: RED, background: "none", border: "none", cursor: "pointer", padding: 0 }}>{t("va_remove_attachment")}</button>
                                          </div>
                                        )}
                                        {audioByKey[p.id] && (
                                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                            <audio src={audioByKey[p.id].url} controls style={{ height: 28 }} />
                                            <button onClick={() => clearAttachment(setAudioByKey, p.id)} style={{ fontSize: 10, color: RED, background: "none", border: "none", cursor: "pointer", padding: 0 }}>{t("va_remove_attachment")}</button>
                                          </div>
                                        )}
                                        {recordingKey === p.id ? (
                                          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 2px" }}>
                                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: RED, flexShrink: 0 }} />
                                            <span style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums", color: "#333" }}>{formatDuration(recordingSeconds)}</span>
                                            <button onClick={cancelRecording} title={t("va_voice_cancel")} style={{ background: "none", border: "none", color: "#686F7D", cursor: "pointer", padding: 0 }}><Trash2 size={13} /></button>
                                            <div style={{ flex: 1 }} />
                                            <button onClick={stopRecording} title={t("va_voice_send")} style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--primary)", color: "white", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                              <Send size={11} />
                                            </button>
                                          </div>
                                        ) : (
                                        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                                          <button
                                            onClick={() => { commentImageTargetRef.current = p.id; commentImageInputRef.current?.click(); }}
                                            title={t("va_attach_image")}
                                            disabled={uploadingCommentImageFor === p.id}
                                            style={{ width: 24, height: 24, borderRadius: "50%", background: "none", border: "1px solid #DDD", color: "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0 }}
                                          >
                                            <Upload size={11} />
                                          </button>
                                          <button
                                            onClick={() => { commentVideoTargetRef.current = p.id; commentVideoInputRef.current?.click(); }}
                                            title={t("va_attach_video")}
                                            disabled={uploadingVideoKey === p.id}
                                            style={{ width: 24, height: 24, borderRadius: "50%", background: "none", border: "1px solid #DDD", color: "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0 }}
                                          >
                                            <Video size={11} />
                                          </button>
                                          <button
                                            onClick={() => startRecording(p.id)}
                                            title={t("va_voice_record")}
                                            disabled={uploadingAudioKey === p.id || (!!recordingKey && recordingKey !== p.id)}
                                            style={{ width: 24, height: 24, borderRadius: "50%", background: "none", border: "1px solid #DDD", color: "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0 }}
                                          >
                                            <Mic size={11} />
                                          </button>
                                          <textarea
                                            ref={(el) => { commentInputRefs.current[p.id] = el; }}
                                            className="va-feed-input"
                                            rows={1}
                                            style={{ ...inputStyle, fontSize: 12, padding: "6px 10px", borderRadius: 14, flex: 1, resize: "none", overflowY: "auto", maxHeight: 120, lineHeight: 1.4, fontFamily: "inherit" }}
                                            placeholder={t("va_comment_placeholder")}
                                            value={newCommentText[p.id] || ""}
                                            onChange={(e) => {
                                              setNewCommentText((prev) => ({ ...prev, [p.id]: e.target.value }));
                                              e.target.style.height = "auto";
                                              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                                            }}
                                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); publishComment(p.id); } }}
                                          />
                                          <button onClick={() => publishComment(p.id)} style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--primary)", color: "white", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                            <Send size={11} />
                                          </button>
                                        </div>
                                        )}
                                      </div>
                                    </Collapsible>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                  <div ref={feedEndRef} />
                </div>
                {/* Entrées fichier cachées, partagées par tous les composeurs de commentaire
                    (la cible est mémorisée dans commentImageTargetRef / commentVideoTargetRef
                    juste avant le clic) */}
                <input
                  type="file" accept="image/*" ref={commentImageInputRef} style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]; e.target.value = "";
                    const postId = commentImageTargetRef.current;
                    if (!file || !postId) return;
                    setUploadingCommentImageFor(postId);
                    const url = await uploadFeedImage(file, "comments/");
                    setUploadingCommentImageFor(null);
                    if (url) setNewCommentImage((prev) => ({ ...prev, [postId]: url }));
                  }}
                />
                <input
                  type="file" accept="video/*" ref={commentVideoInputRef} style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]; e.target.value = "";
                    const postId = commentVideoTargetRef.current;
                    if (!file || !postId) return;
                    await handleVideoSelected(file, postId);
                  }}
                />
                {/* Barre de composition — position: relative pour ancrer le menu de
                    mentions (@) juste au-dessus. */}
                <div style={{ position: "relative", borderTop: "1px solid #EEE", padding: "10px 14px", background: "white" }}>
                  {mentionQuery !== null && mentionSuggestions.length > 0 && (
                    <div style={{ position: "absolute", bottom: "100%", left: 10, right: 10, marginBottom: 6, background: "white", borderRadius: 10, boxShadow: "0 -4px 18px rgba(31,56,100,0.15)", border: "1px solid #EEE", overflow: "hidden", zIndex: 50, maxHeight: 190, overflowY: "auto" }}>
                      {mentionSuggestions.map((m) => (
                        <button key={m.id} onClick={() => insertMention(m)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", background: "none", border: "none", textAlign: "left", cursor: "pointer" }}>
                          <FeedAvatar photoUrl={m.photo_url} name={m.nom} size={22} fontSize={9} />
                          <span style={{ fontSize: 12.5, color: "#333" }}>{m.nom}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {showSchedule && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <Clock size={13} style={{ color: "#686F7D" }} />
                      <input type="datetime-local" style={{ ...inputStyle, padding: "6px 10px", fontSize: 12 }} value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
                      {scheduledDate && <button onClick={() => setScheduledDate("")} style={{ background: "none", border: "none", color: "#686F7D", fontSize: 11, cursor: "pointer" }}>{t("va_cancel_btn")}</button>}
                    </div>
                  )}
                  {newPostImage && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                      <div style={{ position: "relative" }}>
                        <img src={newPostImage} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8 }} />
                        <button onClick={() => { const [next, ...rest] = newPostImages; setNewPostImage(next || ""); setNewPostImages(rest); }} title={t("va_remove_image")} style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", background: RED, color: "white", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                          <X size={10} />
                        </button>
                      </div>
                      {newPostImages.map((url, i) => (
                        <div key={url + i} style={{ position: "relative" }}>
                          <img src={url} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8 }} />
                          <button onClick={() => setNewPostImages((prev) => prev.filter((_, j) => j !== i))} title={t("va_remove_image")} style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", background: RED, color: "white", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                      {(1 + newPostImages.length) < 6 && (
                        <span style={{ fontSize: 10.5, color: "#AAB2BE" }}>{t("va_album_more").replace("{n}", 6 - 1 - newPostImages.length)}</span>
                      )}
                    </div>
                  )}
                  {videoByKey["__post__"] && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <Video size={16} style={{ color: "#888" }} />
                      <span style={{ fontSize: 12, color: "#666" }}>{t("va_video_attached")}</span>
                      <button onClick={() => clearAttachment(setVideoByKey, "__post__")} style={{ fontSize: 11, color: RED, background: "none", border: "none", cursor: "pointer", padding: 0 }}>{t("va_remove_attachment")}</button>
                    </div>
                  )}
                  {audioByKey["__post__"] && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <audio src={audioByKey["__post__"].url} controls style={{ height: 30 }} />
                      <button onClick={() => clearAttachment(setAudioByKey, "__post__")} style={{ fontSize: 11, color: RED, background: "none", border: "none", cursor: "pointer", padding: 0 }}>{t("va_remove_attachment")}</button>
                    </div>
                  )}
                  {pollDraft && (
                    <div style={{ border: "1px solid #E1E5EC", borderRadius: 10, padding: 10, marginBottom: 8, background: "#FAFBFC" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <BarChart3 size={13} style={{ color: "var(--primary)", flexShrink: 0 }} />
                        <input className="va-feed-input" style={{ ...inputStyle, fontSize: 12.5, padding: "6px 10px", flex: 1 }} placeholder={t("va_poll_question_placeholder")} value={pollDraft.question} onChange={(e) => setPollDraft((d) => ({ ...d, question: e.target.value }))} />
                        <button onClick={() => setPollDraft(null)} title={t("va_poll_remove")} style={{ background: "none", border: "none", color: "#686F7D", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 }}><X size={14} /></button>
                      </div>
                      {pollDraft.options.map((opt, i) => (
                        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                          <input className="va-feed-input" style={{ ...inputStyle, fontSize: 12, padding: "5px 9px", flex: 1 }} placeholder={t("va_poll_option_placeholder").replace("{n}", i + 1)} value={opt} onChange={(e) => setPollDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? e.target.value : o)) }))} />
                          {pollDraft.options.length > 2 && (
                            <button onClick={() => setPollDraft((d) => ({ ...d, options: d.options.filter((_, j) => j !== i) }))} style={{ background: "none", border: "none", color: RED, cursor: "pointer", padding: 2, display: "flex" }}><X size={13} /></button>
                          )}
                        </div>
                      ))}
                      {pollDraft.options.length < 6 && (
                        <button onClick={() => setPollDraft((d) => ({ ...d, options: [...d.options, ""] }))} style={{ fontSize: 11, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>
                          + {t("va_poll_add_option")}
                        </button>
                      )}
                    </div>
                  )}
                  {/* Publication → événement en un clic (2026-09-29, 4e vague) —
                      Bureau uniquement, événements gratuits (voir publishPost). */}
                  {isBureau && eventComposerOpen && (
                    <div style={{ border: "1px solid #E1E5EC", borderRadius: 10, padding: 10, marginBottom: 8, background: "#FAFBFC" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <Calendar size={13} style={{ color: "var(--primary)", flexShrink: 0 }} />
                        <input className="va-feed-input" style={{ ...inputStyle, fontSize: 12.5, padding: "6px 10px", flex: 1 }} placeholder={t("va_event_title_placeholder")} value={eventDraft.titre} onChange={(e) => setEventDraft((d) => ({ ...d, titre: e.target.value }))} />
                        <button onClick={() => setEventComposerOpen(false)} title={t("va_event_remove")} style={{ background: "none", border: "none", color: "#686F7D", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 }}><X size={14} /></button>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <input type="datetime-local" className="va-feed-input" style={{ ...inputStyle, fontSize: 12, padding: "5px 9px", flex: "1 1 160px" }} value={eventDraft.date_debut} onChange={(e) => setEventDraft((d) => ({ ...d, date_debut: e.target.value }))} />
                        <input className="va-feed-input" style={{ ...inputStyle, fontSize: 12, padding: "5px 9px", flex: "1 1 130px" }} placeholder={t("va_event_location_placeholder")} value={eventDraft.lieu} onChange={(e) => setEventDraft((d) => ({ ...d, lieu: e.target.value }))} />
                        <input type="number" min="0" className="va-feed-input" style={{ ...inputStyle, fontSize: 12, padding: "5px 9px", width: 110 }} placeholder={t("va_event_capacity_placeholder")} value={eventDraft.capacite_max} onChange={(e) => setEventDraft((d) => ({ ...d, capacite_max: e.target.value }))} />
                      </div>
                      <div style={{ fontSize: 10.5, color: "#686F7D", marginTop: 6 }}>{t("va_event_free_note")}</div>
                    </div>
                  )}
                  <input
                    type="file" accept="image/*" multiple ref={postImageInputRef} style={{ display: "none" }}
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || []); e.target.value = "";
                      if (files.length === 0) return;
                      // Album photo (2026-09-29, 3e vague) : jusqu'à 6 images au total.
                      const already = (newPostImage ? 1 : 0) + newPostImages.length;
                      const toUpload = files.slice(0, Math.max(0, 6 - already));
                      if (toUpload.length === 0) return;
                      setUploadingPostImage(true);
                      const urls = [];
                      for (const file of toUpload) {
                        const url = await uploadFeedImage(file);
                        if (url) urls.push(url);
                      }
                      setUploadingPostImage(false);
                      if (urls.length === 0) return;
                      if (!newPostImage) {
                        setNewPostImage(urls[0]);
                        setNewPostImages((prev) => [...prev, ...urls.slice(1)]);
                      } else {
                        setNewPostImages((prev) => [...prev, ...urls]);
                      }
                    }}
                  />
                  <input
                    type="file" accept="video/*" ref={postVideoInputRef} style={{ display: "none" }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]; e.target.value = "";
                      if (!file) return;
                      await handleVideoSelected(file, "__post__");
                    }}
                  />
                  {typingUsers.length > 0 && (
                    <div style={{ fontSize: 11, color: "#8A93A6", fontStyle: "italic", marginBottom: 6, paddingLeft: 4 }}>
                      {typingUsers.length === 1
                        ? t("va_typing_one").replace("{name}", typingUsers[0])
                        : t("va_typing_many").replace("{names}", typingUsers.join(", "))}
                    </div>
                  )}
                  {repostTarget && (() => {
                    const original = posts.find((op) => op.id === repostTarget.id);
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F4F7F6", border: "1px solid #E1E5EC", borderRadius: 10, padding: "6px 10px", marginBottom: 8 }}>
                        <Repeat2 size={13} style={{ color: "var(--primary)", flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, color: "#5A6270", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t("va_reposting").replace("{name}", original?.auteur_nom || t("va_a_member"))}
                        </span>
                        <button onClick={() => setRepostTarget(null)} style={{ background: "none", border: "none", color: "#686F7D", cursor: "pointer", padding: 0, display: "flex", flexShrink: 0 }}>
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })()}
                  {recordingKey === "__post__" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <FeedAvatar photoUrl={meMember?.photo_url} name={profile?.nom_complet || t("va_a_member")} size={32} fontSize={11} />
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: RED, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: "#333" }}>{formatDuration(recordingSeconds)}</span>
                      <button onClick={cancelRecording} title={t("va_voice_cancel")} style={{ background: "none", border: "none", color: "#686F7D", cursor: "pointer", padding: 0, display: "flex" }}><Trash2 size={16} /></button>
                      <div style={{ flex: 1 }} />
                      <Btn onClick={stopRecording} title={t("va_voice_send")} style={{ borderRadius: 999, width: 38, height: 38, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Send size={14} /></Btn>
                    </div>
                  ) : (
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <FeedAvatar photoUrl={meMember?.photo_url} name={profile?.nom_complet || t("va_a_member")} size={32} fontSize={11} />
                    {isBureau && (
                      <button onClick={() => setShowSchedule((s) => !s)} title={t("va_schedule_toggle")} style={{ width: 32, height: 32, borderRadius: "50%", background: showSchedule ? "#EEF3F1" : "none", border: "1px solid #DDD", color: showSchedule ? TEAL : "#686F7D", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Clock size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => postImageInputRef.current?.click()} title={t("va_attach_image")} disabled={uploadingPostImage}
                      style={{ width: 32, height: 32, borderRadius: "50%", background: "none", border: "1px solid #DDD", color: uploadingPostImage ? "#CCC" : "#686F7D", cursor: uploadingPostImage ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                    >
                      <Upload size={14} />
                    </button>
                    <button
                      onClick={() => postVideoInputRef.current?.click()} title={t("va_attach_video")} disabled={uploadingVideoKey === "__post__"}
                      style={{ width: 32, height: 32, borderRadius: "50%", background: "none", border: "1px solid #DDD", color: uploadingVideoKey === "__post__" ? "#CCC" : "#686F7D", cursor: uploadingVideoKey === "__post__" ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                    >
                      <Video size={14} />
                    </button>
                    <button
                      onClick={() => startRecording("__post__")} title={t("va_voice_record")}
                      disabled={uploadingAudioKey === "__post__" || (!!recordingKey && recordingKey !== "__post__")}
                      style={{ width: 32, height: 32, borderRadius: "50%", background: "none", border: "1px solid #DDD", color: "#686F7D", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                    >
                      <Mic size={14} />
                    </button>
                    <button
                      onClick={() => setPollDraft((d) => (d ? null : { question: "", options: ["", ""] }))} title={t("va_poll_add")}
                      style={{ width: 32, height: 32, borderRadius: "50%", background: pollDraft ? "#EEF3F1" : "none", border: "1px solid #DDD", color: pollDraft ? TEAL : "#686F7D", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                    >
                      <BarChart3 size={14} />
                    </button>
                    {isBureau && (
                      <button
                        onClick={() => setEventComposerOpen((o) => !o)} title={t("va_event_toggle")}
                        style={{ width: 32, height: 32, borderRadius: "50%", background: eventComposerOpen ? "#EEF3F1" : "none", border: "1px solid #DDD", color: eventComposerOpen ? TEAL : "#686F7D", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                      >
                        <Calendar size={14} />
                      </button>
                    )}
                    <textarea
                      ref={postInputRef}
                      className="va-feed-input"
                      rows={1}
                      style={{ ...inputStyle, borderRadius: 18, padding: "9px 16px", flex: 1, resize: "none", overflowY: "auto", maxHeight: 160, lineHeight: 1.4, fontFamily: "inherit" }}
                      placeholder={t("va_share_placeholder")}
                      value={newPost}
                      onChange={handlePostInputChange}
                      onKeyDown={handleComposerKeyDown}
                    />
                    <Btn onClick={publishPost} style={{ borderRadius: 999, width: 38, height: 38, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Send size={14} /></Btn>
                  </div>
                  )}
                </div>
              </div>
              )}
            </div>
          </Collapsible>
        </div>
      </div>

      {lightboxUrl && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }} onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="" style={{ maxWidth: "90%", maxHeight: "88vh", borderRadius: 12, boxShadow: "0 10px 40px rgba(0,0,0,0.45)" }} onClick={(e) => e.stopPropagation()} />
          <button
            onClick={() => setLightboxUrl(null)}
            title={t("tont_decharge_close")}
            style={{ position: "fixed", top: 22, right: 26, background: "rgba(255,255,255,0.15)", border: "none", color: "white", width: 38, height: 38, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}
          >
            ✕
          </button>
        </div>
      )}

      {statusComposerOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100, padding: 16 }} onClick={() => setStatusComposerOpen(false)}>
          <div style={{ background: "white", borderRadius: 16, padding: 18, width: "100%", maxWidth: 380, boxShadow: "0 12px 40px rgba(0,0,0,0.3)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: 15, color: "var(--primary)" }}>{t("va_status_composer_title")}</h4>
              <button onClick={() => setStatusComposerOpen(false)} style={{ background: "none", border: "none", color: "#686F7D", cursor: "pointer", display: "flex" }}><X size={16} /></button>
            </div>
            {statusComposerImage ? (
              <div style={{ position: "relative", marginBottom: 10 }}>
                <img src={statusComposerImage} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 10, display: "block" }} />
                <button onClick={() => setStatusComposerImage("")} style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: "50%", background: "rgba(0,0,0,0.5)", color: "white", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={12} /></button>
              </div>
            ) : (
              <button
                onClick={() => statusImageInputRef.current?.click()} disabled={uploadingStatusImage}
                style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1px dashed #DDD", background: "none", color: uploadingStatusImage ? "#CCC" : "#8A93A6", cursor: uploadingStatusImage ? "not-allowed" : "pointer", fontSize: 12, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Upload size={13} /> {uploadingStatusImage ? "…" : t("va_status_add_image")}
              </button>
            )}
            <input
              type="file" accept="image/*" ref={statusImageInputRef} style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0]; e.target.value = "";
                if (!file) return;
                setUploadingStatusImage(true);
                const url = await uploadFeedImage(file, "status/");
                setUploadingStatusImage(false);
                if (url) setStatusComposerImage(url);
              }}
            />
            <textarea
              rows={2}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "none", fontFamily: "inherit", marginBottom: 12 }}
              placeholder={t("va_status_text_placeholder")}
              value={statusComposerText}
              onChange={(e) => setStatusComposerText(e.target.value)}
            />
            <Btn onClick={addStatus} style={{ width: "100%" }}>{t("va_status_publish")}</Btn>
          </div>
        </div>
      )}

      {viewingStatusGroup && (() => {
        const group = statusGroups.find((g) => g.key === viewingStatusGroup.memberKey);
        const status = group?.items[viewingStatusGroup.index];
        if (!group || !status) { return null; }
        const viewerCount = statusViews.filter((v) => v.status_id === status.id && v.viewer_profile_id !== status.member_profile_id).length;
        const goNext = () => {
          if (viewingStatusGroup.index + 1 < group.items.length) setViewingStatusGroup({ ...viewingStatusGroup, index: viewingStatusGroup.index + 1 });
          else setViewingStatusGroup(null);
        };
        const goPrev = () => {
          if (viewingStatusGroup.index > 0) setViewingStatusGroup({ ...viewingStatusGroup, index: viewingStatusGroup.index - 1 });
        };
        return (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "black", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2200 }}>
            <div style={{ position: "absolute", top: 10, left: 10, right: 10, display: "flex", gap: 4, zIndex: 2 }}>
              {group.items.map((s, i) => (
                <div key={s.id} style={{ flex: 1, height: 3, borderRadius: 999, background: i <= viewingStatusGroup.index ? "white" : "rgba(255,255,255,0.35)" }} />
              ))}
            </div>
            <div style={{ position: "absolute", top: 22, left: 14, display: "flex", alignItems: "center", gap: 8, zIndex: 2 }}>
              <FeedAvatar photoUrl={memberByName(status.auteur_nom)?.photo_url} name={status.auteur_nom || t("va_a_member")} size={30} fontSize={11} />
              <span style={{ color: "white", fontWeight: 700, fontSize: 12.5 }}>{status.auteur_nom || t("va_a_member")}</span>
            </div>
            <button onClick={() => setViewingStatusGroup(null)} style={{ position: "absolute", top: 20, right: 14, background: "rgba(255,255,255,0.15)", border: "none", color: "white", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
              <X size={16} />
            </button>
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "35%", cursor: "pointer" }} onClick={goPrev} />
            <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "35%", cursor: "pointer" }} onClick={goNext} />
            <div style={{ maxWidth: "92%", maxHeight: "80%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {status.type === "image" && status.image_url ? (
                <img src={status.image_url} alt="" style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: 10, display: "block" }} />
              ) : (
                <div style={{ background: "linear-gradient(135deg, var(--primary), var(--primary-dark))", borderRadius: 16, padding: 28, minWidth: 260, maxWidth: 320 }}>
                  <p style={{ color: "white", fontSize: 17, fontWeight: 600, textAlign: "center", lineHeight: 1.5, margin: 0, wordBreak: "break-word" }}>{status.contenu}</p>
                </div>
              )}
              {status.type === "image" && status.contenu && (
                <div style={{ position: "absolute", bottom: 50, left: 16, right: 16, color: "white", fontSize: 13, textAlign: "center", textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>{status.contenu}</div>
              )}
            </div>
            {status.member_profile_id === profile.id && (
              <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 11.5, display: "flex", alignItems: "center", gap: 4 }}><Eye size={12} /> {t("va_seen_by").replace("{n}", viewerCount)}</span>
                <button onClick={() => deleteStatus(status.id)} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 999, padding: "4px 12px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                  <Trash2 size={11} /> {t("va_status_delete")}
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Profils membres enrichis (2026-09-29, 4e vague) — ouvert en cliquant
          sur l'avatar/le nom d'un auteur dans le fil. Construit uniquement à
          partir des données déjà chargées (members + posts), sans requête
          supplémentaire. Cas limite assumé (voir memberByName plus haut) :
          deux membres au même nom exact partageraient les mêmes publications
          listées ici. */}
      {viewingMemberProfile && (() => {
        const member = members.find((m) => m.id === viewingMemberProfile);
        if (!member) return null;
        const memberPosts = orderedPosts.filter((po) => po.auteur_nom === member.nom).slice().reverse().slice(0, 5);
        return (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100, padding: 16 }} onClick={() => setViewingMemberProfile(null)}>
            <div style={{ background: "white", borderRadius: 16, padding: 20, width: "100%", maxWidth: 380, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,0.3)" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => setViewingMemberProfile(null)} style={{ background: "none", border: "none", color: "#686F7D", cursor: "pointer", display: "flex" }}><X size={16} /></button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <FeedAvatar photoUrl={member.photo_url} name={member.nom} size={64} fontSize={20} />
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <h3 style={{ margin: 0, fontSize: 16, color: "var(--primary)" }}>{member.nom}</h3>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5, marginBottom: 16 }}>
                {member.quartier && (
                  <div style={{ display: "flex", gap: 6, color: "#5A6270" }}><MapPin size={13} style={{ flexShrink: 0, marginTop: 1 }} /><span>{member.quartier}</span></div>
                )}
                {member.competences && (
                  <div style={{ display: "flex", gap: 6, color: "#5A6270" }}><Users size={13} style={{ flexShrink: 0, marginTop: 1 }} /><span>{member.competences}</span></div>
                )}
                {member.date_adhesion && (
                  <div style={{ display: "flex", gap: 6, color: "#5A6270" }}><Calendar size={13} style={{ flexShrink: 0, marginTop: 1 }} /><span>{t("va_profile_member_since").replace("{date}", member.date_adhesion)}</span></div>
                )}
                {member.disponible_benevolat && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: TEAL, background: "#EEF3F1", borderRadius: 999, padding: "3px 10px", width: "fit-content" }}>{t("va_profile_volunteer")}</div>
                )}
              </div>
              <div style={{ borderTop: "1px solid #EEE", paddingTop: 12 }}>
                <h4 style={{ fontSize: 12, color: "#8A93A6", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>{t("va_profile_recent_posts")}</h4>
                {memberPosts.length === 0 && <p style={{ fontSize: 12, color: "#AAB2BE", fontStyle: "italic" }}>{t("va_profile_no_posts")}</p>}
                {memberPosts.map((po) => (
                  <div key={po.id} style={{ fontSize: 12, color: "#333", background: "#FAFBFC", borderRadius: 8, padding: "7px 10px", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {po.contenu || t("va_pinned_media_fallback")}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </Section></Container>
  );
}
function EditPostForm({ post, onSave, onCancel, t, inputStyle, isBureau }) {
  const [contenu, setContenu] = useState(post.contenu);
  const [datePublication, setDatePublication] = useState(
    toDatetimeLocal(post.date_publication)
  );
  // La programmation d'une date de publication future reste une capacité
  // du Bureau — un adhérent qui modifie sa propre publication ne peut
  // qu'en changer le texte, la date d'origine est conservée telle quelle.
  return (
    <div style={{ marginTop: 8 }}>
      <textarea style={{ ...inputStyle, minHeight: 60, marginBottom: 8 }} value={contenu} onChange={(e) => setContenu(e.target.value)} />
      {isBureau && (
        <input type="datetime-local" style={{ ...inputStyle, marginBottom: 8 }} value={datePublication} onChange={(e) => setDatePublication(e.target.value)} />
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onSave(post.id, contenu, datePublication ? new Date(datePublication).toISOString() : (post.date_publication || new Date().toISOString()))} style={{ fontSize: 11, color: "white", background: "var(--primary)", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>{t("va_save_btn")}</button>
        <button onClick={onCancel} style={{ fontSize: 11, color: "var(--primary)", background: "none", border: "1px solid var(--primary)", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>{t("va_cancel_btn")}</button>
      </div>
    </div>
  );
}
