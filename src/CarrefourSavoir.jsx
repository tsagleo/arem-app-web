// =====================================================================
// CarrefourSavoir.jsx — « Carrefour du savoir » (2026-10-10)
// =====================================================================
// Demandé par l'utilisateur : une « salle de classe » ouverte à tous —
// élèves, étudiants, universitaires, travailleurs, parents, aînés,
// nouveaux arrivants — pour trouver des ressources en développement
// personnel, professionnel, académique et de vie pratique, le tout bien
// structuré. Volet affiché dans « Jeunesse & tutorat » (Jeunesse.jsx),
// au-dessus des outils jeunesse (qui gardent leur cadre de protection
// des mineurs). Base : sql/2026-10-10m_carrefour_savoir.sql.
//   • Accueil : recherche globale, profil d'apprenant, domaines, « pour
//     vous », populaires, mon espace (favoris, parcours, classes,
//     attestations) ;
//   • Ressources : par domaine, public, type ; ressources externes
//     sélectionnées (pack de démarrage) ; propositions des membres ;
//   • Parcours guidés : étapes, progression, certificat ;
//   • Classes : animateur, séances (visio Jitsi ou sur place),
//     inscriptions, présences, avis, attestation ;
//   • Questions : boîte à questions par domaine, solution, modération ;
//   • Mentorat pro : accompagnement entre adultes ;
//   • Impact (gestionnaires) : indicateurs, heures de bénévolat,
//     attestations, export PDF / CSV.
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import {
  Compass, BookOpen, Route, School, MessageCircleQuestion, Briefcase, BarChart3, Search, Star, ExternalLink, Plus, X,
  CheckCircle2, Circle, Award, Calendar, Users, Download, Trash2, Send, Video, MapPin, Sparkles, Heart, Clock, EyeOff,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { Card, Btn, Field, inputStyle, friendlyError, foldText, formatEventDateTime, toDatetimeLocal, datetimeLocalToISO, TEAL, TEAL_LIGHT, RED } from "./shared";
import { exporterAttestation, exporterRapportImpact } from "./jeunessePdf";

const AMBER = "#B7791F";
const GREY = "#686F7D";
const DOMAINES = ["academique", "professionnel", "personnel", "vie_pratique"];
const DOM_COULEUR = { academique: "#2B6CB0", professionnel: "#1F8A5C", personnel: "#9C4221", vie_pratique: "#6B46C1" };
const PUBLICS = ["tous", "eleves", "etudiants", "universitaires", "travailleurs", "chercheurs_emploi", "entrepreneurs", "parents", "aines", "nouveaux_arrivants"];
const TYPES = ["lien", "video", "pdf", "document", "podcast", "outil"];
const NIVEAUX = ["debutant", "intermediaire", "avance"];
const THEMES = {
  academique: ["Mathématiques", "Français", "Anglais", "Sciences", "Méthodes de travail", "Préparation aux examens", "Recherche universitaire"],
  professionnel: ["Recherche d'emploi", "CV et lettre", "Entrevue", "Entrepreneuriat", "Informatique", "Gestion de projet", "Reconversion"],
  personnel: ["Confiance en soi", "Gestion du temps", "Leadership", "Communication", "Bien-être", "Parentalité"],
  vie_pratique: ["Budget et finances", "Impôts", "Logement", "Santé", "Démarches et immigration", "Droits et justice", "Numérique au quotidien"],
};

// Pack de démarrage : ressources externes gratuites et reconnues.
const PACK = [
  ["Alloprof — aide aux devoirs", "https://www.alloprof.qc.ca", "academique", ["eleves", "parents"], "outil", "Préparation aux examens"],
  ["Khan Academy (français)", "https://fr.khanacademy.org", "academique", ["eleves", "etudiants"], "video", "Mathématiques"],
  ["Télé-Québec en classe", "https://enclasse.telequebec.tv", "academique", ["eleves"], "video", "Sciences"],
  ["FUN MOOC — cours universitaires gratuits", "https://www.fun-mooc.fr", "academique", ["universitaires", "etudiants"], "lien", "Recherche universitaire"],
  ["Coursera — cours en ligne", "https://www.coursera.org", "professionnel", ["universitaires", "travailleurs"], "lien", "Reconversion"],
  ["OpenClassrooms", "https://openclassrooms.com/fr", "professionnel", ["travailleurs", "chercheurs_emploi"], "lien", "Informatique"],
  ["Guichet-Emplois (gouvernement du Canada)", "https://www.guichetemplois.gc.ca", "professionnel", ["chercheurs_emploi", "nouveaux_arrivants"], "outil", "Recherche d'emploi"],
  ["GCFGlobal — apprendre l'informatique", "https://edu.gcfglobal.org/fr/", "vie_pratique", ["aines", "tous"], "lien", "Numérique au quotidien"],
  ["Éducaloi — comprendre ses droits", "https://educaloi.qc.ca", "vie_pratique", ["tous"], "lien", "Droits et justice"],
  ["Agence du revenu du Canada — impôts", "https://www.canada.ca/fr/agence-revenu.html", "vie_pratique", ["travailleurs", "nouveaux_arrivants"], "lien", "Impôts"],
  ["Immigration, Réfugiés et Citoyenneté Canada", "https://www.canada.ca/fr/immigration-refugies-citoyennete.html", "vie_pratique", ["nouveaux_arrivants"], "lien", "Démarches et immigration"],
  ["Agence de la consommation en matière financière", "https://www.canada.ca/fr/agence-consommation-matiere-financiere.html", "vie_pratique", ["tous"], "lien", "Budget et finances"],
  ["TED — conférences inspirantes", "https://www.ted.com", "personnel", ["tous"], "video", "Leadership"],
  ["Duolingo — apprendre une langue", "https://www.duolingo.com", "personnel", ["tous"], "outil", "Communication"],
];

// Modèles de parcours prêts à adapter.
const MODELES = {
  emploi: {
    titre: "Trouver un emploi en 6 étapes", domaine: "professionnel", publics: ["chercheurs_emploi", "nouveaux_arrivants", "travailleurs"], niveau: "debutant", duree: "3 à 4 semaines",
    description: "De la connaissance de soi à l'entrevue : un parcours pas à pas pour décrocher un emploi.",
    etapes: [
      ["Faire le bilan de ses compétences", "Listez vos compétences, expériences et réalisations. Identifiez 3 types de postes visés."],
      ["Rédiger un CV adapté", "Un CV de 2 pages maximum, adapté à chaque offre."],
      ["Écrire une lettre de présentation", "Une lettre courte qui relie votre parcours aux besoins de l'employeur."],
      ["Chercher les offres", "Consultez Guichet-Emplois et les sites spécialisés ; activez des alertes.", "https://www.guichetemplois.gc.ca"],
      ["Développer son réseau", "Parlez de votre projet aux membres de l'association ; demandez un mentor dans « Mentorat pro »."],
      ["Préparer l'entrevue", "Préparez vos réponses aux questions classiques et simulez une entrevue avec un mentor."],
    ],
  },
  etudes: {
    titre: "Réussir ses études", domaine: "academique", publics: ["eleves", "etudiants", "universitaires"], niveau: "debutant", duree: "2 semaines",
    description: "Méthodes de travail, organisation et gestion du stress pour progresser durablement.",
    etapes: [
      ["Organiser son temps", "Construisez un horaire hebdomadaire réaliste avec des plages d'étude courtes et régulières."],
      ["Prendre de bonnes notes", "Essayez la méthode Cornell sur un cours de la semaine."],
      ["Réviser efficacement", "Utilisez la répétition espacée et l'auto-interrogation."],
      ["Demander de l'aide", "Posez vos questions dans la Boîte à questions ou demandez un tuteur dans Jeunesse & tutorat."],
      ["Gérer le stress des examens", "Sommeil, respiration, préparation : votre plan pour la semaine d'examens."],
    ],
  },
  budget: {
    titre: "Maîtriser son budget", domaine: "vie_pratique", publics: ["tous", "nouveaux_arrivants", "etudiants"], niveau: "debutant", duree: "1 semaine",
    description: "Faire un budget, épargner, comprendre le crédit et ses impôts.",
    etapes: [
      ["Faire son budget mensuel", "Listez revenus et dépenses ; fixez un objectif d'épargne.", "https://www.canada.ca/fr/agence-consommation-matiere-financiere.html"],
      ["Comprendre le crédit", "Taux d'intérêt, cote de crédit, bonnes pratiques avec la carte de crédit."],
      ["Préparer sa déclaration d'impôts", "Documents à réunir, crédits auxquels vous avez droit.", "https://www.canada.ca/fr/agence-revenu.html"],
    ],
  },
};

const TXT = {
  fr: {
    tab_accueil: "Accueil", tab_ressources: "Ressources", tab_parcours: "Parcours", tab_classes: "Classes", tab_questions: "Questions", tab_mentorat: "Mentorat pro", tab_impact: "Impact",
    dom_academique: "Académique", dom_professionnel: "Professionnel", dom_personnel: "Développement personnel", dom_vie_pratique: "Vie pratique", dom_tous: "Tous les domaines",
    dom_academique_d: "Du primaire à l'université : cours, devoirs, méthodes, examens.",
    dom_professionnel_d: "Emploi, CV, entrevue, entrepreneuriat, compétences numériques.",
    dom_personnel_d: "Confiance, gestion du temps, leadership, communication, bien-être.",
    dom_vie_pratique_d: "Budget, impôts, logement, santé, droits, démarches, numérique.",
    pub_tous: "Tout public", pub_eleves: "Élèves", pub_etudiants: "Étudiants", pub_universitaires: "Universitaires", pub_travailleurs: "Travailleurs", pub_chercheurs_emploi: "En recherche d'emploi",
    pub_entrepreneurs: "Entrepreneurs", pub_parents: "Parents", pub_aines: "Aînés", pub_nouveaux_arrivants: "Nouveaux arrivants",
    type_lien: "Site / lien", type_video: "Vidéo", type_pdf: "PDF", type_document: "Document", type_podcast: "Balado", type_outil: "Outil en ligne",
    niv_debutant: "Débutant", niv_intermediaire: "Intermédiaire", niv_avance: "Avancé",
    hero: "Que souhaitez-vous apprendre aujourd'hui ?", hero_sub: "Ressources, parcours guidés, classes et entraide, pour tous les âges et tous les projets.",
    search_all: "Rechercher une ressource, un parcours, une classe…", iam: "Je suis :", iam_hint: "Vos choix personnalisent les suggestions (gardés sur cet appareil).",
    for_you: "Pour vous", popular: "Les plus consultées", my_space: "Mon espace", my_favs: "Mes favoris", my_paths: "Mes parcours en cours", my_classes: "Mes classes à venir",
    my_attest: "Mes attestations", none: "Rien pour le moment.", results: "Résultats", nb_res: "{n} ressource(s)",
    // Ressources
    res_add: "Ajouter une ressource", res_propose: "Proposer une ressource", res_title: "Titre", res_desc: "Description (facultatif)", res_dom: "Domaine", res_theme: "Thème",
    res_publics: "Publics visés", res_type: "Type", res_url: "Lien", res_file: "Ou fichier (50 Mo max.)", res_ext: "Ressource externe sélectionnée",
    res_save: "Publier", res_save_prop: "Envoyer la proposition", res_prop_note: "Votre proposition sera publiée après validation par un responsable.",
    res_pending: "Propositions à valider", res_publish: "Publier", res_refuse: "Refuser", res_open: "Ouvrir", res_by: "Par {nom}",
    res_del_confirm: "Supprimer cette ressource ?", res_need_src: "Indiquez un lien ou choisissez un fichier.", res_empty: "Aucune ressource pour ces critères.",
    res_all_pub: "Tous publics", res_all_type: "Tous types", fav_add: "Ajouter aux favoris", fav_del: "Retirer des favoris", ext_badge: "Externe",
    pack: "Importer le pack de démarrage ({n} ressources gratuites reconnues)", pack_confirm: "Ajouter {n} ressources externes sélectionnées (Alloprof, Khan Academy, Guichet-Emplois, Éducaloi…) ?",
    // Parcours
    par_new: "Nouveau parcours", par_model: "Partir d'un modèle", par_title: "Titre", par_desc: "Description", par_level: "Niveau", par_duration: "Durée estimée",
    par_steps: "Étapes", par_step_title: "Titre de l'étape", par_step_instr: "Consigne", par_step_res: "Ressource liée (facultatif)", par_step_url: "Ou lien",
    par_add_step: "Ajouter une étape", par_save: "Publier le parcours", par_empty: "Aucun parcours pour le moment.", par_progress: "{a} / {b} étapes",
    par_done: "Fait", par_todo: "À faire", par_certif: "Mon certificat de parcours", par_archive: "Archiver", par_complete: "Parcours terminé ! Bravo.",
    par_open: "Voir les étapes", par_close: "Masquer", cls_show: "Voir les séances",
    // Classes
    cls_new: "Créer une classe", cls_propose: "Proposer une classe", cls_title: "Titre", cls_desc: "Description et programme", cls_cap: "Places (facultatif)",
    cls_mode: "Format", mode_distance: "À distance (visio)", mode_presentiel: "En personne", mode_hybride: "Hybride", cls_place: "Lieu", cls_link: "Lien de visio",
    cls_save: "Enregistrer", cls_prop_note: "Votre classe sera ouverte aux inscriptions après validation par un responsable.",
    cls_empty: "Aucune classe pour le moment.", cls_by: "Animée par {nom}", cls_seats: "{n} inscrit(s){c}", cls_full: "Complet",
    cls_join: "M'inscrire", cls_leave: "Me retirer", cls_open: "Ouvrir les inscriptions", cls_refuse: "Refuser", cls_end: "Terminer la classe", cls_cancel: "Annuler la classe",
    st_proposee: "En attente de validation", st_ouverte: "Inscriptions ouvertes", st_terminee: "Terminée", st_annulee: "Annulée", st_refusee: "Refusée",
    ses_add: "Ajouter une séance", ses_when: "Date et heure", ses_dur: "Durée (min)", ses_subject: "Sujet", ses_done: "Réalisée", ses_cancel: "Annuler",
    ses_join: "Rejoindre la visio", ses_presence: "Présences", ses_st_prevue: "Prévue", ses_st_realisee: "Réalisée", ses_st_annulee: "Annulée",
    cls_participants: "Participants", cls_avis: "Avis des participants", cls_rate: "Donner mon avis", cls_rating: "Note", cls_comment: "Commentaire",
    cls_attest: "Mon attestation de participation", cls_avg: "{n}/5 ({c} avis)",
    // Questions
    q_ask: "Poser une question", q_title: "Votre question", q_body: "Détails (facultatif)", q_send: "Publier", q_empty: "Aucune question pour le moment.",
    q_answers: "{n} réponse(s)", q_solved: "Résolue", q_answer: "Répondre", q_answer_ph: "Votre réponse…", q_solution: "Marquer comme solution", q_is_solution: "Solution",
    q_hide: "Masquer", q_by: "{nom} · {d}",
    // Mentorat
    men_become: "Devenir mentor professionnel", men_update: "Mettre à jour mon profil de mentor", men_domains: "Domaines d'accompagnement", men_pres: "Présentation (parcours, spécialités)",
    men_dispo: "Disponibilités (ex. : 1 h par semaine, en soirée)", men_save: "Enregistrer", men_pause: "Me mettre en pause", men_resume: "Reprendre",
    men_list: "Mentors disponibles", men_empty: "Aucun mentor pour le moment — soyez le premier !", men_ask: "Demander un accompagnement", men_goal: "Votre objectif",
    men_send: "Envoyer la demande", men_sent: "Demande envoyée au mentor.", men_mine: "Mes accompagnements",
    mst_demande: "Demande en attente", mst_actif: "En cours", mst_termine: "Terminé", mst_refuse: "Refusé",
    men_accept: "Accepter", men_decline: "Refuser", men_end: "Terminer", men_msg_ph: "Écrire un message…", men_with: "Avec {nom}", men_as_mentor: "Vous accompagnez", men_as_mentee: "Vous êtes accompagné(e) par",
    // Impact
    imp_title: "Tableau de bord d'impact", imp_sub: "Pour le rapport annuel, les partenaires et les demandes de subvention.",
    imp_youth: "Jeunesse & tutorat", imp_carrefour: "Carrefour du savoir", imp_volunteers: "Heures de bénévolat",
    k_jeunes: "Jeunes accompagnés", k_mentors: "Mentors approuvés", k_seances: "Séances de tutorat réalisées", k_heures: "Heures de tutorat", k_prog: "Progression moyenne",
    k_satis: "Satisfaction des familles", k_bourses: "Bourses attribuées", k_montant: "Montant des bourses", k_res: "Ressources disponibles", k_vues: "Consultations",
    k_parcours: "Parcours terminés", k_classes: "Classes tenues", k_hclasses: "Heures de classe", k_particip: "Participants aux classes", k_mentorats: "Accompagnements pro en cours",
    k_questions: "Questions résolues", vol_name: "Bénévole", vol_role: "Rôle", vol_hours: "Heures", vol_attest: "Attestation",
    role_mentor: "Mentor jeunesse", role_animateur: "Animateur de classe", export_pdf: "Rapport PDF", export_csv: "Exporter (CSV)",
    // Attestations
    att_par_title: "CERTIFICAT DE PARCOURS", att_par_intro: "est décerné à", att_par_line: "pour avoir complété le parcours",
    att_cls_title: "ATTESTATION DE PARTICIPATION", att_cls_intro: "Nous attestons que", att_cls_line: "a participé à la classe",
    att_cls_detail: "{p} séance(s) sur {t} - {h} h de formation", att_ben_title: "ATTESTATION DE BÉNÉVOLAT", att_ben_intro: "Nous attestons que",
    att_ben_line: "a contribué bénévolement aux activités éducatives de l'association", att_ben_detail: "{h} heures de bénévolat ({d})",
    sql_missing: "Le Carrefour du savoir n'est pas encore installé : exécutez sql/2026-10-10m_carrefour_savoir.sql dans Supabase.",
    cancel: "Annuler", del: "Supprimer", close: "Fermer",
    jeunesse_teaser: "🎓 Jeunesse & tutorat — mentorat, séances et bourses pour les jeunes, dans un cadre protégé.", go: "Ouvrir",
  },
  en: {
    tab_accueil: "Home", tab_ressources: "Resources", tab_parcours: "Pathways", tab_classes: "Classes", tab_questions: "Questions", tab_mentorat: "Career mentoring", tab_impact: "Impact",
    dom_academique: "Academic", dom_professionnel: "Professional", dom_personnel: "Personal growth", dom_vie_pratique: "Everyday life", dom_tous: "All domains",
    dom_academique_d: "From primary school to university: courses, homework, methods, exams.",
    dom_professionnel_d: "Jobs, résumé, interviews, entrepreneurship, digital skills.",
    dom_personnel_d: "Confidence, time management, leadership, communication, well-being.",
    dom_vie_pratique_d: "Budget, taxes, housing, health, rights, paperwork, digital life.",
    pub_tous: "Everyone", pub_eleves: "Pupils", pub_etudiants: "Students", pub_universitaires: "University", pub_travailleurs: "Workers", pub_chercheurs_emploi: "Job seekers",
    pub_entrepreneurs: "Entrepreneurs", pub_parents: "Parents", pub_aines: "Seniors", pub_nouveaux_arrivants: "Newcomers",
    type_lien: "Website / link", type_video: "Video", type_pdf: "PDF", type_document: "Document", type_podcast: "Podcast", type_outil: "Online tool",
    niv_debutant: "Beginner", niv_intermediaire: "Intermediate", niv_avance: "Advanced",
    hero: "What would you like to learn today?", hero_sub: "Resources, guided pathways, classes and peer help, for every age and every project.",
    search_all: "Search a resource, a pathway, a class…", iam: "I am:", iam_hint: "Your choices personalize suggestions (kept on this device).",
    for_you: "For you", popular: "Most viewed", my_space: "My space", my_favs: "My favourites", my_paths: "My pathways in progress", my_classes: "My upcoming classes",
    my_attest: "My certificates", none: "Nothing yet.", results: "Results", nb_res: "{n} resource(s)",
    res_add: "Add a resource", res_propose: "Suggest a resource", res_title: "Title", res_desc: "Description (optional)", res_dom: "Domain", res_theme: "Topic",
    res_publics: "Target audiences", res_type: "Type", res_url: "Link", res_file: "Or file (50 MB max.)", res_ext: "Selected external resource",
    res_save: "Publish", res_save_prop: "Send suggestion", res_prop_note: "Your suggestion will be published once a coordinator approves it.",
    res_pending: "Suggestions to review", res_publish: "Publish", res_refuse: "Decline", res_open: "Open", res_by: "By {nom}",
    res_del_confirm: "Delete this resource?", res_need_src: "Enter a link or choose a file.", res_empty: "No resource matches.",
    res_all_pub: "All audiences", res_all_type: "All types", fav_add: "Add to favourites", fav_del: "Remove from favourites", ext_badge: "External",
    pack: "Import the starter pack ({n} well-known free resources)", pack_confirm: "Add {n} selected external resources (Alloprof, Khan Academy, Job Bank, Éducaloi…)?",
    par_new: "New pathway", par_model: "Start from a template", par_title: "Title", par_desc: "Description", par_level: "Level", par_duration: "Estimated duration",
    par_steps: "Steps", par_step_title: "Step title", par_step_instr: "Instructions", par_step_res: "Linked resource (optional)", par_step_url: "Or link",
    par_add_step: "Add a step", par_save: "Publish pathway", par_empty: "No pathway yet.", par_progress: "{a} / {b} steps",
    par_done: "Done", par_todo: "To do", par_certif: "My pathway certificate", par_archive: "Archive", par_complete: "Pathway completed! Well done.",
    par_open: "Show steps", par_close: "Hide", cls_show: "Show sessions",
    cls_new: "Create a class", cls_propose: "Propose a class", cls_title: "Title", cls_desc: "Description and programme", cls_cap: "Seats (optional)",
    cls_mode: "Format", mode_distance: "Online (video)", mode_presentiel: "In person", mode_hybride: "Hybrid", cls_place: "Place", cls_link: "Video link",
    cls_save: "Save", cls_prop_note: "Your class will open for registration once a coordinator approves it.",
    cls_empty: "No class yet.", cls_by: "Led by {nom}", cls_seats: "{n} registered{c}", cls_full: "Full",
    cls_join: "Register", cls_leave: "Withdraw", cls_open: "Open registration", cls_refuse: "Decline", cls_end: "End the class", cls_cancel: "Cancel the class",
    st_proposee: "Awaiting approval", st_ouverte: "Registration open", st_terminee: "Ended", st_annulee: "Cancelled", st_refusee: "Declined",
    ses_add: "Add a session", ses_when: "Date and time", ses_dur: "Duration (min)", ses_subject: "Topic", ses_done: "Done", ses_cancel: "Cancel",
    ses_join: "Join video call", ses_presence: "Attendance", ses_st_prevue: "Planned", ses_st_realisee: "Held", ses_st_annulee: "Cancelled",
    cls_participants: "Participants", cls_avis: "Participant reviews", cls_rate: "Leave a review", cls_rating: "Rating", cls_comment: "Comment",
    cls_attest: "My certificate of participation", cls_avg: "{n}/5 ({c} reviews)",
    q_ask: "Ask a question", q_title: "Your question", q_body: "Details (optional)", q_send: "Post", q_empty: "No question yet.",
    q_answers: "{n} answer(s)", q_solved: "Solved", q_answer: "Answer", q_answer_ph: "Your answer…", q_solution: "Mark as solution", q_is_solution: "Solution",
    q_hide: "Hide", q_by: "{nom} · {d}",
    men_become: "Become a career mentor", men_update: "Update my mentor profile", men_domains: "Mentoring domains", men_pres: "Introduction (background, specialties)",
    men_dispo: "Availability (e.g. 1 h a week, evenings)", men_save: "Save", men_pause: "Pause", men_resume: "Resume",
    men_list: "Available mentors", men_empty: "No mentor yet — be the first!", men_ask: "Ask for mentoring", men_goal: "Your goal",
    men_send: "Send request", men_sent: "Request sent to the mentor.", men_mine: "My mentoring",
    mst_demande: "Pending", mst_actif: "Ongoing", mst_termine: "Ended", mst_refuse: "Declined",
    men_accept: "Accept", men_decline: "Decline", men_end: "End", men_msg_ph: "Write a message…", men_with: "With {nom}", men_as_mentor: "You mentor", men_as_mentee: "You are mentored by",
    imp_title: "Impact dashboard", imp_sub: "For the annual report, partners and grant applications.",
    imp_youth: "Youth & tutoring", imp_carrefour: "Learning hub", imp_volunteers: "Volunteer hours",
    k_jeunes: "Young people supported", k_mentors: "Approved mentors", k_seances: "Tutoring sessions held", k_heures: "Tutoring hours", k_prog: "Average progress",
    k_satis: "Family satisfaction", k_bourses: "Scholarships awarded", k_montant: "Scholarship amount", k_res: "Resources available", k_vues: "Views",
    k_parcours: "Pathways completed", k_classes: "Classes held", k_hclasses: "Class hours", k_particip: "Class participants", k_mentorats: "Ongoing career mentoring",
    k_questions: "Questions solved", vol_name: "Volunteer", vol_role: "Role", vol_hours: "Hours", vol_attest: "Certificate",
    role_mentor: "Youth mentor", role_animateur: "Class facilitator", export_pdf: "PDF report", export_csv: "Export (CSV)",
    att_par_title: "PATHWAY CERTIFICATE", att_par_intro: "is awarded to", att_par_line: "for completing the pathway",
    att_cls_title: "CERTIFICATE OF PARTICIPATION", att_cls_intro: "We certify that", att_cls_line: "took part in the class",
    att_cls_detail: "{p} of {t} session(s) - {h} h of training", att_ben_title: "VOLUNTEER CERTIFICATE", att_ben_intro: "We certify that",
    att_ben_line: "volunteered in the association's educational activities", att_ben_detail: "{h} volunteer hours ({d})",
    sql_missing: "The Learning hub is not installed yet: run sql/2026-10-10m_carrefour_savoir.sql in Supabase.",
    cancel: "Cancel", del: "Delete", close: "Close",
    jeunesse_teaser: "🎓 Youth & tutoring — mentoring, sessions and scholarships for young people, in a protected setting.", go: "Open",
  },
};

const small = { padding: "6px 12px", fontSize: 12.5 };
const muted = { fontSize: 12.5, color: GREY, margin: 0 };
const linkBtn = (color) => ({ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color, background: "none", border: "none", cursor: "pointer", padding: 0 });
const chip = (on, color = "var(--primary)") => ({ fontSize: 12, fontWeight: 600, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: on ? "1px solid transparent" : "1px solid #DCE0E8", background: on ? color : "white", color: on ? "white" : "#4A5468" });
const jitsi = () => `https://meet.jit.si/unia-classe-${Math.random().toString(36).slice(2, 10)}`;
const heures = (min) => Math.round((min / 60) * 10) / 10;
function Pastille({ color, children }) { return <span style={{ fontSize: 11, fontWeight: 700, color, background: "#F1F2F4", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>{children}</span>; }
function Etoiles({ n }) { return <span style={{ color: AMBER, whiteSpace: "nowrap" }}>{"★".repeat(Math.round(n))}{"☆".repeat(5 - Math.round(n))}</span>; }
function signataire(association) { return association?.signataire1_nom ? { nom: association.signataire1_nom, titre: association.signataire1_titre || "" } : null; }
function lireProfil() { try { return JSON.parse(window.localStorage.getItem("carrefour_profil") || "[]"); } catch { return []; } }

// =====================================================================
// Ressources : carte, formulaire
// =====================================================================
function RessourceCarte({ S, r, fav, onFav, onOpen, canDelete, onDelete }) {
  return (
    <div style={{ background: "white", borderRadius: 12, padding: 14, boxShadow: "0 2px 10px rgba(31,56,100,0.06)", borderLeft: `4px solid ${DOM_COULEUR[r.domaine]}`, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <b style={{ fontSize: 13.5 }}>{r.titre}</b>
        <button onClick={onFav} title={fav ? S.fav_del : S.fav_add} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: fav ? AMBER : "#C3C8D0" }}><Star size={16} fill={fav ? AMBER : "none"} /></button>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        <Pastille color={DOM_COULEUR[r.domaine]}>{S["dom_" + r.domaine]}</Pastille>
        <Pastille color={GREY}>{S["type_" + r.type]}</Pastille>
        {r.theme && <Pastille color={GREY}>{r.theme}</Pastille>}
        {r.externe && <Pastille color={TEAL}>{S.ext_badge}</Pastille>}
        {r.statut === "proposee" && <Pastille color={AMBER}>{S.res_pending}</Pastille>}
      </div>
      {r.description && <p style={{ ...muted, whiteSpace: "pre-wrap" }}>{r.description}</p>}
      <div style={{ fontSize: 11.5, color: GREY }}>{(r.publics || []).map((p) => S["pub_" + p]).join(" · ")}</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: "auto" }}>
        <Btn style={small} onClick={onOpen}><ExternalLink size={13} /> {S.res_open}</Btn>
        {r.depose_par_nom && <span style={{ fontSize: 11, color: GREY }}>{S.res_by.replace("{nom}", r.depose_par_nom)}</span>}
        {canDelete && <button onClick={onDelete} style={{ ...linkBtn(RED), marginLeft: "auto" }}><Trash2 size={13} /></button>}
      </div>
    </div>
  );
}

function RessourceForm({ S, t, profile, gest, onDone, onCancel }) {
  const [f, setF] = useState({ titre: "", description: "", domaine: "academique", theme: "", publics: ["tous"], type: "lien", url: "", externe: false });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const togglePub = (p) => setF((x) => ({ ...x, publics: x.publics.includes(p) ? x.publics.filter((y) => y !== p) : [...x.publics, p] }));
  async function save() {
    if (!f.titre.trim()) return;
    if (!f.url.trim() && !file) { alert(S.res_need_src); return; }
    setBusy(true);
    try {
      let storage_path = null;
      if (file) {
        if (file.size > 50 * 1024 * 1024) throw new Error("50 Mo max.");
        storage_path = `${profile.association_id}/${Date.now()}_${file.name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
        const { error } = await supabase.storage.from("savoir-ressources").upload(storage_path, file);
        if (error) throw error;
      }
      const { error } = await supabase.from("savoir_ressources").insert({
        association_id: profile.association_id, titre: f.titre.trim(), description: f.description.trim() || null, domaine: f.domaine,
        theme: f.theme.trim() || null, publics: f.publics.length ? f.publics : ["tous"], type: f.type, url: f.url.trim() || null, storage_path,
        externe: f.externe, statut: gest ? "publiee" : "proposee", depose_par: profile.id, depose_par_nom: profile.nom_complet,
      });
      if (error) throw error;
      onDone();
    } catch (e) { alert(friendlyError(e, t)); } finally { setBusy(false); }
  }
  return (
    <Card style={{ padding: 16, marginBottom: 14 }}>
      <datalist id="carrefour-themes">{(THEMES[f.domaine] || []).map((x) => <option key={x} value={x} />)}</datalist>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
        <Field label={S.res_title}><input required style={inputStyle} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} /></Field>
        <Field label={S.res_dom}><select style={inputStyle} value={f.domaine} onChange={(e) => setF({ ...f, domaine: e.target.value })}>{DOMAINES.map((d) => <option key={d} value={d}>{S["dom_" + d]}</option>)}</select></Field>
        <Field label={S.res_theme}><input list="carrefour-themes" style={inputStyle} value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })} /></Field>
        <Field label={S.res_type}><select style={inputStyle} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((x) => <option key={x} value={x}>{S["type_" + x]}</option>)}</select></Field>
      </div>
      <Field label={S.res_desc}><textarea style={{ ...inputStyle, minHeight: 50 }} maxLength={2000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label={S.res_publics}><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{PUBLICS.map((p) => <button type="button" key={p} style={chip(f.publics.includes(p))} onClick={() => togglePub(p)}>{S["pub_" + p]}</button>)}</div></Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 12px" }}>
        <Field label={S.res_url}><input type="url" style={inputStyle} placeholder="https://" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        <Field label={S.res_file}><input type="file" style={inputStyle} onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      </div>
      {gest && <label style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 10 }}><input type="checkbox" checked={f.externe} onChange={(e) => setF({ ...f, externe: e.target.checked })} /> {S.res_ext}</label>}
      {!gest && <p style={{ ...muted, marginBottom: 10 }}>{S.res_prop_note}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <Btn disabled={busy || !f.titre.trim()} onClick={save}>{gest ? S.res_save : S.res_save_prop}</Btn>
        <Btn variant="outline" onClick={onCancel}>{S.cancel}</Btn>
      </div>
    </Card>
  );
}

// =====================================================================
// Parcours
// =====================================================================
function ParcoursForm({ S, t, profile, ressources, onDone, onCancel }) {
  const vide = { titre: "", description: "", domaine: "professionnel", publics: ["tous"], niveau: "debutant", duree: "", etapes: [{ titre: "", consigne: "", ressource_id: "", url: "" }] };
  const [f, setF] = useState(vide);
  const [busy, setBusy] = useState(false);
  function modele(k) {
    const m = MODELES[k];
    setF({ titre: m.titre, description: m.description, domaine: m.domaine, publics: m.publics, niveau: m.niveau, duree: m.duree, etapes: m.etapes.map(([titre, consigne, url]) => ({ titre, consigne, ressource_id: "", url: url || "" })) });
  }
  const setEt = (i, k, v) => setF((x) => ({ ...x, etapes: x.etapes.map((e, j) => (j === i ? { ...e, [k]: v } : e)) }));
  async function save() {
    const etapes = f.etapes.filter((e) => e.titre.trim());
    if (!f.titre.trim() || etapes.length === 0) return;
    setBusy(true);
    try {
      const { data: p, error } = await supabase.from("savoir_parcours").insert({
        association_id: profile.association_id, titre: f.titre.trim(), description: f.description.trim() || null, domaine: f.domaine,
        publics: f.publics, niveau: f.niveau, duree_estimee: f.duree.trim() || null, cree_par: profile.id, cree_par_nom: profile.nom_complet,
      }).select().single();
      if (error) throw error;
      const { error: e2 } = await supabase.from("savoir_parcours_etapes").insert(etapes.map((e, i) => ({
        association_id: profile.association_id, parcours_id: p.id, ordre: i + 1, titre: e.titre.trim(), consigne: e.consigne.trim() || null,
        ressource_id: e.ressource_id || null, url: e.url.trim() || null,
      })));
      if (e2) throw e2;
      onDone();
    } catch (e) { alert(friendlyError(e, t)); } finally { setBusy(false); }
  }
  return (
    <Card style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{S.par_model} :</span>
        {Object.entries(MODELES).map(([k, m]) => <button key={k} type="button" style={chip(false)} onClick={() => modele(k)}>{m.titre}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
        <Field label={S.par_title}><input required style={inputStyle} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} /></Field>
        <Field label={S.res_dom}><select style={inputStyle} value={f.domaine} onChange={(e) => setF({ ...f, domaine: e.target.value })}>{DOMAINES.map((d) => <option key={d} value={d}>{S["dom_" + d]}</option>)}</select></Field>
        <Field label={S.par_level}><select style={inputStyle} value={f.niveau} onChange={(e) => setF({ ...f, niveau: e.target.value })}>{NIVEAUX.map((n) => <option key={n} value={n}>{S["niv_" + n]}</option>)}</select></Field>
        <Field label={S.par_duration}><input style={inputStyle} value={f.duree} onChange={(e) => setF({ ...f, duree: e.target.value })} /></Field>
      </div>
      <Field label={S.par_desc}><textarea style={{ ...inputStyle, minHeight: 50 }} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label={S.res_publics}><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{PUBLICS.map((p) => <button type="button" key={p} style={chip(f.publics.includes(p))} onClick={() => setF((x) => ({ ...x, publics: x.publics.includes(p) ? x.publics.filter((y) => y !== p) : [...x.publics, p] }))}>{S["pub_" + p]}</button>)}</div></Field>
      <div style={{ fontWeight: 700, fontSize: 13, margin: "6px 0 8px" }}>{S.par_steps}</div>
      {f.etapes.map((e, i) => (
        <div key={i} style={{ background: "#F8F7F4", borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <b style={{ fontSize: 13, width: 22 }}>{i + 1}.</b>
            <input style={{ ...inputStyle, flex: 1 }} placeholder={S.par_step_title} value={e.titre} onChange={(ev) => setEt(i, "titre", ev.target.value)} />
            {f.etapes.length > 1 && <button onClick={() => setF((x) => ({ ...x, etapes: x.etapes.filter((_, j) => j !== i) }))} style={linkBtn(RED)}><X size={14} /></button>}
          </div>
          <textarea style={{ ...inputStyle, minHeight: 40, marginTop: 6 }} placeholder={S.par_step_instr} value={e.consigne} onChange={(ev) => setEt(i, "consigne", ev.target.value)} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, marginTop: 6 }}>
            <select style={inputStyle} value={e.ressource_id} onChange={(ev) => setEt(i, "ressource_id", ev.target.value)}>
              <option value="">{S.par_step_res}</option>
              {ressources.filter((r) => r.statut === "publiee").map((r) => <option key={r.id} value={r.id}>{r.titre}</option>)}
            </select>
            <input style={inputStyle} placeholder={S.par_step_url} value={e.url} onChange={(ev) => setEt(i, "url", ev.target.value)} />
          </div>
        </div>
      ))}
      <button onClick={() => setF((x) => ({ ...x, etapes: [...x.etapes, { titre: "", consigne: "", ressource_id: "", url: "" }] }))} style={{ ...linkBtn(TEAL), marginBottom: 12 }}><Plus size={13} /> {S.par_add_step}</button>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn disabled={busy || !f.titre.trim()} onClick={save}>{S.par_save}</Btn>
        <Btn variant="outline" onClick={onCancel}>{S.cancel}</Btn>
      </div>
    </Card>
  );
}

function ParcoursCarte({ S, t, lang, profile, gest, association, p, etapes, faits, ressources, onOpenRes, onChanged }) {
  const [ouvert, setOuvert] = useState(false);
  const mesEtapes = etapes.filter((e) => e.parcours_id === p.id).sort((a, b) => a.ordre - b.ordre);
  const nbFait = mesEtapes.filter((e) => faits.has(e.id)).length;
  const fini = mesEtapes.length > 0 && nbFait === mesEtapes.length;
  async function basculer(e) {
    const { error } = faits.has(e.id)
      ? await supabase.from("savoir_progressions").delete().eq("profile_id", profile.id).eq("etape_id", e.id)
      : await supabase.from("savoir_progressions").insert({ association_id: profile.association_id, profile_id: profile.id, parcours_id: p.id, etape_id: e.id });
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }
  async function archiver() {
    const { error } = await supabase.from("savoir_parcours").update({ statut: "archive" }).eq("id", p.id);
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }
  return (
    <Card style={{ padding: 16, borderTop: `3px solid ${DOM_COULEUR[p.domaine]}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, display: "flex", gap: 8, alignItems: "center" }}><Route size={16} color={DOM_COULEUR[p.domaine]} /> {p.titre}</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", margin: "6px 0" }}>
            <Pastille color={DOM_COULEUR[p.domaine]}>{S["dom_" + p.domaine]}</Pastille>
            <Pastille color={GREY}>{S["niv_" + p.niveau]}</Pastille>
            {p.duree_estimee && <Pastille color={GREY}><Clock size={10} /> {p.duree_estimee}</Pastille>}
          </div>
          {p.description && <p style={muted}>{p.description}</p>}
        </div>
        <div style={{ minWidth: 160 }}>
          <div style={{ fontSize: 12, color: GREY, marginBottom: 4 }}>{S.par_progress.replace("{a}", nbFait).replace("{b}", mesEtapes.length)}</div>
          <div style={{ height: 7, background: "#EEF0F3", borderRadius: 999 }}><div style={{ width: `${mesEtapes.length ? (nbFait / mesEtapes.length) * 100 : 0}%`, height: "100%", background: fini ? TEAL : "var(--primary)", borderRadius: 999 }} /></div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setOuvert(!ouvert)} style={linkBtn("var(--primary)")}>{ouvert ? S.par_close : S.par_open}</button>
        {fini && (
          <Btn style={small} onClick={() => exporterAttestation({
            titre: S.att_par_title, intro: S.att_par_intro, nom: profile.nom_complet || "", intitule: `${S.att_par_line} « ${p.titre} »`,
            lignes: [`${S["dom_" + p.domaine]} - ${S["niv_" + p.niveau]} - ${mesEtapes.length} ${S.par_steps.toLowerCase()}`],
            signataire: signataire(association), association, lang, reference: `P-${String(p.id).slice(0, 8).toUpperCase()}`, fileName: "certificat_parcours.pdf",
          }).catch((e) => alert(friendlyError(e, t)))}><Award size={13} /> {S.par_certif}</Btn>
        )}
        {gest && <button onClick={archiver} style={{ ...linkBtn(GREY), marginLeft: "auto" }}>{S.par_archive}</button>}
      </div>
      {fini && <p style={{ fontSize: 12.5, color: TEAL, fontWeight: 700, margin: "8px 0 0" }}>🎉 {S.par_complete}</p>}
      {ouvert && (
        <div style={{ marginTop: 10 }}>
          {mesEtapes.map((e) => {
            const r = ressources.find((x) => x.id === e.ressource_id);
            return (
              <div key={e.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid #EEF0F3", alignItems: "flex-start" }}>
                <button onClick={() => basculer(e)} title={faits.has(e.id) ? S.par_done : S.par_todo} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 1 }}>
                  {faits.has(e.id) ? <CheckCircle2 size={18} color={TEAL} /> : <Circle size={18} color="#B5BCC8" />}
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, textDecoration: faits.has(e.id) ? "line-through" : "none" }}>{e.ordre}. {e.titre}</div>
                  {e.consigne && <p style={{ ...muted, whiteSpace: "pre-wrap" }}>{e.consigne}</p>}
                  <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                    {r && <button onClick={() => onOpenRes(r)} style={linkBtn(TEAL)}><BookOpen size={12} /> {r.titre}</button>}
                    {e.url && <a href={e.url} target="_blank" rel="noreferrer" style={{ ...linkBtn(TEAL), textDecoration: "none" }}><ExternalLink size={12} /> {e.url.replace(/^https?:\/\//, "").slice(0, 40)}</a>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// =====================================================================
// Classes
// =====================================================================
function ClasseForm({ S, t, profile, gest, onDone, onCancel }) {
  const [f, setF] = useState({ titre: "", description: "", domaine: "professionnel", publics: ["tous"], niveau: "debutant", capacite: "", mode: "distance", lieu: "", lien_visio: jitsi() });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.titre.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("savoir_classes").insert({
      association_id: profile.association_id, titre: f.titre.trim(), description: f.description.trim() || null, domaine: f.domaine, publics: f.publics,
      niveau: f.niveau, capacite: Number(f.capacite) > 0 ? Number(f.capacite) : null, mode: f.mode, lieu: f.lieu.trim() || null,
      lien_visio: f.mode === "presentiel" ? null : f.lien_visio.trim() || null, statut: gest ? "ouverte" : "proposee",
      animateur_id: profile.id, animateur_nom: profile.nom_complet, cree_par: profile.id,
    });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onDone();
  }
  return (
    <Card style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
        <Field label={S.cls_title}><input required style={inputStyle} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} /></Field>
        <Field label={S.res_dom}><select style={inputStyle} value={f.domaine} onChange={(e) => setF({ ...f, domaine: e.target.value })}>{DOMAINES.map((d) => <option key={d} value={d}>{S["dom_" + d]}</option>)}</select></Field>
        <Field label={S.par_level}><select style={inputStyle} value={f.niveau} onChange={(e) => setF({ ...f, niveau: e.target.value })}>{NIVEAUX.map((n) => <option key={n} value={n}>{S["niv_" + n]}</option>)}</select></Field>
        <Field label={S.cls_cap}><input type="number" min={1} style={inputStyle} value={f.capacite} onChange={(e) => setF({ ...f, capacite: e.target.value })} /></Field>
        <Field label={S.cls_mode}><select style={inputStyle} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{["distance", "presentiel", "hybride"].map((m) => <option key={m} value={m}>{S["mode_" + m]}</option>)}</select></Field>
        {f.mode !== "distance" && <Field label={S.cls_place}><input style={inputStyle} value={f.lieu} onChange={(e) => setF({ ...f, lieu: e.target.value })} /></Field>}
        {f.mode !== "presentiel" && <Field label={S.cls_link}><div style={{ display: "flex", gap: 6 }}><input style={inputStyle} value={f.lien_visio} onChange={(e) => setF({ ...f, lien_visio: e.target.value })} /><Btn variant="outline" style={small} onClick={() => setF({ ...f, lien_visio: jitsi() })}><Video size={13} /></Btn></div></Field>}
      </div>
      <Field label={S.cls_desc}><textarea style={{ ...inputStyle, minHeight: 60 }} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label={S.res_publics}><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{PUBLICS.map((p) => <button type="button" key={p} style={chip(f.publics.includes(p))} onClick={() => setF((x) => ({ ...x, publics: x.publics.includes(p) ? x.publics.filter((y) => y !== p) : [...x.publics, p] }))}>{S["pub_" + p]}</button>)}</div></Field>
      {!gest && <p style={{ ...muted, marginBottom: 10 }}>{S.cls_prop_note}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <Btn disabled={busy || !f.titre.trim()} onClick={save}>{S.cls_save}</Btn>
        <Btn variant="outline" onClick={onCancel}>{S.cancel}</Btn>
      </div>
    </Card>
  );
}

function ClasseCarte({ S, t, lang, profile, gest, association, c, seances, inscriptions, presences, avis, onChanged }) {
  const [ouvert, setOuvert] = useState(false);
  const [ses, setSes] = useState({ debut: "", duree: 90, sujet: "" });
  const [monAvis, setMonAvis] = useState({ note: 5, commentaire: "" });
  const anime = gest || c.animateur_id === profile.id;
  const mesSeances = seances.filter((s) => s.classe_id === c.id).sort((a, b) => String(a.debut).localeCompare(String(b.debut)));
  const inscrits = inscriptions.filter((i) => i.classe_id === c.id && i.statut === "inscrit");
  const moi = inscriptions.find((i) => i.classe_id === c.id && i.profile_id === profile.id);
  const jeSuisInscrit = moi?.statut === "inscrit";
  const complet = c.capacite && inscrits.length >= c.capacite;
  const avisC = avis.filter((a) => a.classe_id === c.id);
  const moyenne = avisC.length ? avisC.reduce((s, a) => s + a.note, 0) / avisC.length : 0;
  const realisees = mesSeances.filter((s) => s.statut === "realisee");
  const mesPresences = realisees.filter((s) => presences.some((p) => p.seance_id === s.id && p.profile_id === profile.id && p.present));
  const col = { proposee: AMBER, ouverte: TEAL, terminee: GREY, annulee: GREY, refusee: RED }[c.statut];

  async function act(fn) {
    const { error } = await fn();
    if (error) { alert(friendlyError(error, t)); return false; }
    onChanged();
    return true;
  }
  const statut = (s) => act(() => supabase.from("savoir_classes").update({ statut: s }).eq("id", c.id));
  const inscrire = () => moi
    ? act(() => supabase.from("savoir_inscriptions").update({ statut: jeSuisInscrit ? "retire" : "inscrit" }).eq("id", moi.id))
    : act(() => supabase.from("savoir_inscriptions").insert({ association_id: profile.association_id, classe_id: c.id, profile_id: profile.id, nom: profile.nom_complet }));
  async function ajouterSeance() {
    const iso = datetimeLocalToISO(ses.debut);
    if (!iso) return;
    if (await act(() => supabase.from("savoir_classe_seances").insert({ association_id: profile.association_id, classe_id: c.id, debut: iso, duree_min: Number(ses.duree) || 60, sujet: ses.sujet.trim() || null }))) setSes({ debut: "", duree: 90, sujet: "" });
  }
  const presence = (s, pid) => {
    const p = presences.find((x) => x.seance_id === s.id && x.profile_id === pid);
    return p
      ? act(() => supabase.from("savoir_presences").update({ present: !p.present }).eq("seance_id", s.id).eq("profile_id", pid))
      : act(() => supabase.from("savoir_presences").insert({ association_id: profile.association_id, seance_id: s.id, profile_id: pid, present: true }));
  };
  const envoyerAvis = () => act(() => supabase.from("savoir_avis").upsert({ association_id: profile.association_id, classe_id: c.id, profile_id: profile.id, note: Number(monAvis.note), commentaire: monAvis.commentaire.trim() || null }, { onConflict: "classe_id,profile_id" }));
  function attestation() {
    const minutes = mesPresences.reduce((s, x) => s + x.duree_min, 0);
    exporterAttestation({
      titre: S.att_cls_title, intro: S.att_cls_intro, nom: profile.nom_complet || "", intitule: `${S.att_cls_line} « ${c.titre} »`,
      lignes: [S.att_cls_detail.replace("{p}", mesPresences.length).replace("{t}", realisees.length).replace("{h}", heures(minutes)), c.animateur_nom ? S.cls_by.replace("{nom}", c.animateur_nom) : ""],
      signataire: signataire(association), association, lang, reference: `C-${String(c.id).slice(0, 8).toUpperCase()}`, fileName: "attestation_classe.pdf",
    }).catch((e) => alert(friendlyError(e, t)));
  }

  return (
    <Card style={{ padding: 16, borderTop: `3px solid ${DOM_COULEUR[c.domaine]}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, display: "flex", gap: 8, alignItems: "center" }}><School size={16} color={DOM_COULEUR[c.domaine]} /> {c.titre}</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", margin: "6px 0" }}>
            <Pastille color={col}>{S["st_" + c.statut]}</Pastille>
            <Pastille color={DOM_COULEUR[c.domaine]}>{S["dom_" + c.domaine]}</Pastille>
            <Pastille color={GREY}>{S["niv_" + c.niveau]}</Pastille>
            <Pastille color={GREY}>{S["mode_" + c.mode]}</Pastille>
            {complet && <Pastille color={RED}>{S.cls_full}</Pastille>}
          </div>
          <p style={muted}>{S.cls_by.replace("{nom}", c.animateur_nom || "—")} · {S.cls_seats.replace("{n}", inscrits.length).replace("{c}", c.capacite ? ` / ${c.capacite}` : "")}{avisC.length > 0 && <> · <Etoiles n={moyenne} /> {S.cls_avg.replace("{n}", moyenne.toFixed(1)).replace("{c}", avisC.length)}</>}</p>
          {c.description && <p style={{ ...muted, whiteSpace: "pre-wrap", marginTop: 6 }}>{c.description}</p>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          {c.statut === "ouverte" && (!complet || jeSuisInscrit) && <Btn style={small} variant={jeSuisInscrit ? "outline" : undefined} onClick={inscrire}>{jeSuisInscrit ? S.cls_leave : S.cls_join}</Btn>}
          {gest && c.statut === "proposee" && <div style={{ display: "flex", gap: 6 }}><Btn style={small} onClick={() => statut("ouverte")}>{S.cls_open}</Btn><button style={linkBtn(RED)} onClick={() => statut("refusee")}>{S.cls_refuse}</button></div>}
          {anime && c.statut === "ouverte" && <button style={linkBtn(GREY)} onClick={() => statut("terminee")}>{S.cls_end}</button>}
          {anime && ["ouverte", "proposee"].includes(c.statut) && <button style={linkBtn(RED)} onClick={() => window.confirm(S.cls_cancel + " ?") && statut("annulee")}>{S.cls_cancel}</button>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => setOuvert(!ouvert)} style={linkBtn("var(--primary)")}>{ouvert ? S.par_close : `${S.cls_show} (${mesSeances.length})`}</button>
        {mesPresences.length > 0 && <Btn variant="outline" style={small} onClick={attestation}><Award size={13} /> {S.cls_attest}</Btn>}
      </div>
      {ouvert && (
        <div style={{ marginTop: 10 }}>
          {mesSeances.map((s) => (
            <div key={s.id} style={{ padding: "8px 0", borderTop: "1px solid #EEF0F3" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                <Calendar size={13} color={s.statut === "realisee" ? TEAL : "var(--primary)"} />
                <span style={{ textDecoration: s.statut === "annulee" ? "line-through" : "none" }}>{formatEventDateTime(s.debut, lang)} · {s.duree_min} min</span>
                {s.sujet && <b>{s.sujet}</b>}
                <Pastille color={s.statut === "realisee" ? TEAL : GREY}>{S["ses_st_" + s.statut]}</Pastille>
                {s.statut === "prevue" && c.lien_visio && (jeSuisInscrit || anime) && <a href={c.lien_visio} target="_blank" rel="noreferrer" style={{ ...linkBtn(TEAL), textDecoration: "none" }}><Video size={12} /> {S.ses_join}</a>}
                {s.statut === "prevue" && c.lieu && <span style={{ color: GREY, display: "inline-flex", gap: 3, alignItems: "center" }}><MapPin size={12} /> {c.lieu}</span>}
                {anime && s.statut === "prevue" && (
                  <span style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                    <button style={linkBtn(TEAL)} onClick={() => act(() => supabase.from("savoir_classe_seances").update({ statut: "realisee" }).eq("id", s.id))}>{S.ses_done}</button>
                    <button style={linkBtn(RED)} onClick={() => act(() => supabase.from("savoir_classe_seances").update({ statut: "annulee" }).eq("id", s.id))}>{S.ses_cancel}</button>
                  </span>
                )}
              </div>
              {anime && s.statut !== "annulee" && inscrits.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0 0 21px", alignItems: "center" }}>
                  <span style={{ fontSize: 11.5, color: GREY }}>{S.ses_presence} :</span>
                  {inscrits.map((i) => {
                    const on = presences.some((p) => p.seance_id === s.id && p.profile_id === i.profile_id && p.present);
                    return <button key={i.id} style={chip(on, TEAL)} onClick={() => presence(s, i.profile_id)}>{on ? "✓ " : ""}{i.nom || "—"}</button>;
                  })}
                </div>
              )}
            </div>
          ))}
          {anime && ["ouverte", "proposee"].includes(c.statut) && (
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr auto", gap: 8, alignItems: "end", marginTop: 10 }}>
              <Field label={S.ses_when}><input type="datetime-local" style={inputStyle} min={toDatetimeLocal(new Date().toISOString())} value={ses.debut} onChange={(e) => setSes({ ...ses, debut: e.target.value })} /></Field>
              <Field label={S.ses_dur}><input type="number" min={15} step={15} style={inputStyle} value={ses.duree} onChange={(e) => setSes({ ...ses, duree: e.target.value })} /></Field>
              <Field label={S.ses_subject}><input style={inputStyle} value={ses.sujet} onChange={(e) => setSes({ ...ses, sujet: e.target.value })} /></Field>
              <div style={{ marginBottom: 14 }}><Btn style={small} disabled={!ses.debut} onClick={ajouterSeance}><Plus size={13} /> {S.ses_add}</Btn></div>
            </div>
          )}
          {anime && inscrits.length > 0 && <p style={{ ...muted, marginTop: 6 }}><Users size={12} /> {S.cls_participants} : {inscrits.map((i) => i.nom).join(", ")}</p>}
          {jeSuisInscrit && (
            <div style={{ background: "#FDF8EE", borderRadius: 8, padding: 10, marginTop: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>{S.cls_rate}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select style={{ ...inputStyle, width: 110 }} value={monAvis.note} onChange={(e) => setMonAvis({ ...monAvis, note: e.target.value })}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}</select>
                <input style={{ ...inputStyle, flex: 1, minWidth: 180 }} placeholder={S.cls_comment} value={monAvis.commentaire} onChange={(e) => setMonAvis({ ...monAvis, commentaire: e.target.value })} />
                <Btn style={small} onClick={envoyerAvis}><Send size={13} /></Btn>
              </div>
            </div>
          )}
          {avisC.filter((a) => a.commentaire).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>{S.cls_avis}</div>
              {avisC.filter((a) => a.commentaire).map((a) => <p key={a.id} style={{ ...muted, marginTop: 4 }}><Etoiles n={a.note} /> « {a.commentaire} »</p>)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// =====================================================================
// Questions
// =====================================================================
function QuestionCarte({ S, t, lang, profile, gest, q, reponses, onChanged }) {
  const [ouvert, setOuvert] = useState(false);
  const [txt, setTxt] = useState("");
  const rs = reponses.filter((r) => r.question_id === q.id);
  const peutSolution = gest || q.auteur_id === profile.id;
  async function act(fn) { const { error } = await fn(); if (error) { alert(friendlyError(error, t)); return false; } onChanged(); return true; }
  async function repondre() {
    if (!txt.trim()) return;
    if (await act(() => supabase.from("savoir_reponses").insert({ association_id: profile.association_id, question_id: q.id, corps: txt.trim(), auteur_id: profile.id, auteur_nom: profile.nom_complet }))) setTxt("");
  }
  async function solution(r) {
    await act(() => supabase.from("savoir_reponses").update({ est_solution: !r.est_solution }).eq("id", r.id));
    if (!r.est_solution && !q.resolue) await act(() => supabase.from("savoir_questions").update({ resolue: true }).eq("id", q.id));
  }
  return (
    <Card style={{ padding: 14, borderLeft: `4px solid ${DOM_COULEUR[q.domaine]}` }}>
      <div onClick={() => setOuvert(!ouvert)} style={{ cursor: "pointer" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ fontSize: 14 }}>{q.titre}</b>
          {q.resolue && <Pastille color={TEAL}>✓ {S.q_solved}</Pastille>}
          {q.masquee && <Pastille color={RED}><EyeOff size={10} /></Pastille>}
        </div>
        <p style={{ ...muted, marginTop: 4 }}>{S["dom_" + q.domaine]} · {S.q_by.replace("{nom}", q.auteur_nom || "—").replace("{d}", formatEventDateTime(q.created_at, lang))} · {S.q_answers.replace("{n}", rs.length)}</p>
      </div>
      {ouvert && (
        <div style={{ marginTop: 8 }}>
          {q.corps && <p style={{ fontSize: 13, whiteSpace: "pre-wrap", margin: "0 0 8px" }}>{q.corps}</p>}
          {rs.map((r) => (
            <div key={r.id} style={{ padding: "8px 10px", borderRadius: 8, background: r.est_solution ? TEAL_LIGHT : "#F8F7F4", marginBottom: 6 }}>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{r.corps}</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4, fontSize: 11.5, color: GREY, flexWrap: "wrap" }}>
                <span>{S.q_by.replace("{nom}", r.auteur_nom || "—").replace("{d}", formatEventDateTime(r.created_at, lang))}</span>
                {r.est_solution && <b style={{ color: TEAL }}>✓ {S.q_is_solution}</b>}
                {peutSolution && <button style={linkBtn(TEAL)} onClick={() => solution(r)}>{r.est_solution ? "↺" : S.q_solution}</button>}
                {gest && <button style={linkBtn(RED)} onClick={() => act(() => supabase.from("savoir_reponses").update({ masquee: !r.masquee }).eq("id", r.id))}>{S.q_hide}</button>}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <input style={{ ...inputStyle, flex: 1 }} placeholder={S.q_answer_ph} value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && repondre()} />
            <Btn style={small} disabled={!txt.trim()} onClick={repondre}><Send size={13} /> {S.q_answer}</Btn>
          </div>
          {gest && <button style={{ ...linkBtn(RED), marginTop: 8 }} onClick={() => act(() => supabase.from("savoir_questions").update({ masquee: !q.masquee }).eq("id", q.id))}><EyeOff size={12} /> {S.q_hide}</button>}
        </div>
      )}
    </Card>
  );
}

// =====================================================================
// Mentorat professionnel
// =====================================================================
function MentoratCarte({ S, t, lang, profile, x, mentor, messages, onChanged }) {
  const [txt, setTxt] = useState("");
  const jeSuisMentor = mentor?.profile_id === profile.id;
  const msgs = messages.filter((m) => m.mentorat_id === x.id);
  async function act(fn) { const { error } = await fn(); if (error) { alert(friendlyError(error, t)); return false; } onChanged(); return true; }
  async function envoyer() {
    if (!txt.trim()) return;
    if (await act(() => supabase.from("savoir_mentorat_messages").insert({ association_id: profile.association_id, mentorat_id: x.id, auteur_id: profile.id, auteur_nom: profile.nom_complet, contenu: txt.trim() }))) setTxt("");
  }
  const col = { demande: AMBER, actif: TEAL, termine: GREY, refuse: RED }[x.statut];
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <b style={{ fontSize: 13.5 }}>{jeSuisMentor ? `${S.men_as_mentor} ${x.mentore_nom || "—"}` : `${S.men_as_mentee} ${mentor?.nom || "—"}`}</b>
          <p style={{ ...muted, marginTop: 4, whiteSpace: "pre-wrap" }}>{x.objectif}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Pastille color={col}>{S["mst_" + x.statut]}</Pastille>
          {jeSuisMentor && x.statut === "demande" && <>
            <Btn style={small} onClick={() => act(() => supabase.from("savoir_mentorats_pro").update({ statut: "actif", accepte_le: new Date().toISOString() }).eq("id", x.id))}>{S.men_accept}</Btn>
            <button style={linkBtn(RED)} onClick={() => act(() => supabase.from("savoir_mentorats_pro").update({ statut: "refuse" }).eq("id", x.id))}>{S.men_decline}</button>
          </>}
          {x.statut === "actif" && <button style={linkBtn(GREY)} onClick={() => window.confirm(S.men_end + " ?") && act(() => supabase.from("savoir_mentorats_pro").update({ statut: "termine" }).eq("id", x.id))}>{S.men_end}</button>}
        </div>
      </div>
      {x.statut === "actif" && (
        <div style={{ marginTop: 10, background: "#F8F7F4", borderRadius: 8, padding: 10 }}>
          {msgs.map((m) => (
            <div key={m.id} style={{ marginBottom: 6, textAlign: m.auteur_id === profile.id ? "right" : "left" }}>
              <span style={{ display: "inline-block", background: m.auteur_id === profile.id ? "var(--primary)" : "white", color: m.auteur_id === profile.id ? "white" : "#222", borderRadius: 10, padding: "6px 10px", fontSize: 13, maxWidth: "80%", whiteSpace: "pre-wrap", textAlign: "left" }}>{m.contenu}</span>
              <div style={{ fontSize: 10.5, color: GREY }}>{m.auteur_nom} · {formatEventDateTime(m.created_at, lang)}</div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <input style={{ ...inputStyle, flex: 1 }} placeholder={S.men_msg_ph} value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && envoyer()} />
            <Btn style={small} disabled={!txt.trim()} onClick={envoyer}><Send size={13} /></Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

function MentoratTab({ S, t, lang, profile, d, onChanged }) {
  const monProfil = d.mentorsPro.find((m) => m.profile_id === profile.id);
  const [form, setForm] = useState(null);
  const [demande, setDemande] = useState({ mentor: null, objectif: "" });
  const [filtre, setFiltre] = useState("");
  async function enregistrer() {
    const row = { association_id: profile.association_id, profile_id: profile.id, nom: profile.nom_complet || "—", domaines: form.domaines, presentation: form.presentation.trim() || null, disponibilite: form.disponibilite.trim() || null };
    const { error } = monProfil ? await supabase.from("savoir_mentors_pro").update(row).eq("id", monProfil.id) : await supabase.from("savoir_mentors_pro").insert(row);
    if (error) { alert(friendlyError(error, t)); return; }
    setForm(null); onChanged();
  }
  async function pause() {
    const { error } = await supabase.from("savoir_mentors_pro").update({ statut: monProfil.statut === "actif" ? "pause" : "actif" }).eq("id", monProfil.id);
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }
  async function demander() {
    if (!demande.objectif.trim()) return;
    const { error } = await supabase.from("savoir_mentorats_pro").insert({ association_id: profile.association_id, mentor_id: demande.mentor.id, mentore_id: profile.id, mentore_nom: profile.nom_complet, objectif: demande.objectif.trim() });
    if (error) { alert(friendlyError(error, t)); return; }
    alert(S.men_sent); setDemande({ mentor: null, objectif: "" }); onChanged();
  }
  const dispo = d.mentorsPro.filter((m) => m.statut === "actif" && m.profile_id !== profile.id && (!filtre || (m.domaines || []).includes(filtre)));
  const mesMentorats = d.mentorats.filter((x) => x.mentore_id === profile.id || d.mentorsPro.find((m) => m.id === x.mentor_id)?.profile_id === profile.id);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}><Briefcase size={16} /> {monProfil ? S.men_update : S.men_become}</div>
          <div style={{ display: "flex", gap: 8 }}>
            {monProfil && <Btn variant="outline" style={small} onClick={pause}>{monProfil.statut === "actif" ? S.men_pause : S.men_resume}</Btn>}
            {!form && <Btn style={small} onClick={() => setForm({ domaines: monProfil?.domaines || [], presentation: monProfil?.presentation || "", disponibilite: monProfil?.disponibilite || "" })}>{monProfil ? S.men_update : S.men_become}</Btn>}
          </div>
        </div>
        {form && (
          <div style={{ marginTop: 12 }}>
            <Field label={S.men_domains}><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{DOMAINES.map((x) => <button key={x} type="button" style={chip(form.domaines.includes(x), DOM_COULEUR[x])} onClick={() => setForm((f) => ({ ...f, domaines: f.domaines.includes(x) ? f.domaines.filter((y) => y !== x) : [...f.domaines, x] }))}>{S["dom_" + x]}</button>)}</div></Field>
            <Field label={S.men_pres}><textarea style={{ ...inputStyle, minHeight: 60 }} maxLength={1000} value={form.presentation} onChange={(e) => setForm({ ...form, presentation: e.target.value })} /></Field>
            <Field label={S.men_dispo}><input style={inputStyle} value={form.disponibilite} onChange={(e) => setForm({ ...form, disponibilite: e.target.value })} /></Field>
            <div style={{ display: "flex", gap: 8 }}><Btn style={small} disabled={form.domaines.length === 0} onClick={enregistrer}>{S.men_save}</Btn><Btn variant="outline" style={small} onClick={() => setForm(null)}>{S.cancel}</Btn></div>
          </div>
        )}
      </Card>
      {mesMentorats.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{S.men_mine}</div>
          {mesMentorats.map((x) => <MentoratCarte key={x.id} S={S} t={t} lang={lang} profile={profile} x={x} mentor={d.mentorsPro.find((m) => m.id === x.mentor_id)} messages={d.messagesPro} onChanged={onChanged} />)}
        </div>
      )}
      <div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <b style={{ fontSize: 14, marginRight: 8 }}>{S.men_list}</b>
          <button style={chip(!filtre)} onClick={() => setFiltre("")}>{S.dom_tous}</button>
          {DOMAINES.map((x) => <button key={x} style={chip(filtre === x, DOM_COULEUR[x])} onClick={() => setFiltre(x)}>{S["dom_" + x]}</button>)}
        </div>
        {dispo.length === 0 && <p style={{ ...muted, fontStyle: "italic" }}>{S.men_empty}</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {dispo.map((m) => (
            <Card key={m.id} style={{ padding: 14 }}>
              <b>{m.nom}</b>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", margin: "6px 0" }}>{(m.domaines || []).map((x) => <Pastille key={x} color={DOM_COULEUR[x]}>{S["dom_" + x]}</Pastille>)}</div>
              {m.presentation && <p style={{ ...muted, whiteSpace: "pre-wrap" }}>{m.presentation}</p>}
              {m.disponibilite && <p style={{ ...muted, marginTop: 4 }}><Clock size={11} /> {m.disponibilite}</p>}
              {demande.mentor?.id === m.id ? (
                <div style={{ marginTop: 8 }}>
                  <textarea style={{ ...inputStyle, minHeight: 60 }} placeholder={S.men_goal} value={demande.objectif} onChange={(e) => setDemande({ ...demande, objectif: e.target.value })} />
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}><Btn style={small} disabled={!demande.objectif.trim()} onClick={demander}>{S.men_send}</Btn><Btn variant="outline" style={small} onClick={() => setDemande({ mentor: null, objectif: "" })}>{S.cancel}</Btn></div>
                </div>
              ) : <Btn style={{ ...small, marginTop: 8 }} onClick={() => setDemande({ mentor: m, objectif: "" })}><Heart size={13} /> {S.men_ask}</Btn>}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Impact
// =====================================================================
function heuresBenevoles(d, jeunesse) {
  const lignes = [];
  (jeunesse.mentors || []).forEach((m) => {
    const jIds = new Set((jeunesse.jumelages || []).filter((j) => j.mentor_id === m.id).map((j) => j.id));
    const ss = (jeunesse.seances || []).filter((s) => jIds.has(s.jumelage_id) && s.statut === "realisee");
    const min = ss.reduce((a, s) => a + (s.duree_min || 0), 0);
    if (min > 0) lignes.push({ cle: "m" + m.id, nom: m.nom, member_id: m.member_id, role: "mentor", minutes: min, nb: ss.length, depuis: ss.map((s) => s.debut).sort()[0] });
  });
  const parAnim = {};
  d.classes.forEach((c) => {
    if (!c.animateur_id) return;
    const ss = d.seances.filter((s) => s.classe_id === c.id && s.statut === "realisee");
    if (!ss.length) return;
    const x = parAnim[c.animateur_id] || { cle: "a" + c.animateur_id, profile_id: c.animateur_id, nom: c.animateur_nom, role: "animateur", minutes: 0, nb: 0, depuis: null };
    x.minutes += ss.reduce((a, s) => a + (s.duree_min || 0), 0); x.nb += ss.length;
    const premier = ss.map((s) => s.debut).sort()[0];
    if (!x.depuis || premier < x.depuis) x.depuis = premier;
    parAnim[c.animateur_id] = x;
  });
  return [...lignes, ...Object.values(parAnim)].sort((a, b) => b.minutes - a.minutes);
}

function attestationBenevolat(S, v, association, lang, t) {
  const loc = lang === "en" ? "en-CA" : "fr-CA";
  const depuis = v.depuis ? new Date(v.depuis).toLocaleDateString(loc, { month: "long", year: "numeric" }) : "";
  exporterAttestation({
    titre: S.att_ben_title, intro: S.att_ben_intro, nom: v.nom || "", intitule: S.att_ben_line,
    lignes: [`${v.role === "mentor" ? S.role_mentor : S.role_animateur} - ${S.att_ben_detail.replace("{h}", heures(v.minutes)).replace("{d}", `${v.nb} séance(s)${depuis ? `, depuis ${depuis}` : ""}`)}`],
    signataire: signataire(association), association, lang, reference: `V-${new Date().getFullYear()}-${String(v.cle).slice(1, 9).toUpperCase()}`, fileName: "attestation_benevolat.pdf",
  }).catch((e) => alert(friendlyError(e, t)));
}

function ImpactTab({ S, t, lang, association, d, jeunesse }) {
  const j = jeunesse;
  const seancesR = (j.seances || []).filter((s) => s.statut === "realisee");
  const notesProg = seancesR.map((s) => s.progression).filter(Boolean);
  const notesEval = seancesR.map((s) => s.eval_note).filter(Boolean);
  const moy = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) + " / 5" : "—");
  const laureats = (j.candidatures || []).filter((c) => c.statut === "laureat");
  const montant = laureats.reduce((s, c) => s + Number((j.bourses || []).find((b) => b.id === c.bourse_id)?.montant || 0), 0);
  const parcoursFinis = d.parcours.reduce((acc, p) => {
    const ids = d.etapes.filter((e) => e.parcours_id === p.id).map((e) => e.id);
    if (!ids.length) return acc;
    const parProfil = {};
    d.progressions.filter((x) => x.parcours_id === p.id).forEach((x) => { parProfil[x.profile_id] = (parProfil[x.profile_id] || 0) + 1; });
    return acc + Object.values(parProfil).filter((n) => n >= ids.length).length;
  }, 0);
  const seancesClasses = d.seances.filter((s) => s.statut === "realisee");
  const partic = new Set(d.presences.filter((p) => p.present).map((p) => p.profile_id)).size;
  const benevoles = heuresBenevoles(d, j);
  const sections = [
    { titre: S.imp_youth, lignes: [
      [S.k_jeunes, (j.etudiants || []).filter((e) => e.statut === "actif").length], [S.k_mentors, (j.mentors || []).filter((m) => m.statut === "approuve").length],
      [S.k_seances, seancesR.length], [S.k_heures, heures(seancesR.reduce((a, s) => a + (s.duree_min || 0), 0))], [S.k_prog, moy(notesProg)], [S.k_satis, moy(notesEval)],
      [S.k_bourses, laureats.length], [S.k_montant, montant.toLocaleString(lang === "en" ? "en-CA" : "fr-CA", { style: "currency", currency: association?.devise_monetaire || "CAD" })],
    ] },
    { titre: S.imp_carrefour, lignes: [
      [S.k_res, d.ressources.filter((r) => r.statut === "publiee").length + (j.ressources || []).length], [S.k_vues, d.nbVues],
      [S.k_parcours, parcoursFinis], [S.k_classes, d.classes.filter((c) => d.seances.some((s) => s.classe_id === c.id && s.statut === "realisee")).length],
      [S.k_hclasses, heures(seancesClasses.reduce((a, s) => a + (s.duree_min || 0), 0))], [S.k_particip, partic],
      [S.k_mentorats, d.mentorats.filter((x) => x.statut === "actif").length], [S.k_questions, d.questions.filter((q) => q.resolue).length],
    ] },
    { titre: S.imp_volunteers, lignes: benevoles.map((v) => [`${v.nom} (${v.role === "mentor" ? S.role_mentor : S.role_animateur})`, `${heures(v.minutes)} h`]) },
  ];
  function csv() {
    const rows = sections.flatMap((s) => [[s.titre, ""], ...s.lignes]);
    const txt = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + txt], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `impact_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div><div style={{ fontWeight: 700, fontSize: 16 }}>{S.imp_title}</div><p style={muted}>{S.imp_sub}</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn style={small} onClick={() => exporterRapportImpact({ titre: S.imp_title, sousTitre: new Date().toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA", { dateStyle: "long" }), sections, association }).catch((e) => alert(friendlyError(e, t)))}><Download size={13} /> {S.export_pdf}</Btn>
          <Btn variant="outline" style={small} onClick={csv}><Download size={13} /> {S.export_csv}</Btn>
        </div>
      </div>
      {sections.slice(0, 2).map((sec) => (
        <Card key={sec.titre} style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{sec.titre}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            {sec.lignes.map(([k, v]) => (
              <div key={k} style={{ background: "#F8F9FB", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: GREY, textTransform: "uppercase", letterSpacing: ".04em" }}>{k}</div>
                <div style={{ fontSize: 19, fontWeight: 700, color: "var(--primary)" }}>{v}</div>
              </div>
            ))}
          </div>
        </Card>
      ))}
      <Card style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{S.imp_volunteers}</div>
        {benevoles.length === 0 && <p style={{ ...muted, fontStyle: "italic" }}>{S.none}</p>}
        {benevoles.map((v) => (
          <div key={v.cle} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid #EEF0F3", flexWrap: "wrap" }}>
            <b style={{ flex: 1, fontSize: 13.5 }}>{v.nom}</b>
            <span style={{ fontSize: 12, color: GREY }}>{v.role === "mentor" ? S.role_mentor : S.role_animateur} · {v.nb} séance(s)</span>
            <b style={{ fontSize: 13.5, width: 70, textAlign: "right" }}>{heures(v.minutes)} h</b>
            <Btn variant="outline" style={small} onClick={() => attestationBenevolat(S, v, association, lang, t)}><Award size={13} /> {S.vol_attest}</Btn>
          </div>
        ))}
      </Card>
    </div>
  );
}

// =====================================================================
// Composant principal
// =====================================================================
export default function CarrefourSavoir({ t, lang, profile, gest, association, jeunesse, onGoJeunesse }) {
  const S = TXT[lang === "en" ? "en" : "fr"];
  const [tab, setTab] = useState("accueil");
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [d, setD] = useState({ nbVues: 0, ressources: [], favoris: [], consultations: [], populaires: [], parcours: [], etapes: [], progressions: [], questions: [], reponses: [], classes: [], seances: [], inscriptions: [], presences: [], avis: [], mentorsPro: [], mentorats: [], messagesPro: [] });
  const [profil, setProfil] = useState(lireProfil);
  const [q, setQ] = useState("");
  const [fDom, setFDom] = useState("");
  const [fPub, setFPub] = useState("");
  const [fType, setFType] = useState("");
  const [form, setForm] = useState(null);
  const [qForm, setQForm] = useState({ domaine: "academique", titre: "", corps: "" });

  const load = useCallback(async () => {
    const aid = profile.association_id;
    const sel = (table) => supabase.from(table).select("*").eq("association_id", aid);
    const r = await Promise.all([
      sel("savoir_ressources").order("created_at", { ascending: false }),
      sel("savoir_favoris"),
      sel("savoir_consultations").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(30),
      supabase.rpc("savoir_populaires"),
      sel("savoir_parcours").order("created_at", { ascending: false }),
      sel("savoir_parcours_etapes"),
      sel("savoir_progressions"),
      sel("savoir_questions").order("created_at", { ascending: false }),
      sel("savoir_reponses").order("created_at"),
      sel("savoir_classes").order("created_at", { ascending: false }),
      sel("savoir_classe_seances").order("debut"),
      sel("savoir_inscriptions"),
      sel("savoir_presences"),
      sel("savoir_avis"),
      sel("savoir_mentors_pro").order("nom"),
      sel("savoir_mentorats_pro").order("created_at", { ascending: false }),
      sel("savoir_mentorat_messages").order("created_at"),
      gest ? supabase.from("savoir_consultations").select("id", { count: "exact", head: true }).eq("association_id", aid) : Promise.resolve({ count: 0 }),
    ]);
    const nbVues = r.pop().count || 0;
    if (r[0].error && (r[0].error.code === "42P01" || r[0].error.code === "PGRST205")) { setMissing(true); setLoading(false); return; }
    const [ressources, favoris, consultations, populaires, parcours, etapes, progressions, questions, reponses, classes, seances, inscriptions, presences, avis, mentorsPro, mentorats, messagesPro] = r.map((x) => x.data || []);
    setD({ nbVues, ressources, favoris, consultations, populaires, parcours, etapes, progressions, questions, reponses, classes, seances, inscriptions, presences, avis, mentorsPro, mentorats, messagesPro });
    setMissing(false); setLoading(false);
  }, [profile.association_id, profile.id, gest]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <p>{t("loading")}</p>;
  if (missing) return <Card><p style={{ margin: 0, color: AMBER }}>{S.sql_missing}</p></Card>;

  const favIds = new Set(d.favoris.filter((f) => f.profile_id === profile.id).map((f) => f.ressource_id));
  const faits = new Set(d.progressions.filter((p) => p.profile_id === profile.id).map((p) => p.etape_id));
  const publiees = d.ressources.filter((r) => r.statut === "publiee");
  const visePublic = (r) => profil.length === 0 || (r.publics || []).some((p) => p === "tous" || profil.includes(p));

  async function ouvrir(r) {
    supabase.from("savoir_consultations").insert({ association_id: profile.association_id, profile_id: profile.id, ressource_id: r.id }).then(() => {});
    if (r.storage_path) {
      const { data, error } = await supabase.storage.from("savoir-ressources").createSignedUrl(r.storage_path, 300);
      if (error) { alert(friendlyError(error, t)); return; }
      window.open(data.signedUrl, "_blank", "noopener");
    } else if (r.url) window.open(r.url, "_blank", "noopener");
  }
  async function basculerFav(r) {
    const { error } = favIds.has(r.id)
      ? await supabase.from("savoir_favoris").delete().eq("profile_id", profile.id).eq("ressource_id", r.id)
      : await supabase.from("savoir_favoris").insert({ association_id: profile.association_id, profile_id: profile.id, ressource_id: r.id });
    if (error) { alert(friendlyError(error, t)); return; }
    load();
  }
  async function supprimer(r) {
    if (!window.confirm(S.res_del_confirm)) return;
    const { error } = await supabase.from("savoir_ressources").delete().eq("id", r.id);
    if (error) { alert(friendlyError(error, t)); return; }
    if (r.storage_path) supabase.storage.from("savoir-ressources").remove([r.storage_path]).then(() => {});
    load();
  }
  async function statuerRes(r, statut) {
    const { error } = await supabase.from("savoir_ressources").update({ statut }).eq("id", r.id);
    if (error) { alert(friendlyError(error, t)); return; }
    load();
  }
  async function importerPack() {
    const existantes = new Set(d.ressources.map((r) => r.url));
    const aAjouter = PACK.filter((p) => !existantes.has(p[1]));
    if (!aAjouter.length || !window.confirm(S.pack_confirm.replace("{n}", aAjouter.length))) return;
    const { error } = await supabase.from("savoir_ressources").insert(aAjouter.map(([titre, url, domaine, publics, type, theme]) => ({
      association_id: profile.association_id, titre, url, domaine, publics, type, theme, externe: true, statut: "publiee", depose_par: profile.id, depose_par_nom: profile.nom_complet,
    })));
    if (error) { alert(friendlyError(error, t)); return; }
    load();
  }
  async function poserQuestion() {
    if (!qForm.titre.trim()) return;
    const { error } = await supabase.from("savoir_questions").insert({ association_id: profile.association_id, domaine: qForm.domaine, titre: qForm.titre.trim(), corps: qForm.corps.trim() || null, auteur_id: profile.id, auteur_nom: profile.nom_complet });
    if (error) { alert(friendlyError(error, t)); return; }
    setQForm({ domaine: qForm.domaine, titre: "", corps: "" }); setForm(null); load();
  }
  function choisirProfil(p) {
    const n = profil.includes(p) ? profil.filter((x) => x !== p) : [...profil, p];
    setProfil(n);
    try { window.localStorage.setItem("carrefour_profil", JSON.stringify(n)); } catch { /* stockage indisponible */ }
  }

  const fq = foldText(q.trim());
  const filtrerRes = (list) => list.filter((r) => (!fDom || r.domaine === fDom) && (!fPub || (r.publics || []).includes(fPub) || (r.publics || []).includes("tous")) && (!fType || r.type === fType)
    && (!fq || foldText(`${r.titre} ${r.description || ""} ${r.theme || ""}`).includes(fq)));
  const ressourcesVisibles = filtrerRes(publiees);
  const parcoursPublies = d.parcours.filter((p) => p.statut === "publie");
  const classesVisibles = d.classes.filter((c) => c.statut !== "refusee" && c.statut !== "annulee" || c.animateur_id === profile.id);
  const grille = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 };
  const TABS = [
    ["accueil", S.tab_accueil, Compass], ["ressources", S.tab_ressources, BookOpen], ["parcours", S.tab_parcours, Route], ["classes", S.tab_classes, School],
    ["questions", S.tab_questions, MessageCircleQuestion], ["mentorat", S.tab_mentorat, Briefcase], ...(gest ? [["impact", S.tab_impact, BarChart3]] : []),
  ];
  const aValider = gest ? d.ressources.filter((r) => r.statut === "proposee").length + d.classes.filter((c) => c.statut === "proposee").length : 0;
  const demandesMentorat = d.mentorats.filter((x) => x.statut === "demande" && d.mentorsPro.find((m) => m.id === x.mentor_id)?.profile_id === profile.id).length;

  // Mon espace
  const mesParcours = parcoursPublies.map((p) => {
    const ids = d.etapes.filter((e) => e.parcours_id === p.id).map((e) => e.id);
    const n = ids.filter((id) => faits.has(id)).length;
    return { p, n, total: ids.length };
  }).filter((x) => x.n > 0);
  const mesClasses = d.classes.filter((c) => d.inscriptions.some((i) => i.classe_id === c.id && i.profile_id === profile.id && i.statut === "inscrit"));
  const prochaines = d.seances.filter((s) => s.statut === "prevue" && new Date(s.debut) > new Date() && mesClasses.some((c) => c.id === s.classe_id)).slice(0, 4);
  const benevoles = heuresBenevoles(d, jeunesse).filter((v) => v.profile_id === profile.id || (v.member_id && v.member_id === profile.member_id));
  const historique = [...new Map(d.consultations.map((c) => [c.ressource_id, c])).values()].map((c) => publiees.find((r) => r.id === c.ressource_id)).filter(Boolean).slice(0, 5);

  return (
    <div>
      <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map(([id, label, I]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setForm(null); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === id ? "var(--primary)" : "#F1F2F4", color: tab === id ? "white" : "#3A404C" }}>
            <I size={14} /> {label}
            {((id === "ressources" || id === "classes") && aValider > 0) || (id === "mentorat" && demandesMentorat > 0)
              ? <span style={{ background: RED, color: "white", borderRadius: 999, fontSize: 11, padding: "0 6px" }}>{id === "mentorat" ? demandesMentorat : id === "ressources" ? d.ressources.filter((r) => r.statut === "proposee").length : d.classes.filter((c) => c.statut === "proposee").length}</span> : null}
          </button>
        ))}
      </div>

      {tab === "accueil" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ background: "linear-gradient(135deg, var(--primary), var(--primary-dark, #0D3A63))", color: "white", borderRadius: 16, padding: "22px 22px 18px" }}>
            <div style={{ fontSize: 20, fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}><Sparkles size={20} /> {S.hero}</div>
            <p style={{ margin: "4px 0 14px", opacity: 0.9, fontSize: 13 }}>{S.hero_sub}</p>
            <div style={{ position: "relative", maxWidth: 560 }}>
              <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: GREY }} />
              <input style={{ ...inputStyle, paddingLeft: 34, fontSize: 14 }} placeholder={S.search_all} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{S.iam}</span>
              {PUBLICS.filter((p) => p !== "tous").map((p) => <button key={p} onClick={() => choisirProfil(p)} style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, cursor: "pointer", border: "1px solid rgba(255,255,255,.5)", background: profil.includes(p) ? "white" : "transparent", color: profil.includes(p) ? "var(--primary)" : "white" }}>{S["pub_" + p]}</button>)}
            </div>
            <p style={{ fontSize: 11, opacity: 0.75, margin: "6px 0 0" }}>{S.iam_hint}</p>
          </div>

          {fq ? (
            <Card style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>{S.results}</div>
              <div style={grille}>{ressourcesVisibles.slice(0, 12).map((r) => <RessourceCarte key={r.id} S={S} r={r} fav={favIds.has(r.id)} onFav={() => basculerFav(r)} onOpen={() => ouvrir(r)} />)}</div>
              {parcoursPublies.filter((p) => foldText(`${p.titre} ${p.description || ""}`).includes(fq)).map((p) => <p key={p.id} style={{ margin: "8px 0 0" }}><button style={linkBtn("var(--primary)")} onClick={() => setTab("parcours")}><Route size={13} /> {p.titre}</button></p>)}
              {d.classes.filter((c) => c.statut === "ouverte" && foldText(`${c.titre} ${c.description || ""}`).includes(fq)).map((c) => <p key={c.id} style={{ margin: "8px 0 0" }}><button style={linkBtn("var(--primary)")} onClick={() => setTab("classes")}><School size={13} /> {c.titre}</button></p>)}
            </Card>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                {DOMAINES.map((dm) => (
                  <button key={dm} onClick={() => { setFDom(dm); setTab("ressources"); }} style={{ textAlign: "left", background: "white", border: "none", borderTop: `4px solid ${DOM_COULEUR[dm]}`, borderRadius: 12, padding: 16, cursor: "pointer", boxShadow: "0 2px 10px rgba(31,56,100,0.06)" }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: DOM_COULEUR[dm] }}>{S["dom_" + dm]}</div>
                    <div style={{ fontSize: 12.5, color: GREY, margin: "4px 0 8px" }}>{S["dom_" + dm + "_d"]}</div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{S.nb_res.replace("{n}", publiees.filter((r) => r.domaine === dm).length)} · {parcoursPublies.filter((p) => p.domaine === dm).length} {S.tab_parcours.toLowerCase()} · {d.classes.filter((c) => c.domaine === dm && c.statut === "ouverte").length} {S.tab_classes.toLowerCase()}</div>
                  </button>
                ))}
              </div>
              <Card style={{ padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 10 }}>{S.my_space}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: GREY, marginBottom: 6 }}>⭐ {S.my_favs}</div>
                    {publiees.filter((r) => favIds.has(r.id)).slice(0, 6).map((r) => <p key={r.id} style={{ margin: "0 0 4px" }}><button style={linkBtn("var(--primary)")} onClick={() => ouvrir(r)}>{r.titre}</button></p>)}
                    {favIds.size === 0 && <p style={{ ...muted, fontStyle: "italic" }}>{S.none}</p>}
                    {historique.length > 0 && <div style={{ fontSize: 11.5, color: GREY, marginTop: 6 }}>🕘 {historique.map((r) => r.titre).join(" · ")}</div>}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: GREY, marginBottom: 6 }}>🧭 {S.my_paths}</div>
                    {mesParcours.map(({ p, n, total }) => (
                      <div key={p.id} style={{ marginBottom: 6, cursor: "pointer" }} onClick={() => setTab("parcours")}>
                        <div style={{ fontSize: 12.5 }}>{p.titre} <span style={{ color: GREY }}>({n}/{total})</span></div>
                        <div style={{ height: 5, background: "#EEF0F3", borderRadius: 999 }}><div style={{ width: `${total ? (n / total) * 100 : 0}%`, height: "100%", background: n === total ? TEAL : "var(--primary)", borderRadius: 999 }} /></div>
                      </div>
                    ))}
                    {mesParcours.length === 0 && <p style={{ ...muted, fontStyle: "italic" }}>{S.none}</p>}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: GREY, marginBottom: 6 }}>🏫 {S.my_classes}</div>
                    {prochaines.map((s) => <p key={s.id} style={{ ...muted, marginBottom: 4 }}><Calendar size={11} /> {formatEventDateTime(s.debut, lang)} — {d.classes.find((c) => c.id === s.classe_id)?.titre}</p>)}
                    {prochaines.length === 0 && <p style={{ ...muted, fontStyle: "italic" }}>{S.none}</p>}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: GREY, marginBottom: 6 }}>🏅 {S.my_attest}</div>
                    {benevoles.map((v) => <p key={v.cle} style={{ margin: "0 0 4px" }}><button style={linkBtn(TEAL)} onClick={() => attestationBenevolat(S, v, association, lang, t)}><Award size={12} /> {S.att_ben_title.charAt(0) + S.att_ben_title.slice(1).toLowerCase()} — {heures(v.minutes)} h</button></p>)}
                    {mesParcours.filter((x) => x.n === x.total).map(({ p }) => <p key={p.id} style={{ margin: "0 0 4px" }}><button style={linkBtn(TEAL)} onClick={() => setTab("parcours")}><Award size={12} /> {p.titre}</button></p>)}
                    {benevoles.length === 0 && !mesParcours.some((x) => x.n === x.total) && <p style={{ ...muted, fontStyle: "italic" }}>{S.none}</p>}
                  </div>
                </div>
              </Card>
              {publiees.filter(visePublic).length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 10 }}>✨ {S.for_you}</div>
                  <div style={grille}>{publiees.filter(visePublic).slice(0, 6).map((r) => <RessourceCarte key={r.id} S={S} r={r} fav={favIds.has(r.id)} onFav={() => basculerFav(r)} onOpen={() => ouvrir(r)} />)}</div>
                </div>
              )}
              {d.populaires.length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 10 }}>🔥 {S.popular}</div>
                  <div style={grille}>{d.populaires.map((p) => publiees.find((r) => r.id === p.ressource_id)).filter(Boolean).slice(0, 6).map((r) => <RessourceCarte key={r.id} S={S} r={r} fav={favIds.has(r.id)} onFav={() => basculerFav(r)} onOpen={() => ouvrir(r)} />)}</div>
                </div>
              )}
              <Card style={{ padding: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13 }}>{S.jeunesse_teaser}</span>
                <Btn variant="outline" style={{ ...small, marginLeft: "auto" }} onClick={onGoJeunesse}>{S.go} →</Btn>
              </Card>
            </>
          )}
        </div>
      )}

      {tab === "ressources" && (
        <div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <div style={{ position: "relative", flex: "1 1 220px" }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: GREY }} />
              <input style={{ ...inputStyle, paddingLeft: 30 }} placeholder={S.search_all} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select style={{ ...inputStyle, width: "auto" }} value={fDom} onChange={(e) => setFDom(e.target.value)}><option value="">{S.dom_tous}</option>{DOMAINES.map((x) => <option key={x} value={x}>{S["dom_" + x]}</option>)}</select>
            <select style={{ ...inputStyle, width: "auto" }} value={fPub} onChange={(e) => setFPub(e.target.value)}><option value="">{S.res_all_pub}</option>{PUBLICS.filter((p) => p !== "tous").map((x) => <option key={x} value={x}>{S["pub_" + x]}</option>)}</select>
            <select style={{ ...inputStyle, width: "auto" }} value={fType} onChange={(e) => setFType(e.target.value)}><option value="">{S.res_all_type}</option>{TYPES.map((x) => <option key={x} value={x}>{S["type_" + x]}</option>)}</select>
            {form !== "res" && <Btn style={small} onClick={() => setForm("res")}><Plus size={13} /> {gest ? S.res_add : S.res_propose}</Btn>}
          </div>
          {gest && PACK.some((p) => !d.ressources.some((r) => r.url === p[1])) && <button style={{ ...linkBtn(TEAL), marginBottom: 12 }} onClick={importerPack}><Sparkles size={13} /> {S.pack.replace("{n}", PACK.filter((p) => !d.ressources.some((r) => r.url === p[1])).length)}</button>}
          {form === "res" && <RessourceForm S={S} t={t} profile={profile} gest={gest} onCancel={() => setForm(null)} onDone={() => { setForm(null); load(); }} />}
          {gest && d.ressources.some((r) => r.statut === "proposee") && (
            <Card style={{ padding: 14, marginBottom: 14, borderLeft: `4px solid ${AMBER}` }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{S.res_pending}</div>
              {d.ressources.filter((r) => r.statut === "proposee").map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderTop: "1px solid #EEF0F3", flexWrap: "wrap" }}>
                  <span style={{ flex: 1, fontSize: 13 }}><b>{r.titre}</b> · {S["dom_" + r.domaine]} · {S.res_by.replace("{nom}", r.depose_par_nom || "—")}</span>
                  <button style={linkBtn(TEAL)} onClick={() => ouvrir(r)}>{S.res_open}</button>
                  <Btn style={small} onClick={() => statuerRes(r, "publiee")}>{S.res_publish}</Btn>
                  <button style={linkBtn(RED)} onClick={() => statuerRes(r, "refusee")}>{S.res_refuse}</button>
                </div>
              ))}
            </Card>
          )}
          <p style={{ ...muted, marginBottom: 10 }}>{S.nb_res.replace("{n}", ressourcesVisibles.length)}</p>
          {ressourcesVisibles.length === 0 && <p style={{ ...muted, fontStyle: "italic" }}>{S.res_empty}</p>}
          <div style={grille}>{ressourcesVisibles.map((r) => <RessourceCarte key={r.id} S={S} r={r} fav={favIds.has(r.id)} onFav={() => basculerFav(r)} onOpen={() => ouvrir(r)} canDelete={gest || r.depose_par === profile.id} onDelete={() => supprimer(r)} />)}</div>
        </div>
      )}

      {tab === "parcours" && (
        <div style={{ display: "grid", gap: 12 }}>
          {gest && form !== "par" && <div><Btn style={small} onClick={() => setForm("par")}><Plus size={13} /> {S.par_new}</Btn></div>}
          {form === "par" && <ParcoursForm S={S} t={t} profile={profile} ressources={d.ressources} onCancel={() => setForm(null)} onDone={() => { setForm(null); load(); }} />}
          {parcoursPublies.length === 0 && <p style={{ ...muted, fontStyle: "italic" }}>{S.par_empty}</p>}
          {parcoursPublies.map((p) => <ParcoursCarte key={p.id} S={S} t={t} lang={lang} profile={profile} gest={gest} association={association} p={p} etapes={d.etapes} faits={faits} ressources={d.ressources} onOpenRes={ouvrir} onChanged={load} />)}
        </div>
      )}

      {tab === "classes" && (
        <div style={{ display: "grid", gap: 12 }}>
          {form !== "cls" && <div><Btn style={small} onClick={() => setForm("cls")}><Plus size={13} /> {gest ? S.cls_new : S.cls_propose}</Btn></div>}
          {form === "cls" && <ClasseForm S={S} t={t} profile={profile} gest={gest} onCancel={() => setForm(null)} onDone={() => { setForm(null); load(); }} />}
          {classesVisibles.length === 0 && <p style={{ ...muted, fontStyle: "italic" }}>{S.cls_empty}</p>}
          {classesVisibles.map((c) => <ClasseCarte key={c.id} S={S} t={t} lang={lang} profile={profile} gest={gest} association={association} c={c} seances={d.seances} inscriptions={d.inscriptions} presences={d.presences} avis={d.avis} onChanged={load} />)}
        </div>
      )}

      {tab === "questions" && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button style={chip(!fDom)} onClick={() => setFDom("")}>{S.dom_tous}</button>
            {DOMAINES.map((x) => <button key={x} style={chip(fDom === x, DOM_COULEUR[x])} onClick={() => setFDom(x)}>{S["dom_" + x]}</button>)}
            {form !== "q" && <Btn style={{ ...small, marginLeft: "auto" }} onClick={() => setForm("q")}><Plus size={13} /> {S.q_ask}</Btn>}
          </div>
          {form === "q" && (
            <Card style={{ padding: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0 12px" }}>
                <Field label={S.res_dom}><select style={inputStyle} value={qForm.domaine} onChange={(e) => setQForm({ ...qForm, domaine: e.target.value })}>{DOMAINES.map((x) => <option key={x} value={x}>{S["dom_" + x]}</option>)}</select></Field>
                <Field label={S.q_title}><input required style={inputStyle} value={qForm.titre} onChange={(e) => setQForm({ ...qForm, titre: e.target.value })} /></Field>
              </div>
              <Field label={S.q_body}><textarea style={{ ...inputStyle, minHeight: 60 }} maxLength={3000} value={qForm.corps} onChange={(e) => setQForm({ ...qForm, corps: e.target.value })} /></Field>
              <div style={{ display: "flex", gap: 8 }}><Btn style={small} disabled={!qForm.titre.trim()} onClick={poserQuestion}>{S.q_send}</Btn><Btn variant="outline" style={small} onClick={() => setForm(null)}>{S.cancel}</Btn></div>
            </Card>
          )}
          {d.questions.filter((x) => !fDom || x.domaine === fDom).length === 0 && <p style={{ ...muted, fontStyle: "italic" }}>{S.q_empty}</p>}
          {d.questions.filter((x) => !fDom || x.domaine === fDom).map((x) => <QuestionCarte key={x.id} S={S} t={t} lang={lang} profile={profile} gest={gest} q={x} reponses={d.reponses} onChanged={load} />)}
        </div>
      )}

      {tab === "mentorat" && <MentoratTab S={S} t={t} lang={lang} profile={profile} d={d} onChanged={load} />}
      {tab === "impact" && gest && <ImpactTab S={S} t={t} lang={lang} association={association} d={d} jeunesse={jeunesse} />}
    </div>
  );
}

