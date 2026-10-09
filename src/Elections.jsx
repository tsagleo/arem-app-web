// =====================================================================
// Elections.jsx — Élections avec vote secret et comité électoral
// =====================================================================
// Demande de l'utilisateur (2026-10-09) : des élections « professionnelles »,
// sur le modèle du vote papier d'une assemblée générale. Voir
// sql/2026-10-09a_elections_vote_secret.sql (urne séparée de l'émargement)
// et sql/2026-10-09a_elections_vote_secret_comite.sql (comité, calendrier,
// éligibilité, procurations, départage, proclamation).
//
//  • Comité électoral (président d'élection + 2 à 4 scrutateurs) désigné
//    par le bureau ; ses membres ne peuvent pas être candidats.
//  • Calendrier en étapes affiché à tous : candidatures → validation →
//    campagne → scrutin → dépouillement → proclamation + recours.
//  • Un scrutin par poste ; éligibilité calculée par la base.
//  • Procurations déclarées avant le scrutin, validées par le comité.
//  • Participation et quorum en direct ; AUCUN résultat avant la clôture.
//  • Égalité : départage par tirage au sort vérifiable (rubrique Tirages).
//  • Procès-verbal PDF signé par le comité.
// Toute action sensible passe par une fonction RPC qui revérifie tout en
// base : l'interface ne fait qu'afficher et proposer.
// =====================================================================
import { useState, useEffect, useCallback, useRef } from "react";
import { Vote, Trash2, FileDown, UserCheck, Users2, CheckCircle2, XCircle, Clock, Dices, Gavel, Handshake, ShieldCheck, Lock, FileSignature, Upload, FolderOpen } from "lucide-react";
import { supabase } from "./supabaseClient";
import { pdfTexte, enTeteOfficiel, piedsDePageOfficiels, couleurAssociation } from "./pdfOfficiel";
import { Card, Btn, Field, Table, td, RuleBox, inputStyle, RED, TEAL, TEAL_LIGHT, friendlyError, datetimeLocalToISO, formatEventDateTime } from "./shared";

const TXT = {
  fr: {
    create_title: "Organiser une élection",
    f_title: "Titre", f_description: "Description",
    f_postes: "Postes à pourvoir (séparés par des virgules)", f_postes_ph: "Président, Trésorier, Secrétaire",
    f_cand_debut: "Ouverture des candidatures", f_cand_fin: "Clôture des candidatures",
    f_valid_fin: "Fin de la validation par le comité (la campagne suit)",
    f_scrutin_debut: "Ouverture du scrutin", f_scrutin_fin: "Clôture du scrutin",
    f_recours: "Délai de recours après proclamation (jours)",
    f_anciennete: "Ancienneté minimale pour voter / être candidat (mois)",
    f_cotisation: "Exiger d'être à jour du droit d'inscription",
    f_quorum: "Quorum (% des électeurs, vide = aucun)",
    f_procurations: "Autoriser les procurations (une par mandataire)",
    create_btn: "Créer l'élection", cancel: "Annuler", pdf_member: "Membre",
    create_missing: "Titre, ouverture et clôture du scrutin sont obligatoires.",
    confirm_create: "Créer l'élection « {titre} » ?",
    step_candidatures: "Appel à candidatures", step_validation: "Validation d'éligibilité", step_campagne: "Campagne",
    step_scrutin: "Scrutin", step_depouillement: "Dépouillement", step_proclamation: "Proclamation et recours",
    etape_preparation: "En préparation", etape_candidatures: "Candidatures ouvertes", etape_validation: "Validation des candidatures",
    etape_campagne: "Campagne électorale", etape_scrutin: "Scrutin ouvert", etape_depouillement: "Dépouillement",
    etape_recours: "Résultats proclamés — délai de recours", etape_terminee: "Élection terminée",
    until: "jusqu'au", from: "dès le",
    delete_btn: "Supprimer", confirm_delete: "Supprimer définitivement cette élection, ses candidatures, son comité et tous ses bulletins ?",
    close_now_btn: "Clore le scrutin maintenant", confirm_close_now: "Clore le scrutin maintenant ? Plus personne ne pourra voter.",
    params: "Règles : {regles}",
    p_anciennete: "{n} mois d'ancienneté minimum", p_cotisation: "droit d'inscription à jour", p_quorum: "quorum {n} %",
    p_procurations: "procurations autorisées", p_no_procurations: "pas de procuration", p_actif: "membres actifs",
    comite_title: "Comité électoral",
    comite_help: "Le comité valide les candidatures et les procurations, surveille le scrutin et proclame les résultats. Ses membres ne peuvent pas être candidats.",
    role_president: "Président(e) d'élection", role_scrutateur: "Scrutateur / scrutatrice",
    comite_add: "Désigner", comite_choose: "— Choisir un membre actif —",
    comite_incomplete: "Comité incomplet : il faut un(e) président(e) d'élection et 2 à 4 scrutateurs.",
    comite_empty: "Aucun membre désigné pour l'instant.",
    confirm_comite_remove: "Retirer {nom} du comité électoral ?",
    my_situation: "Ma situation",
    elig_ok: "Vous êtes électeur(trice) pour cette élection.",
    elig_no: "Vous ne pouvez pas voter : {motif}.",
    m_non_membre: "fiche membre introuvable", m_inactif: "membre non actif", m_anciennete: "ancienneté insuffisante",
    m_cotisation: "droit d'inscription non à jour", m_comite: "membre du comité électoral",
    not_linked: "Votre compte n'est pas relié à une fiche membre : vous ne pouvez ni voter ni être candidat(e). Membre du bureau (ex. fondateur) : Gestion des accès → « Relier mon compte à ma fiche ». Adhérent : le bureau doit confirmer votre demande.",
    cand_title: "Candidatures",
    cand_none: "Aucune candidature pour l'instant.",
    st_en_attente: "En attente du comité", st_validee: "Validée", st_rejetee: "Rejetée",
    cand_rejected_reason: "Motif : {motif}",
    cand_profession: "Profession de foi",
    cand_no_profession: "Pas de profession de foi.",
    cand_deposit_title: "Déposer ma candidature",
    cand_deposit_help: "Votre photo de profil (fiche membre) sera affichée à côté de votre candidature. Le comité électoral vérifiera votre éligibilité.",
    cand_poste: "Poste visé", cand_deposit_btn: "Déposer ma candidature",
    confirm_deposit: "Déposer votre candidature au poste « {poste} » ?",
    cand_not_eligible: "Vous ne pouvez pas être candidat(e) : {motif}.",
    cand_edit_btn: "Modifier ma profession de foi", cand_save_btn: "Enregistrer", cand_withdraw_btn: "Retirer ma candidature",
    confirm_withdraw: "Retirer votre candidature ?",
    validate_btn: "Valider", reject_btn: "Rejeter", reject_prompt: "Motif du rejet (communiqué au candidat) :",
    bureau_add_cand: "Ajouter un candidat (bureau)", bureau_add_cand_btn: "Ajouter",
    confirm_bureau_add: "Ajouter {nom} comme candidat(e) ? Le comité devra valider la candidature.",
    confirm_delete_cand: "Supprimer cette candidature ?",
    no_poste: "Poste non précisé",
    participation_title: "Participation en direct",
    participation_line: "{v} votant(s) sur {i} électeur(s) — {pct} %",
    procuration_line: "dont {n} par procuration",
    quorum_ok: "Quorum atteint ({q} votant(s) requis)", quorum_ko: "Quorum non atteint : {q} votant(s) requis",
    no_results_yet: "Vote secret : aucun résultat n'est connu avant la clôture du scrutin.",
    depouillement_wait: "Dépouillement en cours par le comité : les résultats seront publiés à la proclamation.",
    ballot_title: "Mon bulletin",
    ballot_for: "Bulletin de mon mandant : {nom}",
    ballot_help: "Choisissez un(e) candidat(e) par poste. Votre choix est secret : il est déposé dans l'urne sans votre nom.",
    vote_btn: "Voter", voted: "A voté ✓", confirm_vote: "Voter pour {nom} au poste « {poste} » ? Ce vote est définitif.",
    confirm_vote_proxy: "Voter pour {nom} au poste « {poste} », AU NOM DE {mandant} ? Ce vote est définitif.",
    no_valid_cands: "Aucune candidature validée pour ce poste.",
    proc_title: "Procurations",
    proc_help: "Un membre qui ne pourra pas voter peut, AVANT le scrutin, donner procuration à un autre électeur. Un mandataire ne porte qu'une seule procuration ; le comité les valide.",
    proc_give: "Donner ma procuration à", proc_choose: "— Choisir un électeur —", proc_give_btn: "Déclarer la procuration",
    confirm_proc: "Donner votre procuration à {nom} ? Il ou elle votera à votre place pour tous les postes.",
    proc_none: "Aucune procuration déclarée.",
    proc_st_en_attente: "En attente du comité", proc_st_validee: "Validée", proc_st_refusee: "Refusée", proc_st_annulee: "Annulée",
    proc_cancel_btn: "Annuler", confirm_proc_cancel: "Annuler votre procuration ?",
    proc_validate_btn: "Valider", proc_refuse_btn: "Refuser",
    results_title: "Résultats",
    col_candidate: "Candidat(e)", col_votes: "Voix", col_pct: "%",
    quorum_ko_result: "Quorum non atteint : le scrutin n'est pas valable, aucun(e) candidat(e) n'est élu(e). Les voix sont données à titre d'information ; l'élection est à reprendre.",
    elected: "Élu(e)", tie: "Égalité", elected_by_draw: "Élu(e) par tirage au sort",
    no_votes: "Aucun vote exprimé pour ce poste.",
    tie_help: "Égalité en tête : le bureau prépare un tirage au sort vérifiable entre les ex æquo, puis le lance en direct dans la rubrique « Tirages au sort ».",
    tie_btn: "Préparer le tirage de départage",
    confirm_tie: "Préparer un tirage au sort entre les candidats à égalité pour « {poste} » ?",
    tie_prepared: "Tirage préparé. Lancez-le en direct dans la rubrique « Tirages au sort ».",
    tie_pending: "Tirage de départage en attente (rubrique « Tirages au sort »).",
    tie_cancelled: "Le tirage de départage a été annulé : préparez-en un nouveau.",
    proclaim_btn: "Proclamer les résultats",
    confirm_proclaim: "Proclamer officiellement les résultats ? Ils deviennent publics et le délai de recours commence.",
    proclaim_need_president: "Seul(e) le/la président(e) d'élection peut proclamer les résultats.",
    proclaim_blocked_comite: "Proclamation impossible tant que le comité n'a pas au moins 2 scrutateurs.",
    proclaim_blocked_tie: "Proclamation impossible tant qu'une égalité n'est pas départagée.",
    proclaimed_on: "Résultats proclamés le {date} par {nom}.",
    recours_until: "Recours possibles jusqu'au {date} (à adresser au comité électoral).",
    pv_btn: "Procès-verbal (PDF)",
    schema_pending: "Les nouvelles fonctions électorales ne sont pas encore installées : exécutez le script sql/2026-10-09a_elections_vote_secret_comite.sql dans Supabase.",
    empty: "Aucune élection pour l'instant.",
    pdf_title: "Procès-verbal des élections",
    pdf_generated: "Généré le",
    pdf_calendar: "Calendrier",
    pdf_comite: "Comité électoral",
    pdf_rules: "Règles d'éligibilité",
    pdf_participation: "Participation",
    pdf_inscrits: "Électeurs inscrits", pdf_votants: "Votants", pdf_taux: "Taux de participation",
    pdf_procurations: "Votes par procuration", pdf_quorum: "Quorum requis",
    pdf_quorum_ok: "atteint", pdf_quorum_ko: "NON atteint", pdf_quorum_none: "aucun",
    pdf_results: "Résultats par poste",
    pdf_tie_note: "Égalité départagée par tirage au sort vérifiable — empreinte : {h}",
    pdf_proclamation: "Proclamation",
    pdf_not_proclaimed: "Résultats non encore proclamés (document provisoire).",
    pdf_secret: "Vote secret : l'urne ne contient aucun lien entre votant et bulletin ; seule la liste d'émargement indique qui a voté.",
    pdf_sign: "Signatures du comité électoral",
    pdf_signed_on: "Signé électroniquement le {date}", pdf_signed_ref: "depuis son compte - réf. {h}",
    pdf_fingerprint: "Empreinte des résultats signés (SHA-256) : {h}",
    pdf_awaiting: "Signature électronique en attente",
    pvb_title: "Procès-verbal : signatures et archivage",
    pvb_help: "Chaque membre du comité signe le PV depuis son propre compte. Quand tout le comité a signé, le président d'élection (ou le bureau) le verse dans Documents (rubrique Gouvernance). On peut aussi téléverser le scan d'un PV signé à la main.",
    pvb_signed: "Signé le {date}", pvb_waiting: "En attente de signature",
    pvb_sign_btn: "Signer le PV", confirm_sign: "Signer électroniquement le procès-verbal ? Votre signature atteste les résultats proclamés et ne pourra pas être retirée.",
    pvb_download_btn: "Télécharger le PV", pvb_file_btn: "Verser le PV signé aux Documents",
    confirm_file: "Verser le procès-verbal signé par tout le comité dans Documents (rubrique Gouvernance) ?",
    pvb_scan_btn: "Téléverser un PV signé à la main (scan)", confirm_scan: "Verser « {nom} » comme procès-verbal signé à la main ?",
    pvb_missing: "Il manque encore {n} signature(s) du comité avant de pouvoir verser la version électronique.",
    pvb_filed: "PV versé dans Documents le {date} par {nom}{mode}.", pvb_filed_scan: " (scan signé à la main)",
    pvb_open_btn: "Ouvrir le PV archivé", pvb_refile: "Verser une nouvelle version",
    pvb_done_signed: "Merci, votre signature est enregistrée.", pvb_done_filed: "Procès-verbal versé dans Documents.",
    pvb_upload_error: "Envoi du fichier impossible : {e}",
    pdf_from_to: "du {a} au {b}", pdf_until: "jusqu’au {a}", pdf_page: "Page {p} sur {n}", pdf_signature: "Signature", pdf_date: "Date",
    pdf_col_result: "Résultat", pdf_role: "Rôle", pdf_none: "Aucun membre désigné.", pdf_election: "Élection", pdf_status: "Statut",
  },
  en: {
    create_title: "Organize an election",
    f_title: "Title", f_description: "Description",
    f_postes: "Positions to fill (comma-separated)", f_postes_ph: "President, Treasurer, Secretary",
    f_cand_debut: "Nominations open", f_cand_fin: "Nominations close",
    f_valid_fin: "End of committee review (campaign follows)",
    f_scrutin_debut: "Voting opens", f_scrutin_fin: "Voting closes",
    f_recours: "Appeal period after proclamation (days)",
    f_anciennete: "Minimum membership to vote / run (months)",
    f_cotisation: "Require registration fee to be paid up",
    f_quorum: "Quorum (% of voters, empty = none)",
    f_procurations: "Allow proxy votes (one per proxy holder)",
    create_btn: "Create election", cancel: "Cancel", pdf_member: "Member",
    create_missing: "Title, voting opening and closing are required.",
    confirm_create: "Create the election \"{titre}\"?",
    step_candidatures: "Call for candidates", step_validation: "Eligibility review", step_campagne: "Campaign",
    step_scrutin: "Voting", step_depouillement: "Counting", step_proclamation: "Proclamation & appeals",
    etape_preparation: "In preparation", etape_candidatures: "Nominations open", etape_validation: "Reviewing nominations",
    etape_campagne: "Campaign", etape_scrutin: "Voting open", etape_depouillement: "Counting",
    etape_recours: "Results proclaimed — appeal period", etape_terminee: "Election completed",
    until: "until", from: "from",
    delete_btn: "Delete", confirm_delete: "Permanently delete this election, its nominations, committee and all ballots?",
    close_now_btn: "Close voting now", confirm_close_now: "Close voting now? Nobody will be able to vote anymore.",
    params: "Rules: {regles}",
    p_anciennete: "{n} months minimum membership", p_cotisation: "registration fee paid up", p_quorum: "quorum {n}%",
    p_procurations: "proxy votes allowed", p_no_procurations: "no proxy votes", p_actif: "active members",
    comite_title: "Election committee",
    comite_help: "The committee reviews nominations and proxies, oversees voting and proclaims the results. Its members cannot run.",
    role_president: "Returning officer", role_scrutateur: "Scrutineer",
    comite_add: "Appoint", comite_choose: "— Choose an active member —",
    comite_incomplete: "Committee incomplete: one returning officer and 2 to 4 scrutineers are required.",
    comite_empty: "No one appointed yet.",
    confirm_comite_remove: "Remove {nom} from the election committee?",
    my_situation: "My status",
    elig_ok: "You are a voter in this election.",
    elig_no: "You cannot vote: {motif}.",
    m_non_membre: "member record not found", m_inactif: "member not active", m_anciennete: "insufficient membership length",
    m_cotisation: "registration fee not paid up", m_comite: "member of the election committee",
    not_linked: "Your account is not linked to a member record: you can neither vote nor run. Board member (e.g. founder): Access management → \"Link my account to my record\". Member: the board must confirm your request.",
    cand_title: "Nominations",
    cand_none: "No nominations yet.",
    st_en_attente: "Awaiting committee", st_validee: "Approved", st_rejetee: "Rejected",
    cand_rejected_reason: "Reason: {motif}",
    cand_profession: "Candidate statement",
    cand_no_profession: "No statement.",
    cand_deposit_title: "Submit my candidacy",
    cand_deposit_help: "Your profile photo (member record) will be shown next to your candidacy. The election committee will check your eligibility.",
    cand_poste: "Position", cand_deposit_btn: "Submit my candidacy",
    confirm_deposit: "Submit your candidacy for \"{poste}\"?",
    cand_not_eligible: "You cannot run: {motif}.",
    cand_edit_btn: "Edit my statement", cand_save_btn: "Save", cand_withdraw_btn: "Withdraw my candidacy",
    confirm_withdraw: "Withdraw your candidacy?",
    validate_btn: "Approve", reject_btn: "Reject", reject_prompt: "Reason for rejection (shared with the candidate):",
    bureau_add_cand: "Add a candidate (board)", bureau_add_cand_btn: "Add",
    confirm_bureau_add: "Add {nom} as a candidate? The committee will have to approve.",
    confirm_delete_cand: "Delete this nomination?",
    no_poste: "Position not specified",
    participation_title: "Live turnout",
    participation_line: "{v} voter(s) out of {i} eligible — {pct}%",
    procuration_line: "including {n} by proxy",
    quorum_ok: "Quorum reached ({q} voter(s) required)", quorum_ko: "Quorum not reached: {q} voter(s) required",
    no_results_yet: "Secret ballot: no result is known before voting closes.",
    depouillement_wait: "The committee is counting: results will be published at proclamation.",
    ballot_title: "My ballot",
    ballot_for: "Ballot for my principal: {nom}",
    ballot_help: "Choose one candidate per position. Your choice is secret: it goes into the ballot box without your name.",
    vote_btn: "Vote", voted: "Voted ✓", confirm_vote: "Vote for {nom} as \"{poste}\"? This vote is final.",
    confirm_vote_proxy: "Vote for {nom} as \"{poste}\", ON BEHALF OF {mandant}? This vote is final.",
    no_valid_cands: "No approved candidate for this position.",
    proc_title: "Proxy votes",
    proc_help: "A member who cannot vote may, BEFORE voting opens, give a proxy to another voter. A proxy holder carries only one proxy; the committee approves them.",
    proc_give: "Give my proxy to", proc_choose: "— Choose a voter —", proc_give_btn: "Declare proxy",
    confirm_proc: "Give your proxy to {nom}? They will vote on your behalf for every position.",
    proc_none: "No proxy declared.",
    proc_st_en_attente: "Awaiting committee", proc_st_validee: "Approved", proc_st_refusee: "Refused", proc_st_annulee: "Cancelled",
    proc_cancel_btn: "Cancel", confirm_proc_cancel: "Cancel your proxy?",
    proc_validate_btn: "Approve", proc_refuse_btn: "Refuse",
    results_title: "Results",
    col_candidate: "Candidate", col_votes: "Votes", col_pct: "%",
    quorum_ko_result: "Quorum not reached: the vote is not valid and no candidate is elected. Votes are shown for information only; the election must be held again.",
    elected: "Elected", tie: "Tie", elected_by_draw: "Elected by draw",
    no_votes: "No vote cast for this position.",
    tie_help: "Tie at the top: the board prepares a verifiable draw between the tied candidates, then runs it live in the \"Draws\" section.",
    tie_btn: "Prepare the tie-break draw",
    confirm_tie: "Prepare a draw between the tied candidates for \"{poste}\"?",
    tie_prepared: "Draw prepared. Run it live in the \"Draws\" section.",
    tie_pending: "Tie-break draw pending (\"Draws\" section).",
    tie_cancelled: "The tie-break draw was cancelled: prepare a new one.",
    proclaim_btn: "Proclaim the results",
    confirm_proclaim: "Officially proclaim the results? They become public and the appeal period starts.",
    proclaim_need_president: "Only the returning officer can proclaim the results.",
    proclaim_blocked_comite: "Cannot proclaim until the committee has at least 2 scrutineers.",
    proclaim_blocked_tie: "Cannot proclaim while a tie is unresolved.",
    proclaimed_on: "Results proclaimed on {date} by {nom}.",
    recours_until: "Appeals accepted until {date} (address them to the election committee).",
    pv_btn: "Minutes (PDF)",
    schema_pending: "The new election functions are not installed yet: run sql/2026-10-09a_elections_vote_secret_comite.sql in Supabase.",
    empty: "No election yet.",
    pdf_title: "Election minutes",
    pdf_generated: "Generated on",
    pdf_calendar: "Schedule",
    pdf_comite: "Election committee",
    pdf_rules: "Eligibility rules",
    pdf_participation: "Turnout",
    pdf_inscrits: "Registered voters", pdf_votants: "Voters", pdf_taux: "Turnout rate",
    pdf_procurations: "Proxy votes", pdf_quorum: "Quorum required",
    pdf_quorum_ok: "reached", pdf_quorum_ko: "NOT reached", pdf_quorum_none: "none",
    pdf_results: "Results by position",
    pdf_tie_note: "Tie broken by verifiable draw — fingerprint: {h}",
    pdf_proclamation: "Proclamation",
    pdf_not_proclaimed: "Results not yet proclaimed (provisional document).",
    pdf_secret: "Secret ballot: the ballot box holds no link between voter and ballot; only the sign-in list shows who voted.",
    pdf_sign: "Election committee signatures",
    pdf_signed_on: "Electronically signed on {date}", pdf_signed_ref: "from their own account - ref. {h}",
    pdf_fingerprint: "Fingerprint of the signed results (SHA-256): {h}",
    pdf_awaiting: "Electronic signature pending",
    pvb_title: "Minutes: signatures and filing",
    pvb_help: "Each committee member signs the minutes from their own account. Once the whole committee has signed, the returning officer (or the board) files them in Documents (Governance). A scan of minutes signed by hand can also be uploaded.",
    pvb_signed: "Signed on {date}", pvb_waiting: "Awaiting signature",
    pvb_sign_btn: "Sign the minutes", confirm_sign: "Electronically sign the minutes? Your signature certifies the proclaimed results and cannot be withdrawn.",
    pvb_download_btn: "Download the minutes", pvb_file_btn: "File the signed minutes in Documents",
    confirm_file: "File the minutes signed by the whole committee in Documents (Governance)?",
    pvb_scan_btn: "Upload minutes signed by hand (scan)", confirm_scan: "File \"{nom}\" as the minutes signed by hand?",
    pvb_missing: "{n} committee signature(s) still missing before the electronic version can be filed.",
    pvb_filed: "Minutes filed in Documents on {date} by {nom}{mode}.", pvb_filed_scan: " (scan signed by hand)",
    pvb_open_btn: "Open the filed minutes", pvb_refile: "File a new version",
    pvb_done_signed: "Thank you, your signature is recorded.", pvb_done_filed: "Minutes filed in Documents.",
    pvb_upload_error: "File upload failed: {e}",
    pdf_from_to: "from {a} to {b}", pdf_until: "until {a}", pdf_page: "Page {p} of {n}", pdf_signature: "Signature", pdf_date: "Date",
    pdf_col_result: "Result", pdf_role: "Role", pdf_none: "No member appointed.", pdf_election: "Election", pdf_status: "Status",
  },
};

const ETAPES = ["candidatures", "validation", "campagne", "scrutin", "depouillement", "proclamation"];
const ETAPE_INDEX = { preparation: -1, candidatures: 0, validation: 1, campagne: 2, scrutin: 3, depouillement: 4, recours: 5, terminee: 6 };
const AVANT_SCRUTIN = ["preparation", "candidatures", "validation", "campagne"];
const GREY = "#686F7D";

// Même règle que public.election_etape() (sql 2026-10-09a_…_comite) : la
// base fait foi, ce calcul sert seulement à basculer l'affichage à l'heure
// pile sans attendre un rechargement.
function etapeElection(el, now = Date.now()) {
  const ts = (v) => (v ? new Date(v).getTime() : null);
  const proclame = ts(el.proclame_le);
  if (proclame != null) return now < proclame + (el.delai_recours_jours || 0) * 86400000 ? "recours" : "terminee";
  if (el.statut !== "ouverte" || (el.date_fin && now > ts(el.date_fin))) return "depouillement";
  if (!el.date_debut || now >= ts(el.date_debut)) return "scrutin";
  if (el.candidatures_debut && now < ts(el.candidatures_debut)) return "preparation";
  if (el.candidatures_fin && now < ts(el.candidatures_fin)) return "candidatures";
  if (el.validation_fin && now < ts(el.validation_fin)) return "validation";
  if (!el.candidatures_fin) return "candidatures";
  return "campagne";
}

function fill(s, vars) {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);
}
function posteKey(c) { return c.poste_vise || ""; }
function rpcMessage(error, t) {
  // Les fonctions électorales lèvent des messages clairs en français (code
  // P0001) : on les montre tels quels plutôt qu'un « erreur générique ».
  return error?.code === "P0001" ? error.message : friendlyError(error, t);
}

function Photo({ url, nom, size = 34 }) {
  const initiales = (nom || "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return url
    ? <img src={url} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
    : <span style={{ width: size, height: size, borderRadius: "50%", background: TEAL_LIGHT, color: TEAL, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.38, flexShrink: 0 }}>{initiales}</span>;
}

function Pill({ color, children }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" }}>{children}</span>;
}
const smallBtn = { padding: "4px 10px", fontSize: 12 };
const linkDanger = { fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };

// =====================================================================
export default function Elections({ profile, isBureau, association, members, t, lang }) {
  const L = TXT[lang === "en" ? "en" : "fr"];
  const myId = profile.member_id || null;
  const [elections, setElections] = useState([]);
  const [candidats, setCandidats] = useState([]);
  const [comite, setComite] = useState([]);
  const [procurations, setProcurations] = useState([]);
  const [departages, setDepartages] = useState([]);
  const [pvSignatures, setPvSignatures] = useState([]);
  const [tirages, setTirages] = useState({});
  const [etats, setEtats] = useState({});
  const [emargements, setEmargements] = useState([]); // les miens + ceux de mon mandant
  const [eligib, setEligib] = useState({}); // election_id → { member_id → {electeur, candidat} }
  const [schemaPending, setSchemaPending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [info, setInfo] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [{ data: el }, { data: cand }, { data: com, error: comErr }, { data: proc }, { data: dep }, { data: et }, { data: sig }] = await Promise.all([
      supabase.from("elections").select("*").eq("association_id", profile.association_id).order("date_debut", { ascending: false }),
      supabase.from("election_candidats").select("*"),
      supabase.from("election_comite").select("*"),
      supabase.from("election_procurations").select("*"),
      supabase.from("election_departages").select("*"),
      supabase.rpc("etat_elections"),
      supabase.from("election_pv_signatures").select("*"),
    ]);
    setPvSignatures(sig || []);
    setSchemaPending(!!comErr);
    const els = el || [];
    setElections(els);
    setCandidats(cand || []);
    setComite(com || []);
    setProcurations(proc || []);
    setDepartages(dep || []);
    setEtats(Object.fromEntries((et || []).map((x) => [x.election_id, x])));

    const tirIds = (dep || []).map((d) => d.tirage_id);
    if (tirIds.length) {
      const { data: tir } = await supabase.from("tirages").select("id,titre,statut,resultat,engagement,graine,termine_le").in("id", tirIds);
      setTirages(Object.fromEntries((tir || []).map((x) => [x.id, x])));
    }
    if (myId) {
      const mandants = (proc || []).filter((p) => p.mandataire_id === myId && p.statut === "validee").map((p) => p.mandant_id);
      const { data: em } = await supabase.from("election_emargements").select("election_id, poste, member_id").in("member_id", [myId, ...mandants]);
      setEmargements(em || []);
    }
    // Éligibilité : seulement pour les élections encore en cours.
    const actives = els.filter((e) => !["recours", "terminee"].includes(etapeElection(e)));
    const res = await Promise.all(actives.map((e) => supabase.rpc("eligibilites_election", { p_election_id: e.id })));
    setEligib(Object.fromEntries(actives.map((e, i) => [e.id, Object.fromEntries((res[i].data || []).map((r) => [r.member_id, r]))])));
  }, [profile.association_id, myId]);

  useEffect(() => { load(); }, [load]);

  // Temps réel : participation, décisions du comité, procurations… Les
  // changements arrivent en rafale pendant un scrutin : on regroupe.
  const timer = useRef(null);
  useEffect(() => {
    const schedule = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 700); };
    let channel = supabase.channel(`elections-${profile.association_id}`);
    ["elections", "election_emargements", "election_candidats", "election_comite", "election_procurations", "election_departages", "election_pv_signatures", "tirages"]
      .forEach((table) => { channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, schedule); });
    channel.subscribe();
    return () => { clearTimeout(timer.current); supabase.removeChannel(channel); };
  }, [profile.association_id, load]);

  // Horloge : bascule d'étape à l'heure pile (et filet de sécurité si le
  // temps réel n'est pas disponible).
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); }, 30000);
    return () => clearInterval(id);
  }, []);
  const prevEtapes = useRef("");
  useEffect(() => {
    const sig = elections.map((e) => etapeElection(e, now)).join(",");
    if (prevEtapes.current && prevEtapes.current !== sig) load();
    prevEtapes.current = sig;
  }, [now, elections, load]);

  // Clôture automatique (reprise de Gouvernance.jsx) : dès la date de fin
  // passée, le statut passe à « fermée » en base. Le bureau seul peut
  // écrire ; l'étape affichée, elle, bascule déjà grâce à etapeElection().
  const dejaClos = useRef(new Set()); // une seule tentative par élection
  useEffect(() => {
    if (!isBureau) return;
    const echues = elections.filter((el) => el.statut === "ouverte" && el.date_fin && new Date(el.date_fin).getTime() < now && !dejaClos.current.has(el.id));
    if (echues.length === 0) return;
    echues.forEach((el) => dejaClos.current.add(el.id));
    (async () => {
      for (const el of echues) await supabase.from("elections").update({ statut: "fermée" }).eq("id", el.id);
      load();
    })();
  }, [elections, now, isBureau, load]);

  async function rpc(fn, args, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return false;
    setErrorMsg(""); setInfo("");
    const { error } = await supabase.rpc(fn, args);
    if (error) { setErrorMsg(rpcMessage(error, t)); return false; }
    await load();
    return true;
  }

  const nameOf = (id) => members.find((m) => m.id === id)?.nom || "—";
  const photoOf = (id) => members.find((m) => m.id === id)?.photo_url || null;

  return (
    <>
      {schemaPending && <div style={{ background: "#FBE4E1", color: RED, padding: "8px 14px", borderRadius: 8, fontSize: 12.5, marginBottom: 12 }}>{L.schema_pending}</div>}
      {errorMsg && <div style={{ background: "#FBE4E1", color: RED, padding: "8px 14px", borderRadius: 8, fontSize: 12.5, marginBottom: 12 }}>{errorMsg}</div>}
      {info && <div style={{ background: TEAL_LIGHT, color: TEAL, padding: "8px 14px", borderRadius: 8, fontSize: 12.5, marginBottom: 12 }}>{info}</div>}

      {isBureau && <CreateElection L={L} t={t} profile={profile} onCreated={load} setErrorMsg={setErrorMsg} />}

      {elections.map((el) => (
        <ElectionCard
          key={el.id}
          el={el} etape={etapeElection(el, now)} etat={etats[el.id]}
          cands={candidats.filter((c) => c.election_id === el.id)}
          comite={comite.filter((c) => c.election_id === el.id)}
          procurations={procurations.filter((p) => p.election_id === el.id)}
          departages={departages.filter((d) => d.election_id === el.id)}
          signatures={pvSignatures.filter((x) => x.election_id === el.id)}
          tirages={tirages}
          emargements={emargements.filter((e) => e.election_id === el.id)}
          eligib={eligib[el.id] || {}}
          members={members} nameOf={nameOf} photoOf={photoOf}
          myId={myId} isBureau={isBureau} association={association}
          L={L} t={t} lang={lang}
          rpc={rpc} reload={load} setErrorMsg={setErrorMsg} setInfo={setInfo}
        />
      ))}
      {elections.length === 0 && <p style={{ color: GREY, fontStyle: "italic" }}>{L.empty}</p>}
    </>
  );
}

// ---------------------------------------------------------------------
function CreateElection({ L, t, profile, onCreated, setErrorMsg }) {
  const vide = { titre: "", description: "", postes: "", candidatures_debut: "", candidatures_fin: "", validation_fin: "", date_debut: "", date_fin: "", delai_recours_jours: 7, anciennete_min_mois: 0, exiger_cotisation: false, quorum_pct: "", procurations_autorisees: true };
  const [f, setF] = useState(vide);
  const [open, setOpen] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function create() {
    if (!f.titre.trim() || !f.date_debut || !f.date_fin) { setErrorMsg(L.create_missing); return; }
    if (!window.confirm(fill(L.confirm_create, { titre: f.titre }))) return;
    const row = {
      association_id: profile.association_id,
      titre: f.titre.trim(), description: f.description, statut: "ouverte",
      postes: f.postes.split(",").map((s) => s.trim()).filter(Boolean),
      candidatures_debut: datetimeLocalToISO(f.candidatures_debut),
      candidatures_fin: datetimeLocalToISO(f.candidatures_fin),
      validation_fin: datetimeLocalToISO(f.validation_fin),
      date_debut: datetimeLocalToISO(f.date_debut),
      date_fin: datetimeLocalToISO(f.date_fin),
      delai_recours_jours: Number(f.delai_recours_jours) || 0,
      anciennete_min_mois: Number(f.anciennete_min_mois) || 0,
      exiger_cotisation: !!f.exiger_cotisation,
      quorum_pct: f.quorum_pct === "" ? null : Number(f.quorum_pct),
      procurations_autorisees: !!f.procurations_autorisees,
    };
    const { error } = await supabase.from("elections").insert(row);
    if (error) { setErrorMsg(rpcMessage(error, t)); return; }
    setF(vide); setOpen(false); onCreated();
  }

  if (!open) return <div style={{ marginBottom: 16 }}><Btn onClick={() => setOpen(true)}><Vote size={14} /> {L.create_title}</Btn></div>;
  const dt = (k, label) => <Field label={label}><input type="datetime-local" style={inputStyle} value={f[k]} onChange={set(k)} /></Field>;
  return (
    <Card style={{ marginBottom: 20 }}>
      <h4 style={{ fontSize: 14, marginBottom: 10 }}>{L.create_title}</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0 16px" }}>
        <Field label={L.f_title}><input style={inputStyle} value={f.titre} onChange={set("titre")} /></Field>
        <Field label={L.f_description}><input style={inputStyle} value={f.description} onChange={set("description")} /></Field>
        <Field label={L.f_postes}><input style={inputStyle} value={f.postes} placeholder={L.f_postes_ph} onChange={set("postes")} /></Field>
        {dt("candidatures_debut", L.f_cand_debut)}
        {dt("candidatures_fin", L.f_cand_fin)}
        {dt("validation_fin", L.f_valid_fin)}
        {dt("date_debut", L.f_scrutin_debut)}
        {dt("date_fin", L.f_scrutin_fin)}
        <Field label={L.f_recours}><input type="number" min={0} max={90} style={inputStyle} value={f.delai_recours_jours} onChange={set("delai_recours_jours")} /></Field>
        <Field label={L.f_anciennete}><input type="number" min={0} max={240} style={inputStyle} value={f.anciennete_min_mois} onChange={set("anciennete_min_mois")} /></Field>
        <Field label={L.f_quorum}><input type="number" min={0} max={100} style={inputStyle} value={f.quorum_pct} onChange={set("quorum_pct")} /></Field>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 6 }}><input type="checkbox" checked={f.exiger_cotisation} onChange={set("exiger_cotisation")} /> {L.f_cotisation}</label>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 12 }}><input type="checkbox" checked={f.procurations_autorisees} onChange={set("procurations_autorisees")} /> {L.f_procurations}</label>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn onClick={create}>{L.create_btn}</Btn>
        <Btn variant="outline" onClick={() => setOpen(false)}>{L.cancel}</Btn>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
function Stepper({ el, etape, L, lang }) {
  const idx = ETAPE_INDEX[etape];
  const fmt = (d) => (d ? formatEventDateTime(d, lang) : "");
  const recoursFin = el.proclame_le ? new Date(new Date(el.proclame_le).getTime() + (el.delai_recours_jours || 0) * 86400000).toISOString() : null;
  const dates = {
    candidatures: el.candidatures_debut ? `${fmt(el.candidatures_debut)} → ${fmt(el.candidatures_fin)}` : (el.candidatures_fin ? `${L.until} ${fmt(el.candidatures_fin)}` : `${L.until} ${fmt(el.date_debut)}`),
    validation: el.validation_fin ? `${L.until} ${fmt(el.validation_fin)}` : "",
    campagne: el.date_debut ? `${L.until} ${fmt(el.date_debut)}` : "",
    scrutin: `${fmt(el.date_debut)} → ${fmt(el.date_fin)}`,
    depouillement: el.date_fin ? `${L.from} ${fmt(el.date_fin)}` : "",
    proclamation: el.proclame_le ? `${fmt(el.proclame_le)}${recoursFin ? ` → ${fmt(recoursFin)}` : ""}` : "",
  };
  return (
    <ol style={{ listStyle: "none", padding: 0, margin: "10px 0 14px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 6 }}>
      {ETAPES.map((s, i) => {
        const done = i < idx || etape === "terminee";
        const current = i === idx || (s === "proclamation" && etape === "recours");
        const color = current ? "white" : done ? TEAL : GREY;
        return (
          <li key={s} style={{ background: current ? TEAL : done ? TEAL_LIGHT : "#F3F4F6", color, borderRadius: 8, padding: "6px 8px", fontSize: 11.5 }}>
            <div style={{ fontWeight: 700 }}>{i + 1}. {L[`step_${s}`]} {done && "✓"}</div>
            {dates[s] && <div style={{ fontSize: 10.5, opacity: 0.9, marginTop: 2 }}>{dates[s]}</div>}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------
// Résultat d'un poste : voix, élu(s), égalité éventuelle et départage.
// Quorum non atteint (signalé au premier test de l'utilisateur, 2026-10-09) :
// le scrutin n'est pas valable — voix affichées, mais personne n'est élu.
function resultatPoste(cands, voix, departage, tirage, quorumKo = false) {
  const lignes = cands.map((c) => ({ c, v: Number(voix?.[c.id] || 0) })).sort((a, b) => b.v - a.v);
  const total = lignes.reduce((s, x) => s + x.v, 0);
  const max = lignes.length ? lignes[0].v : 0;
  const tete = total > 0 ? lignes.filter((x) => x.v === max) : [];
  const egalite = !quorumKo && tete.length > 1;
  let gagnant = !quorumKo && tete.length === 1 ? tete[0].c.member_id : null;
  let parTirage = false;
  if (egalite && departage && tirage?.statut === "termine") {
    const premier = (tirage.resultat || []).find((r) => Number(r.position) === 1);
    if (premier) { gagnant = premier.member_id; parTirage = true; }
  }
  return { lignes, total, egalite, gagnant, parTirage };
}

function postesDe(el, cands) {
  const list = (el.postes || []).length ? [...el.postes] : [];
  cands.forEach((c) => { if (!list.includes(posteKey(c))) list.push(posteKey(c)); });
  return list;
}

function ElectionCard({ el, etape, etat, cands, comite, procurations, departages, signatures, tirages, emargements, eligib, members, nameOf, photoOf, myId, isBureau, association, L, t, lang, rpc, reload, setErrorMsg, setInfo }) {
  const avant = AVANT_SCRUTIN.includes(etape);
  const close = ["depouillement", "recours", "terminee"].includes(etape);
  const monRole = comite.find((c) => c.member_id === myId)?.role || null;
  const president = comite.find((c) => c.role === "president");
  const scrutateurs = comite.filter((c) => c.role === "scrutateur");
  const comiteComplet = !!president && scrutateurs.length >= 2;
  const postes = postesDe(el, cands);
  const valides = cands.filter((c) => c.statut_candidature === "validee");
  const voix = etat?.voix || null;
  const moi = myId ? eligib[myId] : null;
  const procActives = procurations.filter((p) => ["en_attente", "validee"].includes(p.statut));
  const maProcDonnee = procActives.find((p) => p.mandant_id === myId);
  const maProcPortee = procActives.find((p) => p.mandataire_id === myId);

  const etapeColor = etape === "scrutin" ? TEAL : close ? "#4A5468" : "#B7791F";

  async function supprimer() {
    await rpc("supprimer_election", { p_election_id: el.id }, L.confirm_delete);
  }
  async function cloreMaintenant() {
    if (!window.confirm(L.confirm_close_now)) return;
    const { error } = await supabase.from("elections").update({ statut: "fermée" }).eq("id", el.id);
    if (error) setErrorMsg(rpcMessage(error, t)); else reload();
  }

  const regles = [L.p_actif];
  if (el.anciennete_min_mois > 0) regles.push(fill(L.p_anciennete, { n: el.anciennete_min_mois }));
  if (el.exiger_cotisation) regles.push(L.p_cotisation);
  if (el.quorum_pct != null) regles.push(fill(L.p_quorum, { n: el.quorum_pct }));
  regles.push(el.procurations_autorisees === false ? L.p_no_procurations : L.p_procurations);

  return (
    <Card style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h4 style={{ fontSize: 15, margin: 0 }}>{el.titre}</h4>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Pill color={etapeColor}>{L[`etape_${etape}`]}</Pill>
          {voix && <Btn variant="outline" style={smallBtn} onClick={() => exporterPvElection({ el, etat, cands, comite, departages, tirages, procurations, signatures, nameOf, association, L, lang })}><FileDown size={13} /> {L.pv_btn}</Btn>}
          {isBureau && etape === "scrutin" && <Btn variant="outline" style={smallBtn} onClick={cloreMaintenant}><Lock size={13} /> {L.close_now_btn}</Btn>}
          {isBureau && <button onClick={supprimer} style={linkDanger}><Trash2 size={11} /> {L.delete_btn}</button>}
        </div>
      </div>
      {el.description && <p style={{ fontSize: 12.5, color: "#5B6270", margin: "6px 0 0" }}>{el.description}</p>}
      <Stepper el={el} etape={etape} L={L} lang={lang} />
      <p style={{ fontSize: 12, color: "#4A5468", margin: "0 0 12px" }}>{fill(L.params, { regles: regles.join(" · ") })}</p>

      {el.proclame_le && (
        <RuleBox>
          {fill(L.proclaimed_on, { date: formatEventDateTime(el.proclame_le, lang), nom: el.proclame_par_nom || "—" })}
          {etape === "recours" && <><br />{fill(L.recours_until, { date: formatEventDateTime(new Date(new Date(el.proclame_le).getTime() + (el.delai_recours_jours || 0) * 86400000).toISOString(), lang) })}</>}
        </RuleBox>
      )}

      {/* Comité électoral */}
      <ComiteBlock el={el} comite={comite} cands={cands} members={members} nameOf={nameOf} photoOf={photoOf} isBureau={isBureau} comiteComplet={comiteComplet} L={L} t={t} reload={reload} setErrorMsg={setErrorMsg} />

      {/* Ma situation */}
      {!["recours", "terminee"].includes(etape) && (
        <div style={{ fontSize: 12.5, margin: "4px 0 14px", display: "flex", alignItems: "center", gap: 6 }}>
          <UserCheck size={14} color={TEAL} /> <b>{L.my_situation} :</b>{" "}
          {!myId ? L.not_linked : !moi ? "…" : moi.electeur ? fill(L.elig_no, { motif: L[`m_${moi.electeur}`] || moi.electeur }) : L.elig_ok}
          {monRole && <Pill color={TEAL}>{L[`role_${monRole}`]}</Pill>}
        </div>
      )}

      {/* Participation en direct */}
      {(etape === "scrutin" || close) && etat && <Participation etat={etat} etape={etape} hasVoix={!!voix} L={L} />}

      {/* Candidatures */}
      <CandidaturesBlock el={el} etape={etape} avant={avant} cands={cands} postes={postes} eligib={eligib} members={members} nameOf={nameOf} photoOf={photoOf} myId={myId} moi={moi} monRole={monRole} isBureau={isBureau} L={L} t={t} rpc={rpc} reload={reload} setErrorMsg={setErrorMsg} />

      {/* Procurations */}
      {el.procurations_autorisees !== false && (avant || procurations.length > 0) && (
        <ProcurationsBlock el={el} avant={avant} procurations={procurations} eligib={eligib} members={members} nameOf={nameOf} myId={myId} moi={moi} monRole={monRole} maProcDonnee={maProcDonnee} maProcPortee={maProcPortee} L={L} rpc={rpc} />
      )}

      {/* Bulletins */}
      {etape === "scrutin" && myId && (
        <>
          {moi && !moi.electeur && maProcDonnee?.statut !== "validee" && (
            <Bulletin el={el} titre={L.ballot_title} postes={postes} valides={valides} emargements={emargements} pour={myId} mandant={null} nameOf={nameOf} photoOf={photoOf} L={L} rpc={rpc} />
          )}
          {maProcPortee?.statut === "validee" && (
            <Bulletin el={el} titre={fill(L.ballot_for, { nom: nameOf(maProcPortee.mandant_id) })} postes={postes} valides={valides} emargements={emargements} pour={maProcPortee.mandant_id} mandant={maProcPortee.mandant_id} nameOf={nameOf} photoOf={photoOf} L={L} rpc={rpc} />
          )}
        </>
      )}

      {/* Résultats */}
      {close && voix && (
        <Resultats el={el} etape={etape} quorumKo={etat?.quorum_atteint === false} postes={postes} valides={valides} voix={voix} departages={departages} tirages={tirages} nameOf={nameOf} photoOf={photoOf} isBureau={isBureau} monRole={monRole} comiteComplet={comiteComplet} L={L} rpc={rpc} setInfo={setInfo} />
      )}

      {/* Procès-verbal : signatures du comité et versement aux Documents */}
      {el.proclame_le && voix && (monRole || isBureau || signatures.length > 0 || el.pv_verse_le) && (
        <PvBlock el={el} comite={comite} signatures={signatures} myId={myId} monRole={monRole} isBureau={isBureau} nameOf={nameOf}
          exporter={(sortie) => exporterPvElection({ el, etat, cands, comite, departages, tirages, procurations, signatures, nameOf, association, L, lang, sortie })}
          L={L} t={t} lang={lang} rpc={rpc} reload={reload} setErrorMsg={setErrorMsg} setInfo={setInfo} />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
function ComiteBlock({ el, comite, cands, members, nameOf, photoOf, isBureau, comiteComplet, L, t, reload, setErrorMsg }) {
  const [draft, setDraft] = useState({ member_id: "", role: "scrutateur" });
  const modifiable = !el.proclame_le;
  const candidatsIds = new Set(cands.filter((c) => c.statut_candidature !== "rejetee").map((c) => c.member_id));
  const dejaIds = new Set(comite.map((c) => c.member_id));
  const choix = members.filter((m) => m.statut === "Actif" && !candidatsIds.has(m.id) && !dejaIds.has(m.id));

  async function ajouter() {
    if (!draft.member_id) return;
    const { error } = await supabase.from("election_comite").insert({ association_id: el.association_id, election_id: el.id, member_id: draft.member_id, role: draft.role });
    if (error) { setErrorMsg(rpcMessage(error, t)); return; }
    setDraft({ member_id: "", role: "scrutateur" }); reload();
  }
  async function retirer(row) {
    if (!window.confirm(fill(L.confirm_comite_remove, { nom: nameOf(row.member_id) }))) return;
    const { error } = await supabase.from("election_comite").delete().eq("id", row.id);
    if (error) setErrorMsg(rpcMessage(error, t)); else reload();
  }
  const ordre = [...comite].sort((a, b) => (a.role === "president" ? -1 : 0) - (b.role === "president" ? -1 : 0));

  return (
    <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><ShieldCheck size={15} color={TEAL} /> {L.comite_title}</div>
      <p style={{ fontSize: 11.5, color: GREY, margin: "0 0 8px" }}>{L.comite_help}</p>
      {ordre.length === 0 && <p style={{ fontSize: 12, color: GREY, fontStyle: "italic", margin: "0 0 6px" }}>{L.comite_empty}</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {ordre.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#F8FAFB", borderRadius: 999, padding: "4px 10px 4px 4px" }}>
            <Photo url={photoOf(c.member_id)} nom={nameOf(c.member_id)} size={28} />
            <div style={{ fontSize: 12 }}><b>{nameOf(c.member_id)}</b><div style={{ fontSize: 10.5, color: GREY }}>{L[`role_${c.role}`]}</div></div>
            {isBureau && modifiable && <button onClick={() => retirer(c)} title={L.delete_btn} style={{ background: "none", border: "none", color: RED, cursor: "pointer", padding: 2 }}><XCircle size={14} /></button>}
          </div>
        ))}
      </div>
      {!comiteComplet && <p style={{ fontSize: 11.5, color: "#B7791F", margin: "8px 0 0" }}>{L.comite_incomplete}</p>}
      {isBureau && modifiable && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select style={{ ...inputStyle, width: 220 }} value={draft.member_id} onChange={(e) => setDraft({ ...draft, member_id: e.target.value })}>
            <option value="">{L.comite_choose}</option>
            {choix.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </select>
          <select style={{ ...inputStyle, width: 200 }} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
            <option value="president">{L.role_president}</option>
            <option value="scrutateur">{L.role_scrutateur}</option>
          </select>
          <Btn style={smallBtn} onClick={ajouter}>{L.comite_add}</Btn>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
function Participation({ etat, etape, hasVoix, L }) {
  const pct = etat.inscrits > 0 ? Math.round((etat.votants / etat.inscrits) * 100) : 0;
  return (
    <div style={{ background: "#F8FAFB", borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}><Users2 size={15} color={TEAL} /> {L.participation_title}</div>
      <div style={{ fontSize: 13 }}>
        {fill(L.participation_line, { v: etat.votants, i: etat.inscrits, pct })}
        {etat.votants_par_procuration > 0 && <> ({fill(L.procuration_line, { n: etat.votants_par_procuration })})</>}
      </div>
      <div style={{ height: 8, background: "#E5E7EB", borderRadius: 999, margin: "8px 0", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: TEAL }} />
      </div>
      {etat.quorum_requis != null && (
        <div style={{ fontSize: 12, fontWeight: 600, color: etat.quorum_atteint ? TEAL : "#B7791F", display: "flex", alignItems: "center", gap: 6 }}>
          {etat.quorum_atteint ? <CheckCircle2 size={13} /> : <Clock size={13} />}
          {fill(etat.quorum_atteint ? L.quorum_ok : L.quorum_ko, { q: etat.quorum_requis })}
        </div>
      )}
      {etape === "scrutin" && <p style={{ fontSize: 11.5, color: GREY, fontStyle: "italic", margin: "6px 0 0", display: "flex", alignItems: "center", gap: 6 }}><Lock size={12} /> {L.no_results_yet}</p>}
      {etape === "depouillement" && !hasVoix && <p style={{ fontSize: 11.5, color: GREY, fontStyle: "italic", margin: "6px 0 0" }}>{L.depouillement_wait}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
function CandidaturesBlock({ el, etape, avant, cands, postes, eligib, members, nameOf, photoOf, myId, moi, monRole, isBureau, L, t, rpc, reload, setErrorMsg }) {
  const [depot, setDepot] = useState({ poste: "", profession: "" });
  const [edit, setEdit] = useState({}); // candidat_id → texte en cours
  const [bureauDraft, setBureauDraft] = useState({ member_id: "", poste: "" });
  const [ouvert, setOuvert] = useState({});
  const postesFixes = (el.postes || []).length > 0;

  async function deposer() {
    const poste = postesFixes ? depot.poste : depot.poste.trim();
    if (postesFixes && !poste) return;
    const ok = await rpc("deposer_candidature", { p_election_id: el.id, p_poste: poste, p_profession_foi: depot.profession }, fill(L.confirm_deposit, { poste: poste || L.no_poste }));
    if (ok) setDepot({ poste: "", profession: "" });
  }
  async function ajouterBureau() {
    if (!bureauDraft.member_id) return;
    if (!window.confirm(fill(L.confirm_bureau_add, { nom: nameOf(bureauDraft.member_id) }))) return;
    const { error } = await supabase.from("election_candidats").insert({ election_id: el.id, member_id: bureauDraft.member_id, poste_vise: bureauDraft.poste || "" });
    if (error) { setErrorMsg(rpcMessage(error, t)); return; }
    setBureauDraft({ member_id: "", poste: "" }); reload();
  }
  async function supprimer(c) {
    if (!window.confirm(L.confirm_delete_cand)) return;
    const { error } = await supabase.from("election_candidats").delete().eq("id", c.id);
    if (error) setErrorMsg(rpcMessage(error, t)); else reload();
  }
  async function rejeter(c) {
    const motif = window.prompt(L.reject_prompt);
    if (!motif || !motif.trim()) return;
    rpc("statuer_candidature", { p_candidat_id: c.id, p_decision: "rejetee", p_motif: motif.trim() });
  }

  const stColor = { en_attente: "#B7791F", validee: TEAL, rejetee: RED };
  const eligiblesCandidats = members.filter((m) => eligib[m.id] && !eligib[m.id].candidat);
  const peutDeposer = etape === "candidatures" && myId;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}><Vote size={15} color={TEAL} /> {L.cand_title}</div>
      {cands.length === 0 && <p style={{ fontSize: 12, color: GREY, fontStyle: "italic" }}>{L.cand_none}</p>}
      {postes.map((poste) => {
        const liste = cands.filter((c) => posteKey(c) === poste);
        if (liste.length === 0) return null;
        return (
          <div key={poste || "_"} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--primary)", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 6 }}>{poste || L.no_poste}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
              {liste.map((c) => {
                const estMoi = c.member_id === myId;
                const editing = edit[c.id] != null;
                return (
                  <div key={c.id} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 10, opacity: c.statut_candidature === "rejetee" ? 0.7 : 1 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <Photo url={photoOf(c.member_id)} nom={nameOf(c.member_id)} size={44} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{nameOf(c.member_id)}</div>
                        <Pill color={stColor[c.statut_candidature] || GREY}>{L[`st_${c.statut_candidature}`] || c.statut_candidature}</Pill>
                      </div>
                    </div>
                    {c.statut_candidature === "rejetee" && c.motif_rejet && <p style={{ fontSize: 11.5, color: RED, margin: "6px 0 0" }}>{fill(L.cand_rejected_reason, { motif: c.motif_rejet })}</p>}
                    {editing ? (
                      <div style={{ marginTop: 8 }}>
                        <textarea style={{ ...inputStyle, minHeight: 80 }} value={edit[c.id]} maxLength={3000} onChange={(e) => setEdit({ ...edit, [c.id]: e.target.value })} />
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <Btn style={smallBtn} onClick={async () => { if (await rpc("modifier_candidature", { p_candidat_id: c.id, p_profession_foi: edit[c.id], p_retirer: false })) setEdit((p) => { const n = { ...p }; delete n[c.id]; return n; }); }}>{L.cand_save_btn}</Btn>
                          <Btn variant="outline" style={smallBtn} onClick={() => setEdit((p) => { const n = { ...p }; delete n[c.id]; return n; })}>✕</Btn>
                        </div>
                      </div>
                    ) : c.profession_foi ? (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: GREY }}>{L.cand_profession}</div>
                        <p style={{ fontSize: 12, margin: "2px 0 0", whiteSpace: "pre-wrap", ...(ouvert[c.id] ? {} : { display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }) }}>{c.profession_foi}</p>
                        {c.profession_foi.length > 220 && <button onClick={() => setOuvert({ ...ouvert, [c.id]: !ouvert[c.id] })} style={{ background: "none", border: "none", color: TEAL, fontSize: 11.5, cursor: "pointer", padding: 0 }}>{ouvert[c.id] ? "▲" : "▼"}</button>}
                      </div>
                    ) : null}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      {avant && monRole && c.statut_candidature !== "validee" && <Btn style={smallBtn} onClick={() => rpc("statuer_candidature", { p_candidat_id: c.id, p_decision: "validee", p_motif: null })}><CheckCircle2 size={12} /> {L.validate_btn}</Btn>}
                      {avant && monRole && c.statut_candidature !== "rejetee" && <Btn variant="outline" style={smallBtn} onClick={() => rejeter(c)}><XCircle size={12} /> {L.reject_btn}</Btn>}
                      {avant && estMoi && !editing && <Btn variant="outline" style={smallBtn} onClick={() => setEdit({ ...edit, [c.id]: c.profession_foi || "" })}>{L.cand_edit_btn}</Btn>}
                      {avant && estMoi && <button style={linkDanger} onClick={() => rpc("modifier_candidature", { p_candidat_id: c.id, p_profession_foi: null, p_retirer: true }, L.confirm_withdraw)}>{L.cand_withdraw_btn}</button>}
                      {avant && isBureau && !estMoi && <button style={linkDanger} onClick={() => supprimer(c)}><Trash2 size={11} /> {L.delete_btn}</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Dépôt de candidature */}
      {peutDeposer && (
        <div style={{ background: "#F8FAFB", borderRadius: 10, padding: 12, marginTop: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{L.cand_deposit_title}</div>
          {moi?.candidat ? (
            <p style={{ fontSize: 12, color: "#B7791F", margin: 0 }}>{fill(L.cand_not_eligible, { motif: L[`m_${moi.candidat}`] || moi.candidat })}</p>
          ) : (
            <>
              <p style={{ fontSize: 11.5, color: GREY, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}><Photo url={photoOf(myId)} nom={nameOf(myId)} size={26} /> {L.cand_deposit_help}</p>
              <Field label={L.cand_poste}>
                {postesFixes ? (
                  <select style={inputStyle} value={depot.poste} onChange={(e) => setDepot({ ...depot, poste: e.target.value })}>
                    <option value="">—</option>
                    {el.postes.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : <input style={inputStyle} value={depot.poste} onChange={(e) => setDepot({ ...depot, poste: e.target.value })} />}
              </Field>
              <Field label={L.cand_profession}><textarea style={{ ...inputStyle, minHeight: 90 }} maxLength={3000} value={depot.profession} onChange={(e) => setDepot({ ...depot, profession: e.target.value })} /></Field>
              <Btn onClick={deposer}>{L.cand_deposit_btn}</Btn>
            </>
          )}
        </div>
      )}

      {/* Ajout direct par le bureau */}
      {isBureau && avant && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select style={{ ...inputStyle, width: 220 }} value={bureauDraft.member_id} onChange={(e) => setBureauDraft({ ...bureauDraft, member_id: e.target.value })}>
            <option value="">{L.bureau_add_cand}</option>
            {eligiblesCandidats.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </select>
          {postesFixes ? (
            <select style={{ ...inputStyle, width: 180 }} value={bureauDraft.poste} onChange={(e) => setBureauDraft({ ...bureauDraft, poste: e.target.value })}>
              <option value="">{L.cand_poste}</option>
              {el.postes.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : <input style={{ ...inputStyle, width: 180 }} placeholder={L.cand_poste} value={bureauDraft.poste} onChange={(e) => setBureauDraft({ ...bureauDraft, poste: e.target.value })} />}
          <Btn style={smallBtn} onClick={ajouterBureau}>{L.bureau_add_cand_btn}</Btn>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
function ProcurationsBlock({ el, avant, procurations, eligib, members, nameOf, myId, moi, monRole, maProcDonnee, maProcPortee, L, rpc }) {
  const [choix, setChoix] = useState("");
  const indisponibles = new Set(procurations.filter((p) => ["en_attente", "validee"].includes(p.statut)).flatMap((p) => [p.mandant_id, p.mandataire_id]));
  const mandatairesPossibles = members.filter((m) => m.id !== myId && eligib[m.id] && !eligib[m.id].electeur && !indisponibles.has(m.id));
  const peutDonner = avant && myId && moi && !moi.electeur && !maProcDonnee && !maProcPortee;
  const stColor = { en_attente: "#B7791F", validee: TEAL, refusee: RED, annulee: GREY };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><Handshake size={15} color={TEAL} /> {L.proc_title}</div>
      <p style={{ fontSize: 11.5, color: GREY, margin: "0 0 8px" }}>{L.proc_help}</p>
      {procurations.filter((p) => p.statut !== "annulee").length === 0 && <p style={{ fontSize: 12, color: GREY, fontStyle: "italic", margin: "0 0 6px" }}>{L.proc_none}</p>}
      {procurations.filter((p) => p.statut !== "annulee").map((p) => (
        <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, padding: "4px 0", borderBottom: "1px solid #F0F0F0" }}>
          <span><b>{nameOf(p.mandant_id)}</b> → <b>{nameOf(p.mandataire_id)}</b></span>
          <Pill color={stColor[p.statut]}>{L[`proc_st_${p.statut}`]}</Pill>
          {avant && monRole && p.statut !== "validee" && <Btn style={smallBtn} onClick={() => rpc("statuer_procuration", { p_id: p.id, p_decision: "validee" })}>{L.proc_validate_btn}</Btn>}
          {avant && monRole && p.statut !== "refusee" && <Btn variant="outline" style={smallBtn} onClick={() => rpc("statuer_procuration", { p_id: p.id, p_decision: "refusee" })}>{L.proc_refuse_btn}</Btn>}
          {avant && p.mandant_id === myId && p.statut !== "refusee" && <button style={linkDanger} onClick={() => rpc("annuler_procuration", { p_id: p.id }, L.confirm_proc_cancel)}>{L.proc_cancel_btn}</button>}
        </div>
      ))}
      {peutDonner && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12.5 }}>{L.proc_give}</span>
          <select style={{ ...inputStyle, width: 220 }} value={choix} onChange={(e) => setChoix(e.target.value)}>
            <option value="">{L.proc_choose}</option>
            {mandatairesPossibles.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </select>
          <Btn style={smallBtn} onClick={async () => { if (choix && await rpc("declarer_procuration", { p_election_id: el.id, p_mandataire_id: choix }, fill(L.confirm_proc, { nom: nameOf(choix) }))) setChoix(""); }}>{L.proc_give_btn}</Btn>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
function Bulletin({ el, titre, postes, valides, emargements, pour, mandant, nameOf, photoOf, L, rpc }) {
  const [choix, setChoix] = useState({}); // poste → candidat_id
  const aVote = (poste) => emargements.some((e) => e.member_id === pour && e.poste === poste);

  async function voter(poste) {
    const cid = choix[poste];
    if (!cid) return;
    const c = valides.find((x) => x.id === cid);
    const msg = mandant
      ? fill(L.confirm_vote_proxy, { nom: nameOf(c.member_id), poste: poste || L.no_poste, mandant: nameOf(mandant) })
      : fill(L.confirm_vote, { nom: nameOf(c.member_id), poste: poste || L.no_poste });
    await rpc("voter_scrutin", { p_election_id: el.id, p_candidat_id: cid, p_mandant_id: mandant }, msg);
  }

  return (
    <div style={{ border: `2px solid ${TEAL}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}><Vote size={16} color={TEAL} /> {titre}</div>
      <p style={{ fontSize: 11.5, color: GREY, margin: "4px 0 10px" }}>{L.ballot_help}</p>
      {postes.map((poste) => {
        const liste = valides.filter((c) => posteKey(c) === poste);
        const fait = aVote(poste);
        return (
          <div key={poste || "_"} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--primary)", textTransform: "uppercase", marginBottom: 6 }}>{poste || L.no_poste}</div>
            {liste.length === 0 ? <p style={{ fontSize: 12, color: GREY, fontStyle: "italic", margin: 0 }}>{L.no_valid_cands}</p>
              : fait ? <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 700 }}>{L.voted}</span>
              : (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {liste.map((c) => (
                      <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${choix[poste] === c.id ? TEAL : "#E5E7EB"}`, background: choix[poste] === c.id ? TEAL_LIGHT : "white", borderRadius: 999, padding: "4px 12px 4px 4px", cursor: "pointer", fontSize: 13 }}>
                        <input type="radio" name={`b-${el.id}-${pour}-${poste}`} checked={choix[poste] === c.id} onChange={() => setChoix({ ...choix, [poste]: c.id })} style={{ display: "none" }} />
                        <Photo url={photoOf(c.member_id)} nom={nameOf(c.member_id)} size={28} /> {nameOf(c.member_id)}
                      </label>
                    ))}
                  </div>
                  <Btn style={{ ...smallBtn, marginTop: 8 }} disabled={!choix[poste]} onClick={() => voter(poste)}>{L.vote_btn}</Btn>
                </>
              )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
function Resultats({ el, etape, quorumKo, postes, valides, voix, departages, tirages, nameOf, photoOf, isBureau, monRole, comiteComplet, L, rpc, setInfo }) {
  const parPoste = postes.map((poste) => {
    const dep = departages.find((d) => d.poste === poste);
    const tir = dep ? tirages[dep.tirage_id] : null;
    return { poste, dep, tir, ...resultatPoste(valides.filter((c) => posteKey(c) === poste), voix, dep, tir, quorumKo) };
  }).filter((r) => r.lignes.length > 0);
  const egaliteNonResolue = parPoste.some((r) => r.egalite && !r.parTirage);

  async function departager(poste) {
    if (await rpc("departager_election", { p_election_id: el.id, p_poste: poste }, fill(L.confirm_tie, { poste: poste || L.no_poste }))) setInfo(L.tie_prepared);
  }

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}><Gavel size={15} color={TEAL} /> {L.results_title}</div>
      {quorumKo && <p style={{ fontSize: 12.5, fontWeight: 600, color: RED, background: "#FBE4E1", borderRadius: 8, padding: "8px 12px", margin: "0 0 10px" }}>{L.quorum_ko_result}</p>}
      {parPoste.map((r) => (
        <div key={r.poste || "_"} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--primary)", textTransform: "uppercase", marginBottom: 6 }}>{r.poste || L.no_poste}</div>
          <Table head={[L.col_candidate, L.col_votes, L.col_pct, ""]}>
            {r.lignes.map(({ c, v }) => {
              const pct = r.total > 0 ? Math.round((v / r.total) * 100) : 0;
              const elu = r.gagnant === c.member_id;
              const exaequo = r.egalite && !r.parTirage && v === r.lignes[0].v;
              return (
                <tr key={c.id}>
                  <td style={{ ...td, fontWeight: 600 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Photo url={photoOf(c.member_id)} nom={nameOf(c.member_id)} size={24} /> {nameOf(c.member_id)}</span></td>
                  <td style={td}>{v}</td>
                  <td style={td}>{pct} %</td>
                  <td style={{ ...td, fontWeight: 700, color: elu ? TEAL : "#B7791F" }}>{elu ? (r.parTirage ? L.elected_by_draw : L.elected) : exaequo ? L.tie : ""}</td>
                </tr>
              );
            })}
          </Table>
          {r.total === 0 && <p style={{ fontSize: 12, color: GREY, fontStyle: "italic", margin: "4px 0 0" }}>{L.no_votes}</p>}
          {r.egalite && !r.parTirage && (
            <div style={{ fontSize: 12, marginTop: 6, color: "#4A5468" }}>
              <Dices size={13} style={{ verticalAlign: "-2px" }} />{" "}
              {!r.dep || r.tir?.statut === "annule"
                ? <>{r.tir?.statut === "annule" ? L.tie_cancelled : L.tie_help}{" "}{isBureau && etape === "depouillement" && <Btn variant="outline" style={smallBtn} onClick={() => departager(r.poste)}><Dices size={12} /> {L.tie_btn}</Btn>}</>
                : L.tie_pending}
            </div>
          )}
        </div>
      ))}

      {etape === "depouillement" && monRole === "president" && (
        <div style={{ marginTop: 8 }}>
          {!comiteComplet && <p style={{ fontSize: 12, color: "#B7791F" }}>{L.proclaim_blocked_comite}</p>}
          {egaliteNonResolue && <p style={{ fontSize: 12, color: "#B7791F" }}>{L.proclaim_blocked_tie}</p>}
          <Btn disabled={!comiteComplet || egaliteNonResolue} onClick={() => rpc("proclamer_election", { p_election_id: el.id }, L.confirm_proclaim)}><Gavel size={14} /> {L.proclaim_btn}</Btn>
        </div>
      )}
      {etape === "depouillement" && monRole !== "president" && (isBureau || monRole) && <p style={{ fontSize: 11.5, color: GREY, fontStyle: "italic" }}>{L.proclaim_need_president}</p>}
    </div>
  );
}


// ---------------------------------------------------------------------
// Procès-verbal PDF : calendrier, comité, règles, participation, quorum,
// résultats par poste (départages compris) et signatures du comité.
//
// Refait après le premier essai de l'utilisateur (2026-10-09) : caractères
// illisibles et mise en page confuse. Les polices standard de jsPDF ne
// connaissent que l'alphabet latin courant (WinAnsi) : la flèche « → » et
// les espaces fines que le navigateur glisse dans les dates françaises
// sortaient en signes incompréhensibles ou en lettres espacées. Tout texte
// passe donc par pdfTexte(), et les dates par un format court sans ces
// caractères ; les tableaux font passer les textes longs à la ligne.
// ---------------------------------------------------------------------
function pdfDate(iso, lang) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const locale = lang === "en" ? "en-CA" : "fr-CA";
  const jour = d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  const pad = (n) => String(n).padStart(2, "0");
  return pdfTexte(lang === "en" ? `${jour}, ${pad(d.getHours())}:${pad(d.getMinutes())}` : `${jour} à ${d.getHours()} h ${pad(d.getMinutes())}`);
}

async function exporterPvElection({ el, etat, cands, comite, departages, tirages, procurations, signatures = [], nameOf, association, L, lang, sortie = "telecharger" }) {
  const [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const { jsPDF } = jsPDFmod;
  const autoTable = autoTableMod.default || autoTableMod;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const T = (s) => pdfTexte(s);
  const D = (iso) => pdfDate(iso, lang);
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const M = 48; // marge
  const W = PAGE_W - 2 * M;
  // Sobriété demandée par l'utilisateur : texte en noir, mentions
  // importantes en gras ou en italique, et une seule couleur d'accent
  // (filets, en-têtes de tableaux) = couleur principale de l'association.
  const ACCENT = couleurAssociation(association);
  const NOIR = [0, 0, 0];
  let y = 0;

  const placeLibre = (h) => { if (y + h > PAGE_H - 60) { doc.addPage(); y = 56; } };
  const section = (titre) => {
    placeLibre(46);
    y += 14;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...NOIR);
    doc.text(T(titre).toUpperCase(), M, y);
    doc.setDrawColor(...ACCENT); doc.setLineWidth(1.2);
    doc.line(M, y + 5, M + W, y + 5);
    y += 14;
    doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  };
  const paragraphe = (txt, { size = 10, bold = false, italic = false } = {}) => {
    doc.setFont("helvetica", bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal"); doc.setFontSize(size); doc.setTextColor(...NOIR);
    const lignes = doc.splitTextToSize(T(txt), W);
    placeLibre(lignes.length * size * 1.35 + 4);
    doc.text(lignes, M, y + size, { lineHeightFactor: 1.35 });
    y += lignes.length * size * 1.35 + 6;
    doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "normal");
  };
  // Tableau « libellé : valeur » (calendrier, participation…).
  const fiche = (lignes) => {
    autoTable(doc, {
      startY: y,
      body: lignes.map(([k, v]) => [T(k), T(v)]),
      theme: "plain",
      styles: { font: "helvetica", fontSize: 10, cellPadding: { top: 4, bottom: 4, left: 6, right: 6 }, valign: "middle", overflow: "linebreak" },
      columnStyles: { 0: { cellWidth: 170, fontStyle: "bold" }, 1: { cellWidth: W - 170 } },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: M, right: M, top: 56, bottom: 60 },
    });
    y = doc.lastAutoTable.finalY + 6;
  };
  const tableau = (head, body, columnStyles = {}) => {
    autoTable(doc, {
      startY: y,
      head: [head.map(T)],
      body: body.map((r) => r.map(T)),
      theme: "grid",
      styles: { font: "helvetica", fontSize: 10, cellPadding: 5, lineColor: [220, 224, 230], lineWidth: 0.5, valign: "middle", overflow: "linebreak" },
      headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: "bold" },
      columnStyles,
      margin: { left: M, right: M, top: 56, bottom: 60 },
    });
    y = doc.lastAutoTable.finalY + 8;
  };

  // ----- En-tête officiel : logo + mentions légales (pdfOfficiel.js) -----
  y = await enTeteOfficiel(doc, association, { titre: L.pdf_title, marge: M, droite: `${L.pdf_generated} ${D(new Date().toISOString())}` });
  y += 6;

  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...NOIR);
  const titreLignes = doc.splitTextToSize(T(el.titre || ""), W);
  doc.text(titreLignes, M, y);
  y += (titreLignes.length - 1) * 18 + 8;
  doc.setTextColor(0, 0, 0);
  if (el.description) paragraphe(el.description, { size: 10, italic: true });
  paragraphe(
    el.proclame_le ? fill(L.proclaimed_on, { date: D(el.proclame_le), nom: el.proclame_par_nom || "-" }) : L.pdf_not_proclaimed,
    { size: 10, bold: true, italic: !el.proclame_le },
  );

  // ----- Calendrier -----
  section(L.pdf_calendar);
  const recoursFin = el.proclame_le ? new Date(new Date(el.proclame_le).getTime() + (el.delai_recours_jours || 0) * 86400000).toISOString() : null;
  const periode = (a, b) => (a && b ? fill(L.pdf_from_to, { a: D(a), b: D(b) }) : b ? fill(L.pdf_until, { a: D(b) }) : a ? D(a) : "-");
  fiche([
    [L.step_candidatures, periode(el.candidatures_debut, el.candidatures_fin || el.date_debut)],
    [L.step_validation, el.validation_fin ? fill(L.pdf_until, { a: D(el.validation_fin) }) : "-"],
    [L.step_scrutin, periode(el.date_debut, el.date_fin)],
    [L.step_proclamation, el.proclame_le ? periode(el.proclame_le, recoursFin) : "-"],
  ]);

  // ----- Comité -----
  section(L.pdf_comite);
  const membresComite = [...comite].sort((a, b) => (a.role === "president" ? 0 : 1) - (b.role === "president" ? 0 : 1));
  if (membresComite.length) {
    tableau([L.pdf_member, L.pdf_role], membresComite.map((c) => [nameOf(c.member_id), L[`role_${c.role}`]]), { 0: { cellWidth: W * 0.55, fontStyle: "bold" } });
  } else paragraphe(L.pdf_none, { italic: true });

  // ----- Règles -----
  section(L.pdf_rules);
  const regles = [L.p_actif];
  if (el.anciennete_min_mois > 0) regles.push(fill(L.p_anciennete, { n: el.anciennete_min_mois }));
  if (el.exiger_cotisation) regles.push(L.p_cotisation);
  if (el.quorum_pct != null) regles.push(fill(L.p_quorum, { n: el.quorum_pct }));
  regles.push(el.procurations_autorisees === false ? L.p_no_procurations : L.p_procurations);
  paragraphe(regles.map((r) => `- ${r}`).join("\n"));

  // ----- Participation -----
  section(L.pdf_participation);
  const inscrits = etat?.inscrits || 0;
  const votants = etat?.votants || 0;
  const quorumKo = etat?.quorum_atteint === false;
  const quorum = etat?.quorum_requis == null ? L.pdf_quorum_none
    : `${etat.quorum_requis} (${el.quorum_pct} %) - ${etat.quorum_atteint ? L.pdf_quorum_ok : L.pdf_quorum_ko}`;
  const procValidees = procurations.filter((p) => p.statut === "validee").length;
  fiche([
    [L.pdf_inscrits, String(inscrits)],
    [L.pdf_votants, String(votants)],
    [L.pdf_taux, `${inscrits > 0 ? Math.round((votants / inscrits) * 100) : 0} %`],
    [L.pdf_procurations, `${etat?.votants_par_procuration || 0} / ${procValidees}`],
    [L.pdf_quorum, quorum],
  ]);
  paragraphe(L.pdf_secret, { size: 8.5, italic: true });

  // ----- Résultats -----
  section(L.pdf_results);
  if (quorumKo) {
    doc.setFont("helvetica", "bolditalic"); doc.setFontSize(10);
    const lignes = doc.splitTextToSize(T(L.quorum_ko_result), W - 20);
    const h = lignes.length * 13.5 + 14;
    placeLibre(h + 8);
    doc.setDrawColor(...NOIR); doc.setLineWidth(0.8);
    doc.roundedRect(M, y, W, h, 4, 4, "S");
    doc.setTextColor(...NOIR);
    doc.text(lignes, M + 10, y + 17, { lineHeightFactor: 1.35 });
    doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "normal");
    y += h + 10;
  }
  const valides = cands.filter((c) => c.statut_candidature === "validee");
  postesDe(el, cands).forEach((poste) => {
    const dep = departages.find((d) => d.poste === poste);
    const tir = dep ? tirages[dep.tirage_id] : null;
    const r = resultatPoste(valides.filter((c) => posteKey(c) === poste), etat?.voix, dep, tir, quorumKo);
    if (r.lignes.length === 0) return;
    placeLibre(80);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...NOIR);
    doc.text(T(poste || L.no_poste), M, y + 8);
    doc.setTextColor(0, 0, 0);
    y += 14;
    tableau(
      [L.col_candidate, L.col_votes, L.col_pct, L.pdf_col_result],
      r.lignes.map(({ c, v }) => [
        nameOf(c.member_id), String(v), `${r.total > 0 ? Math.round((v / r.total) * 100) : 0} %`,
        r.gagnant === c.member_id ? (r.parTirage ? L.elected_by_draw : L.elected) : (r.egalite && v === r.lignes[0].v ? L.tie : ""),
      ]),
      { 0: { cellWidth: W * 0.46, fontStyle: "bold" }, 1: { cellWidth: W * 0.12, halign: "center" }, 2: { cellWidth: W * 0.12, halign: "center" }, 3: { fontStyle: "bolditalic" } },
    );
    if (r.total === 0) paragraphe(L.no_votes, { size: 9, italic: true });
    if (r.parTirage && tir?.engagement) paragraphe(fill(L.pdf_tie_note, { h: tir.engagement }), { size: 8, italic: true });
  });

  // ----- Proclamation -----
  section(L.pdf_proclamation);
  paragraphe(el.proclame_le
    ? `${fill(L.proclaimed_on, { date: D(el.proclame_le), nom: el.proclame_par_nom || "-" })}\n${fill(L.recours_until, { date: D(recoursFin) })}`
    : L.pdf_not_proclaimed);

  // ----- Signatures : un cadre par membre du comité, 2 par rangée -----
  const signataires = membresComite.length ? membresComite
    : [{ role: "president", member_id: null }, { role: "scrutateur", member_id: null }, { role: "scrutateur", member_id: null }];
  const BOX_W = (W - 20) / 2;
  const BOX_H = 92;
  placeLibre(46 + BOX_H);
  section(L.pdf_sign);
  y += 4;
  signataires.forEach((c, i) => {
    if (i % 2 === 0) placeLibre(BOX_H + 12);
    const bx = M + (i % 2) * (BOX_W + 20);
    const by = y;
    doc.setDrawColor(200, 205, 212); doc.setLineWidth(0.6);
    doc.roundedRect(bx, by, BOX_W, BOX_H, 4, 4, "S");
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(0, 0, 0);
    doc.text(T(c.member_id ? nameOf(c.member_id) : "...................................."), bx + 10, by + 18, { maxWidth: BOX_W - 20 });
    doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(...NOIR);
    doc.text(T(L[`role_${c.role}`]), bx + 10, by + 31);
    const sig = c.member_id ? signatures.find((x) => x.member_id === c.member_id) : null;
    if (sig) {
      // Signature électronique : date, compte et empreinte des résultats.
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...NOIR);
      doc.text(T(fill(L.pdf_signed_on, { date: D(sig.signe_le) })), bx + 10, by + 52);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
      doc.text(T(fill(L.pdf_signed_ref, { h: (sig.empreinte || "").slice(0, 16) })), bx + 10, by + 63);
      doc.setFont("helvetica", "normal");
    } else {
      doc.setFont("helvetica", "italic"); doc.setFontSize(8);
      if (signatures.length) doc.text(T(L.pdf_awaiting), bx + 10, by + 52);
    }
    doc.setFont("helvetica", "normal"); doc.setDrawColor(...NOIR);
    doc.line(bx + 10, by + 70, bx + BOX_W - 10, by + 70);
    doc.setFontSize(8);
    doc.text(T(L.pdf_signature), bx + 10, by + 81);
    doc.text(T(sig ? `${L.pdf_date} : ${D(sig.signe_le)}` : `${L.pdf_date} : ____ / ____ / ________`), bx + BOX_W - 10, by + 81, { align: "right" });
    doc.setTextColor(0, 0, 0);
    if (i % 2 === 1 || i === signataires.length - 1) y += BOX_H + 12;
  });
  if (signatures.length && signatures[0].empreinte) paragraphe(fill(L.pdf_fingerprint, { h: signatures[0].empreinte }), { size: 7.5, italic: true });

  // ----- Pied de page officiel sur chaque page -----
  piedsDePageOfficiels(doc, association, { marge: M, texte: `${L.pdf_title} - ${el.titre || ""}`, libellePage: (p, n) => fill(L.pdf_page, { p, n }) });

  const nomFichier = (el.titre || "election").normalize("NFD").replace(/[\u0300-\u036F]/g, "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  const fichier = `PV_${nomFichier || "election"}.pdf`;
  if (sortie === "blob") return { blob: doc.output("blob"), fichier };
  doc.save(fichier);
  return null;
}

// ---------------------------------------------------------------------
// Signatures du PV par le comité, chacun depuis son compte, puis
// versement dans Documents (sql 2026-10-09a_…_pv_signatures). Demande de
// l'utilisateur (2026-10-09) : plus besoin d'imprimer et de faire
// circuler le PV pour le signer.
function PvBlock({ el, comite, signatures, myId, monRole, isBureau, nameOf, exporter, L, t, lang, rpc, reload, setErrorMsg, setInfo }) {
  const [busy, setBusy] = useState(false);
  const scanRef = useRef(null);
  const ordre = [...comite].sort((a, b) => (a.role === "president" ? 0 : 1) - (b.role === "president" ? 0 : 1));
  const signeePar = (mid) => signatures.find((x) => x.member_id === mid);
  const manquants = comite.filter((c) => !signeePar(c.member_id)).length;
  const peutVerser = isBureau || monRole === "president";
  const dossier = `${el.association_id}/elections/${el.id}`;

  async function signer() {
    if (await rpc("signer_pv_election", { p_election_id: el.id }, L.confirm_sign)) setInfo(L.pvb_done_signed);
  }
  async function deposer(fichier, nom, signeMain) {
    setBusy(true); setErrorMsg("");
    const path = `${dossier}/${Date.now()}_${nom.normalize("NFD").replace(/[^\w.-]+/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("documents").upload(path, fichier, { contentType: fichier.type || "application/pdf" });
    if (upErr) { setBusy(false); setErrorMsg(fill(L.pvb_upload_error, { e: rpcMessage(upErr, t) })); return; }
    const { error } = await supabase.rpc("verser_pv_election", { p_election_id: el.id, p_path: path, p_nom: nom, p_signe_main: signeMain });
    setBusy(false);
    if (error) { setErrorMsg(rpcMessage(error, t)); return; }
    setInfo(L.pvb_done_filed); reload();
  }
  async function verserElectronique() {
    if (!window.confirm(L.confirm_file)) return;
    const res = await exporter("blob");
    if (res) await deposer(res.blob, res.fichier, false);
  }
  async function verserScan(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !window.confirm(fill(L.confirm_scan, { nom: f.name }))) return;
    await deposer(f, f.name, true);
  }
  async function ouvrir() {
    const { data: d } = await supabase.from("documents").select("storage_path").eq("id", el.pv_document_id).maybeSingle();
    if (!d?.storage_path) return;
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(d.storage_path, 120);
    if (error) setErrorMsg(rpcMessage(error, t)); else window.open(data.signedUrl, "_blank");
  }

  return (
    <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 12, marginTop: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><FileSignature size={15} color={TEAL} /> {L.pvb_title}</div>
      <p style={{ fontSize: 11.5, color: GREY, margin: "0 0 10px" }}>{L.pvb_help}</p>
      <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
        {ordre.map((c) => {
          const sig = signeePar(c.member_id);
          return (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, flexWrap: "wrap" }}>
              {sig ? <CheckCircle2 size={14} color={TEAL} /> : <Clock size={14} color="#B7791F" />}
              <b>{nameOf(c.member_id)}</b>
              <span style={{ color: GREY }}>· {L[`role_${c.role}`]}</span>
              <span style={{ color: sig ? TEAL : "#B7791F", fontWeight: 600 }}>{sig ? fill(L.pvb_signed, { date: formatEventDateTime(sig.signe_le, lang) }) : L.pvb_waiting}</span>
              {!sig && c.member_id === myId && <Btn style={smallBtn} onClick={signer}><FileSignature size={12} /> {L.pvb_sign_btn}</Btn>}
            </div>
          );
        })}
      </div>

      {el.pv_verse_le && (
        <p style={{ fontSize: 12.5, color: TEAL, fontWeight: 600, margin: "0 0 8px" }}>
          {fill(L.pvb_filed, { date: formatEventDateTime(el.pv_verse_le, lang), nom: el.pv_verse_par_nom || "—", mode: el.pv_signe_main ? L.pvb_filed_scan : "" })}
        </p>
      )}
      {peutVerser && manquants > 0 && <p style={{ fontSize: 11.5, color: "#B7791F", margin: "0 0 8px" }}>{fill(L.pvb_missing, { n: manquants })}</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn variant="outline" style={smallBtn} onClick={() => exporter("telecharger")}><FileDown size={12} /> {L.pvb_download_btn}</Btn>
        {el.pv_document_id && <Btn variant="outline" style={smallBtn} onClick={ouvrir}><FolderOpen size={12} /> {L.pvb_open_btn}</Btn>}
        {peutVerser && (
          <>
            <Btn style={smallBtn} disabled={busy || manquants > 0 || comite.length === 0} onClick={verserElectronique}>
              <Upload size={12} /> {el.pv_verse_le ? L.pvb_refile : L.pvb_file_btn}
            </Btn>
            <Btn variant="outline" style={smallBtn} disabled={busy} onClick={() => scanRef.current?.click()}><Upload size={12} /> {L.pvb_scan_btn}</Btn>
            <input ref={scanRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={verserScan} />
          </>
        )}
      </div>
    </div>
  );
}
