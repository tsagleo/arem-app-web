// =====================================================================
// Jeunesse.jsx — « Jeunesse & tutorat » (Unia Campus), 2026-10-09
// =====================================================================
// Rubrique Premium pour accompagner les jeunes de l'association :
//   • Ressources : bibliothèque (PDF, vidéos, liens) classée par catégorie,
//     niveau et matière, avec recherche et filtres ; dépôt par le bureau,
//     les responsables jeunesse et les mentors approuvés ;
//   • Jeunes : profils étudiants (enfant rattaché à un parent membre, ou
//     membre lui-même) et CONSENTEMENT PARENTAL ;
//   • Mentors : bénévoles (pré-rempli depuis members.competences),
//     approuvés par le bureau ;
//   • Jumelages : proposés selon matière / niveau, validés par le bureau ;
//     séances (visio Jitsi ou en personne), compte rendu, progression, fil
//     d'échanges visible du parent et des responsables ;
//   • Bourses : candidatures, attribution par jury ou par tirage au sort
//     vérifiable (rubrique Tirages).
// Les règles de protection des mineurs sont imposées par la base (voir
// sql/2026-10-09f_jeunesse_tutorat.sql) : l'écran ne fait que les expliquer.
// Toute écriture passe par des fonctions RPC jeunesse_*.
// =====================================================================
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  GraduationCap, BookOpen, Users, UserCheck, Handshake, Award, ShieldCheck, Plus, X, Search, FileText, Video, Link2,
  ExternalLink, Trash2, CheckCircle2, AlertTriangle, Calendar, MapPin, MessageSquare, Star, Send, Dices, Upload,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { exporterCertificatsBourse } from "./jeunessePdf";
import { Section, Container, Card, Btn, Field, Pill, inputStyle, useLang, friendlyError, foldText, formatEventDateTime, toDatetimeLocal, datetimeLocalToISO, TEAL, TEAL_LIGHT, RED } from "./shared";

const AMBER = "#B7791F";
const AMBER_LIGHT = "#FDF3E1";
const GREY = "#686F7D";
const NIVEAUX = ["primaire", "secondaire", "cegep", "universite"];
const CATEGORIES = ["cours", "remise_niveau", "developpement_personnel", "orientation"];
const TYPES_RES = ["pdf", "video", "lien", "document"];
const MATIERES_SUGG = ["Mathématiques", "Français", "Anglais", "Sciences", "Physique", "Chimie", "Biologie", "Histoire", "Géographie", "Informatique", "Économie", "Philosophie", "Méthodes de travail", "Orientation"];
const MAX_FILE_MB = 50;

const TXT = {
  fr: {
    title: "Jeunesse & tutorat",
    brand: "Unia Campus",
    intro: "Ressources scolaires, mentorat bénévole, séances de tutorat et bourses pour les jeunes de l'association — dans un cadre sûr pour les mineurs.",
    tab_ressources: "Ressources", tab_jeunes: "Jeunes", tab_mentors: "Mentors", tab_jumelages: "Jumelages & séances", tab_bourses: "Bourses & prix", tab_cadre: "Protection & encadrement",
    // Niveaux, catégories, types
    niv_primaire: "Primaire", niv_secondaire: "Secondaire", niv_cegep: "Cégep / collège", niv_universite: "Université", niv_tous: "Tous niveaux",
    cat_cours: "Cours", cat_remise_niveau: "Remise à niveau", cat_developpement_personnel: "Développement personnel", cat_orientation: "Orientation",
    type_pdf: "PDF", type_video: "Vidéo", type_lien: "Lien", type_document: "Document",
    // Ressources
    res_search: "Rechercher une ressource…",
    res_all_cat: "Toutes catégories", res_all_niv: "Tous niveaux", res_all_mat: "Toutes matières",
    res_add: "Ajouter une ressource", res_empty: "Aucune ressource pour ces critères.",
    res_title: "Titre", res_desc: "Description (facultatif)", res_type: "Type", res_cat: "Catégorie", res_niv: "Niveau", res_mat: "Matière",
    res_url: "Lien (vidéo YouTube, site, etc.)", res_file: "Ou fichier (PDF, vidéo… {n} Mo max.)", res_need_source: "Indiquez un lien ou choisissez un fichier.",
    res_too_big: "Fichier trop volumineux (maximum {n} Mo).", res_open: "Ouvrir", res_by: "Déposé par {nom}", res_delete_confirm: "Supprimer cette ressource ?",
    res_save: "Publier la ressource", res_who: "Seuls le bureau, les responsables jeunesse et les mentors approuvés peuvent déposer des ressources.",
    // Jeunes
    stu_mine: "Mes jeunes", stu_all: "Tous les jeunes inscrits",
    stu_add: "Inscrire un jeune", stu_add_self: "M'inscrire comme étudiant(e)",
    stu_prenom: "Prénom", stu_initiale: "Initiale du nom (facultatif)", stu_mineur: "Moins de 18 ans (mineur)",
    stu_niveau: "Niveau scolaire", stu_matieres: "Matières où un soutien est souhaité (séparées par des virgules)",
    stu_besoin: "Besoin en quelques mots (facultatif, 500 caractères max.)",
    stu_parent: "Parent / tuteur (membre)", stu_member: "Le jeune est lui-même membre (facultatif)", stu_choose: "— Choisir —",
    stu_minimal: "Par respect de la vie privée, nous ne demandons ni date de naissance, ni école, ni photo, ni coordonnées du jeune : le parent reste le contact.",
    stu_save: "Enregistrer", stu_edit: "Modifier", stu_empty: "Aucun jeune inscrit pour le moment.",
    stu_consent_ok: "Consentement parental donné le {date} ({mode})", stu_consent_missing: "Consentement parental manquant — aucune activité possible",
    stu_adult: "Majeur(e)", stu_minor: "Mineur(e)", stu_archived: "Archivé",
    mode_en_ligne: "en ligne", mode_papier: "formulaire papier",
    consent_title: "Consentement du parent ou tuteur",
    consent_text: "J'autorise mon enfant à participer aux activités de tutorat et de mentorat de l'association (ressources, jumelage avec un mentor bénévole approuvé, séances à distance ou en personne, candidatures aux bourses). Je comprends que tous les échanges se font dans le fil du jumelage, que je peux lire à tout moment, et que je peux retirer ce consentement quand je le souhaite.",
    consent_check: "J'ai lu et j'accepte",
    consent_btn: "Je donne mon consentement", consent_paper_btn: "Consentement papier reçu (signé)",
    consent_paper_confirm: "Confirmez-vous avoir reçu le formulaire de consentement SIGNÉ par le parent ou tuteur ?",
    consent_withdraw: "Retirer le consentement", consent_withdraw_confirm: "Retirer le consentement ? Les jumelages en cours seront suspendus et les séances prévues annulées.",
    stu_archive: "Archiver", stu_archive_confirm: "Archiver ce profil ? Les jumelages seront terminés.",
    stu_find_mentor: "Trouver un mentor", stu_suggestions: "Mentors suggérés (matière et niveau)", stu_no_suggestion: "Aucun mentor approuvé ne correspond pour l'instant.",
    stu_request: "Demander ce mentor", stu_request_matiere: "Matière du jumelage",
    stu_requested: "Demande envoyée : le bureau va valider le jumelage.",
    // Mentors
    men_become: "Devenir mentor bénévole",
    men_intro: "Partagez vos compétences avec les jeunes de l'association. Votre candidature sera examinée par le bureau (vérification des antécédents) avant tout jumelage.",
    men_matieres: "Matières que vous pouvez accompagner (séparées par des virgules)", men_niveaux: "Niveaux", men_presentation: "Courte présentation (facultatif)",
    men_prefill: "Pré-rempli depuis vos compétences de fiche membre.",
    men_code_title: "Code de conduite du mentor",
    men_code: "Je m'engage à : échanger avec le jeune uniquement dans le fil du jumelage (jamais en privé, ni par téléphone ou réseaux sociaux) ; tenir les séances en ligne avec le lien fourni ou dans un lieu public / en présence d'un parent ; respecter la confidentialité ; signaler toute situation préoccupante au responsable jeunesse ; accepter la vérification de mes antécédents.",
    men_code_check: "J'accepte le code de conduite", men_submit: "Envoyer ma candidature", men_update: "Mettre à jour mon profil mentor",
    men_my_status: "Votre statut de mentor : {s}",
    men_st_en_attente: "En attente d'approbation", men_st_approuve: "Approuvé", men_st_suspendu: "Suspendu", men_st_refuse: "Refusé",
    men_list: "Mentors approuvés", men_pending: "Candidatures de mentors à examiner", men_empty: "Aucun mentor approuvé pour le moment.",
    men_verif: "Antécédents vérifiés (vérification de l'aptitude à travailler auprès de personnes vulnérables)",
    men_approve: "Approuver", men_refuse: "Refuser", men_suspend: "Suspendre", men_reinstate: "Réactiver",
    men_motif_prompt: "Motif (facultatif) :", men_need_verif: "Cochez la vérification des antécédents avant d'approuver.",
    men_volunteer: "Bénévole déclaré", men_no_member: "Votre compte doit être lié à une fiche membre pour devenir mentor.",
    // Jumelages
    jum_new: "Nouveau jumelage", jum_student: "Jeune", jum_mentor: "Mentor", jum_matiere: "Matière", jum_objectifs: "Objectifs (facultatif)",
    jum_create: "Proposer le jumelage", jum_empty: "Aucun jumelage pour le moment.",
    jum_st_propose: "À valider", jum_st_actif: "Actif", jum_st_suspendu: "Suspendu", jum_st_termine: "Terminé", jum_st_refuse: "Refusé",
    jum_validate: "Valider", jum_refuse: "Refuser", jum_suspend: "Suspendre", jum_reactivate: "Réactiver", jum_end: "Terminer le suivi",
    jum_end_confirm: "Mettre fin à ce jumelage ?",
    jum_framework: "Cadre protégé : ce fil est visible du mentor, du jeune, de son parent et des responsables jeunesse. Aucun message privé.",
    jum_sessions: "Séances", jum_no_session: "Aucune séance planifiée.",
    ses_plan: "Planifier une séance", ses_when: "Date et heure", ses_duration: "Durée (minutes)", ses_mode: "Format",
    ses_distance: "À distance (visio)", ses_presentiel: "En personne", ses_link: "Lien de visioconférence", ses_link_gen: "Générer un lien Jitsi",
    ses_place: "Lieu", ses_place_hint: "Pour un mineur : lieu public (bibliothèque, local de l'association) ou en présence d'un parent.",
    ses_save: "Planifier", ses_join: "Rejoindre la visio",
    ses_st_prevue: "Prévue", ses_st_realisee: "Réalisée", ses_st_annulee: "Annulée",
    ses_done: "Marquer réalisée", ses_cancel: "Annuler", ses_cancel_confirm: "Annuler cette séance ?",
    ses_report: "Compte rendu de la séance", ses_progress: "Progression (1 à 5)", ses_save_report: "Enregistrer",
    msg_placeholder: "Écrire dans le fil du jumelage…", msg_send: "Envoyer", msg_progress: "Point de progression",
    msg_empty: "Aucun échange pour le moment.", progress_avg: "Progression moyenne : {n} / 5",
    role_mentor: "Mentor", role_parent: "Parent", role_etudiant: "Jeune", role_responsable: "Responsable",
    // Bourses
    bou_new: "Nouvelle bourse ou prix", bou_title: "Titre", bou_desc: "Description", bou_criteres: "Critères", bou_montant: "Montant (facultatif)",
    bou_nb: "Nombre de lauréats", bou_niveau: "Niveau visé", bou_mode: "Attribution", bou_mode_jury: "Par un jury", bou_mode_tirage: "Par tirage au sort vérifiable",
    bou_deadline: "Date limite des candidatures", bou_create: "Publier", bou_empty: "Aucune bourse pour le moment.",
    bou_st_ouverte: "Candidatures ouvertes", bou_st_fermee: "Candidatures closes", bou_st_attribuee: "Attribuée", bou_st_annulee: "Annulée",
    bou_until: "Jusqu'au {date}", bou_apply: "Déposer une candidature", bou_apply_for: "Pour", bou_motivation: "Motivation / réalisations",
    bou_submit: "Envoyer la candidature", bou_no_student: "Inscrivez d'abord un jeune dans l'onglet « Jeunes » (avec consentement parental pour un mineur).",
    bou_candidatures: "Candidatures ({n})", bou_close: "Clore les candidatures", bou_reopen: "Rouvrir", bou_cancel: "Annuler la bourse",
    bou_cancel_confirm: "Annuler cette bourse ?",
    cand_st_deposee: "Déposée", cand_st_retenue: "Présélectionnée", cand_st_laureat: "Lauréat(e)", cand_st_non_retenue: "Non retenue", cand_st_retiree: "Retirée",
    cand_note: "Note du jury", cand_comment: "Commentaire du jury", cand_shortlist: "Présélectionner", cand_save: "Enregistrer",
    cand_withdraw: "Retirer", cand_pick: "Lauréat",
    bou_award_jury: "Attribuer aux lauréats cochés", bou_award_confirm: "Attribuer la bourse aux {n} lauréat(s) sélectionné(s) ? Les autres candidatures seront marquées non retenues.",
    bou_prepare_draw: "Préparer le tirage au sort", bou_draw_confirm: "Préparer un tirage au sort parmi les {n} candidatures ? Les candidatures seront closes. Vous lancerez ensuite le tirage en direct depuis la rubrique « Tirages au sort ».",
    bou_draw_ready: "Tirage préparé : lancez-le en direct depuis la rubrique « Tirages au sort ».",
    bou_draw_live: "Tirage en cours dans la rubrique « Tirages au sort ».",
    bou_apply_draw: "Appliquer le résultat du tirage", bou_draw_done: "Le tirage est terminé.",
    bou_laureats: "Lauréat(s) : {noms}",
    bou_certificat: "Certificat (PDF)", bou_certificats: "Certificats des lauréats (PDF)",
    // Encadrement
    cad_rules_title: "Règles de protection des mineurs (imposées par la base de données)",
    cad_rule_1: "Consentement parental obligatoire : tant que le parent ou tuteur n'a pas donné son accord (date et identité enregistrées), aucun jumelage, séance, message ni candidature n'est possible pour un mineur.",
    cad_rule_2: "Aucun échange privé : tous les messages passent par le fil du jumelage, lisible par le parent et les responsables jeunesse. Les messages ne peuvent être ni modifiés ni supprimés.",
    cad_rule_3: "Mentors approuvés uniquement : vérification des antécédents et code de conduite avant toute intervention ; une suspension coupe l'accès immédiatement.",
    cad_rule_4: "Données minimales : prénom, initiale, niveau et matières seulement — ni date de naissance, ni école, ni photo, ni coordonnées du mineur (Loi 25 au Québec, LPRPDE et lois provinciales équivalentes).",
    cad_resp_title: "Responsables jeunesse",
    cad_resp_help: "En plus du bureau, ces personnes valident les jumelages, relisent les échanges et attribuent les bourses.",
    cad_add_resp: "Ajouter", cad_none: "Aucun responsable désigné (le bureau assure ce rôle).",
    cad_remove: "Retirer",
    // Divers
    sql_missing: "La rubrique n'est pas encore installée : le bureau doit exécuter le script SQL « 2026-10-09f_jeunesse_tutorat.sql » dans Supabase.",
    cancel: "Annuler", close: "Fermer", stat_res: "Ressources", stat_mentors: "Mentors", stat_jumelages: "Jumelages actifs", stat_jeunes: "Jeunes",
  },
  en: {
    title: "Youth & tutoring",
    brand: "Unia Campus",
    intro: "Learning resources, volunteer mentoring, tutoring sessions and scholarships for the association's young people — in a safe setting for minors.",
    tab_ressources: "Resources", tab_jeunes: "Youth", tab_mentors: "Mentors", tab_jumelages: "Matches & sessions", tab_bourses: "Scholarships & awards", tab_cadre: "Safeguarding",
    niv_primaire: "Elementary", niv_secondaire: "High school", niv_cegep: "CEGEP / college", niv_universite: "University", niv_tous: "All levels",
    cat_cours: "Courses", cat_remise_niveau: "Catch-up", cat_developpement_personnel: "Personal development", cat_orientation: "Career guidance",
    type_pdf: "PDF", type_video: "Video", type_lien: "Link", type_document: "Document",
    res_search: "Search resources…",
    res_all_cat: "All categories", res_all_niv: "All levels", res_all_mat: "All subjects",
    res_add: "Add a resource", res_empty: "No resources match these filters.",
    res_title: "Title", res_desc: "Description (optional)", res_type: "Type", res_cat: "Category", res_niv: "Level", res_mat: "Subject",
    res_url: "Link (YouTube video, website, etc.)", res_file: "Or file (PDF, video… {n} MB max.)", res_need_source: "Enter a link or choose a file.",
    res_too_big: "File too large (maximum {n} MB).", res_open: "Open", res_by: "Shared by {nom}", res_delete_confirm: "Delete this resource?",
    res_save: "Publish resource", res_who: "Only the board, youth leads and approved mentors can share resources.",
    stu_mine: "My young people", stu_all: "All registered young people",
    stu_add: "Register a young person", stu_add_self: "Register myself as a student",
    stu_prenom: "First name", stu_initiale: "Last name initial (optional)", stu_mineur: "Under 18 (minor)",
    stu_niveau: "School level", stu_matieres: "Subjects where help is wanted (comma-separated)",
    stu_besoin: "Need in a few words (optional, 500 characters max.)",
    stu_parent: "Parent / guardian (member)", stu_member: "The young person is a member (optional)", stu_choose: "— Choose —",
    stu_minimal: "To protect privacy we never ask for the young person's date of birth, school, photo or contact details: the parent remains the contact.",
    stu_save: "Save", stu_edit: "Edit", stu_empty: "No young people registered yet.",
    stu_consent_ok: "Parental consent given on {date} ({mode})", stu_consent_missing: "Parental consent missing — no activity possible",
    stu_adult: "Adult", stu_minor: "Minor", stu_archived: "Archived",
    mode_en_ligne: "online", mode_papier: "paper form",
    consent_title: "Parent or guardian consent",
    consent_text: "I allow my child to take part in the association's tutoring and mentoring activities (resources, match with an approved volunteer mentor, online or in-person sessions, scholarship applications). I understand that all exchanges happen in the match thread, which I can read at any time, and that I can withdraw this consent whenever I wish.",
    consent_check: "I have read and agree",
    consent_btn: "I give my consent", consent_paper_btn: "Paper consent received (signed)",
    consent_paper_confirm: "Do you confirm you received the consent form SIGNED by the parent or guardian?",
    consent_withdraw: "Withdraw consent", consent_withdraw_confirm: "Withdraw consent? Ongoing matches will be suspended and planned sessions cancelled.",
    stu_archive: "Archive", stu_archive_confirm: "Archive this profile? Matches will be ended.",
    stu_find_mentor: "Find a mentor", stu_suggestions: "Suggested mentors (subject and level)", stu_no_suggestion: "No approved mentor matches yet.",
    stu_request: "Request this mentor", stu_request_matiere: "Match subject",
    stu_requested: "Request sent: the board will validate the match.",
    men_become: "Become a volunteer mentor",
    men_intro: "Share your skills with the association's young people. The board will review your application (background check) before any match.",
    men_matieres: "Subjects you can help with (comma-separated)", men_niveaux: "Levels", men_presentation: "Short introduction (optional)",
    men_prefill: "Pre-filled from your member profile skills.",
    men_code_title: "Mentor code of conduct",
    men_code: "I commit to: communicate with the young person only in the match thread (never privately, by phone or social media); hold sessions online with the provided link or in a public place / with a parent present; respect confidentiality; report any concern to the youth lead; accept a background check.",
    men_code_check: "I accept the code of conduct", men_submit: "Send my application", men_update: "Update my mentor profile",
    men_my_status: "Your mentor status: {s}",
    men_st_en_attente: "Awaiting approval", men_st_approuve: "Approved", men_st_suspendu: "Suspended", men_st_refuse: "Declined",
    men_list: "Approved mentors", men_pending: "Mentor applications to review", men_empty: "No approved mentors yet.",
    men_verif: "Background checked (vulnerable sector check)",
    men_approve: "Approve", men_refuse: "Decline", men_suspend: "Suspend", men_reinstate: "Reinstate",
    men_motif_prompt: "Reason (optional):", men_need_verif: "Tick the background check before approving.",
    men_volunteer: "Declared volunteer", men_no_member: "Your account must be linked to a member record to become a mentor.",
    jum_new: "New match", jum_student: "Young person", jum_mentor: "Mentor", jum_matiere: "Subject", jum_objectifs: "Goals (optional)",
    jum_create: "Propose match", jum_empty: "No matches yet.",
    jum_st_propose: "To validate", jum_st_actif: "Active", jum_st_suspendu: "Suspended", jum_st_termine: "Ended", jum_st_refuse: "Declined",
    jum_validate: "Validate", jum_refuse: "Decline", jum_suspend: "Suspend", jum_reactivate: "Reactivate", jum_end: "End mentoring",
    jum_end_confirm: "End this match?",
    jum_framework: "Protected setting: this thread is visible to the mentor, the young person, their parent and youth leads. No private messages.",
    jum_sessions: "Sessions", jum_no_session: "No sessions planned.",
    ses_plan: "Plan a session", ses_when: "Date and time", ses_duration: "Duration (minutes)", ses_mode: "Format",
    ses_distance: "Online (video)", ses_presentiel: "In person", ses_link: "Video call link", ses_link_gen: "Generate a Jitsi link",
    ses_place: "Location", ses_place_hint: "For a minor: public place (library, association premises) or with a parent present.",
    ses_save: "Plan", ses_join: "Join video call",
    ses_st_prevue: "Planned", ses_st_realisee: "Done", ses_st_annulee: "Cancelled",
    ses_done: "Mark as done", ses_cancel: "Cancel", ses_cancel_confirm: "Cancel this session?",
    ses_report: "Session report", ses_progress: "Progress (1 to 5)", ses_save_report: "Save",
    msg_placeholder: "Write in the match thread…", msg_send: "Send", msg_progress: "Progress note",
    msg_empty: "No messages yet.", progress_avg: "Average progress: {n} / 5",
    role_mentor: "Mentor", role_parent: "Parent", role_etudiant: "Student", role_responsable: "Youth lead",
    bou_new: "New scholarship or award", bou_title: "Title", bou_desc: "Description", bou_criteres: "Criteria", bou_montant: "Amount (optional)",
    bou_nb: "Number of recipients", bou_niveau: "Target level", bou_mode: "Selection", bou_mode_jury: "By a jury", bou_mode_tirage: "By verifiable random draw",
    bou_deadline: "Application deadline", bou_create: "Publish", bou_empty: "No scholarships yet.",
    bou_st_ouverte: "Open for applications", bou_st_fermee: "Applications closed", bou_st_attribuee: "Awarded", bou_st_annulee: "Cancelled",
    bou_until: "Until {date}", bou_apply: "Apply", bou_apply_for: "For", bou_motivation: "Motivation / achievements",
    bou_submit: "Submit application", bou_no_student: "First register a young person in the “Youth” tab (with parental consent for a minor).",
    bou_candidatures: "Applications ({n})", bou_close: "Close applications", bou_reopen: "Reopen", bou_cancel: "Cancel scholarship",
    bou_cancel_confirm: "Cancel this scholarship?",
    cand_st_deposee: "Submitted", cand_st_retenue: "Shortlisted", cand_st_laureat: "Recipient", cand_st_non_retenue: "Not selected", cand_st_retiree: "Withdrawn",
    cand_note: "Jury score", cand_comment: "Jury comment", cand_shortlist: "Shortlist", cand_save: "Save",
    cand_withdraw: "Withdraw", cand_pick: "Recipient",
    bou_award_jury: "Award to ticked recipients", bou_award_confirm: "Award the scholarship to the {n} selected recipient(s)? Other applications will be marked not selected.",
    bou_prepare_draw: "Prepare the random draw", bou_draw_confirm: "Prepare a random draw among the {n} applications? Applications will close. You will then run the draw live from the “Random draws” section.",
    bou_draw_ready: "Draw prepared: run it live from the “Random draws” section.",
    bou_draw_live: "Draw in progress in the “Random draws” section.",
    bou_apply_draw: "Apply the draw result", bou_draw_done: "The draw is finished.",
    bou_laureats: "Recipient(s): {noms}",
    bou_certificat: "Certificate (PDF)", bou_certificats: "Recipients' certificates (PDF)",
    cad_rules_title: "Rules protecting minors (enforced by the database)",
    cad_rule_1: "Mandatory parental consent: until the parent or guardian has agreed (date and identity recorded), no match, session, message or application is possible for a minor.",
    cad_rule_2: "No private messaging: all messages go through the match thread, readable by the parent and youth leads. Messages can be neither edited nor deleted.",
    cad_rule_3: "Approved mentors only: background check and code of conduct before any involvement; a suspension removes access immediately.",
    cad_rule_4: "Minimal data: first name, initial, level and subjects only — no date of birth, school, photo or contact details for minors (Quebec Law 25, PIPEDA and equivalent provincial laws).",
    cad_resp_title: "Youth leads",
    cad_resp_help: "Besides the board, these people validate matches, review exchanges and award scholarships.",
    cad_add_resp: "Add", cad_none: "No youth lead designated (the board fills this role).",
    cad_remove: "Remove",
    sql_missing: "This section is not installed yet: the board must run the SQL script “2026-10-09f_jeunesse_tutorat.sql” in Supabase.",
    cancel: "Cancel", close: "Close", stat_res: "Resources", stat_mentors: "Mentors", stat_jumelages: "Active matches", stat_jeunes: "Young people",
  },
};

// ---------- Utilitaires ----------
function splitList(s) {
  return (s || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}
function safeFileName(name) {
  const raw = (name || "fichier").toString();
  const dot = raw.lastIndexOf(".");
  const base = dot > 0 ? raw.slice(0, dot) : raw;
  const ext = dot > 0 ? raw.slice(dot + 1) : "";
  const safeBase = base.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100) || "fichier";
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
  return safeExt ? `${safeBase}.${safeExt}` : safeBase;
}
function generateJitsiRoom() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `https://meet.jit.si/unia-campus-${rand}`;
}
function nomEtudiant(e) {
  return e ? `${e.prenom}${e.initiale_nom ? ` ${e.initiale_nom}.` : ""}` : "—";
}
// Score de correspondance mentor ↔ étudiant : matières en commun (poids 3)
// et niveau couvert (poids 2). Comparaison sans accents ni majuscules.
function scoreMentor(mentor, etudiant) {
  const mm = new Set((mentor.matieres || []).map(foldText));
  const commun = (etudiant.matieres || []).filter((x) => mm.has(foldText(x)));
  const niveauOk = (mentor.niveaux || []).includes(etudiant.niveau);
  return { score: commun.length * 3 + (niveauOk ? 2 : 0), commun, niveauOk };
}
const btnLink = (color) => ({ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color, background: "none", border: "none", cursor: "pointer", padding: 0 });
const small = { padding: "6px 12px", fontSize: 12.5 };
const muted = { fontSize: 12.5, color: GREY, margin: 0 };

function StatusPill({ color, bg, children }) {
  return <span style={{ display: "inline-block", background: bg, color, fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999 }}>{children}</span>;
}
const JUM_COLORS = { propose: [AMBER, AMBER_LIGHT], actif: [TEAL, TEAL_LIGHT], suspendu: [RED, "#FCEAEA"], termine: [GREY, "#EEF0F3"], refuse: [GREY, "#EEF0F3"] };

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 14, padding: 20, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: GREY }} aria-label="Fermer"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// =====================================================================
// Ressources
// =====================================================================
function RessourcesTab({ L, t, profile, ressources, canDeposit, onChanged }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [niv, setNiv] = useState("");
  const [mat, setMat] = useState("");
  const [showForm, setShowForm] = useState(false);
  const matieres = useMemo(() => [...new Set(ressources.map((r) => r.matiere).filter(Boolean))].sort(), [ressources]);
  const fq = foldText(q.trim());
  const visibles = ressources.filter((r) =>
    (!cat || r.categorie === cat) && (!niv || r.niveau === niv || r.niveau === "tous") && (!mat || r.matiere === mat)
    && (!fq || foldText(`${r.titre} ${r.description || ""} ${r.matiere || ""}`).includes(fq)));

  async function ouvrir(r) {
    if (r.url) { window.open(r.url, "_blank", "noopener"); return; }
    const { data, error } = await supabase.storage.from("jeunesse-ressources").createSignedUrl(r.storage_path, 300);
    if (error) { alert(friendlyError(error, t)); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }
  async function supprimer(r) {
    if (!window.confirm(L.res_delete_confirm)) return;
    const { data: path, error } = await supabase.rpc("jeunesse_supprimer_ressource", { p_id: r.id });
    if (error) { alert(friendlyError(error, t)); return; }
    if (path) await supabase.storage.from("jeunesse-ressources").remove([path]);
    onChanged();
  }
  const Icone = { pdf: FileText, video: Video, lien: Link2, document: FileText };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: 11, color: GREY }} />
          <input style={{ ...inputStyle, paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L.res_search} />
        </div>
        <select style={{ ...inputStyle, width: "auto", flex: "0 1 190px" }} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">{L.res_all_cat}</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{L["cat_" + c]}</option>)}
        </select>
        <select style={{ ...inputStyle, width: "auto", flex: "0 1 170px" }} value={niv} onChange={(e) => setNiv(e.target.value)}>
          <option value="">{L.res_all_niv}</option>
          {NIVEAUX.map((n) => <option key={n} value={n}>{L["niv_" + n]}</option>)}
        </select>
        <select style={{ ...inputStyle, width: "auto", flex: "0 1 170px" }} value={mat} onChange={(e) => setMat(e.target.value)}>
          <option value="">{L.res_all_mat}</option>
          {matieres.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {canDeposit && <Btn onClick={() => setShowForm(true)}><Plus size={14} /> {L.res_add}</Btn>}
      </div>
      {!canDeposit && <p style={{ ...muted, marginBottom: 12 }}>{L.res_who}</p>}

      {visibles.length === 0 && <p style={{ color: GREY, fontStyle: "italic" }}>{L.res_empty}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
        {visibles.map((r) => {
          const I = Icone[r.type] || FileText;
          return (
            <Card key={r.id} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <I size={18} color={TEAL} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontWeight: 700, fontSize: 14.5, color: "#182233" }}>{r.titre}</div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <StatusPill color={TEAL} bg={TEAL_LIGHT}>{L["cat_" + r.categorie]}</StatusPill>
                <StatusPill color="#3B4A6B" bg="#EAF0FA">{L["niv_" + r.niveau]}</StatusPill>
                {r.matiere && <StatusPill color={AMBER} bg={AMBER_LIGHT}>{r.matiere}</StatusPill>}
              </div>
              {r.description && <p style={{ ...muted, whiteSpace: "pre-wrap" }}>{r.description}</p>}
              <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11.5, color: "#8A8F98" }}>{L.res_by.replace("{nom}", r.depose_par_nom || "—")}</span>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => ouvrir(r)} style={btnLink("var(--primary)")}><ExternalLink size={13} /> {L.res_open}</button>
                  {(canDeposit && (r.depose_par === profile.id || profile._jeunesseResp)) && (
                    <button onClick={() => supprimer(r)} style={btnLink(RED)} aria-label="Supprimer"><Trash2 size={13} /></button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {showForm && <RessourceForm L={L} t={t} profile={profile} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); onChanged(); }} />}
    </div>
  );
}

function RessourceForm({ L, t, profile, onClose, onSaved }) {
  const [f, setF] = useState({ titre: "", description: "", type: "pdf", categorie: "cours", niveau: "secondaire", matiere: "", url: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    if (!f.url.trim() && !file) { alert(L.res_need_source); return; }
    if (file && file.size > MAX_FILE_MB * 1024 * 1024) { alert(L.res_too_big.replace("{n}", MAX_FILE_MB)); return; }
    setBusy(true);
    let path = null;
    if (file) {
      path = `${profile.association_id}/${Date.now()}_${safeFileName(file.name)}`;
      const { error: upErr } = await supabase.storage.from("jeunesse-ressources").upload(path, file);
      if (upErr) { setBusy(false); alert(friendlyError(upErr, t)); return; }
    }
    const { error } = await supabase.rpc("jeunesse_ajouter_ressource", {
      p_titre: f.titre, p_description: f.description, p_type: f.type, p_categorie: f.categorie, p_niveau: f.niveau,
      p_matiere: f.matiere, p_url: file ? null : f.url.trim(), p_storage_path: path,
    });
    setBusy(false);
    if (error) {
      if (path) await supabase.storage.from("jeunesse-ressources").remove([path]);
      alert(friendlyError(error, t)); return;
    }
    onSaved();
  }

  return (
    <Modal title={L.res_add} onClose={onClose}>
      <Field label={L.res_title}><input style={inputStyle} value={f.titre} onChange={set("titre")} /></Field>
      <Field label={L.res_desc}><textarea style={{ ...inputStyle, minHeight: 70 }} value={f.description} onChange={set("description")} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <Field label={L.res_type}>
          <select style={inputStyle} value={f.type} onChange={set("type")}>{TYPES_RES.map((x) => <option key={x} value={x}>{L["type_" + x]}</option>)}</select>
        </Field>
        <Field label={L.res_cat}>
          <select style={inputStyle} value={f.categorie} onChange={set("categorie")}>{CATEGORIES.map((x) => <option key={x} value={x}>{L["cat_" + x]}</option>)}</select>
        </Field>
        <Field label={L.res_niv}>
          <select style={inputStyle} value={f.niveau} onChange={set("niveau")}>
            {NIVEAUX.map((x) => <option key={x} value={x}>{L["niv_" + x]}</option>)}
            <option value="tous">{L.niv_tous}</option>
          </select>
        </Field>
        <Field label={L.res_mat}>
          <input style={inputStyle} list="jeunesse-matieres" value={f.matiere} onChange={set("matiere")} />
        </Field>
      </div>
      <Field label={L.res_url}><input style={inputStyle} value={f.url} onChange={set("url")} placeholder="https://" disabled={!!file} /></Field>
      <Field label={L.res_file.replace("{n}", MAX_FILE_MB)}>
        <input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.odt,.mp4,.webm,.mov,.mp3,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </Field>
      <Btn onClick={save} disabled={busy || !f.titre.trim()}><Upload size={14} /> {L.res_save}</Btn>
    </Modal>
  );
}

// =====================================================================
// Jeunes (profils étudiants + consentement)
// =====================================================================
function EtudiantForm({ L, t, profile, isResp, members, initial, selfMode, onClose, onSaved }) {
  const [f, setF] = useState(() => initial ? {
    prenom: initial.prenom, initiale: initial.initiale_nom || "", mineur: initial.mineur, niveau: initial.niveau,
    matieres: (initial.matieres || []).join(", "), besoin: initial.besoin || "",
    parent: initial.parent_member_id || "", member: initial.member_id || "",
  } : {
    prenom: "", initiale: "", mineur: !selfMode, niveau: "secondaire", matieres: "", besoin: "",
    parent: selfMode ? "" : (profile.member_id || ""), member: selfMode ? (profile.member_id || "") : "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const actifs = members.filter((m) => m.statut !== "Supprimé");

  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc("jeunesse_enregistrer_etudiant", {
      p_id: initial?.id || null, p_prenom: f.prenom, p_initiale_nom: f.initiale, p_mineur: !!f.mineur, p_niveau: f.niveau,
      p_matieres: splitList(f.matieres), p_besoin: f.besoin,
      p_parent_member_id: f.parent || null, p_member_id: f.member || null,
    });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onSaved();
  }

  return (
    <Modal title={selfMode ? L.stu_add_self : L.stu_add} onClose={onClose}>
      <p style={{ ...muted, marginBottom: 12, display: "flex", gap: 6 }}><ShieldCheck size={15} color={TEAL} style={{ flexShrink: 0 }} /> {L.stu_minimal}</p>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
        <Field label={L.stu_prenom}><input style={inputStyle} value={f.prenom} onChange={set("prenom")} maxLength={60} /></Field>
        <Field label={L.stu_initiale}><input style={inputStyle} value={f.initiale} onChange={set("initiale")} maxLength={1} /></Field>
      </div>
      {!selfMode && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginBottom: 14 }}>
          <input type="checkbox" checked={!!f.mineur} onChange={set("mineur")} disabled={!!initial && !isResp} /> {L.stu_mineur}
        </label>
      )}
      <Field label={L.stu_niveau}>
        <select style={inputStyle} value={f.niveau} onChange={set("niveau")}>{NIVEAUX.map((x) => <option key={x} value={x}>{L["niv_" + x]}</option>)}</select>
      </Field>
      <Field label={L.stu_matieres}><input style={inputStyle} value={f.matieres} onChange={set("matieres")} placeholder="Mathématiques, Français" /></Field>
      <Field label={L.stu_besoin}><textarea style={{ ...inputStyle, minHeight: 60 }} value={f.besoin} onChange={set("besoin")} maxLength={500} /></Field>
      {isResp && !selfMode && (
        <>
          <Field label={L.stu_parent}>
            <select style={inputStyle} value={f.parent} onChange={set("parent")}>
              <option value="">{L.stu_choose}</option>
              {actifs.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </select>
          </Field>
          {!f.mineur && (
            <Field label={L.stu_member}>
              <select style={inputStyle} value={f.member} onChange={set("member")}>
                <option value="">{L.stu_choose}</option>
                {actifs.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
              </select>
            </Field>
          )}
        </>
      )}
      <Btn onClick={save} disabled={busy || !f.prenom.trim()}>{L.stu_save}</Btn>
    </Modal>
  );
}

function ConsentementBloc({ L, t, etudiant, isParent, isResp, onChanged }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  async function rpc(name, params, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    const { error } = await supabase.rpc(name, params);
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }
  if (!etudiant.mineur || etudiant.statut !== "actif") return null;
  if (etudiant.consentement_le) {
    return (isParent || isResp) ? (
      <button disabled={busy} onClick={() => rpc("jeunesse_retirer_consentement", { p_etudiant_id: etudiant.id }, L.consent_withdraw_confirm)} style={btnLink(RED)}>{L.consent_withdraw}</button>
    ) : null;
  }
  return (
    <div style={{ background: AMBER_LIGHT, border: "1px solid #EEDDA0", borderRadius: 10, padding: 12, marginTop: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, display: "flex", gap: 6, alignItems: "center" }}><ShieldCheck size={15} /> {L.consent_title}</div>
      <p style={{ fontSize: 12.5, color: "#5B4A1A", margin: "0 0 8px" }}>{L.consent_text}</p>
      {isParent && (
        <>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 8 }}>
            <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> {L.consent_check}
          </label>
          <Btn style={small} disabled={!ok || busy} onClick={() => rpc("jeunesse_donner_consentement", { p_etudiant_id: etudiant.id, p_mode: "en_ligne" })}>
            <CheckCircle2 size={14} /> {L.consent_btn}
          </Btn>
        </>
      )}
      {isResp && !isParent && (
        <Btn variant="outline" style={small} disabled={busy} onClick={() => rpc("jeunesse_donner_consentement", { p_etudiant_id: etudiant.id, p_mode: "papier" }, L.consent_paper_confirm)}>
          <FileText size={14} /> {L.consent_paper_btn}
        </Btn>
      )}
    </div>
  );
}

function SuggestionsMentors({ L, t, etudiant, mentors, onDone }) {
  const [matiere, setMatiere] = useState((etudiant.matieres || [])[0] || "");
  const [busy, setBusy] = useState(false);
  const sugg = mentors.filter((m) => m.statut === "approuve")
    .map((m) => ({ m, ...scoreMentor(m, etudiant) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  async function demander(mentor) {
    setBusy(true);
    const { error } = await supabase.rpc("jeunesse_proposer_jumelage", { p_etudiant_id: etudiant.id, p_mentor_id: mentor.id, p_matiere: matiere, p_objectifs: etudiant.besoin || null });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    alert(L.stu_requested);
    onDone();
  }
  return (
    <div style={{ background: "#F8F7F4", borderRadius: 10, padding: 12, marginTop: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{L.stu_suggestions}</div>
      <Field label={L.stu_request_matiere}><input style={inputStyle} list="jeunesse-matieres" value={matiere} onChange={(e) => setMatiere(e.target.value)} /></Field>
      {sugg.length === 0 && <p style={muted}>{L.stu_no_suggestion}</p>}
      {sugg.map(({ m, commun, niveauOk }) => (
        <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid #E4E7EC", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13 }}>
            <b>{m.nom}</b>
            <span style={{ color: GREY }}> — {[...commun, niveauOk ? L["niv_" + etudiant.niveau] : null].filter(Boolean).join(" · ")}</span>
          </div>
          <Btn style={small} disabled={busy || !matiere.trim()} onClick={() => demander(m)}><Handshake size={13} /> {L.stu_request}</Btn>
        </div>
      ))}
    </div>
  );
}

function JeunesTab({ L, t, lang, profile, isResp, etudiants, mentors, members, onChanged }) {
  const [form, setForm] = useState(null); // { initial, selfMode }
  const [openSugg, setOpenSugg] = useState(null);
  const memberNom = (id) => members.find((m) => m.id === id)?.nom || "—";
  const mesJeunes = etudiants.filter((e) => e.parent_member_id === profile.member_id || e.member_id === profile.member_id);
  const autres = isResp ? etudiants.filter((e) => !mesJeunes.includes(e)) : [];
  const dejaInscrit = etudiants.some((e) => e.member_id === profile.member_id && e.statut === "actif");

  async function archiver(e) {
    if (!window.confirm(L.stu_archive_confirm)) return;
    const { error } = await supabase.rpc("jeunesse_archiver_etudiant", { p_etudiant_id: e.id });
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }

  function carte(e) {
    const isParent = e.parent_member_id && e.parent_member_id === profile.member_id;
    const isFamille = isParent || e.member_id === profile.member_id;
    const cadreOk = !e.mineur || !!e.consentement_le;
    return (
      <Card key={e.id} style={{ padding: 16, borderTopColor: cadreOk ? TEAL : AMBER, opacity: e.statut === "archive" ? 0.6 : 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{nomEtudiant(e)}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
              <StatusPill color="#3B4A6B" bg="#EAF0FA">{L["niv_" + e.niveau]}</StatusPill>
              <StatusPill color={GREY} bg="#EEF0F3">{e.mineur ? L.stu_minor : L.stu_adult}</StatusPill>
              {e.statut === "archive" && <StatusPill color={GREY} bg="#EEF0F3">{L.stu_archived}</StatusPill>}
              {(e.matieres || []).map((m) => <StatusPill key={m} color={AMBER} bg={AMBER_LIGHT}>{m}</StatusPill>)}
            </div>
            {e.parent_member_id && <p style={muted}>{L.stu_parent} : {memberNom(e.parent_member_id)}</p>}
            {e.besoin && <p style={{ ...muted, marginTop: 4, whiteSpace: "pre-wrap" }}>{e.besoin}</p>}
            {e.mineur && (
              <p style={{ fontSize: 12.5, margin: "6px 0 0", color: e.consentement_le ? TEAL : AMBER, display: "flex", gap: 5, alignItems: "center" }}>
                {e.consentement_le ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                {e.consentement_le
                  ? L.stu_consent_ok.replace("{date}", formatEventDateTime(e.consentement_le, lang)).replace("{mode}", L["mode_" + e.consentement_mode] || "")
                  : L.stu_consent_missing}
              </p>
            )}
          </div>
          {e.statut === "actif" && (isFamille || isResp) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
              {cadreOk && <Btn style={small} variant="outline" onClick={() => setOpenSugg(openSugg === e.id ? null : e.id)}><Search size={13} /> {L.stu_find_mentor}</Btn>}
              <div style={{ display: "flex", gap: 12 }}>
                <button onClick={() => setForm({ initial: e, selfMode: e.member_id === profile.member_id && !e.parent_member_id })} style={btnLink("var(--primary)")}>{L.stu_edit}</button>
                <button onClick={() => archiver(e)} style={btnLink(GREY)}>{L.stu_archive}</button>
              </div>
            </div>
          )}
        </div>
        {e.statut === "actif" && <ConsentementBloc L={L} t={t} etudiant={e} isParent={isParent} isResp={isResp} onChanged={onChanged} />}
        {openSugg === e.id && cadreOk && <SuggestionsMentors L={L} t={t} etudiant={e} mentors={mentors} onDone={() => { setOpenSugg(null); onChanged(); }} />}
      </Card>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        {(profile.member_id || isResp) && <Btn onClick={() => setForm({ initial: null, selfMode: false })}><Plus size={14} /> {L.stu_add}</Btn>}
        {profile.member_id && !dejaInscrit && <Btn variant="outline" onClick={() => setForm({ initial: null, selfMode: true })}><GraduationCap size={14} /> {L.stu_add_self}</Btn>}
      </div>
      {mesJeunes.length > 0 && <h3 style={{ fontSize: 15, margin: "0 0 10px" }}>{L.stu_mine}</h3>}
      <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>{mesJeunes.map(carte)}</div>
      {isResp && autres.length > 0 && <h3 style={{ fontSize: 15, margin: "0 0 10px" }}>{L.stu_all}</h3>}
      <div style={{ display: "grid", gap: 12 }}>{autres.map(carte)}</div>
      {mesJeunes.length === 0 && autres.length === 0 && <p style={{ color: GREY, fontStyle: "italic" }}>{L.stu_empty}</p>}
      {form && (
        <EtudiantForm L={L} t={t} profile={profile} isResp={isResp} members={members} initial={form.initial} selfMode={form.selfMode}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); onChanged(); }} />
      )}
    </div>
  );
}

// =====================================================================
// Mentors
// =====================================================================
function MentorForm({ L, t, me, monMentor, onSaved }) {
  const [f, setF] = useState(() => ({
    matieres: monMentor ? (monMentor.matieres || []).join(", ") : (me?.competences || ""),
    niveaux: new Set(monMentor?.niveaux || []),
    presentation: monMentor?.presentation || "",
    code: !!monMentor?.engagement_signe,
  }));
  const [busy, setBusy] = useState(false);
  function toggleNiv(n) { setF((p) => { const s = new Set(p.niveaux); if (s.has(n)) s.delete(n); else s.add(n); return { ...p, niveaux: s }; }); }
  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc("jeunesse_proposer_mentor", {
      p_matieres: splitList(f.matieres), p_niveaux: [...f.niveaux], p_presentation: f.presentation, p_engagement: f.code,
    });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onSaved();
  }
  return (
    <Card style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 15, margin: "0 0 6px", display: "flex", gap: 8, alignItems: "center" }}><UserCheck size={17} /> {monMentor ? L.men_update : L.men_become}</h3>
      {!monMentor && <p style={{ ...muted, marginBottom: 12 }}>{L.men_intro}</p>}
      <Field label={L.men_matieres}>
        <input style={inputStyle} value={f.matieres} onChange={(e) => setF((p) => ({ ...p, matieres: e.target.value }))} />
        {!monMentor && me?.competences && <p style={{ fontSize: 11.5, color: "#8A8F98", margin: "4px 0 0" }}>{L.men_prefill}</p>}
      </Field>
      <Field label={L.men_niveaux}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {NIVEAUX.map((n) => (
            <label key={n} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={f.niveaux.has(n)} onChange={() => toggleNiv(n)} /> {L["niv_" + n]}
            </label>
          ))}
        </div>
      </Field>
      <Field label={L.men_presentation}><textarea style={{ ...inputStyle, minHeight: 60 }} maxLength={800} value={f.presentation} onChange={(e) => setF((p) => ({ ...p, presentation: e.target.value }))} /></Field>
      <div style={{ background: "#F8F7F4", borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{L.men_code_title}</div>
        <p style={{ fontSize: 12.5, color: "#4A505C", margin: "0 0 8px" }}>{L.men_code}</p>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={f.code} onChange={(e) => setF((p) => ({ ...p, code: e.target.checked }))} /> {L.men_code_check}
        </label>
      </div>
      <Btn onClick={save} disabled={busy || !f.code || splitList(f.matieres).length === 0 || f.niveaux.size === 0}>{monMentor ? L.men_update : L.men_submit}</Btn>
    </Card>
  );
}

function MentorsTab({ L, t, profile, isBureau, mentors, members, onChanged }) {
  const me = members.find((m) => m.id === profile.member_id);
  const monMentor = mentors.find((m) => m.member_id === profile.member_id);
  const [verif, setVerif] = useState({});
  const [editing, setEditing] = useState(false);
  const approuves = mentors.filter((m) => m.statut === "approuve");
  const aExaminer = isBureau ? mentors.filter((m) => m.statut !== "approuve") : [];

  async function statuer(m, statut) {
    const v = verif[m.id] ?? m.verification_antecedents;
    if (statut === "approuve" && !v) { alert(L.men_need_verif); return; }
    let motif = null;
    if (statut === "refuse" || statut === "suspendu") { motif = window.prompt(L.men_motif_prompt); if (motif === null) return; }
    const { error } = await supabase.rpc("jeunesse_statuer_mentor", { p_mentor_id: m.id, p_statut: statut, p_verification: !!v, p_motif: motif });
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }

  function ligne(m, admin) {
    const membre = members.find((x) => x.id === m.member_id);
    return (
      <Card key={m.id} style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>{m.nom}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
              {(m.matieres || []).map((x) => <StatusPill key={x} color={AMBER} bg={AMBER_LIGHT}>{x}</StatusPill>)}
              {(m.niveaux || []).map((x) => <StatusPill key={x} color="#3B4A6B" bg="#EAF0FA">{L["niv_" + x]}</StatusPill>)}
              {admin && membre?.disponible_benevolat && <StatusPill color={TEAL} bg={TEAL_LIGHT}>{L.men_volunteer}</StatusPill>}
            </div>
            {m.presentation && <p style={{ ...muted, whiteSpace: "pre-wrap" }}>{m.presentation}</p>}
            {admin && <p style={{ ...muted, marginTop: 4 }}>{L.men_my_status.replace("{s}", L["men_st_" + m.statut])}{m.motif ? ` — ${m.motif}` : ""}</p>}
          </div>
          {admin && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", maxWidth: 320 }}>
              {m.statut !== "approuve" && (
                <label style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12 }}>
                  <input type="checkbox" checked={verif[m.id] ?? m.verification_antecedents} onChange={(e) => setVerif((p) => ({ ...p, [m.id]: e.target.checked }))} /> {L.men_verif}
                </label>
              )}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {m.statut !== "approuve" && <Btn style={small} onClick={() => statuer(m, "approuve")}><CheckCircle2 size={13} /> {m.statut === "suspendu" ? L.men_reinstate : L.men_approve}</Btn>}
                {m.statut === "en_attente" && <button onClick={() => statuer(m, "refuse")} style={btnLink(RED)}>{L.men_refuse}</button>}
                {m.statut === "approuve" && <button onClick={() => statuer(m, "suspendu")} style={btnLink(RED)}>{L.men_suspend}</button>}
              </div>
            </div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <div>
      {!profile.member_id && <p style={{ ...muted, marginBottom: 12 }}>{L.men_no_member}</p>}
      {profile.member_id && monMentor && !editing && (
        <Card style={{ marginBottom: 18, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5 }}><b>{L.men_my_status.replace("{s}", L["men_st_" + monMentor.statut])}</b></span>
            {monMentor.statut !== "suspendu" && <button onClick={() => setEditing(true)} style={btnLink("var(--primary)")}>{L.men_update}</button>}
          </div>
        </Card>
      )}
      {profile.member_id && (!monMentor || editing) && (
        <MentorForm L={L} t={t} me={me} monMentor={monMentor} onSaved={() => { setEditing(false); onChanged(); }} />
      )}
      {isBureau && aExaminer.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, margin: "0 0 10px" }}>{L.men_pending}</h3>
          <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>{aExaminer.map((m) => ligne(m, true))}</div>
        </>
      )}
      <h3 style={{ fontSize: 15, margin: "0 0 10px" }}>{L.men_list}</h3>
      {approuves.length === 0 && <p style={{ color: GREY, fontStyle: "italic" }}>{L.men_empty}</p>}
      <div style={{ display: "grid", gap: 12 }}>{approuves.map((m) => ligne(m, isBureau))}</div>
    </div>
  );
}

// =====================================================================
// Jumelages, séances, fil d'échanges
// =====================================================================
function SeanceForm({ L, t, jumelage, etudiant, onClose, onSaved }) {
  const [f, setF] = useState({ debut: "", duree: 60, mode: "distance", lien: generateJitsiRoom(), lieu: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  async function save() {
    const iso = datetimeLocalToISO(f.debut);
    if (!iso) return;
    setBusy(true);
    const { error } = await supabase.rpc("jeunesse_planifier_seance", {
      p_jumelage_id: jumelage.id, p_debut: iso, p_duree_min: Number(f.duree) || 60, p_mode: f.mode, p_lien_visio: f.lien, p_lieu: f.lieu,
    });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onSaved();
  }
  return (
    <Modal title={L.ses_plan} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
        <Field label={L.ses_when}><input type="datetime-local" style={inputStyle} value={f.debut} min={toDatetimeLocal(new Date().toISOString())} onChange={set("debut")} /></Field>
        <Field label={L.ses_duration}><input type="number" min={15} max={240} step={15} style={inputStyle} value={f.duree} onChange={set("duree")} /></Field>
      </div>
      <Field label={L.ses_mode}>
        <select style={inputStyle} value={f.mode} onChange={set("mode")}>
          <option value="distance">{L.ses_distance}</option>
          <option value="presentiel">{L.ses_presentiel}</option>
        </select>
      </Field>
      {f.mode === "distance" ? (
        <Field label={L.ses_link}>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={inputStyle} value={f.lien} onChange={set("lien")} />
            <Btn variant="outline" style={small} onClick={() => setF((p) => ({ ...p, lien: generateJitsiRoom() }))}><Video size={13} /></Btn>
          </div>
          <p style={{ fontSize: 11.5, color: "#8A8F98", margin: "4px 0 0" }}>{L.ses_link_gen}</p>
        </Field>
      ) : (
        <Field label={L.ses_place}>
          <input style={inputStyle} value={f.lieu} onChange={set("lieu")} />
          {etudiant?.mineur && <p style={{ fontSize: 11.5, color: AMBER, margin: "4px 0 0" }}>{L.ses_place_hint}</p>}
        </Field>
      )}
      <Btn onClick={save} disabled={busy || !f.debut || (f.mode === "distance" ? !f.lien.trim() : !f.lieu.trim())}><Calendar size={14} /> {L.ses_save}</Btn>
    </Modal>
  );
}

function SeanceLigne({ L, t, lang, s, canManage, canCancel, onChanged }) {
  const [open, setOpen] = useState(false);
  const [cr, setCr] = useState(s.compte_rendu || "");
  const [prog, setProg] = useState(s.progression || 3);
  async function cloturer(statut) {
    if (statut === "annulee" && !window.confirm(L.ses_cancel_confirm)) return;
    const { error } = await supabase.rpc("jeunesse_cloturer_seance", { p_seance_id: s.id, p_statut: statut, p_compte_rendu: cr, p_progression: statut === "realisee" ? Number(prog) : null });
    if (error) { alert(friendlyError(error, t)); return; }
    setOpen(false);
    onChanged();
  }
  const couleur = s.statut === "realisee" ? TEAL : s.statut === "annulee" ? GREY : "var(--primary)";
  return (
    <div style={{ padding: "8px 0", borderTop: "1px solid #EEF0F3" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Calendar size={13} color={couleur} />
          <span style={{ textDecoration: s.statut === "annulee" ? "line-through" : "none" }}>{formatEventDateTime(s.debut, lang)} · {s.duree_min} min</span>
          {s.mode === "presentiel" ? <span style={{ color: GREY, display: "inline-flex", gap: 3, alignItems: "center" }}><MapPin size={12} /> {s.lieu}</span> : <span style={{ color: GREY }}>{L.ses_distance}</span>}
          <StatusPill color={couleur} bg="#F1F2F4">{L["ses_st_" + s.statut]}</StatusPill>
          {s.progression && <span style={{ color: AMBER, display: "inline-flex", alignItems: "center", gap: 2 }}><Star size={12} fill={AMBER} /> {s.progression}/5</span>}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {s.statut === "prevue" && s.mode === "distance" && s.lien_visio && (
            <a href={s.lien_visio} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--accent)", color: "var(--primary-dark)", fontWeight: 700, fontSize: 12, borderRadius: 999, padding: "6px 12px", textDecoration: "none" }}>
              <ExternalLink size={12} /> {L.ses_join}
            </a>
          )}
          {s.statut === "prevue" && canManage && <button onClick={() => setOpen(!open)} style={btnLink(TEAL)}>{L.ses_done}</button>}
          {s.statut === "prevue" && canCancel && <button onClick={() => cloturer("annulee")} style={btnLink(RED)}>{L.ses_cancel}</button>}
        </div>
      </div>
      {s.compte_rendu && <p style={{ ...muted, margin: "4px 0 0 21px", whiteSpace: "pre-wrap" }}>{s.compte_rendu}</p>}
      {open && (
        <div style={{ background: "#F8F7F4", borderRadius: 8, padding: 10, marginTop: 6 }}>
          <Field label={L.ses_report}><textarea style={{ ...inputStyle, minHeight: 60 }} maxLength={2000} value={cr} onChange={(e) => setCr(e.target.value)} /></Field>
          <Field label={L.ses_progress}>
            <select style={{ ...inputStyle, width: 120 }} value={prog} onChange={(e) => setProg(e.target.value)}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </Field>
          <Btn style={small} onClick={() => cloturer("realisee")}>{L.ses_save_report}</Btn>
        </div>
      )}
    </div>
  );
}

function FilJumelage({ L, t, lang, jumelage, messages, canProgress, canWrite, onChanged }) {
  const [txt, setTxt] = useState("");
  const [asProgress, setAsProgress] = useState(false);
  const [note, setNote] = useState(3);
  const [busy, setBusy] = useState(false);
  async function envoyer() {
    if (!txt.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc("jeunesse_ecrire", { p_jumelage_id: jumelage.id, p_contenu: txt, p_type: asProgress ? "progression" : "message", p_note: asProgress ? Number(note) : null });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    setTxt(""); setAsProgress(false);
    onChanged();
  }
  return (
    <div style={{ marginTop: 10 }}>
      <p style={{ fontSize: 12, color: TEAL, display: "flex", gap: 6, alignItems: "flex-start", margin: "0 0 8px" }}><ShieldCheck size={14} style={{ flexShrink: 0 }} /> {L.jum_framework}</p>
      <div style={{ maxHeight: 280, overflowY: "auto", display: "grid", gap: 6, marginBottom: 8 }}>
        {messages.length === 0 && <p style={{ ...muted, fontStyle: "italic" }}>{L.msg_empty}</p>}
        {messages.map((m) => (
          <div key={m.id} style={{ background: m.type === "progression" ? AMBER_LIGHT : "#F4F6F9", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 11.5, color: GREY, marginBottom: 2 }}>
              <b>{m.auteur_nom || "—"}</b> · {L["role_" + m.auteur_role] || ""} · {formatEventDateTime(m.created_at, lang)}
              {m.type === "progression" && m.note_progression && <span style={{ color: AMBER, marginLeft: 6 }}>★ {m.note_progression}/5</span>}
            </div>
            <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.contenu}</div>
          </div>
        ))}
      </div>
      {canWrite && (
        <div>
          <textarea style={{ ...inputStyle, minHeight: 54 }} maxLength={2000} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={L.msg_placeholder} />
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
            {canProgress && (
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                <input type="checkbox" checked={asProgress} onChange={(e) => setAsProgress(e.target.checked)} /> {L.msg_progress}
              </label>
            )}
            {asProgress && (
              <select style={{ ...inputStyle, width: 80, padding: "5px 8px" }} value={note} onChange={(e) => setNote(e.target.value)}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            )}
            <Btn style={small} disabled={busy || !txt.trim()} onClick={envoyer}><Send size={13} /> {L.msg_send}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function NouveauJumelage({ L, t, etudiants, mentors, onClose, onSaved }) {
  const eligibles = etudiants.filter((e) => e.statut === "actif" && (!e.mineur || e.consentement_le));
  const approuves = mentors.filter((m) => m.statut === "approuve");
  const [etuId, setEtuId] = useState("");
  const [menId, setMenId] = useState("");
  const [matiere, setMatiere] = useState("");
  const [obj, setObj] = useState("");
  const [busy, setBusy] = useState(false);
  const etu = eligibles.find((e) => e.id === etuId);
  const tries = etu ? [...approuves].sort((a, b) => scoreMentor(b, etu).score - scoreMentor(a, etu).score) : approuves;
  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc("jeunesse_proposer_jumelage", { p_etudiant_id: etuId, p_mentor_id: menId, p_matiere: matiere, p_objectifs: obj });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onSaved();
  }
  return (
    <Modal title={L.jum_new} onClose={onClose}>
      <Field label={L.jum_student}>
        <select style={inputStyle} value={etuId} onChange={(e) => { setEtuId(e.target.value); const x = eligibles.find((y) => y.id === e.target.value); setMatiere((x?.matieres || [])[0] || ""); }}>
          <option value="">{L.stu_choose}</option>
          {eligibles.map((e) => <option key={e.id} value={e.id}>{nomEtudiant(e)} — {L["niv_" + e.niveau]}</option>)}
        </select>
      </Field>
      <Field label={L.jum_mentor}>
        <select style={inputStyle} value={menId} onChange={(e) => setMenId(e.target.value)}>
          <option value="">{L.stu_choose}</option>
          {tries.map((m) => {
            const sc = etu ? scoreMentor(m, etu) : null;
            return <option key={m.id} value={m.id}>{m.nom}{sc && sc.score > 0 ? ` ★ ${[...sc.commun, sc.niveauOk ? L["niv_" + etu.niveau] : null].filter(Boolean).join(", ")}` : ""}</option>;
          })}
        </select>
      </Field>
      <Field label={L.jum_matiere}><input style={inputStyle} list="jeunesse-matieres" value={matiere} onChange={(e) => setMatiere(e.target.value)} /></Field>
      <Field label={L.jum_objectifs}><textarea style={{ ...inputStyle, minHeight: 60 }} maxLength={1000} value={obj} onChange={(e) => setObj(e.target.value)} /></Field>
      <Btn onClick={save} disabled={busy || !etuId || !menId || !matiere.trim()}><Handshake size={14} /> {L.jum_create}</Btn>
    </Modal>
  );
}

function JumelagesTab({ L, t, lang, profile, isResp, etudiants, mentors, jumelages, seances, messages, onChanged }) {
  const [openId, setOpenId] = useState(null);
  const [planFor, setPlanFor] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const monMentorId = mentors.find((m) => m.member_id === profile.member_id && m.statut === "approuve")?.id;
  const ordre = { propose: 0, actif: 1, suspendu: 2, termine: 3, refuse: 4 };
  const liste = [...jumelages].sort((a, b) => (ordre[a.statut] - ordre[b.statut]) || (b.created_at || "").localeCompare(a.created_at || ""));

  async function statuer(j, statut, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    const { error } = await supabase.rpc("jeunesse_statuer_jumelage", { p_jumelage_id: j.id, p_statut: statut });
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }

  return (
    <div>
      {isResp && <div style={{ marginBottom: 14 }}><Btn onClick={() => setShowNew(true)}><Plus size={14} /> {L.jum_new}</Btn></div>}
      {liste.length === 0 && <p style={{ color: GREY, fontStyle: "italic" }}>{L.jum_empty}</p>}
      <div style={{ display: "grid", gap: 12 }}>
        {liste.map((j) => {
          const e = etudiants.find((x) => x.id === j.etudiant_id);
          const m = mentors.find((x) => x.id === j.mentor_id);
          const estMentor = monMentorId && monMentorId === j.mentor_id;
          const estFamille = e && (e.parent_member_id === profile.member_id || e.member_id === profile.member_id);
          const sj = seances.filter((s) => s.jumelage_id === j.id).sort((a, b) => (a.debut || "").localeCompare(b.debut || ""));
          const mj = messages.filter((x) => x.jumelage_id === j.id);
          const notes = [...sj.map((s) => s.progression), ...mj.map((x) => x.note_progression)].filter(Boolean);
          const moy = notes.length ? (notes.reduce((a, b) => a + b, 0) / notes.length).toFixed(1) : null;
          const [c, bg] = JUM_COLORS[j.statut] || [GREY, "#EEF0F3"];
          const open = openId === j.id;
          return (
            <Card key={j.id} style={{ padding: 16, borderTopColor: c }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14.5, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <GraduationCap size={16} /> {nomEtudiant(e)} <span style={{ color: GREY, fontWeight: 400 }}>↔</span> <UserCheck size={16} /> {m?.nom || "—"}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
                    <StatusPill color={c} bg={bg}>{L["jum_st_" + j.statut]}</StatusPill>
                    <StatusPill color={AMBER} bg={AMBER_LIGHT}>{j.matiere}</StatusPill>
                    {e && <StatusPill color="#3B4A6B" bg="#EAF0FA">{L["niv_" + e.niveau]}</StatusPill>}
                    {moy && <span style={{ fontSize: 12, color: AMBER, display: "inline-flex", gap: 3, alignItems: "center" }}><Star size={12} fill={AMBER} /> {L.progress_avg.replace("{n}", moy)}</span>}
                  </div>
                  {j.objectifs && <p style={{ ...muted, whiteSpace: "pre-wrap" }}>{j.objectifs}</p>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                  {isResp && j.statut === "propose" && (
                    <div style={{ display: "flex", gap: 10 }}>
                      <Btn style={small} onClick={() => statuer(j, "actif")}><CheckCircle2 size={13} /> {L.jum_validate}</Btn>
                      <button onClick={() => statuer(j, "refuse")} style={btnLink(RED)}>{L.jum_refuse}</button>
                    </div>
                  )}
                  {isResp && j.statut === "actif" && <button onClick={() => statuer(j, "suspendu")} style={btnLink(RED)}>{L.jum_suspend}</button>}
                  {isResp && j.statut === "suspendu" && <button onClick={() => statuer(j, "actif")} style={btnLink(TEAL)}>{L.jum_reactivate}</button>}
                  {(isResp || estMentor || estFamille) && ["actif", "suspendu", "propose"].includes(j.statut) && (
                    <button onClick={() => statuer(j, "termine", L.jum_end_confirm)} style={btnLink(GREY)}>{L.jum_end}</button>
                  )}
                  <button onClick={() => setOpenId(open ? null : j.id)} style={btnLink("var(--primary)")}>
                    <MessageSquare size={13} /> {L.jum_sessions} ({sj.length}) · {mj.length}
                  </button>
                </div>
              </div>
              {open && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <b style={{ fontSize: 13 }}>{L.jum_sessions}</b>
                    {j.statut === "actif" && (isResp || estMentor) && <Btn style={small} variant="outline" onClick={() => setPlanFor(j)}><Plus size={13} /> {L.ses_plan}</Btn>}
                  </div>
                  {sj.length === 0 && <p style={muted}>{L.jum_no_session}</p>}
                  {sj.map((s) => (
                    <SeanceLigne key={s.id} L={L} t={t} lang={lang} s={s} canManage={isResp || estMentor} canCancel={isResp || estMentor || estFamille} onChanged={onChanged} />
                  ))}
                  <FilJumelage L={L} t={t} lang={lang} jumelage={j} messages={mj}
                    canWrite={isResp || (j.statut === "actif" && (estMentor || estFamille))}
                    canProgress={isResp || estMentor} onChanged={onChanged} />
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {planFor && (
        <SeanceForm L={L} t={t} jumelage={planFor} etudiant={etudiants.find((x) => x.id === planFor.etudiant_id)}
          onClose={() => setPlanFor(null)} onSaved={() => { setPlanFor(null); onChanged(); }} />
      )}
      {showNew && <NouveauJumelage L={L} t={t} etudiants={etudiants} mentors={mentors} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); onChanged(); }} />}
    </div>
  );
}

// =====================================================================
// Bourses et prix
// =====================================================================
function BourseForm({ L, t, onClose, onSaved }) {
  const [f, setF] = useState({ titre: "", description: "", criteres: "", montant: "", nb: 1, niveau: "tous", mode: "jury", date_limite: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc("jeunesse_creer_bourse", {
      p_titre: f.titre, p_description: f.description, p_criteres: f.criteres, p_montant: f.montant === "" ? null : Number(f.montant),
      p_nb_laureats: Number(f.nb) || 1, p_niveau: f.niveau, p_mode: f.mode, p_date_limite: f.date_limite || null,
    });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onSaved();
  }
  return (
    <Modal title={L.bou_new} onClose={onClose}>
      <Field label={L.bou_title}><input style={inputStyle} value={f.titre} onChange={set("titre")} /></Field>
      <Field label={L.bou_desc}><textarea style={{ ...inputStyle, minHeight: 60 }} value={f.description} onChange={set("description")} /></Field>
      <Field label={L.bou_criteres}><textarea style={{ ...inputStyle, minHeight: 50 }} value={f.criteres} onChange={set("criteres")} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <Field label={L.bou_montant}><input type="number" min={0} style={inputStyle} value={f.montant} onChange={set("montant")} /></Field>
        <Field label={L.bou_nb}><input type="number" min={1} style={inputStyle} value={f.nb} onChange={set("nb")} /></Field>
        <Field label={L.bou_niveau}>
          <select style={inputStyle} value={f.niveau} onChange={set("niveau")}>
            <option value="tous">{L.niv_tous}</option>
            {NIVEAUX.map((x) => <option key={x} value={x}>{L["niv_" + x]}</option>)}
          </select>
        </Field>
        <Field label={L.bou_deadline}><input type="date" style={inputStyle} value={f.date_limite} onChange={set("date_limite")} /></Field>
      </div>
      <Field label={L.bou_mode}>
        <select style={inputStyle} value={f.mode} onChange={set("mode")}>
          <option value="jury">{L.bou_mode_jury}</option>
          <option value="tirage">{L.bou_mode_tirage}</option>
        </select>
      </Field>
      <Btn onClick={save} disabled={busy || !f.titre.trim()}><Award size={14} /> {L.bou_create}</Btn>
    </Modal>
  );
}

function CandidatureJury({ L, t, c, etudiant, pickable, picked, onPick, onChanged }) {
  const [note, setNote] = useState(c.note_jury ?? "");
  const [com, setCom] = useState(c.commentaire_jury || "");
  async function save(retenue) {
    const { error } = await supabase.rpc("jeunesse_evaluer_candidature", { p_candidature_id: c.id, p_note: note === "" ? null : Number(note), p_commentaire: com, p_retenue: retenue });
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }
  const actif = ["deposee", "retenue"].includes(c.statut);
  return (
    <div style={{ borderTop: "1px solid #EEF0F3", padding: "8px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 13 }}>
          {pickable && actif && <input type="checkbox" checked={picked} onChange={onPick} style={{ marginRight: 6 }} aria-label={L.cand_pick} />}
          <b>{nomEtudiant(etudiant)}</b> {etudiant && <span style={{ color: GREY }}>· {L["niv_" + etudiant.niveau]}</span>} · <span style={{ color: c.statut === "laureat" ? TEAL : GREY }}>{L["cand_st_" + c.statut]}</span>
        </div>
      </div>
      {c.motivation && <p style={{ ...muted, whiteSpace: "pre-wrap", margin: "4px 0" }}>{c.motivation}</p>}
      {actif && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="number" min={0} max={100} step={0.5} style={{ ...inputStyle, width: 90, padding: "5px 8px" }} placeholder={L.cand_note} value={note} onChange={(e) => setNote(e.target.value)} />
          <input style={{ ...inputStyle, flex: "1 1 180px", padding: "5px 8px" }} placeholder={L.cand_comment} value={com} onChange={(e) => setCom(e.target.value)} />
          <button onClick={() => save(c.statut === "retenue")} style={btnLink("var(--primary)")}>{L.cand_save}</button>
          {c.statut === "deposee" && <button onClick={() => save(true)} style={btnLink(TEAL)}>{L.cand_shortlist}</button>}
        </div>
      )}
    </div>
  );
}

function BourseCard({ association, L, t, lang, profile, isResp, isBureau, b, candidatures, etudiants, tirage, onChanged }) {
  const [applyOpen, setApplyOpen] = useState(false);
  const [etuId, setEtuId] = useState("");
  const [motiv, setMotiv] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const mesJeunes = etudiants.filter((e) => e.statut === "actif" && (e.parent_member_id === profile.member_id || e.member_id === profile.member_id) && (!e.mineur || e.consentement_le));
  const cands = candidatures.filter((c) => c.bourse_id === b.id);
  const mesCands = cands.filter((c) => etudiants.some((e) => e.id === c.etudiant_id && (e.parent_member_id === profile.member_id || e.member_id === profile.member_id)));
  const actives = cands.filter((c) => ["deposee", "retenue"].includes(c.statut));
  const laureats = cands.filter((c) => c.statut === "laureat").map((c) => nomEtudiant(etudiants.find((e) => e.id === c.etudiant_id)));
  const deadlinePassed = b.date_limite && b.date_limite < new Date().toISOString().slice(0, 10);
  const ouverte = b.statut === "ouverte" && !deadlinePassed;
  const etuNom = (id) => nomEtudiant(etudiants.find((e) => e.id === id));

  async function rpc(name, params, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return false;
    setBusy(true);
    const { error } = await supabase.rpc(name, params);
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return false; }
    onChanged();
    return true;
  }
  async function candidater() {
    if (await rpc("jeunesse_candidater", { p_bourse_id: b.id, p_etudiant_id: etuId, p_motivation: motiv })) { setApplyOpen(false); setMotiv(""); setEtuId(""); }
  }
  const stColor = b.statut === "attribuee" ? TEAL : b.statut === "annulee" ? GREY : b.statut === "ouverte" ? "var(--primary)" : AMBER;

  return (
    <Card style={{ padding: 16, borderTopColor: stColor }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, display: "flex", gap: 8, alignItems: "center" }}><Award size={17} color={AMBER} /> {b.titre}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
            <StatusPill color={stColor} bg="#F1F2F4">{L["bou_st_" + b.statut]}</StatusPill>
            <StatusPill color="#3B4A6B" bg="#EAF0FA">{L["niv_" + (b.niveau || "tous")]}</StatusPill>
            <StatusPill color={GREY} bg="#EEF0F3">{b.mode === "tirage" ? L.bou_mode_tirage : L.bou_mode_jury}</StatusPill>
            {b.montant != null && <StatusPill color={TEAL} bg={TEAL_LIGHT}>{Number(b.montant).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")} $ × {b.nb_laureats}</StatusPill>}
            {b.date_limite && <span style={{ fontSize: 12, color: GREY }}>{L.bou_until.replace("{date}", new Date(`${b.date_limite}T12:00:00`).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA", { dateStyle: "long" }))}</span>}
          </div>
          {b.description && <p style={{ ...muted, whiteSpace: "pre-wrap" }}>{b.description}</p>}
          {b.criteres && <p style={{ ...muted, whiteSpace: "pre-wrap", marginTop: 4 }}><b>{L.bou_criteres} :</b> {b.criteres}</p>}
          {laureats.length > 0 && <p style={{ fontSize: 13, color: TEAL, fontWeight: 700, margin: "8px 0 0" }}>🏆 {L.bou_laureats.replace("{noms}", laureats.join(", "))}</p>}
          {(() => {
            // Certificat imprimable : tous les lauréats pour les responsables,
            // seulement son propre jeune pour un parent (2026-10-10).
            const cl = cands.filter((c) => c.statut === "laureat")
              .map((c) => etudiants.find((e) => e.id === c.etudiant_id))
              .filter((e) => e && (isResp || e.parent_member_id === profile.member_id || e.member_id === profile.member_id));
            if (b.statut !== "attribuee" || cl.length === 0) return null;
            return (
              <Btn variant="outline" style={{ ...small, marginTop: 8 }} onClick={() => exporterCertificatsBourse({
                bourse: b, association, lang,
                laureats: cl.map((e) => ({ nom: nomEtudiant(e), niveauLabel: L["niv_" + e.niveau] || "" })),
              }).catch((e) => alert(friendlyError(e, t)))}>
                <Award size={13} /> {cl.length > 1 ? L.bou_certificats : L.bou_certificat}
              </Btn>
            );
          })()}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          {ouverte && profile.member_id && <Btn style={small} onClick={() => setApplyOpen(!applyOpen)}><Send size={13} /> {L.bou_apply}</Btn>}
          {isResp && b.statut === "ouverte" && <button onClick={() => rpc("jeunesse_statuer_bourse", { p_bourse_id: b.id, p_statut: "fermee" })} style={btnLink(AMBER)}>{L.bou_close}</button>}
          {isResp && b.statut === "fermee" && !b.tirage_id && <button onClick={() => rpc("jeunesse_statuer_bourse", { p_bourse_id: b.id, p_statut: "ouverte" })} style={btnLink(TEAL)}>{L.bou_reopen}</button>}
          {isResp && ["ouverte", "fermee"].includes(b.statut) && <button onClick={() => rpc("jeunesse_statuer_bourse", { p_bourse_id: b.id, p_statut: "annulee" }, L.bou_cancel_confirm)} style={btnLink(RED)}>{L.bou_cancel}</button>}
        </div>
      </div>

      {mesCands.length > 0 && !isResp && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          {mesCands.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "3px 0" }}>
              <span>{etuNom(c.etudiant_id)} — <b style={{ color: c.statut === "laureat" ? TEAL : GREY }}>{L["cand_st_" + c.statut]}</b></span>
              {["deposee", "retenue"].includes(c.statut) && b.statut === "ouverte" && (
                <button onClick={() => rpc("jeunesse_retirer_candidature", { p_candidature_id: c.id })} style={btnLink(RED)}>{L.cand_withdraw}</button>
              )}
            </div>
          ))}
        </div>
      )}

      {applyOpen && (
        <div style={{ background: "#F8F7F4", borderRadius: 10, padding: 12, marginTop: 10 }}>
          {mesJeunes.length === 0 ? <p style={muted}>{L.bou_no_student}</p> : (
            <>
              <Field label={L.bou_apply_for}>
                <select style={inputStyle} value={etuId} onChange={(e) => setEtuId(e.target.value)}>
                  <option value="">{L.stu_choose}</option>
                  {mesJeunes.filter((e) => !cands.some((c) => c.etudiant_id === e.id)).map((e) => <option key={e.id} value={e.id}>{nomEtudiant(e)}</option>)}
                </select>
              </Field>
              <Field label={L.bou_motivation}><textarea style={{ ...inputStyle, minHeight: 80 }} maxLength={3000} value={motiv} onChange={(e) => setMotiv(e.target.value)} /></Field>
              <Btn style={small} disabled={busy || !etuId} onClick={candidater}>{L.bou_submit}</Btn>
            </>
          )}
        </div>
      )}

      {isResp && cands.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>{L.bou_candidatures.replace("{n}", cands.length)}</summary>
          {cands.map((c) => (
            <CandidatureJury key={c.id} L={L} t={t} c={c} etudiant={etudiants.find((e) => e.id === c.etudiant_id)}
              pickable={b.mode === "jury" && b.statut !== "attribuee" && b.statut !== "annulee"}
              picked={picked.has(c.id)}
              onPick={() => setPicked((p) => { const n = new Set(p); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
              onChanged={onChanged} />
          ))}
          {b.mode === "jury" && !["attribuee", "annulee"].includes(b.statut) && (
            <div style={{ marginTop: 8 }}>
              <Btn style={small} disabled={busy || picked.size === 0 || picked.size > b.nb_laureats}
                onClick={() => rpc("jeunesse_attribuer_jury", { p_bourse_id: b.id, p_candidature_ids: [...picked] }, L.bou_award_confirm.replace("{n}", picked.size))}>
                <Award size={13} /> {L.bou_award_jury}
              </Btn>
            </div>
          )}
        </details>
      )}

      {b.mode === "tirage" && isResp && !["attribuee", "annulee"].includes(b.statut) && (
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {(!tirage || tirage.statut === "annule") && isBureau && (
            <Btn style={small} variant="outline" disabled={busy || actives.length < 2}
              onClick={() => rpc("jeunesse_preparer_tirage_bourse", { p_bourse_id: b.id }, L.bou_draw_confirm.replace("{n}", actives.length))}>
              <Dices size={13} /> {L.bou_prepare_draw}
            </Btn>
          )}
          {tirage?.statut === "prepare" && <span style={{ fontSize: 12.5, color: AMBER }}><Dices size={13} /> {L.bou_draw_ready}</span>}
          {tirage?.statut === "en_cours" && <span style={{ fontSize: 12.5, color: RED, fontWeight: 700 }}><Dices size={13} /> {L.bou_draw_live}</span>}
          {tirage?.statut === "termine" && (
            <>
              <span style={{ fontSize: 12.5, color: TEAL }}>{L.bou_draw_done}</span>
              <Btn style={small} disabled={busy} onClick={() => rpc("jeunesse_appliquer_tirage_bourse", { p_bourse_id: b.id })}><Award size={13} /> {L.bou_apply_draw}</Btn>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function BoursesTab({ association, L, t, lang, profile, isResp, isBureau, bourses, candidatures, etudiants, tirages, onChanged }) {
  const [showNew, setShowNew] = useState(false);
  return (
    <div>
      {isResp && <div style={{ marginBottom: 14 }}><Btn onClick={() => setShowNew(true)}><Plus size={14} /> {L.bou_new}</Btn></div>}
      {bourses.length === 0 && <p style={{ color: GREY, fontStyle: "italic" }}>{L.bou_empty}</p>}
      <div style={{ display: "grid", gap: 12 }}>
        {bourses.map((b) => (
          <BourseCard key={b.id} association={association} L={L} t={t} lang={lang} profile={profile} isResp={isResp} isBureau={isBureau} b={b}
            candidatures={candidatures} etudiants={etudiants} tirage={tirages.find((x) => x.id === b.tirage_id)} onChanged={onChanged} />
        ))}
      </div>
      {showNew && <BourseForm L={L} t={t} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); onChanged(); }} />}
    </div>
  );
}

// =====================================================================
// Protection & encadrement
// =====================================================================
function CadreTab({ L, t, isBureau, responsables, profiles, onChanged }) {
  const [choix, setChoix] = useState("");
  const nomProfil = (id) => profiles.find((p) => p.id === id)?.nom_complet || "—";
  async function definir(id, actif) {
    const { error } = await supabase.rpc("jeunesse_definir_responsable", { p_profile_id: id, p_actif: actif });
    if (error) { alert(friendlyError(error, t)); return; }
    setChoix("");
    onChanged();
  }
  const disponibles = profiles.filter((p) => !responsables.some((r) => r.profile_id === p.id));
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card>
        <h3 style={{ fontSize: 15, margin: "0 0 10px", display: "flex", gap: 8, alignItems: "center" }}><ShieldCheck size={18} color={TEAL} /> {L.cad_rules_title}</h3>
        <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8, fontSize: 13.5, color: "#3A404C" }}>
          <li>{L.cad_rule_1}</li><li>{L.cad_rule_2}</li><li>{L.cad_rule_3}</li><li>{L.cad_rule_4}</li>
        </ol>
      </Card>
      <Card>
        <h3 style={{ fontSize: 15, margin: "0 0 4px" }}>{L.cad_resp_title}</h3>
        <p style={{ ...muted, marginBottom: 10 }}>{L.cad_resp_help}</p>
        {responsables.length === 0 && <p style={{ ...muted, fontStyle: "italic" }}>{L.cad_none}</p>}
        {responsables.map((r) => (
          <div key={r.profile_id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderTop: "1px solid #EEF0F3", fontSize: 13.5 }}>
            <span>{nomProfil(r.profile_id)}</span>
            {isBureau && <button onClick={() => definir(r.profile_id, false)} style={btnLink(RED)}>{L.cad_remove}</button>}
          </div>
        ))}
        {isBureau && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <select style={inputStyle} value={choix} onChange={(e) => setChoix(e.target.value)}>
              <option value="">{L.stu_choose}</option>
              {disponibles.map((p) => <option key={p.id} value={p.id}>{p.nom_complet || p.id}</option>)}
            </select>
            <Btn style={small} disabled={!choix} onClick={() => definir(choix, true)}><Plus size={13} /> {L.cad_add_resp}</Btn>
          </div>
        )}
      </Card>
    </div>
  );
}

// =====================================================================
// Composant principal
// =====================================================================
export default function Jeunesse({ profile, isBureau, association }) {
  const { t, lang } = useLang();
  const L = TXT[lang === "en" ? "en" : "fr"];
  const [tab, setTab] = useState("ressources");
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [d, setD] = useState({
    isResp: false, ressources: [], etudiants: [], mentors: [], jumelages: [], seances: [], messages: [],
    bourses: [], candidatures: [], responsables: [], members: [], profiles: [], tirages: [],
  });

  const load = useCallback(async () => {
    const aid = profile.association_id;
    const q = (table, cols = "*") => supabase.from(table).select(cols).eq("association_id", aid);
    const [resp, ressources, etudiants, mentors, jumelages, seances, messages, bourses, candidatures, responsables, members, profiles] = await Promise.all([
      supabase.rpc("jeunesse_est_responsable"),
      q("jeunesse_ressources").order("created_at", { ascending: false }),
      q("jeunesse_etudiants").order("prenom"),
      q("jeunesse_mentors").order("nom"),
      q("jeunesse_jumelages").order("created_at", { ascending: false }),
      q("jeunesse_seances").order("debut"),
      q("jeunesse_messages").order("created_at"),
      q("jeunesse_bourses").order("created_at", { ascending: false }),
      q("jeunesse_candidatures"),
      q("jeunesse_responsables"),
      q("members", "id, nom, statut, competences, disponible_benevolat").order("nom"),
      isBureau ? q("profiles", "id, nom_complet, role").order("nom_complet") : Promise.resolve({ data: [] }),
    ]);
    if (ressources.error && (ressources.error.code === "42P01" || ressources.error.code === "PGRST205")) {
      setMissing(true); setLoading(false); return;
    }
    const bs = bourses.data || [];
    const tirageIds = bs.map((b) => b.tirage_id).filter(Boolean);
    const tirages = tirageIds.length ? (await supabase.from("tirages").select("id, statut").in("id", tirageIds)).data || [] : [];
    setD({
      isResp: !!resp.data, ressources: ressources.data || [], etudiants: etudiants.data || [], mentors: mentors.data || [],
      jumelages: jumelages.data || [], seances: seances.data || [], messages: messages.data || [], bourses: bs,
      candidatures: candidatures.data || [], responsables: responsables.data || [], members: members.data || [],
      profiles: profiles.data || [], tirages,
    });
    setMissing(false);
    setLoading(false);
  }, [profile.association_id, isBureau]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Container><Section><p>{t("loading")}</p></Section></Container>;
  if (missing) return <Container><Section><Card><p style={{ margin: 0, color: AMBER, display: "flex", gap: 8 }}><AlertTriangle size={18} /> {L.sql_missing}</p></Card></Section></Container>;

  const isResp = d.isResp || isBureau;
  const monMentor = d.mentors.find((m) => m.member_id === profile.member_id && m.statut === "approuve");
  const canDeposit = isResp || !!monMentor;
  const profileX = { ...profile, _jeunesseResp: isResp };
  const nbAValider = d.jumelages.filter((j) => j.statut === "propose").length;
  const nbMentorsAttente = d.mentors.filter((m) => m.statut === "en_attente").length;

  const TABS = [
    { id: "ressources", label: L.tab_ressources, icon: BookOpen },
    { id: "jeunes", label: L.tab_jeunes, icon: GraduationCap },
    { id: "mentors", label: L.tab_mentors, icon: UserCheck, badge: isBureau ? nbMentorsAttente : 0 },
    { id: "jumelages", label: L.tab_jumelages, icon: Handshake, badge: isResp ? nbAValider : 0 },
    { id: "bourses", label: L.tab_bourses, icon: Award },
    { id: "cadre", label: L.tab_cadre, icon: ShieldCheck },
  ];

  return (
    <Container>
      <Section>
        <datalist id="jeunesse-matieres">{MATIERES_SUGG.map((m) => <option key={m} value={m} />)}</datalist>
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 22, margin: 0, display: "flex", alignItems: "center", gap: 10 }}><GraduationCap size={24} /> {L.title}</h2>
            <Pill>{L.brand}</Pill>
          </div>
          <p style={{ fontSize: 13, color: GREY, margin: "6px 0 0", maxWidth: 680 }}>{L.intro}</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 18 }}>
          {[
            [L.stat_res, d.ressources.length, BookOpen],
            [L.stat_mentors, d.mentors.filter((m) => m.statut === "approuve").length, UserCheck],
            [L.stat_jumelages, d.jumelages.filter((j) => j.statut === "actif").length, Handshake],
            ...(isResp ? [[L.stat_jeunes, d.etudiants.filter((e) => e.statut === "actif").length, Users]] : []),
          ].map(([label, value, I]) => (
            <div key={label} style={{ background: "white", borderRadius: 10, padding: "10px 14px", boxShadow: "0 2px 10px rgba(31,56,100,0.06)" }}>
              <div style={{ fontSize: 11.5, color: TEAL, fontWeight: 700, textTransform: "uppercase", display: "flex", gap: 6, alignItems: "center" }}><I size={13} /> {label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--primary)" }}>{value}</div>
            </div>
          ))}
        </div>

        <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18, borderBottom: "1px solid #E4E7EC", paddingBottom: 8 }}>
          {TABS.map(({ id, label, icon: I, badge }) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === id ? "var(--primary)" : "#F1F2F4", color: tab === id ? "white" : "#3A404C" }}>
              <I size={14} /> {label}
              {badge > 0 && <span style={{ background: RED, color: "white", borderRadius: 999, fontSize: 11, padding: "0 6px", minWidth: 18, textAlign: "center" }}>{badge}</span>}
            </button>
          ))}
        </div>

        {tab === "ressources" && <RessourcesTab L={L} t={t} profile={profileX} ressources={d.ressources} canDeposit={canDeposit} onChanged={load} />}
        {tab === "jeunes" && <JeunesTab L={L} t={t} lang={lang} profile={profile} isResp={isResp} etudiants={d.etudiants} mentors={d.mentors} members={d.members} onChanged={load} />}
        {tab === "mentors" && <MentorsTab L={L} t={t} profile={profile} isBureau={isBureau} mentors={d.mentors} members={d.members} onChanged={load} />}
        {tab === "jumelages" && <JumelagesTab L={L} t={t} lang={lang} profile={profile} isResp={isResp} etudiants={d.etudiants} mentors={d.mentors} jumelages={d.jumelages} seances={d.seances} messages={d.messages} onChanged={load} />}
        {tab === "bourses" && <BoursesTab association={association} L={L} t={t} lang={lang} profile={profile} isResp={isResp} isBureau={isBureau} bourses={d.bourses} candidatures={d.candidatures} etudiants={d.etudiants} tirages={d.tirages} onChanged={load} />}
        {tab === "cadre" && <CadreTab L={L} t={t} isBureau={isBureau} responsables={d.responsables} profiles={d.profiles} onChanged={load} />}
      </Section>
    </Container>
  );
}
