// =====================================================================
// liaisonTextes.js — textes et outils de la liaison compte ↔ fiche adhérent
// =====================================================================
// Demande de l'utilisateur (2026-10-09) : rendre l'application autonome
// pour relier un compte à sa fiche adhérent, sans requête SQL :
//  • le fondateur / un membre du bureau relie lui-même son compte
//    (sql/2026-10-09a_liaison_compte_fondateur.sql) ;
//  • l'adhérent qui rejoint avec le code sait ce qui va se passer ;
//  • le bureau qui confirme une demande est guidé et averti des doublons.
// Fichier sans composant (textes + fonctions pures), pour être partagé par
// LiaisonCompte.jsx, GestionAcces.jsx et App.jsx.
// =====================================================================

export const TXT_LIAISON = {
  fr: {
    // Bandeau (toutes rubriques)
    banner_bureau: "Votre compte n'est relié à aucune fiche adhérent : vous ne pouvez pas voter, siéger à un comité électoral ni apparaître comme membre.",
    banner_bureau_btn: "Relier mon compte à ma fiche",
    banner_adherent: "Votre compte n'est pas encore relié à votre fiche d'adhérent. Le bureau doit confirmer votre demande ; vous aurez ensuite accès à tout votre espace (cotisations, votes, etc.).",
    // Carte du fondateur (Gestion des accès)
    self_title: "Relier mon compte à ma fiche adhérent",
    self_intro: "En tant que membre du bureau (par exemple fondateur de l'association), vous n'êtes pas passé par une demande d'adhésion : reliez ici votre compte à VOTRE fiche. C'est indispensable pour voter, siéger à un comité électoral ou recevoir vos rappels de cotisation.",
    self_warning: "Choisissez bien votre propre fiche : la liaison ne se fait qu'une fois et elle est inscrite au Journal d'activité.",
    self_option_existing: "J'ai déjà une fiche dans la liste des adhérents",
    self_option_new: "Je n'ai pas encore de fiche : la créer maintenant",
    self_suggested: "Fiche(s) qui vous ressemblent",
    self_pick: "— Choisir ma fiche —",
    self_link_btn: "Relier mon compte à cette fiche",
    self_confirm: "Relier définitivement votre compte à la fiche « {nom} » ?",
    self_none_available: "Aucune fiche libre dans la liste des adhérents : créez la vôtre ci-dessous.",
    self_f_nom: "Nom complet (tel qu'il doit apparaître dans la liste des adhérents)",
    self_f_email: "Courriel",
    self_f_tel: "Téléphone",
    self_f_date: "Date d'adhésion",
    self_create_btn: "Créer ma fiche et relier mon compte",
    self_create_confirm: "Créer la fiche « {nom} » et y relier votre compte ?",
    self_missing_name: "Indiquez votre nom complet.",
    self_done: "Votre compte est relié à votre fiche. La page va se recharger.",
    self_linked_ok: "Votre compte est relié à la fiche « {nom} ».",
    // Formulaire de l'adhérent qui rejoint avec le code
    join_help_title: "Comment se passe votre adhésion",
    join_help_1: "Vous complétez cette fiche et joignez les documents demandés.",
    join_help_2: "Le bureau vérifie votre identité et votre paiement, puis relie votre compte à votre fiche d'adhérent. S'il vous a déjà inscrit, il retrouve votre fiche grâce à votre courriel : utilisez donc le courriel que vous avez donné à l'association.",
    join_help_3: "Dès que le bureau a confirmé, vous avez accès à tout votre espace : cotisations, événements, votes aux élections, etc. D'ici là, certaines rubriques restent limitées.",
    // Bureau qui traite les demandes (Gestion des accès)
    req_help_title: "Comment traiter une demande de rattachement",
    req_help_1: "Vérifiez la pièce d'identité et le paiement déclarés.",
    req_help_2: "Si la personne figure DÉJÀ dans la liste des adhérents, choisissez sa fiche dans le menu (ou cliquez sur « Utiliser » à côté d'une fiche proposée) : sinon une deuxième fiche serait créée en double.",
    req_help_3: "Si elle n'a pas encore de fiche, laissez le menu vide : « Confirmer » ouvre une fiche neuve préremplie à vérifier.",
    req_help_4: "Une fois confirmée, la personne est reliée à sa fiche : elle peut voter, payer ses cotisations, etc. Le lien s'affiche dans « Comptes » (Nom du compte → fiche).",
    req_similar: "Fiche(s) au nom proche, sans compte",
    req_use_btn: "Utiliser",
    req_dup_confirm: "Attention : {liste} existe déjà dans la liste des adhérents sans compte relié. Si c'est la même personne, annulez et choisissez cette fiche dans le menu. Créer quand même une NOUVELLE fiche ?",
  },
  en: {
    banner_bureau: "Your account is not linked to any member record: you cannot vote, sit on an election committee or appear as a member.",
    banner_bureau_btn: "Link my account to my record",
    banner_adherent: "Your account is not yet linked to your member record. The board must confirm your request; you will then have access to your whole space (dues, votes, etc.).",
    self_title: "Link my account to my member record",
    self_intro: "As a board member (for example the association's founder), you did not go through a membership request: link your account to YOUR record here. It is required to vote, sit on an election committee or receive dues reminders.",
    self_warning: "Make sure you pick your own record: linking happens only once and is recorded in the activity log.",
    self_option_existing: "I already have a record in the member list",
    self_option_new: "I don't have a record yet: create it now",
    self_suggested: "Record(s) that look like you",
    self_pick: "— Choose my record —",
    self_link_btn: "Link my account to this record",
    self_confirm: "Permanently link your account to the record \"{nom}\"?",
    self_none_available: "No free record in the member list: create yours below.",
    self_f_nom: "Full name (as it should appear in the member list)",
    self_f_email: "Email",
    self_f_tel: "Phone",
    self_f_date: "Membership date",
    self_create_btn: "Create my record and link my account",
    self_create_confirm: "Create the record \"{nom}\" and link your account to it?",
    self_missing_name: "Enter your full name.",
    self_done: "Your account is linked to your record. The page will reload.",
    self_linked_ok: "Your account is linked to the record \"{nom}\".",
    join_help_title: "How your membership works",
    join_help_1: "You complete this form and attach the requested documents.",
    join_help_2: "The board checks your identity and payment, then links your account to your member record. If they already registered you, they find your record through your email: so use the email you gave the association.",
    join_help_3: "As soon as the board confirms, you get access to your whole space: dues, events, election votes, etc. Until then, some sections remain limited.",
    req_help_title: "How to handle a link request",
    req_help_1: "Check the declared ID and payment.",
    req_help_2: "If the person is ALREADY in the member list, pick their record in the menu (or click \"Use\" next to a suggested record): otherwise a duplicate record would be created.",
    req_help_3: "If they have no record yet, leave the menu empty: \"Confirm\" opens a new pre-filled record to check.",
    req_help_4: "Once confirmed, the person is linked to their record: they can vote, pay dues, etc. The link shows under \"Accounts\" (account name → record).",
    req_similar: "Record(s) with a similar name, without an account",
    req_use_btn: "Use",
    req_dup_confirm: "Warning: {liste} already exists in the member list without a linked account. If it is the same person, cancel and pick that record in the menu. Create a NEW record anyway?",
  },
};

export function txtLiaison(lang) {
  return TXT_LIAISON[lang === "en" ? "en" : "fr"];
}

// Mots d'un nom, sans accents ni casse, pour comparer « Tsague Tsakeu
// Leonel » et « LEONEL LTT TSAGUE TSAKEU ».
function motsDuNom(nom) {
  return String(nom || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().split(/[^a-z0-9]+/).filter((m) => m.length >= 2);
}

// Fiches dont le nom partage au moins 2 mots avec `nom` (ou 1 seul si le
// nom n'en compte qu'un), triées de la plus proche à la moins proche.
export function fichesNomProche(nom, fiches) {
  const cible = new Set(motsDuNom(nom));
  if (cible.size === 0) return [];
  const seuil = cible.size === 1 ? 1 : 2;
  return fiches
    .map((f) => ({ f, n: motsDuNom(f.nom).filter((m) => cible.has(m)).length }))
    .filter((x) => x.n >= seuil)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.f);
}
