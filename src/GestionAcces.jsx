// =====================================================================
// GestionAcces.jsx — Gestion des accès
// Onglet réservé au bureau : (1) confirmer ou rejeter les demandes de
// rattachement automatique entre un nouveau compte (arrivé via un code
// d'invitation) et une fiche membre existante, (2) consulter les comptes
// de l'association, changer leur rôle et bloquer/débloquer leur accès
// (les deux réservés au président). Un compte bloqué peut techniquement
// encore s'authentifier, mais n'a plus accès à aucune donnée de
// l'association (verrouillé côté base de données, colonne
// `profiles.compte_bloque` — voir sql/2026-09-07f_revocation_acces.sql).
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import { UserCheck, UserX, KeyRound, Ban, ShieldCheck, Copy, Globe, FileText, Receipt, Settings, Plus, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Field, RuleBox, useLang, friendlyError, inputStyle, todayISO } from "./shared";

const ROLE_KEY_MAP = {
  bureau_president: "role_bureau_president",
  bureau_secretaire: "role_bureau_secretaire",
  bureau_tresorier: "role_bureau_tresorier",
  responsable_rubrique: "role_responsable_rubrique",
  adherent: "role_adherent",
};

// Modules configurables par rôle de bureau (suite 2026-10-07, demandé par
// l'utilisateur) — DOIT rester identique à BUREAU_CONFIGURABLE_MODULES /
// BUREAU_MODULE_LABEL_KEYS dans App.jsx (même convention de duplication
// que ROLE_KEY_MAP ci-dessus, déjà dupliqué entre les deux fichiers) :
// c'est App.jsx qui applique réellement la restriction à la navigation,
// ce fichier ne fait que l'éditer. "apercu"/"dashboard"/"securite" sont
// volontairement absents : toujours accessibles, quel que soit le rôle.
const BUREAU_CONFIGURABLE_MODULES = [
  "membres", "inscription", "tontine", "collation", "urgence", "secours",
  "finances", "paiements_interac", "gouvernance", "vieassociative", "presences",
  "projets", "evenements", "covoiturage", "reunions", "emploi", "sondages", "tirages",
  "funeraire", "sanctions", "dons", "emprunts", "documents", "annonces",
  "journal", "demandes_suppression", "acces", "config",
];
const BUREAU_MODULE_LABEL_KEYS = {
  membres: "nav_members", inscription: "nav_inscription", tontine: "nav_tontine",
  collation: "nav_collation", urgence: "nav_urgence", secours: "nav_secours",
  finances: "nav_finances", paiements_interac: "nav_interac", gouvernance: "nav_governance",
  vieassociative: "nav_community", presences: "nav_presences", projets: "nav_projects",
  evenements: "nav_events", covoiturage: "nav_carpool", reunions: "nav_meetings",
  emploi: "nav_jobs", sondages: "nav_polls", tirages: "nav_draws", funeraire: "nav_funeraire",
  sanctions: "nav_sanctions", dons: "nav_donations", emprunts: "nav_loans",
  documents: "nav_documents", annonces: "nav_announcements", journal: "nav_activity",
  demandes_suppression: "nav_del_requests", acces: "nav_access", config: "nav_config",
};

export default function GestionAcces({ profile, association, isPresident, onPendingCountChange, onLinkRequestResolved }) {
  const { t } = useLang();
  const [requests, setRequests] = useState([]);
  const [membershipRequests, setMembershipRequests] = useState([]);
  const [profilesList, setProfilesList] = useState([]);
  const [membersList, setMembersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [chosenMember, setChosenMember] = useState({});
  const [copiedCodeFor, setCopiedCodeFor] = useState(null);
  // 2026-10-06 (demandé par l'utilisateur) — { reqId, memberId, initial }
  // de la demande en cours de confirmation, pendant qu'on complète sa fiche
  // adhérent avant intégration définitive à la liste des adhérents. Voir
  // openCompleteModal()/saveCompleteMember() plus bas.
  const [completeModal, setCompleteModal] = useState(null);
  // Configuration des rôles du bureau (suite 2026-10-07, demandé par
  // l'utilisateur) — voir sql/2026-10-07d_configuration_roles_bureau.sql.
  const [roleConfigs, setRoleConfigs] = useState([]);
  const [editingRole, setEditingRole] = useState(null); // 'bureau_secretaire' | 'bureau_tresorier' | <id d'un rôle personnalisé> | null
  const [roleDraft, setRoleDraft] = useState({ nom: "", modules: [], responsabilites: "" });
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleMsg, setRoleMsg] = useState("");
  const [newCustomRoleName, setNewCustomRoleName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: reqs }, { data: mreqs }, { data: profs }, { data: mems }, { data: roles }] = await Promise.all([
      supabase.from("member_link_requests").select("*").eq("association_id", profile.association_id).order("created_at", { ascending: false }),
      supabase.from("membership_requests").select("*").eq("association_id", profile.association_id).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,nom_complet,role,member_id,compte_bloque,bureau_role_config_id").eq("association_id", profile.association_id).order("nom_complet"),
      // "*" (plutôt que la liste restreinte d'avant, id/nom/email/statut) :
      // openCompleteModal() ci-dessous a besoin de la fiche complète pour la
      // pré-remplir quand on complète un adhérent déjà suggéré/choisi.
      supabase.from("members").select("*").eq("association_id", profile.association_id).neq("statut", "Supprimé").order("nom"),
      // Tolérant (pas de .throwOnError, data vide si la table n'existe pas
      // encore — script SQL 2026-10-07d pas encore exécuté) : ne doit pas
      // faire échouer le reste de cet onglet.
      supabase.from("bureau_role_configs").select("*").eq("association_id", profile.association_id).order("created_at"),
    ]);
    setRequests(reqs || []);
    setMembershipRequests(mreqs || []);
    setProfilesList(profs || []);
    setMembersList(mems || []);
    setRoleConfigs(roles || []);
    setLoading(false);
    const pendingCount = (reqs || []).filter((r) => r.statut === "en_attente").length
      + (mreqs || []).filter((r) => r.statut === "en_attente").length;
    if (onPendingCountChange) onPendingCountChange(pendingCount);
  }, [profile.association_id, onPendingCountChange]);
  useEffect(() => { load(); }, [load]);

  const customRoles = roleConfigs.filter((r) => !r.cle);
  const configFor = (cle) => roleConfigs.find((r) => r.cle === cle) || null;

  // "Pas encore configuré" (existing === null) démarre avec TOUS les
  // modules cochés : reflète l'accès complet actuel (voir note de
  // rétrocompatibilité, sql/2026-10-07d_configuration_roles_bureau.sql) —
  // le président décoche ensuite ce qu'il veut retirer, plutôt que de
  // partir d'une page blanche qui retirerait tout dès le premier
  // enregistrement. Un rôle personnalisé tout juste créé (existing avec
  // modules déjà à []) part au contraire de zéro — rien à préserver.
  function openRoleEditor(roleKey, existing) {
    setEditingRole(roleKey);
    setRoleDraft({
      nom: existing?.nom || (roleKey === "bureau_secretaire" ? t("role_bureau_secretaire") : roleKey === "bureau_tresorier" ? t("role_bureau_tresorier") : ""),
      modules: existing ? [...(existing.modules || [])] : [...BUREAU_CONFIGURABLE_MODULES],
      responsabilites: existing?.responsabilites || "",
    });
    setRoleMsg("");
  }
  function closeRoleEditor() { setEditingRole(null); setRoleMsg(""); }
  function toggleDraftModule(id) {
    setRoleDraft((p) => ({ ...p, modules: p.modules.includes(id) ? p.modules.filter((m) => m !== id) : [...p.modules, id] }));
  }
  async function saveRoleEditor() {
    setRoleBusy(true); setRoleMsg("");
    const isBuiltIn = editingRole === "bureau_secretaire" || editingRole === "bureau_tresorier";
    const { error } = isBuiltIn
      ? await supabase.rpc("enregistrer_role_bureau_integre", { p_cle: editingRole, p_modules: roleDraft.modules, p_responsabilites: roleDraft.responsabilites.trim() || null })
      : await supabase.rpc("enregistrer_role_bureau_config", { p_id: editingRole, p_nom: roleDraft.nom, p_modules: roleDraft.modules, p_responsabilites: roleDraft.responsabilites.trim() || null });
    setRoleBusy(false);
    if (error) { setRoleMsg(friendlyError(error, t)); return; }
    setEditingRole(null);
    load();
  }
  async function createCustomRole() {
    const nom = newCustomRoleName.trim();
    if (!nom) return;
    setRoleBusy(true); setRoleMsg("");
    const { data, error } = await supabase.rpc("creer_role_bureau_personnalise", { p_nom: nom });
    setRoleBusy(false);
    if (error) { setRoleMsg(friendlyError(error, t)); return; }
    setNewCustomRoleName("");
    await load();
    const newId = (Array.isArray(data) ? data[0]?.id : data?.id) || null;
    if (newId) openRoleEditor(newId, { nom, modules: [], responsabilites: "" });
  }
  async function deleteCustomRole(id) {
    if (!window.confirm(t("acces_role_confirm_delete"))) return;
    setRoleBusy(true); setRoleMsg("");
    const { error } = await supabase.rpc("supprimer_role_bureau_personnalise", { p_id: id });
    setRoleBusy(false);
    if (error) { setRoleMsg(friendlyError(error, t)); return; }
    load();
  }

  const membershipPending = membershipRequests.filter((r) => r.statut === "en_attente");
  const membershipTraitees = membershipRequests.filter((r) => r.statut !== "en_attente");

  async function resolveMembership(reqId, action) {
    const req = membershipRequests.find((r) => r.id === reqId);
    const confirmKey = action === "approuver" ? "acces_confirm_approve_membership" : "acces_confirm_reject_membership";
    if (!window.confirm(t(confirmKey).replace("{nom}", req?.nom || ""))) return;
    setBusyId(reqId); setMsg("");
    const { error } = await supabase.rpc("resolve_membership_request", { p_request_id: reqId, p_action: action });
    setBusyId(null);
    if (error) { setMsg(friendlyError(error, t)); return; }
    load();
  }

  // 2026-10-06 (demandé par l'utilisateur) — consulte un fichier joint par
  // la personne au moment de sa demande (pièce d'identité ou preuve de
  // paiement), stocké dans le bucket privé "member-join-documents" (voir
  // sql/2026-10-06_demande_adhesion_complete.sql) : URL signée temporaire,
  // jamais public.
  async function viewJoinDocument(path) {
    if (!path) return;
    const { data, error } = await supabase.storage.from("member-join-documents").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) { setMsg(friendlyError(error, t)); return; }
    window.open(data.signedUrl, "_blank");
  }

  // 2026-10-06 (demandé par l'utilisateur) — archive définitivement, dans le
  // coffre-fort documentaire de l'association (table/bucket "documents",
  // onglet Documents — mêmes conventions que handleFileUpload, App.jsx),
  // une COPIE de la pièce jointe à une demande d'adhésion : pour qu'elle
  // reste consultable et retrouvable par la suite, classée avec le reste
  // de la documentation, même après le traitement de la demande qui l'a
  // apportée. L'original dans "member-join-documents" n'est pas supprimé
  // (copie, pas déplacement) — il reste la trace brute de la demande
  // elle-même, encore visible depuis l'historique des demandes traitées.
  // Nommé "<adhérent> — <fichier original>" pour rester trouvable par la
  // recherche par nom de l'onglet Documents, qui ne cherche que par nom
  // de fichier, pas par adhérent.
  async function archiveJoinDocument(path, nomFichier, rubrique, memberNom) {
    if (!path) return;
    const { data: blob, error: dlError } = await supabase.storage.from("member-join-documents").download(path);
    if (dlError || !blob) { console.error("archiveJoinDocument: téléchargement échoué", dlError); return; }
    const nomOriginal = nomFichier || path.split("/").pop();
    const destPath = `${profile.association_id}/${Date.now()}_${nomOriginal}`;
    const { error: upError } = await supabase.storage.from("documents").upload(destPath, blob);
    if (upError) { console.error("archiveJoinDocument: dépôt échoué", upError); return; }
    const { error: insError } = await supabase.from("documents").insert({
      association_id: profile.association_id, nom: `${memberNom} — ${nomOriginal}`,
      storage_path: destPath, rubrique, uploaded_by: profile.id,
    });
    if (insError) console.error("archiveJoinDocument: enregistrement échoué", insError);
  }

  function copyCodeFor(reqId) {
    const code = association?.code_invitation;
    if (!code) return;
    try {
      navigator.clipboard.writeText(code);
      setCopiedCodeFor(reqId);
      setTimeout(() => setCopiedCodeFor(null), 2000);
    } catch { /* presse-papier indisponible : le code reste visible dans Configuration */ }
  }

  const profileName = (id) => profilesList.find((p) => p.id === id)?.nom_complet || id?.slice(0, 8) || "—";
  const memberName = (id) => membersList.find((m) => m.id === id)?.nom || null;
  const linkedMemberIds = new Set(profilesList.map((p) => p.member_id).filter(Boolean));
  const availableMembers = (currentSuggestion) => membersList.filter((m) => !linkedMemberIds.has(m.id) || m.id === currentSuggestion);

  const pending = requests.filter((r) => r.statut === "en_attente");
  const traitees = requests.filter((r) => r.statut !== "en_attente");

  async function resolve(reqId, action) {
    const req = requests.find((r) => r.id === reqId);
    const compteNom = profileName(req?.profile_id);
    if (action === "confirmer") {
      // 2026-10-06 (demandé par l'utilisateur) — "Confirmer" n'intègre plus
      // directement la demande : il ouvre d'abord la fiche adhérent
      // (nouvelle ou déjà suggérée/choisie ci-dessous) pour qu'elle soit
      // complète — nom, courriel, téléphone, adresse, etc. — avant d'être
      // intégrée à la liste des adhérents. C'est la validation DANS cette
      // fiche (saveCompleteMember) qui termine réellement la demande.
      openCompleteModal(reqId);
      return;
    }
    if (!window.confirm(t("acces_confirm_reject_request").replace("{compte}", compteNom))) return;
    setBusyId(reqId); setMsg("");
    const { error } = await supabase.rpc("resolve_member_link_request", { p_request_id: reqId, p_member_id: null, p_action: action });
    setBusyId(null);
    if (error) { setMsg(friendlyError(error, t)); return; }
    load();
    // 2026-10-06 (signalé par l'utilisateur) — confirmer/rejeter une demande
    // pose resolved_at (voir sql/2026-09-07b_rejoindre_association.sql), ce
    // qui retire bien cette ligne du compte "demandes_rattachement" de
    // get_unread_counts() côté base — mais le total déjà affiché sur la
    // cloche 🔔 (App.jsx, useUnreadCounts) ne se recalculait jamais tout
    // seul après coup : il fallait explicitement redemander le compte.
    onLinkRequestResolved?.();
  }

  // 2026-10-06 (demandé par l'utilisateur) — ouvre la fiche à compléter pour
  // la demande reqId : pré-remplie depuis la fiche membre déjà suggérée ou
  // choisie dans le menu déroulant s'il y en a une (memberId non nul —
  // auquel cas la validation METTRA À JOUR cette fiche existante), sinon
  // juste le nom du compte qui a rejoint (memberId nul — la validation
  // CRÉERA une nouvelle fiche adhérent).
  function openCompleteModal(reqId) {
    const req = requests.find((r) => r.id === reqId);
    const memberId = chosenMember[reqId] || req?.suggested_member_id || null;
    const existing = memberId ? membersList.find((m) => m.id === memberId) : null;
    // 2026-10-06 (demandé par l'utilisateur) — la personne a maintenant
    // rempli sa fiche et déclaré le paiement de son inscription dès sa
    // demande (voir App.jsx, CompleteJoinRequestForm) : on s'en sert pour
    // préremplir tout ce que la fiche existante (le cas échéant) n'a pas
    // déjà, pour qu'il n'y ait plus jamais rien à ressaisir ici.
    const dejaPayee = req?.preuve_paiement_mode && req.preuve_paiement_mode !== "non_paye";
    setCompleteModal({
      reqId,
      memberId: existing?.id || null,
      request: req || null,
      initial: {
        nom: existing?.nom || profileName(req?.profile_id) || "",
        email: existing?.email || req?.courriel || "",
        telephone: existing?.telephone || req?.telephone || "",
        sexe: existing?.sexe || req?.sexe || "",
        dateAdhesion: existing?.date_adhesion || todayISO(),
        statut: existing?.statut || "Actif",
        dateNaissance: existing?.date_naissance || req?.date_naissance || "",
        quartier: existing?.quartier || req?.quartier || "",
        competences: existing?.competences || req?.competences || "",
        disponibleBenevolat: existing?.disponible_benevolat || req?.disponible_benevolat || false,
        inscriptionPaye: existing?.inscription_paye ?? (dejaPayee ? (req?.preuve_paiement_montant ?? "") : ""),
        inscriptionDate: existing?.inscription_date || (dejaPayee ? todayISO() : ""),
      },
    });
  }

  // 2026-10-06 (demandé par l'utilisateur) — termine réellement la demande
  // reqId : crée (ou met à jour, voir openCompleteModal) la fiche adhérent
  // complète, PUIS seulement résout la demande de rattachement avec cette
  // fiche — pour que la personne intègre toujours la liste des adhérents de
  // façon complète, jamais avec juste un nom.
  async function saveCompleteMember(form) {
    const { reqId, memberId, request } = completeModal;
    setBusyId(reqId); setMsg("");
    const payload = {
      nom: form.nom.trim(), email: form.email.trim() || null, telephone: form.telephone || null,
      sexe: form.sexe || null, date_adhesion: form.dateAdhesion || null, statut: form.statut,
      date_naissance: form.dateNaissance || null, quartier: form.quartier || null,
      competences: form.competences || null, disponible_benevolat: form.disponibleBenevolat,
      // 2026-10-06 (demandé par l'utilisateur) — prérempli depuis la
      // déclaration de paiement faite au moment de la demande (ou la fiche
      // déjà existante), mais modifiable ici par le bureau avant validation.
      inscription_paye: form.inscriptionPaye === "" || form.inscriptionPaye == null ? null : Number(form.inscriptionPaye),
      inscription_date: form.inscriptionDate || null,
    };
    let finalMemberId = memberId;
    if (memberId) {
      const { error } = await supabase.from("members").update(payload).eq("id", memberId);
      if (error) { setBusyId(null); setMsg(friendlyError(error, t)); return; }
    } else {
      const { data, error } = await supabase.from("members").insert({ association_id: profile.association_id, ...payload }).select().single();
      if (error) { setBusyId(null); setMsg(friendlyError(error, t)); return; }
      finalMemberId = data.id;
    }
    // 2026-10-06 (demandé par l'utilisateur) — archive une copie permanente
    // de la pièce d'identité et de la preuve de paiement (si un fichier a
    // été joint — une simple déclaration espèces/autre n'a pas de fichier à
    // archiver) dans le coffre-fort documentaire, avant de résoudre la
    // demande. Volontairement non bloquant (erreur journalée, pas de
    // blocage de la confirmation) : l'adhésion elle-même ne doit pas
    // échouer pour un problème d'archivage secondaire.
    if (request?.piece_identite_path) {
      await archiveJoinDocument(request.piece_identite_path, request.piece_identite_nom, "piece_identite_adhesion", payload.nom);
    }
    if (request?.preuve_paiement_mode === "fichier" && request?.preuve_paiement_path) {
      await archiveJoinDocument(request.preuve_paiement_path, request.preuve_paiement_nom, "preuve_paiement_adhesion", payload.nom);
    }
    const { error: rpcError } = await supabase.rpc("resolve_member_link_request", { p_request_id: reqId, p_member_id: finalMemberId, p_action: "confirmer" });
    setBusyId(null);
    if (rpcError) { setMsg(friendlyError(rpcError, t)); return; }
    setCompleteModal(null);
    load();
    onLinkRequestResolved?.();
  }

  // 2026-10-07 (demandé par l'utilisateur) — selectValue encode soit un
  // rôle intégré (ex. "bureau_tresorier") soit un rôle personnalisé
  // ("custom:<id>", voir l'option générée plus bas) ; route maintenant
  // par assigner_role_bureau (sql/2026-10-07d_configuration_roles_
  // bureau.sql) plutôt qu'une simple update de profiles.role, pour que
  // bureau_role_config_id soit toujours mis à jour EN MÊME TEMPS que le
  // rôle (jamais l'un sans l'autre, pour ne pas laisser une association
  // à un rôle personnalisé périmée).
  async function changeRole(profileId, selectValue) {
    if (!isPresident) return;
    const isCustom = selectValue.startsWith("custom:");
    const role = isCustom ? "bureau_custom" : selectValue;
    const configId = isCustom ? selectValue.slice(7) : null;
    const nomCompte = profileName(profileId);
    const roleLabel = isCustom ? (roleConfigs.find((r) => r.id === configId)?.nom || selectValue) : t(ROLE_KEY_MAP[role] || role);
    if (!window.confirm(t("acces_confirm_role_change").replace("{nom}", nomCompte).replace("{role}", roleLabel))) return;
    setMsg("");
    const { error } = await supabase.rpc("assigner_role_bureau", { p_profile_id: profileId, p_role: role, p_bureau_role_config_id: configId });
    if (error) { setMsg(friendlyError(error, t)); return; }
    load();
  }

  async function toggleBlocked(profileId, blocked) {
    if (!isPresident) return;
    if (!window.confirm(blocked ? t("acces_confirm_block") : t("acces_confirm_unblock"))) return;
    setMsg("");
    const { error } = await supabase.from("profiles").update({ compte_bloque: blocked }).eq("id", profileId);
    if (error) { setMsg(friendlyError(error, t)); return; }
    load();
  }

  if (loading) return <Container><Section><p style={{ fontSize: 13, color: "#5B6270" }}>{t("acces_loading")}</p></Section></Container>;

  return (
    <Container><Section>
      <h2 style={{ marginBottom: 6 }}>{t("acces_title")}</h2>
      <p style={{ color: "#5B6270", marginBottom: 20, fontSize: 13 }}>{t("acces_intro")}</p>
      {msg && <p style={{ color: "#C0392B", fontSize: 12.5, marginBottom: 14 }}>{msg}</p>}

      <h3 style={{ fontSize: 14.5, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
        <Globe size={15} /> {t("acces_membership_pending_title")}
      </h3>
      <p style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>{t("acces_membership_pending_intro")}</p>
      {membershipPending.length === 0 ? (
        <RuleBox>{t("acces_membership_pending_empty")}</RuleBox>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 26 }}>
          {membershipPending.map((r) => (
            <Card key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <strong style={{ fontSize: 13.5 }}>{r.nom}</strong>
                  <p style={{ fontSize: 12, color: "#5B6270", marginTop: 2 }}>
                    {r.courriel}{r.telephone ? ` · ${r.telephone}` : ""}
                    {r.sexe ? ` · ${r.sexe === "M" ? t("mem_sexe_m") : t("mem_sexe_f")}` : ""}
                    {r.date_naissance ? ` · ${t("mem_birthdate")} : ${r.date_naissance}` : ""}
                    {r.quartier ? ` · ${r.quartier}` : ""}
                  </p>
                  {r.message && <p style={{ fontSize: 12, color: "#5B6270", marginTop: 4, fontStyle: "italic" }}>« {r.message} »</p>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Btn variant="outline" onClick={() => copyCodeFor(r.id)}>
                    <Copy size={13} /> {copiedCodeFor === r.id ? t("cfg_invite_copied") : t("acces_copy_invite_code")}
                  </Btn>
                  <Btn onClick={() => resolveMembership(r.id, "approuver")} disabled={busyId === r.id}>
                    <UserCheck size={14} /> {t("acces_confirm")}
                  </Btn>
                  <Btn variant="outline" onClick={() => resolveMembership(r.id, "rejeter")} disabled={busyId === r.id}>
                    <UserX size={14} /> {t("acces_reject")}
                  </Btn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {membershipTraitees.length > 0 && (
        <details style={{ marginBottom: 26 }}>
          <summary style={{ fontSize: 12.5, color: "#5B6270", cursor: "pointer" }}>{t("acces_history_title")} ({membershipTraitees.length})</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 10 }}>
            {membershipTraitees.slice(0, 20).map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #F0F1F3", fontSize: 12.5 }}>
                <span>{r.nom} <span style={{ color: "#9AA2B5" }}>({r.courriel})</span></span>
                <span style={{ color: r.statut === "approuve" ? "#1F8A5C" : "#C0392B", fontWeight: 600 }}>
                  {r.statut === "approuve" ? t("acces_status_confirmed") : t("acces_status_rejected")}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      <h3 style={{ fontSize: 14.5, marginBottom: 10 }}>{t("acces_pending_title")}</h3>
      {pending.length === 0 ? (
        <RuleBox>{t("acces_pending_empty")}</RuleBox>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 26 }}>
          {pending.map((r) => (
            <Card key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <strong style={{ fontSize: 13.5 }}>{profileName(r.profile_id)}</strong>
                  <p style={{ fontSize: 12, color: "#5B6270", marginTop: 2 }}>
                    {r.suggested_member_id
                      ? `${t("acces_suggested")} : ${memberName(r.suggested_member_id) || "—"}`
                      : t("acces_no_match")}
                  </p>
                  {/* 2026-10-06 (demandé par l'utilisateur) — fiche + pièce
                      d'identité + déclaration de paiement remplies par la
                      personne dès sa demande : le bureau vérifie ici avant
                      de cliquer Confirmer (voir sql/2026-10-06_demande_
                      adhesion_complete.sql et App.jsx, CompleteJoinRequestForm). */}
                  {(r.courriel || r.telephone || r.quartier || r.date_naissance) && (
                    <p style={{ fontSize: 12, color: "#5B6270", marginTop: 2 }}>
                      {r.courriel}{r.telephone ? ` · ${r.telephone}` : ""}
                      {r.sexe ? ` · ${r.sexe === "M" ? t("mem_sexe_m") : t("mem_sexe_f")}` : ""}
                      {r.date_naissance ? ` · ${t("mem_birthdate")} : ${r.date_naissance}` : ""}
                      {r.quartier ? ` · ${r.quartier}` : ""}
                    </p>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    {r.piece_identite_path ? (
                      <Btn variant="outline" onClick={() => viewJoinDocument(r.piece_identite_path)}>
                        <FileText size={13} /> {t("acces_view_identite_btn")}
                      </Btn>
                    ) : (
                      <span style={{ fontSize: 11.5, color: "#AAB0BA" }}>{t("acces_no_identite")}</span>
                    )}
                    {r.preuve_paiement_mode === "fichier" && r.preuve_paiement_path ? (
                      <Btn variant="outline" onClick={() => viewJoinDocument(r.preuve_paiement_path)}>
                        <Receipt size={13} /> {t("acces_view_paiement_btn")}
                        {r.preuve_paiement_montant != null ? ` · ${r.preuve_paiement_montant}` : ""}
                      </Btn>
                    ) : r.preuve_paiement_mode === "especes" ? (
                      <span style={{ fontSize: 11.5, color: "#5B6270" }}>
                        {t("acces_paiement_declared_cash")}{r.preuve_paiement_montant != null ? ` · ${r.preuve_paiement_montant}` : ""}
                      </span>
                    ) : r.preuve_paiement_mode === "autre" ? (
                      <span style={{ fontSize: 11.5, color: "#5B6270" }}>
                        {t("acces_paiement_declared_other")}{r.preuve_paiement_montant != null ? ` · ${r.preuve_paiement_montant}` : ""}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: "#AAB0BA" }}>{t("acces_paiement_not_paid")}</span>
                    )}
                  </div>
                  {r.preuve_paiement_note && (
                    <p style={{ fontSize: 11.5, color: "#5B6270", marginTop: 4, fontStyle: "italic" }}>« {r.preuve_paiement_note} »</p>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <select
                    style={{ fontSize: 12.5, padding: "6px 8px", borderRadius: 8, border: "1px solid #DADDE1" }}
                    value={chosenMember[r.id] ?? r.suggested_member_id ?? ""}
                    onChange={(e) => setChosenMember((p) => ({ ...p, [r.id]: e.target.value || null }))}
                  >
                    <option value="">{t("acces_pick_member")}</option>
                    {availableMembers(r.suggested_member_id).map((m) => (
                      <option key={m.id} value={m.id}>{m.nom}{m.email ? ` (${m.email})` : ""}</option>
                    ))}
                  </select>
                  <Btn onClick={() => resolve(r.id, "confirmer")} disabled={busyId === r.id}>
                    <UserCheck size={14} /> {t("acces_confirm")}
                  </Btn>
                  <Btn variant="outline" onClick={() => resolve(r.id, "rejeter")} disabled={busyId === r.id}>
                    <UserX size={14} /> {t("acces_reject")}
                  </Btn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: 14.5, marginBottom: 10 }}>{t("acces_accounts_title")}</h3>
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {profilesList.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F0F1F3", flexWrap: "wrap", gap: 8 }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{p.nom_complet || p.id.slice(0, 8)}</span>
                {p.member_id && <span style={{ fontSize: 11.5, color: "#5B6270", marginLeft: 8 }}>→ {memberName(p.member_id) || t("acces_linked_unknown")}</span>}
                {p.compte_bloque && <span style={{ fontSize: 11, color: "#C0392B", fontWeight: 700, marginLeft: 8, border: "1px solid #C0392B", borderRadius: 999, padding: "1px 8px" }}>{t("acces_blocked_badge")}</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select
                  disabled={!isPresident || p.id === profile.id}
                  style={{ fontSize: 12.5, padding: "5px 8px", borderRadius: 8, border: "1px solid #DADDE1", background: (!isPresident || p.id === profile.id) ? "#F1F2F4" : "white", cursor: (!isPresident || p.id === profile.id) ? "not-allowed" : "pointer" }}
                  value={p.role === "bureau_custom" ? "custom:" + (p.bureau_role_config_id || "") : p.role}
                  onChange={(e) => changeRole(p.id, e.target.value)}
                >
                  <option value="bureau_president">{t(ROLE_KEY_MAP.bureau_president)}</option>
                  <option value="bureau_secretaire">{t(ROLE_KEY_MAP.bureau_secretaire)}</option>
                  <option value="bureau_tresorier">{t(ROLE_KEY_MAP.bureau_tresorier)}</option>
                  {customRoles.map((r) => <option key={r.id} value={"custom:" + r.id}>{r.nom}</option>)}
                  <option value="responsable_rubrique">{t(ROLE_KEY_MAP.responsable_rubrique)}</option>
                  <option value="adherent">{t(ROLE_KEY_MAP.adherent)}</option>
                </select>
                {p.compte_bloque ? (
                  <button
                    disabled={!isPresident}
                    onClick={() => toggleBlocked(p.id, false)}
                    style={{ fontSize: 11, fontWeight: 600, color: isPresident ? "#1F8A5C" : "#AAB0BA", background: "none", border: `1px solid ${isPresident ? "#1F8A5C" : "#DADDE1"}`, borderRadius: 999, padding: "4px 10px", cursor: isPresident ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <ShieldCheck size={12} /> {t("acces_unblock_btn")}
                  </button>
                ) : (
                  <button
                    disabled={!isPresident || p.id === profile.id}
                    onClick={() => toggleBlocked(p.id, true)}
                    style={{ fontSize: 11, fontWeight: 600, color: (!isPresident || p.id === profile.id) ? "#AAB0BA" : "#C0392B", background: "none", border: `1px solid ${(!isPresident || p.id === profile.id) ? "#DADDE1" : "#C0392B"}`, borderRadius: 999, padding: "4px 10px", cursor: (!isPresident || p.id === profile.id) ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <Ban size={12} /> {t("acces_block_btn")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
      {!isPresident && <p style={{ fontSize: 11.5, color: "#C0392B", fontWeight: 600, marginTop: 10 }}>{t("cfg_president_only_note")}</p>}
      <p style={{ fontSize: 11, color: "#686F7D", marginTop: 14, display: "flex", alignItems: "center", gap: 6 }}>
        <KeyRound size={12} /> {t("acces_revoke_note")}
      </p>

      {/* ===== Rôles du bureau (suite 2026-10-07, demandé par l'utilisateur) =====
          Secrétaire/Trésorier/rôles personnalisés : quels modules chacun
          voit, et ses responsabilités en langage libre. Le président
          garde toujours accès complet, non configurable ici (voir
          sql/2026-10-07d_configuration_roles_bureau.sql). */}
      <h3 style={{ fontSize: 14.5, margin: "26px 0 10px" }}>{t("acces_roles_title")}</h3>
      <p style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>{t("acces_roles_intro")}</p>
      {roleMsg && <p style={{ color: "#C0392B", fontSize: 12.5, marginBottom: 10 }}>{roleMsg}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <strong style={{ fontSize: 13.5 }}>{t("role_bureau_president")}</strong>
              <p style={{ fontSize: 11.5, color: "#5B6270", marginTop: 2 }}>{t("acces_role_president_note")}</p>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#1F8A5C", border: "1px solid #1F8A5C", borderRadius: 999, padding: "3px 10px" }}>{t("acces_role_full_access")}</span>
          </div>
        </Card>

        {[{ cle: "bureau_secretaire", nom: t("role_bureau_secretaire") }, { cle: "bureau_tresorier", nom: t("role_bureau_tresorier") }].map(({ cle, nom }) => {
          const cfg = configFor(cle);
          return (
            <Card key={cle}>
              {editingRole === cle ? (
                <RoleEditorForm t={t} draft={roleDraft} setDraft={setRoleDraft} onToggleModule={toggleDraftModule} onSave={saveRoleEditor} onCancel={closeRoleEditor} busy={roleBusy} nomEditable={false} />
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <strong style={{ fontSize: 13.5 }}>{nom}</strong>
                    <p style={{ fontSize: 11.5, color: "#5B6270", marginTop: 2 }}>
                      {cfg ? t("acces_role_modules_count").replace("{n}", (cfg.modules || []).length) : t("acces_role_not_configured")}
                    </p>
                    {cfg?.responsabilites && <p style={{ fontSize: 11.5, color: "#5B6270", marginTop: 4, fontStyle: "italic" }}>« {cfg.responsabilites} »</p>}
                  </div>
                  {isPresident && (
                    <button onClick={() => openRoleEditor(cle, cfg)} style={{ fontSize: 11.5, fontWeight: 600, color: "var(--primary)", background: "none", border: "1px solid var(--primary)", borderRadius: 999, padding: "4px 10px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Settings size={12} /> {t("acces_role_configure_btn")}
                    </button>
                  )}
                </div>
              )}
            </Card>
          );
        })}

        {customRoles.map((r) => (
          <Card key={r.id}>
            {editingRole === r.id ? (
              <RoleEditorForm t={t} draft={roleDraft} setDraft={setRoleDraft} onToggleModule={toggleDraftModule} onSave={saveRoleEditor} onCancel={closeRoleEditor} busy={roleBusy} nomEditable={true} />
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <strong style={{ fontSize: 13.5 }}>{r.nom}</strong>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#8F6A24", background: "#FBF3D9", borderRadius: 999, padding: "1px 8px", marginLeft: 8 }}>{t("acces_role_custom_badge")}</span>
                  <p style={{ fontSize: 11.5, color: "#5B6270", marginTop: 2 }}>{t("acces_role_modules_count").replace("{n}", (r.modules || []).length)}</p>
                  {r.responsabilites && <p style={{ fontSize: 11.5, color: "#5B6270", marginTop: 4, fontStyle: "italic" }}>« {r.responsabilites} »</p>}
                </div>
                {isPresident && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => openRoleEditor(r.id, r)} style={{ fontSize: 11.5, fontWeight: 600, color: "var(--primary)", background: "none", border: "1px solid var(--primary)", borderRadius: 999, padding: "4px 10px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Pencil size={11} /> {t("acces_role_configure_btn")}
                    </button>
                    <button onClick={() => deleteCustomRole(r.id)} style={{ fontSize: 11.5, fontWeight: 600, color: "#C0392B", background: "none", border: "1px solid #C0392B", borderRadius: 999, padding: "4px 10px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Trash2 size={11} /> {t("action_delete")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
      {isPresident && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
          <input style={{ ...inputStyle, maxWidth: 260 }} placeholder={t("acces_role_new_placeholder")} value={newCustomRoleName} onChange={(e) => setNewCustomRoleName(e.target.value)} />
          <Btn variant="outline" onClick={createCustomRole} disabled={roleBusy || !newCustomRoleName.trim()}><Plus size={13} /> {t("acces_role_add_btn")}</Btn>
        </div>
      )}

      {traitees.length > 0 && (
        <>
          <h3 style={{ fontSize: 14.5, margin: "26px 0 10px" }}>{t("acces_history_title")}</h3>
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {traitees.slice(0, 20).map((r) => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #F0F1F3", fontSize: 12.5 }}>
                  <span>{profileName(r.profile_id)}</span>
                  <span style={{ color: r.statut === "confirme" ? "#1F8A5C" : "#C0392B", fontWeight: 600 }}>
                    {r.statut === "confirme" ? t("acces_status_confirmed") : t("acces_status_rejected")}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {completeModal && (
        <CompleteMemberModal
          initial={completeModal.initial}
          isNew={!completeModal.memberId}
          busy={busyId === completeModal.reqId}
          msg={msg}
          request={completeModal.request}
          onViewDocument={viewJoinDocument}
          onCancel={() => { setCompleteModal(null); setMsg(""); }}
          onValidate={saveCompleteMember}
          t={t}
        />
      )}
    </Section></Container>
  );
}

// =====================================================================
// CompleteMemberModal — 2026-10-06, demandé par l'utilisateur : étape
// obligatoire entre "Confirmer" une demande de rattachement et son
// intégration réelle à la liste des adhérents. Mêmes champs, mêmes options
// que la fiche "Ajouter un adhérent" (App.jsx, newMemberForm/handleAddMember)
// pour que la fiche créée (ou complétée, si une fiche suggérée/choisie
// existait déjà) soit exactement aussi complète qu'une fiche ajoutée
// manuellement — jamais seulement un nom.
// =====================================================================
function CompleteMemberModal({ initial, isNew, busy, msg, request, onViewDocument, onCancel, onValidate, t }) {
  const [form, setForm] = useState(initial);
  function handleValidate() {
    if (!form.nom.trim()) return;
    onValidate(form);
  }
  // 2026-10-06 (demandé par l'utilisateur) — dernier coup d'œil, juste avant
  // de valider, sur ce que la personne a joint à sa demande (pièce
  // d'identité + preuve ou déclaration de paiement) : déjà visible dans la
  // liste des demandes en attente, répété ici pour vérifier sans fermer
  // cette fenêtre.
  const hasJoinInfo = request && (request.piece_identite_path || request.preuve_paiement_mode);
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 560, width: "100%", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("acces_complete_member_title")}</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 16 }}>
          {isNew ? t("acces_complete_member_intro_new") : t("acces_complete_member_intro_existing")}
        </p>
        {msg && <p style={{ color: "#C0392B", fontSize: 12.5, marginBottom: 14 }}>{msg}</p>}
        {hasJoinInfo && (
          <div style={{ background: "#F7F8FA", borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 8px" }}>{t("acces_paiement_section_title")}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {request.piece_identite_path ? (
                <Btn variant="outline" onClick={() => onViewDocument(request.piece_identite_path)}>
                  <FileText size={13} /> {t("acces_view_identite_btn")}
                </Btn>
              ) : (
                <span style={{ fontSize: 11.5, color: "#AAB0BA" }}>{t("acces_no_identite")}</span>
              )}
              {request.preuve_paiement_mode === "fichier" && request.preuve_paiement_path ? (
                <Btn variant="outline" onClick={() => onViewDocument(request.preuve_paiement_path)}>
                  <Receipt size={13} /> {t("acces_view_paiement_btn")}
                </Btn>
              ) : request.preuve_paiement_mode === "especes" ? (
                <span style={{ fontSize: 11.5, color: "#5B6270" }}>{t("acces_paiement_declared_cash")}</span>
              ) : request.preuve_paiement_mode === "autre" ? (
                <span style={{ fontSize: 11.5, color: "#5B6270" }}>{t("acces_paiement_declared_other")}</span>
              ) : (
                <span style={{ fontSize: 11.5, color: "#AAB0BA" }}>{t("acces_paiement_not_paid")}</span>
              )}
            </div>
            {request.preuve_paiement_note && (
              <p style={{ fontSize: 11.5, color: "#5B6270", fontStyle: "italic", margin: "6px 0 0" }}>« {request.preuve_paiement_note} »</p>
            )}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 14 }}>
          <Field label={t("mem_fullname")}><input style={inputStyle} value={form.nom} onChange={(e) => setForm((p) => ({ ...p, nom: e.target.value }))} /></Field>
          <Field label={t("mem_email")}><input style={inputStyle} value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></Field>
          <Field label={t("mem_phone")}><input type="tel" style={inputStyle} value={form.telephone} onChange={(e) => setForm((p) => ({ ...p, telephone: e.target.value }))} placeholder={t("mem_phone_placeholder")} /></Field>
          <Field label={t("mem_sexe")}>
            <select style={inputStyle} value={form.sexe} onChange={(e) => setForm((p) => ({ ...p, sexe: e.target.value }))}>
              <option value="">{t("mem_sexe_placeholder")}</option>
              <option value="M">{t("mem_sexe_m")}</option>
              <option value="F">{t("mem_sexe_f")}</option>
            </select>
          </Field>
          <Field label={t("mem_join_date")}><input type="date" style={inputStyle} value={form.dateAdhesion} onChange={(e) => setForm((p) => ({ ...p, dateAdhesion: e.target.value }))} /></Field>
          <Field label={t("mem_status")}>
            <select style={inputStyle} value={form.statut} onChange={(e) => setForm((p) => ({ ...p, statut: e.target.value }))}>
              <option value="Actif">{t("mem_active")}</option><option value="Inactif">{t("mem_inactive")}</option>
            </select>
          </Field>
          <Field label={t("mem_birthdate")}><input type="date" style={inputStyle} value={form.dateNaissance} onChange={(e) => setForm((p) => ({ ...p, dateNaissance: e.target.value }))} /></Field>
          <Field label={t("mem_address")}><input style={inputStyle} value={form.quartier} onChange={(e) => setForm((p) => ({ ...p, quartier: e.target.value }))} /></Field>
          <Field label={t("mem_skills")}><input style={inputStyle} value={form.competences} onChange={(e) => setForm((p) => ({ ...p, competences: e.target.value }))} placeholder={t("mem_skills_placeholder")} /></Field>
          <Field label={t("mem_volunteer")}>
            <select style={inputStyle} value={form.disponibleBenevolat ? "oui" : "non"} onChange={(e) => setForm((p) => ({ ...p, disponibleBenevolat: e.target.value === "oui" }))}><option value="non">{t("mem_no")}</option><option value="oui">{t("mem_yes")}</option></select>
          </Field>
          <Field label={t("acces_complete_inscription_amount_label")}>
            <input type="number" step="0.01" min="0" style={inputStyle} value={form.inscriptionPaye} onChange={(e) => setForm((p) => ({ ...p, inscriptionPaye: e.target.value }))} />
          </Field>
          <Field label={t("acces_complete_inscription_date_label")}>
            <input type="date" style={inputStyle} value={form.inscriptionDate} onChange={(e) => setForm((p) => ({ ...p, inscriptionDate: e.target.value }))} />
          </Field>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={handleValidate} disabled={busy}>{t("acces_complete_member_validate_btn")}</Btn>
          <Btn variant="outline" onClick={onCancel} disabled={busy}>{t("action_cancel")}</Btn>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// RoleEditorForm — 2026-10-07, demandé par l'utilisateur : formulaire
// d'édition d'un rôle de bureau (Secrétaire/Trésorier/personnalisé) —
// nom (rôles personnalisés seulement), responsabilités en texte libre,
// et la grille de modules autorisés. Rendu en place dans la carte du
// rôle (pas de modale), voir son usage plus haut.
// =====================================================================
function RoleEditorForm({ t, draft, setDraft, onToggleModule, onSave, onCancel, busy, nomEditable }) {
  return (
    <div>
      {nomEditable && (
        <Field label={t("acces_role_name_label")}>
          <input style={inputStyle} value={draft.nom} onChange={(e) => setDraft((p) => ({ ...p, nom: e.target.value }))} />
        </Field>
      )}
      <div style={{ margin: "10px 0" }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#182233", display: "block", marginBottom: 6 }}>{t("acces_role_responsibilities_label")}</label>
        <textarea
          style={{ ...inputStyle, minHeight: 60, resize: "vertical", fontFamily: "inherit", width: "100%" }}
          placeholder={t("acces_role_responsibilities_placeholder")}
          value={draft.responsabilites}
          onChange={(e) => setDraft((p) => ({ ...p, responsabilites: e.target.value }))}
        />
      </div>
      <div style={{ margin: "10px 0" }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#182233", display: "block", marginBottom: 6 }}>{t("acces_role_modules_label")}</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 6 }}>
          {BUREAU_CONFIGURABLE_MODULES.map((id) => (
            <label key={id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={draft.modules.includes(id)} onChange={() => onToggleModule(id)} />
              {t(BUREAU_MODULE_LABEL_KEYS[id])}
            </label>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Btn onClick={onSave} disabled={busy}>{t("action_save")}</Btn>
        <Btn variant="outline" onClick={onCancel} disabled={busy}><X size={13} /> {t("action_cancel")}</Btn>
      </div>
    </div>
  );
}
