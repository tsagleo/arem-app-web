// =====================================================================
// AchatsGroupes.jsx — Achats groupés (coopérative d'achat entre membres)
// =====================================================================
// Demande de l'utilisateur (2026-10-09) : permettre aux membres d'acheter
// ensemble au prix de gros (produits, services, envoi groupé de colis ou
// de conteneur vers le pays, tarifé au kg ou au volume). Vocabulaire :
// COOPÉRATIVE D'ACHAT, jamais « mutuelle » (assurance réglementée).
// L'association organise, elle ne vend pas.
//
// Déroulement (voir sql/2026-10-09e_achats_groupes.sql pour les règles
// appliquées côté serveur) :
//   proposition → validation par le bureau → souscriptions (quantité,
//   charte acceptée, seuil minimum, date limite) → clôture (seuil atteint
//   ou annulation ; stock limité réparti premier arrivé / prorata /
//   tirage au sort vérifiable) → paiement de chaque part AVANT la
//   commande (Interac avec capture, espèces, ou avoir) → commande →
//   livraison et remise (scan du QR de la carte de membre) → bilan au
//   coût réel (écart remboursé ou converti en avoir, complément plafonné
//   à 10 % sauf accord).
// Double contrôle de l'argent : « reçu » par le porteur, « validé » par
// un AUTRE membre du bureau. Comptes comptables dédiés (1050 / 2100),
// jamais mélangés avec la caisse.
// Toute écriture passe par des fonctions RPC (security definer).
// =====================================================================
import { useState, useEffect, useCallback, useRef } from "react";
import {
  ShoppingBasket, Plus, X, ArrowLeft, Pencil, CheckCircle2, AlertTriangle, Ban, Wallet, QrCode, FileDown, Download,
  Truck, PackageCheck, ShieldCheck, Upload, Users, Dices, PiggyBank, Eye, Lock, Receipt, BarChart3,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { enTeteOfficiel, piedsDePageOfficiels, couleurAssociation } from "./pdfOfficiel";
import {
  Section, Container, Card, Btn, Field, Table, td, inputStyle, useLang, friendlyError, money,
  formatEventDateTime, toDatetimeLocal, datetimeLocalToISO, TEAL, TEAL_LIGHT, RED,
} from "./shared";

const MUTED = "#686F7D";
const AMBER = "#B7791F";
const AMBER_LIGHT = "#FDF3E1";

const TXT = {
  fr: {
    title: "Achats groupés",
    intro: "Coopérative d'achat entre membres : on achète ensemble au prix de gros, chacun paie sa part au coût réel. L'association organise l'achat, elle ne vend rien.",
    tab_achats: "Achats", tab_releve: "Mon relevé", tab_bilan: "Bilan annuel",
    propose_btn: "Proposer un achat",
    new_btn: "Nouvel achat groupé",
    back: "Retour à la liste",
    empty: "Aucun achat groupé pour le moment.",
    to_control: "Argent à contrôler ({n})",
    to_control_help: "Double contrôle : le porteur confirme « reçu », puis un AUTRE membre du bureau valide. Seuls les montants validés comptent.",
    // Formulaire
    f_title: "Produit ou service",
    f_title_ph: "Ex. riz parfumé 25 kg, envoi groupé de colis vers Douala…",
    f_desc: "Description",
    f_photo: "Photo",
    f_photo_change: "Changer la photo",
    f_supplier: "Fournisseur",
    f_unit: "Unité",
    u_piece: "pièce", u_kg: "kg", u_litre: "litre", u_m3: "m³", u_lot: "lot",
    unit_help: "Envoi groupé de colis ou de conteneur : choisissez le kg ou le m³.",
    f_price: "Prix unitaire de gros",
    f_retail: "Prix de détail (en magasin)",
    f_fees: "Frais estimés (livraison, transport — total)",
    f_threshold: "Seuil minimum (quantité totale)",
    f_stock: "Stock disponible (vide = illimité)",
    f_mode: "Si le stock ne suffit pas, répartition par",
    m_premier_arrive: "Premier arrivé", m_prorata: "Prorata des demandes", m_tirage: "Tirage au sort vérifiable",
    f_deadline: "Date limite des souscriptions",
    f_perishable: "Produit périssable",
    f_cold: "Chaîne du froid assurée",
    cold_required: "Charte : pas de produit périssable sans chaîne du froid.",
    f_carrier: "Porteur de l'achat (centralise l'argent et la commande)",
    f_carrier_none: "— Choisir —",
    submit_propose: "Envoyer la proposition",
    submit_create: "Ouvrir les souscriptions",
    submit_save: "Enregistrer",
    propose_note: "Votre proposition sera examinée par le bureau avant d'être ouverte aux membres.",
    required: "Renseignez le produit, le prix de gros, le seuil et la date limite.",
    // Fiche
    st_propose: "Proposé — en attente du bureau", st_refuse: "Refusé", st_ouvert: "Souscriptions ouvertes",
    st_confirme: "Confirmé — paiement des parts", st_commande: "Commandé", st_livre: "Arrivé — remise en cours",
    st_cloture: "Clôturé", st_annule: "Annulé",
    wholesale: "Prix de gros", retail: "Détail", saving: "Économie {pct} %",
    per: "par {u}",
    progress: "{total} / {seuil} {u} (seuil)",
    stock: "Stock : {n} {u}",
    subscribers: "{n} souscripteur(s)",
    deadline: "Date limite : {date}",
    supplier: "Fournisseur : {f}",
    carrier: "Porteur : {nom}",
    est_fees: "Frais estimés : {m}",
    proposed_by: "Proposé par {nom}",
    reason: "Motif : {m}",
    tirage_linked: "Tirage lié : {titre} ({statut})",
    // Souscription
    charte_title: "Charte des achats groupés",
    charte: [
      "L'association organise l'achat pour ses membres : elle ne vend rien et ne fait aucun bénéfice.",
      "Je paie ma part AVANT la commande. Personne n'avance l'argent des autres.",
      "Si le seuil minimum n'est pas atteint à la date limite, l'achat est annulé et je ne paie rien.",
      "Le coût réel (livraison comprise) est réparti au prorata des quantités : l'écart m'est remboursé ou converti en avoir. Un complément éventuel est plafonné à 10 % de ma part, sauf accord.",
      "Aucun produit périssable sans chaîne du froid.",
      "Je récupère ma commande en présentant ma carte de membre.",
    ],
    charte_accept: "J'ai lu et j'accepte la charte",
    charte_needed: "Vous devez accepter la charte.",
    qty: "Quantité ({u})",
    subscribe: "Souscrire",
    update_sub: "Modifier ma quantité",
    withdraw: "Me retirer",
    confirm_withdraw: "Vous retirer de cet achat ?",
    my_sub: "Ma souscription : {q} {u}",
    my_alloc: "Quantité attribuée : {q} {u}",
    not_retained: "Votre demande n'a pas pu être retenue (stock épuisé ou achat annulé). Vous n'avez rien à payer.",
    desiste: "Vous avez été retiré(e) de cet achat : {m}",
    // Ma part
    my_share: "Ma part",
    due: "Montant dû", due_est: "Part estimée", due_real: "Part au coût réel",
    paid: "Payé (validé)", pending: "En cours de vérification", balance: "Solde",
    to_pay: "Reste à payer : {m}",
    owed: "Trop-perçu : {m} — à rembourser ou à convertir en avoir",
    settled: "Réglé ✓",
    pay_interac: "J'ai payé par Interac",
    pay_modes: "Comment payer ma part", pay_when: "Le paiement s'ouvre à la clôture des souscriptions, si le seuil est atteint. Rien à payer avant : si l'achat est annulé, personne ne paie.",
    pay_est: "Part estimée à ce jour : {m}",
    pm_interac: "Virement Interac{dest} — puis cliquez sur « J'ai payé par Interac » et joignez la capture.",
    pm_cash: "Espèces ou virement remis au porteur{nom} — il enregistre le paiement, un autre membre du bureau le valide.",
    pm_credit: "Avoir : un trop-perçu d'un achat précédent peut servir à payer.",
    pay_interac_help: "Envoyez le virement Interac au trésorier, puis joignez la capture d'écran ici.",
    proof: "Capture du virement",
    reference: "Référence (facultatif)",
    amount: "Montant",
    send: "Envoyer",
    pay_credit: "Payer avec mon avoir ({m} disponible)",
    confirm_credit: "Utiliser {m} de votre avoir pour cet achat ?",
    to_credit: "Convertir en avoir",
    confirm_to_credit: "Convertir {m} en avoir pour un prochain achat ?",
    proof_needed: "Joignez la capture du virement.",
    sent_ok: "Paiement envoyé : il sera vérifié par le porteur puis validé par le bureau.",
    // Gestion
    manage: "Gestion de l'achat",
    approve: "Valider la proposition",
    refuse: "Refuser",
    refuse_prompt: "Motif du refus :",
    edit: "Modifier",
    close_subs: "Clôturer les souscriptions",
    confirm_close: "Clôturer les souscriptions ? Si le seuil n'est pas atteint, l'achat sera annulé et personne ne paiera.",
    closed_ok: "Seuil atteint : l'achat est confirmé, les membres peuvent payer leur part.",
    closed_ko: "Seuil non atteint : l'achat est annulé, personne ne paie.",
    stock_short: "Demandes : {d} {u} pour un stock de {s} {u}.",
    prepare_draw: "Préparer le tirage au sort",
    confirm_draw: "Préparer un tirage au sort entre les {n} souscripteurs ? Lancez-le ensuite en direct dans la rubrique « Tirages au sort ».",
    draw_ready: "Tirage préparé. Ouvrez la rubrique « Tirages au sort » pour le lancer en direct, puis revenez clôturer les souscriptions.",
    order: "Passer la commande",
    order_note: "Note de commande (n° de bon, date de livraison prévue…)",
    order_blocked: "{n} part(s) pas encore payée(s) et validée(s) : la commande ne peut pas être passée. Personne n'avance l'argent des autres.",
    confirm_order: "Toutes les parts sont payées et validées. Confirmer que la commande est passée auprès du fournisseur ?",
    delivered: "Marchandise arrivée",
    confirm_delivered: "Confirmer l'arrivée de la marchandise ? Les membres seront prévenus.",
    cancel: "Annuler l'achat",
    cancel_prompt: "Motif de l'annulation (visible par les membres) :",
    // Souscripteurs
    subs_title: "Souscripteurs",
    col_member: "Membre", col_asked: "Demandé", col_alloc: "Attribué", col_due: "Dû", col_paid: "Payé",
    col_balance: "Solde", col_status: "Statut", col_handover: "Remise", col_actions: "Actions",
    s_inscrit: "Inscrit", s_retire: "Retiré", s_retenu: "Retenu", s_non_retenu: "Non retenu", s_desiste: "Retiré (non-paiement)",
    cash_in: "Encaisser", refund: "Rembourser", remove: "Retirer",
    remove_prompt: "Motif du retrait (ex. part non payée à temps) :",
    hand_over: "Remettre",
    handed: "Remis le {date}",
    mvt_form_in: "Encaisser un paiement de {nom}",
    mvt_form_out: "Rembourser {nom}",
    mode: "Mode",
    mo_interac: "Interac", mo_especes: "Espèces", mo_virement: "Virement", mo_avoir: "Avoir", mo_stripe: "Carte (Stripe)", mo_aucun: "—",
    note: "Note",
    mvt_saved: "Enregistré comme « reçu ». Un AUTRE membre du bureau doit maintenant le valider.",
    // Mouvements
    mvts_title: "Mouvements d'argent",
    col_date: "Date", col_kind: "Type", col_mode: "Mode", col_amount: "Montant", col_received: "Reçu par", col_validated: "Validé par",
    k_entree: "Versement", k_sortie: "Remboursement", k_avoir: "Avoir",
    o_part: "part", o_complement: "complément", o_remboursement: "remboursement", o_avoir: "avoir", o_ristourne: "ristourne",
    ms_declare: "Déclaré", ms_recu: "Reçu", ms_valide: "Validé", ms_rejete: "Rejeté",
    see_proof: "Capture",
    confirm_receipt: "Confirmer reçu",
    validate: "Valider",
    reject: "Rejeter",
    reject_prompt: "Motif du rejet :",
    other_must_validate: "Un autre membre du bureau doit valider",
    no_mvts: "Aucun mouvement.",
    // Remise
    handover_title: "Remise aux membres",
    scan_start: "Scanner une carte de membre",
    scan_stop: "Arrêter le scan",
    scan_error: "Caméra indisponible : utilisez la liste ci-dessous.",
    scan_missing: "Module de scan indisponible : utilisez la liste ci-dessous.",
    handover_ok: "Reçu ✓ — {nom} : {q} {u}",
    handover_again: "Déjà remis le {date} à {nom}",
    unknown_card: "Carte inconnue dans cette association.",
    no_share: "Ce membre n'a pas de part dans cet achat.",
    handed_count: "{n} / {t} remis",
    // Bilan
    bilan_title: "Bilan au coût réel",
    bilan_cost: "Coût réel des produits (facture fournisseur)",
    bilan_fees: "Frais communs réels (livraison, douane, transport…)",
    bilan_note: "Note (n° de facture…)",
    bilan_save: "Enregistrer le bilan",
    bilan_saved: "Bilan enregistré. Un AUTRE membre du bureau doit maintenant le valider.",
    bilan_entered: "Saisi le {date} : produits {p} + frais {f} = {t}",
    bilan_preview: "Répartition au prorata des quantités",
    col_est: "Part estimée", col_real: "Part réelle", col_diff: "Écart",
    over_cap: "Le complément dépasse {cap} % de la part estimée pour au moins un membre ({max} %). Indiquez l'accord obtenu pour valider.",
    accord: "Accord obtenu (ex. AG du 12/11, accord écrit des membres…)",
    bilan_validate: "Valider le bilan (double contrôle)",
    confirm_bilan: "Valider ce bilan ? Les parts réelles seront fixées et la dépense enregistrée sur le compte dédié.",
    bilan_done: "Bilan validé le {date}.",
    // Exports
    export_pdf: "Fiche PDF", export_csv: "CSV",
    pdf_sheet: "Fiche d'achat groupé",
    pdf_releve: "Relevé — achats groupés",
    pdf_bilan: "Bilan annuel des achats groupés {y}",
    // Relevé
    releve_intro: "Toutes vos participations aux achats groupés, avec ce que vous avez payé et ce qui vous est dû.",
    credit_available: "Avoir disponible",
    total_paid: "Total payé",
    total_saving: "Économies réalisées",
    col_purchase: "Achat",
    releve_empty: "Vous n'avez participé à aucun achat groupé.",
    my_mvts: "Mes mouvements",
    // Bilan annuel
    year: "Année",
    y_purchases: "Achats clôturés",
    y_volume: "Montant total acheté",
    y_saving: "Économies pour les membres",
    y_members: "Membres participants",
    col_qty: "Quantité", col_cost: "Coût réel", col_retail_value: "Valeur au détail", col_saving: "Économie",
    per_member: "Par membre",
    col_purchases_total: "Achats de l'année",
    ristourne_title: "Ristourne annuelle",
    ristourne_help: "Une remise reçue (fournisseur, surplus…) est redistribuée en avoirs au prorata des achats réels de l'année.",
    ristourne_amount: "Montant à redistribuer",
    ristourne_btn: "Répartir en avoirs",
    confirm_ristourne: "Répartir {m} entre les membres au prorata de leurs achats {y} ?",
    ristourne_done: "{n} avoir(s) créé(s).",
    bilan_empty: "Aucun achat clôturé cette année.",
    accounts_note: "Comptabilité : compte dédié 1050 « Encaisse — Achats groupés » et 2100 « Fonds détenus pour les membres », jamais mélangés avec la caisse de l'association.",
    csv_head_sheet: ["Membre", "Statut", "Quantité demandée", "Quantité attribuée", "Montant dû", "Payé (validé)", "Solde", "Remis le"],
  },
  en: {
    title: "Group buying",
    intro: "A buying cooperative between members: buy together at wholesale price, everyone pays their share at actual cost. The association organizes the purchase; it does not sell anything.",
    tab_achats: "Purchases", tab_releve: "My statement", tab_bilan: "Annual report",
    propose_btn: "Suggest a purchase",
    new_btn: "New group purchase",
    back: "Back to the list",
    empty: "No group purchase yet.",
    to_control: "Money to check ({n})",
    to_control_help: "Two-person check: the carrier confirms “received”, then ANOTHER board member validates. Only validated amounts count.",
    f_title: "Product or service",
    f_title_ph: "E.g. 25 kg fragrant rice, group parcel shipment to Douala…",
    f_desc: "Description",
    f_photo: "Photo",
    f_photo_change: "Change photo",
    f_supplier: "Supplier",
    f_unit: "Unit",
    u_piece: "item", u_kg: "kg", u_litre: "litre", u_m3: "m³", u_lot: "lot",
    unit_help: "Group parcel or container shipment: choose kg or m³.",
    f_price: "Wholesale unit price",
    f_retail: "Retail price (in store)",
    f_fees: "Estimated fees (delivery, shipping — total)",
    f_threshold: "Minimum threshold (total quantity)",
    f_stock: "Available stock (empty = unlimited)",
    f_mode: "If stock runs short, allocate by",
    m_premier_arrive: "First come, first served", m_prorata: "Pro rata of requests", m_tirage: "Verifiable random draw",
    f_deadline: "Subscription deadline",
    f_perishable: "Perishable product",
    f_cold: "Cold chain guaranteed",
    cold_required: "Charter: no perishable product without a cold chain.",
    f_carrier: "Purchase carrier (collects the money and places the order)",
    f_carrier_none: "— Choose —",
    submit_propose: "Send the suggestion",
    submit_create: "Open subscriptions",
    submit_save: "Save",
    propose_note: "Your suggestion will be reviewed by the board before it is opened to members.",
    required: "Fill in the product, wholesale price, threshold and deadline.",
    st_propose: "Suggested — awaiting the board", st_refuse: "Declined", st_ouvert: "Open for subscriptions",
    st_confirme: "Confirmed — shares being paid", st_commande: "Ordered", st_livre: "Arrived — being handed out",
    st_cloture: "Closed", st_annule: "Cancelled",
    wholesale: "Wholesale", retail: "Retail", saving: "Save {pct}%",
    per: "per {u}",
    progress: "{total} / {seuil} {u} (threshold)",
    stock: "Stock: {n} {u}",
    subscribers: "{n} subscriber(s)",
    deadline: "Deadline: {date}",
    supplier: "Supplier: {f}",
    carrier: "Carrier: {nom}",
    est_fees: "Estimated fees: {m}",
    proposed_by: "Suggested by {nom}",
    reason: "Reason: {m}",
    tirage_linked: "Linked draw: {titre} ({statut})",
    charte_title: "Group buying charter",
    charte: [
      "The association organizes the purchase for its members: it sells nothing and makes no profit.",
      "I pay my share BEFORE the order is placed. Nobody advances money for others.",
      "If the minimum threshold is not reached by the deadline, the purchase is cancelled and I pay nothing.",
      "The actual cost (delivery included) is split pro rata of quantities: any difference is refunded or turned into a credit. Any top-up is capped at 10% of my share, unless agreed.",
      "No perishable product without a cold chain.",
      "I collect my order by showing my membership card.",
    ],
    charte_accept: "I have read and accept the charter",
    charte_needed: "You must accept the charter.",
    qty: "Quantity ({u})",
    subscribe: "Subscribe",
    update_sub: "Change my quantity",
    withdraw: "Withdraw",
    confirm_withdraw: "Withdraw from this purchase?",
    my_sub: "My subscription: {q} {u}",
    my_alloc: "Allocated quantity: {q} {u}",
    not_retained: "Your request could not be fulfilled (stock exhausted or purchase cancelled). You have nothing to pay.",
    desiste: "You were removed from this purchase: {m}",
    my_share: "My share",
    due: "Amount due", due_est: "Estimated share", due_real: "Share at actual cost",
    paid: "Paid (validated)", pending: "Being checked", balance: "Balance",
    to_pay: "Left to pay: {m}",
    owed: "Overpaid: {m} — to be refunded or turned into a credit",
    settled: "Settled ✓",
    pay_interac: "I paid by Interac",
    pay_modes: "How to pay my share", pay_when: "Payment opens when subscriptions close, if the threshold is reached. Nothing to pay before: if the purchase is cancelled, nobody pays.",
    pay_est: "Estimated share so far: {m}",
    pm_interac: "Interac transfer{dest} — then click \"I paid by Interac\" and attach the screenshot.",
    pm_cash: "Cash or transfer handed to the carrier{nom} — they record it, another board member validates it.",
    pm_credit: "Credit: an overpayment from a previous purchase can be used to pay.",
    pay_interac_help: "Send the Interac transfer to the treasurer, then attach the screenshot here.",
    proof: "Transfer screenshot",
    reference: "Reference (optional)",
    amount: "Amount",
    send: "Send",
    pay_credit: "Pay with my credit ({m} available)",
    confirm_credit: "Use {m} of your credit for this purchase?",
    to_credit: "Turn into credit",
    confirm_to_credit: "Turn {m} into a credit for a future purchase?",
    proof_needed: "Attach the transfer screenshot.",
    sent_ok: "Payment sent: it will be checked by the carrier, then validated by the board.",
    manage: "Purchase management",
    approve: "Approve the suggestion",
    refuse: "Decline",
    refuse_prompt: "Reason for declining:",
    edit: "Edit",
    close_subs: "Close subscriptions",
    confirm_close: "Close subscriptions? If the threshold is not reached, the purchase will be cancelled and nobody pays.",
    closed_ok: "Threshold reached: the purchase is confirmed, members can pay their share.",
    closed_ko: "Threshold not reached: the purchase is cancelled, nobody pays.",
    stock_short: "Requests: {d} {u} for a stock of {s} {u}.",
    prepare_draw: "Prepare the random draw",
    confirm_draw: "Prepare a random draw between the {n} subscribers? Then run it live in the “Random draws” section.",
    draw_ready: "Draw prepared. Open “Random draws” to run it live, then come back to close subscriptions.",
    order: "Place the order",
    order_note: "Order note (order no., expected delivery date…)",
    order_blocked: "{n} share(s) not yet paid and validated: the order cannot be placed. Nobody advances money for others.",
    confirm_order: "All shares are paid and validated. Confirm the order has been placed with the supplier?",
    delivered: "Goods arrived",
    confirm_delivered: "Confirm the goods have arrived? Members will be notified.",
    cancel: "Cancel the purchase",
    cancel_prompt: "Reason for cancelling (visible to members):",
    subs_title: "Subscribers",
    col_member: "Member", col_asked: "Requested", col_alloc: "Allocated", col_due: "Due", col_paid: "Paid",
    col_balance: "Balance", col_status: "Status", col_handover: "Handover", col_actions: "Actions",
    s_inscrit: "Subscribed", s_retire: "Withdrawn", s_retenu: "Allocated", s_non_retenu: "Not allocated", s_desiste: "Removed (unpaid)",
    cash_in: "Collect", refund: "Refund", remove: "Remove",
    remove_prompt: "Reason for removal (e.g. share not paid on time):",
    hand_over: "Hand over",
    handed: "Handed over {date}",
    mvt_form_in: "Collect a payment from {nom}",
    mvt_form_out: "Refund {nom}",
    mode: "Method",
    mo_interac: "Interac", mo_especes: "Cash", mo_virement: "Bank transfer", mo_avoir: "Credit", mo_stripe: "Card (Stripe)", mo_aucun: "—",
    note: "Note",
    mvt_saved: "Recorded as “received”. ANOTHER board member must now validate it.",
    mvts_title: "Money movements",
    col_date: "Date", col_kind: "Type", col_mode: "Method", col_amount: "Amount", col_received: "Received by", col_validated: "Validated by",
    k_entree: "Payment", k_sortie: "Refund", k_avoir: "Credit",
    o_part: "share", o_complement: "top-up", o_remboursement: "refund", o_avoir: "credit", o_ristourne: "rebate",
    ms_declare: "Declared", ms_recu: "Received", ms_valide: "Validated", ms_rejete: "Rejected",
    see_proof: "Screenshot",
    confirm_receipt: "Confirm received",
    validate: "Validate",
    reject: "Reject",
    reject_prompt: "Reason for rejecting:",
    other_must_validate: "Another board member must validate",
    no_mvts: "No movement.",
    handover_title: "Handover to members",
    scan_start: "Scan a membership card",
    scan_stop: "Stop scanning",
    scan_error: "Camera unavailable: use the list below.",
    scan_missing: "Scanner module unavailable: use the list below.",
    handover_ok: "Received ✓ — {nom}: {q} {u}",
    handover_again: "Already handed over {date} by {nom}",
    unknown_card: "Unknown card in this association.",
    no_share: "This member has no share in this purchase.",
    handed_count: "{n} / {t} handed over",
    bilan_title: "Actual cost report",
    bilan_cost: "Actual product cost (supplier invoice)",
    bilan_fees: "Actual shared fees (delivery, customs, shipping…)",
    bilan_note: "Note (invoice no.…)",
    bilan_save: "Save the report",
    bilan_saved: "Report saved. ANOTHER board member must now validate it.",
    bilan_entered: "Entered {date}: products {p} + fees {f} = {t}",
    bilan_preview: "Split pro rata of quantities",
    col_est: "Estimated share", col_real: "Actual share", col_diff: "Difference",
    over_cap: "The top-up exceeds {cap}% of the estimated share for at least one member ({max}%). Enter the agreement obtained to validate.",
    accord: "Agreement obtained (e.g. general meeting of 11/12, members' written consent…)",
    bilan_validate: "Validate the report (two-person check)",
    confirm_bilan: "Validate this report? Actual shares will be set and the expense recorded in the dedicated account.",
    bilan_done: "Report validated {date}.",
    export_pdf: "PDF sheet", export_csv: "CSV",
    pdf_sheet: "Group purchase sheet",
    pdf_releve: "Statement — group buying",
    pdf_bilan: "Group buying annual report {y}",
    releve_intro: "All your group purchases, with what you paid and what you are owed.",
    credit_available: "Available credit",
    total_paid: "Total paid",
    total_saving: "Savings achieved",
    col_purchase: "Purchase",
    releve_empty: "You have not taken part in any group purchase.",
    my_mvts: "My movements",
    year: "Year",
    y_purchases: "Closed purchases",
    y_volume: "Total purchased",
    y_saving: "Savings for members",
    y_members: "Participating members",
    col_qty: "Quantity", col_cost: "Actual cost", col_retail_value: "Retail value", col_saving: "Saving",
    per_member: "Per member",
    col_purchases_total: "Purchases this year",
    ristourne_title: "Annual rebate",
    ristourne_help: "A rebate received (supplier, surplus…) is redistributed as credits pro rata of each member's actual purchases this year.",
    ristourne_amount: "Amount to redistribute",
    ristourne_btn: "Split into credits",
    confirm_ristourne: "Split {m} between members pro rata of their {y} purchases?",
    ristourne_done: "{n} credit(s) created.",
    bilan_empty: "No closed purchase this year.",
    accounts_note: "Accounting: dedicated accounts 1050 “Cash — Group buying” and 2100 “Funds held for members”, never mixed with the association's own cash.",
    csv_head_sheet: ["Member", "Status", "Requested quantity", "Allocated quantity", "Amount due", "Paid (validated)", "Balance", "Handed over"],
  },
};

const STATUT_COULEUR = {
  propose: [AMBER, AMBER_LIGHT], refuse: [MUTED, "#EEF0F3"], ouvert: [TEAL, TEAL_LIGHT],
  confirme: ["#1F5FA8", "#E3EEFA"], commande: ["#1F5FA8", "#E3EEFA"], livre: ["#6B3FA0", "#F0E8FA"],
  cloture: [MUTED, "#EEF0F3"], annule: [RED, "#FBE4E1"],
};

// Les fonctions SQL lèvent des messages clairs en français (code P0001,
// « raise exception ») : on les affiche tels quels plutôt que derrière le
// message générique de friendlyError.
const errTxt = (e, t) => (e?.code === "P0001" && e.message ? e.message : friendlyError(e, t));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtQ = (n) => (Number(n) || 0).toLocaleString("fr-CA", { maximumFractionDigits: 3 });
const fill = (s, vars) => Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s);
const uniteDe = (L, a) => L[`u_${a.unite}`] || a.unite;

// ---------- Calculs (miroir des fonctions SQL achats_du / achats_solde) ----------
function duDe(s, a) {
  if (!s || s.statut !== "retenu" || !a || a.statut === "annule" || a.statut === "refuse") return 0;
  return Number(s.part_reelle ?? s.montant_du) || 0;
}

function comptesMembre(mouvements, achatId, memberId) {
  let paye = 0, attente = 0, sortiesAttente = 0;
  for (const m of mouvements) {
    if (m.achat_id !== achatId || m.member_id !== memberId) continue;
    const v = Number(m.montant) || 0;
    if (m.statut === "valide") paye += m.sens === "entree" ? v : -v;
    else if (m.statut === "declare" || m.statut === "recu") {
      if (m.sens === "entree") attente += v;
      else if (m.sens === "sortie") sortiesAttente += v;
    }
  }
  return { paye: r2(paye), attente: r2(attente), sortiesAttente: r2(sortiesAttente) };
}

function avoirDisponible(mouvements, memberId) {
  let n = 0;
  for (const m of mouvements) {
    if (m.member_id !== memberId || m.statut === "rejete") continue;
    if (m.sens === "avoir") n += Number(m.montant) || 0;
    else if (m.sens === "entree" && m.mode === "avoir") n -= Number(m.montant) || 0;
  }
  return r2(n);
}

function economiePct(a) {
  if (!a.prix_detail || Number(a.prix_detail) <= Number(a.prix_unitaire)) return null;
  return Math.round((1 - Number(a.prix_unitaire) / Number(a.prix_detail)) * 100);
}

// ---------- Exports ----------
function telechargerCSV(fichier, head, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [head, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url; lien.download = fichier;
  document.body.appendChild(lien); lien.click(); lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exporterPDF({ association, titre, sousTitre, lignes = [], tableaux = [], fichier }) {
  const [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const { jsPDF } = jsPDFmod;
  const autoTable = autoTableMod.default || autoTableMod;
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const x = 40;
  // Logo + mentions légales (pdfOfficiel.js) : demande de l'utilisateur
  // (2026-10-09), sur tous les documents générés, pour leur authenticité.
  let y = await enTeteOfficiel(doc, association, { titre, sousTitre, marge: x });
  doc.setFont(undefined, "normal"); doc.setFontSize(9.5);
  for (const l of lignes) {
    const morceaux = doc.splitTextToSize(l, 710);
    doc.text(morceaux, x, y); y += morceaux.length * 12;
  }
  for (const tb of tableaux) {
    y += 8;
    if (tb.titre) { doc.setFont(undefined, "bold"); doc.setFontSize(10.5); doc.text(tb.titre, x, y); doc.setFont(undefined, "normal"); y += 6; }
    autoTable(doc, { startY: y, head: [tb.head], body: tb.body, styles: { fontSize: 8.5 }, headStyles: { fillColor: couleurAssociation(association) }, margin: { left: x, right: x } });
    y = (doc.lastAutoTable?.finalY || y) + 14;
  }
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text(new Date().toLocaleString("fr-CA"), x, doc.internal.pageSize.getHeight() - 20);
  piedsDePageOfficiels(doc, association, { marge: x, texte: titre, libellePage: (p, n) => `${p} / ${n}` });
  doc.save(fichier);
}

const nomFichier = (s) => (s || "achat").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40);

// ---------- Scanner QR (même principe que Presences.jsx) ----------
function extractToken(decodedText) {
  try {
    const url = new URL(decodedText);
    const token = url.searchParams.get("verify");
    if (token) return token;
  } catch { /* pas une URL complète */ }
  const m = /verify=([0-9a-fA-F-]{36})/.exec(decodedText || "");
  if (m) return m[1];
  if (/^[0-9a-fA-F-]{36}$/.test((decodedText || "").trim())) return decodedText.trim();
  return null;
}

function QrScanner({ active, onDecode, L }) {
  const onDecodeRef = useRef(onDecode);
  const lastRef = useRef({ token: null, time: 0 });
  const [error, setError] = useState(null);
  useEffect(() => { onDecodeRef.current = onDecode; }, [onDecode]);
  useEffect(() => {
    if (!active) return;
    let scanner;
    let cancelled = false;
    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (cancelled) return;
      scanner = new Html5Qrcode("achats-qr-reader");
      scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 240 }, (text) => {
        const token = extractToken(text);
        if (!token) return;
        const now = Date.now();
        if (lastRef.current.token === token && now - lastRef.current.time < 8000) return;
        lastRef.current = { token, time: now };
        onDecodeRef.current?.(token);
      }, () => {}).catch(() => { if (!cancelled) setError(L.scan_error); });
    }).catch(() => { if (!cancelled) setError(L.scan_missing); });
    return () => {
      cancelled = true;
      if (scanner) scanner.stop().then(() => scanner.clear()).catch(() => {});
    };
  }, [active, L]);
  if (!active) return null;
  return error ? <div style={{ color: RED, fontSize: 13.5, marginTop: 10 }}>{error}</div>
    : <div id="achats-qr-reader" style={{ maxWidth: 340, margin: "12px auto 0", borderRadius: 12, overflow: "hidden" }} />;
}

// ---------- Petits composants ----------
function StatutPill({ L, statut }) {
  const [c, bg] = STATUT_COULEUR[statut] || [MUTED, "#EEF0F3"];
  return <span style={{ display: "inline-block", background: bg, color: c, fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999 }}>{L[`st_${statut}`] || statut}</span>;
}

function Progression({ L, a }) {
  const u = uniteDe(L, a);
  const total = Number(a.statut === "ouvert" || a.statut === "propose" ? a.total_demande : (a.total_attribue || a.total_demande)) || 0;
  const seuil = Number(a.seuil_min) || 1;
  const pct = Math.min(100, Math.round((total / seuil) * 100));
  const atteint = total >= seuil;
  return (
    <div style={{ margin: "10px 0" }}>
      <div style={{ height: 10, background: "#EEF0F3", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: atteint ? TEAL : AMBER, transition: "width .4s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, fontSize: 12, color: MUTED, marginTop: 4 }}>
        <span>{fill(L.progress, { total: fmtQ(total), seuil: fmtQ(seuil), u })} {atteint && "✓"}</span>
        <span>{fill(L.subscribers, { n: a.nb_souscripteurs || 0 })}{a.stock_max ? ` · ${fill(L.stock, { n: fmtQ(a.stock_max), u })}` : ""}</span>
      </div>
    </div>
  );
}

function Prix({ L, a, devise }) {
  const eco = economiePct(a);
  const u = uniteDe(L, a);
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontWeight: 800, fontSize: 18, color: "var(--primary)" }}>{money(a.prix_unitaire, devise)}</span>
      <span style={{ fontSize: 12, color: MUTED }}>{fill(L.per, { u })}</span>
      {a.prix_detail && <span style={{ fontSize: 12.5, color: MUTED, textDecoration: "line-through" }}>{L.retail} {money(a.prix_detail, devise)}</span>}
      {eco !== null && <span style={{ background: TEAL_LIGHT, color: TEAL, fontWeight: 700, fontSize: 12, padding: "2px 8px", borderRadius: 999 }}>{fill(L.saving, { pct: eco })}</span>}
    </div>
  );
}

function Message({ msg }) {
  if (!msg) return null;
  const ok = msg.tone !== "warn";
  return <div style={{ background: ok ? TEAL_LIGHT : "#FBE4E1", color: ok ? TEAL : RED, borderRadius: 10, padding: "9px 12px", fontSize: 13.5, margin: "10px 0" }}>{msg.text}</div>;
}

const ligneBtns = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" };
const petitBtn = { padding: "5px 11px", fontSize: 12 };

// ---------- Formulaire de proposition / modification ----------
function AchatForm({ L, t, isBureau, members, initial, profile, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    titre: initial?.titre || "", description: initial?.description || "", photo_url: initial?.photo_url || "",
    fournisseur: initial?.fournisseur || "", unite: initial?.unite || "piece",
    prix_unitaire: initial?.prix_unitaire ?? "", prix_detail: initial?.prix_detail ?? "", frais_estimes: initial?.frais_estimes ?? "",
    seuil_min: initial?.seuil_min ?? "", stock_max: initial?.stock_max ?? "", mode_repartition: initial?.mode_repartition || "premier_arrive",
    date_limite: initial?.date_limite ? toDatetimeLocal(initial.date_limite) : "",
    perissable: !!initial?.perissable, chaine_froid: !!initial?.chaine_froid,
    porteur_member_id: initial?.porteur_member_id || "",
  }));
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function enregistrer() {
    setErr(null);
    if (!f.titre.trim() || !Number(f.prix_unitaire) || !Number(f.seuil_min) || !f.date_limite) { setErr(L.required); return; }
    if (f.perissable && !f.chaine_froid) { setErr(L.cold_required); return; }
    setBusy(true);
    let photoUrl = f.photo_url;
    if (photo) {
      const path = `${profile.association_id}/${Date.now()}_${photo.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("achats-photos").upload(path, photo);
      if (upErr) { setBusy(false); setErr(errTxt(upErr, t)); return; }
      photoUrl = supabase.storage.from("achats-photos").getPublicUrl(path).data.publicUrl;
    }
    const p = { ...f, photo_url: photoUrl, date_limite: datetimeLocalToISO(f.date_limite) };
    const { error } = initial
      ? await supabase.rpc("achats_modifier", { p_id: initial.id, p })
      : await supabase.rpc("achats_proposer", { p });
    setBusy(false);
    if (error) { setErr(errTxt(error, t)); return; }
    onSaved();
  }

  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 14px" };
  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 17 }}>{initial ? L.edit : isBureau ? L.new_btn : L.propose_btn}</h3>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }} aria-label="Fermer"><X size={18} /></button>
      </div>
      {!isBureau && !initial && <p style={{ fontSize: 13, color: MUTED, marginTop: 0 }}>{L.propose_note}</p>}
      <Field label={L.f_title}><input style={inputStyle} value={f.titre} onChange={set("titre")} placeholder={L.f_title_ph} maxLength={140} /></Field>
      <Field label={L.f_desc}><textarea style={{ ...inputStyle, minHeight: 64 }} value={f.description} onChange={set("description")} /></Field>
      <div style={grid}>
        <Field label={L.f_supplier}><input style={inputStyle} value={f.fournisseur} onChange={set("fournisseur")} /></Field>
        <Field label={L.f_unit}>
          <select style={inputStyle} value={f.unite} onChange={set("unite")}>
            {["piece", "kg", "litre", "m3", "lot"].map((u) => <option key={u} value={u}>{L[`u_${u}`]}</option>)}
          </select>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>{L.unit_help}</div>
        </Field>
        <Field label={L.f_photo}>
          {f.photo_url && !photo && <img src={f.photo_url} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, display: "block", marginBottom: 6 }} />}
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
        </Field>
        <Field label={L.f_price}><input type="number" min="0" step="0.01" style={inputStyle} value={f.prix_unitaire} onChange={set("prix_unitaire")} /></Field>
        <Field label={L.f_retail}><input type="number" min="0" step="0.01" style={inputStyle} value={f.prix_detail} onChange={set("prix_detail")} /></Field>
        <Field label={L.f_fees}><input type="number" min="0" step="0.01" style={inputStyle} value={f.frais_estimes} onChange={set("frais_estimes")} /></Field>
        <Field label={L.f_threshold}><input type="number" min="0" step="any" style={inputStyle} value={f.seuil_min} onChange={set("seuil_min")} /></Field>
        <Field label={L.f_stock}><input type="number" min="0" step="any" style={inputStyle} value={f.stock_max} onChange={set("stock_max")} /></Field>
        <Field label={L.f_mode}>
          <select style={inputStyle} value={f.mode_repartition} onChange={set("mode_repartition")}>
            {["premier_arrive", "prorata", "tirage"].map((m) => <option key={m} value={m}>{L[`m_${m}`]}</option>)}
          </select>
        </Field>
        <Field label={L.f_deadline}><input type="datetime-local" style={inputStyle} value={f.date_limite} onChange={set("date_limite")} /></Field>
        {isBureau && (
          <Field label={L.f_carrier}>
            <select style={inputStyle} value={f.porteur_member_id} onChange={set("porteur_member_id")}>
              <option value="">{L.f_carrier_none}</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13.5, marginBottom: 12 }}>
        <label><input type="checkbox" checked={f.perissable} onChange={set("perissable")} /> {L.f_perishable}</label>
        {f.perissable && <label><input type="checkbox" checked={f.chaine_froid} onChange={set("chaine_froid")} /> {L.f_cold}</label>}
      </div>
      {f.perissable && !f.chaine_froid && <Message msg={{ tone: "warn", text: L.cold_required }} />}
      {err && <Message msg={{ tone: "warn", text: err }} />}
      <Btn onClick={enregistrer} disabled={busy}>{initial ? L.submit_save : isBureau ? L.submit_create : L.submit_propose}</Btn>
    </Card>
  );
}

// ---------- Carte d'un achat dans la liste ----------
function AchatCarte({ L, a, devise, lang, onOpen, maSous }) {
  return (
    <Card style={{ cursor: "pointer", display: "flex", gap: 14, padding: 16 }}>
      <div onClick={onOpen} style={{ display: "flex", gap: 14, width: "100%", minWidth: 0 }}>
        {a.photo_url
          ? <img src={a.photo_url} alt="" style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />
          : <div style={{ width: 84, height: 84, borderRadius: 10, background: TEAL_LIGHT, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ShoppingBasket size={30} color={TEAL} /></div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 15.5 }}>{a.titre}</strong>
            <StatutPill L={L} statut={a.statut} />
          </div>
          <Prix L={L} a={a} devise={devise} />
          {["ouvert", "confirme", "commande", "propose"].includes(a.statut) && <Progression L={L} a={a} />}
          <div style={{ fontSize: 12, color: MUTED }}>
            {a.statut === "ouvert" && fill(L.deadline, { date: formatEventDateTime(a.date_limite, lang) })}
            {maSous && maSous.statut !== "retire" && <span style={{ marginLeft: 8, color: TEAL, fontWeight: 700 }}>· {fill(L.my_sub, { q: fmtQ(maSous.quantite_demandee), u: uniteDe(L, a) })}</span>}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------- Table des mouvements (avec actions de contrôle) ----------
function TableMouvements({ L, t, lang, mouvements, devise, achatsParId, profile, isBureau, peutGerer, onAction, montrerAchat }) {
  async function voirPreuve(m) {
    const { data, error } = await supabase.storage.from("interac-proofs").createSignedUrl(m.preuve_path, 120);
    if (error) { alert(errTxt(error, t)); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }
  if (mouvements.length === 0) return <p style={{ color: MUTED, fontStyle: "italic", fontSize: 13 }}>{L.no_mvts}</p>;
  const head = [L.col_date, ...(montrerAchat ? [L.col_purchase] : []), L.col_member, L.col_kind, L.col_mode, L.col_amount, L.col_status, L.col_received, L.col_validated, L.col_actions];
  return (
    <Table head={head} minWidth={900}>
      {mouvements.map((m) => {
        const a = achatsParId[m.achat_id];
        const gerer = peutGerer(a);
        return (
          <tr key={m.id}>
            <td style={td}>{new Date(m.declare_le || m.created_at).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA")}</td>
            {montrerAchat && <td style={td}>{a?.titre || "—"}</td>}
            <td style={td}>{m.member_nom}</td>
            <td style={td}>{L[`k_${m.sens}`]} <span style={{ color: MUTED }}>({L[`o_${m.objet}`]})</span></td>
            <td style={td}>{L[`mo_${m.mode}`] || m.mode}{m.reference ? ` · ${m.reference}` : ""}</td>
            <td style={{ ...td, fontWeight: 700, color: m.sens === "entree" ? TEAL : m.sens === "sortie" ? RED : "inherit" }}>{money(m.montant, devise)}</td>
            <td style={td}>{L[`ms_${m.statut}`]}{m.motif_rejet ? ` — ${m.motif_rejet}` : ""}</td>
            <td style={td}>{m.recu_par_nom || "—"}</td>
            <td style={td}>{m.valide_par_nom || "—"}</td>
            <td style={td}>
              <div style={ligneBtns}>
                {m.preuve_path && (isBureau || gerer) && <Btn variant="outline" style={petitBtn} onClick={() => voirPreuve(m)}><Eye size={12} /> {L.see_proof}</Btn>}
                {m.statut === "declare" && gerer && <Btn style={petitBtn} onClick={() => onAction("achats_confirmer_reception", { p_mvt: m.id })}>{L.confirm_receipt}</Btn>}
                {m.statut === "recu" && isBureau && (m.recu_par === profile.id
                  ? <span style={{ fontSize: 11.5, color: AMBER }}><Lock size={11} /> {L.other_must_validate}</span>
                  : <Btn style={petitBtn} onClick={() => onAction("achats_valider_mouvement", { p_mvt: m.id })}><ShieldCheck size={12} /> {L.validate}</Btn>)}
                {(m.statut === "declare" || m.statut === "recu") && gerer && (
                  <Btn variant="outline" style={petitBtn} onClick={() => {
                    const motif = window.prompt(L.reject_prompt);
                    if (motif && motif.trim()) onAction("achats_rejeter_mouvement", { p_mvt: m.id, p_motif: motif.trim() });
                  }}>{L.reject}</Btn>
                )}
              </div>
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

// ---------- Bloc « Ma part » d'un membre ----------
// 2026-10-10 (signalé par l'utilisateur : « il n'y a pas de mode de paiement
// chez l'adhérent simple ») : les modes acceptés sont affichés à chaque étape.
function ModesPaiement({ L, a, association, avoir, devise }) {
  const dest = association?.interac_email ? ` (${association.interac_email})` : "";
  return (
    <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
      <li>{fill(L.pm_interac, { dest })}</li>
      <li>{fill(L.pm_cash, { nom: a.porteur_nom ? ` (${a.porteur_nom})` : "" })}</li>
      <li>{L.pm_credit}{avoir > 0 ? ` — ${money(avoir, devise)}` : ""}</li>
    </ul>
  );
}

function MaPart({ L, t, a, s, mouvements, devise, profile, association, onAction, onReload }) {
  const [showInterac, setShowInterac] = useState(false);
  const [montant, setMontant] = useState("");
  const [fichier, setFichier] = useState(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const du = duDe(s, a);
  const { paye, attente, sortiesAttente } = comptesMembre(mouvements, a.id, s.member_id);
  const solde = r2(paye - du);
  const avoir = avoirDisponible(mouvements, s.member_id);
  const peutPayer = s.statut === "retenu" && ["confirme", "commande", "livre", "cloture"].includes(a.statut) && solde + attente < 0;
  const reste = r2(-(solde + attente));
  const tropPercu = r2(solde - sortiesAttente);
  const peutConvertir = tropPercu > 0 && (["cloture", "annule"].includes(a.statut) || ["desiste", "non_retenu"].includes(s.statut));

  async function envoyerInterac() {
    setMsg(null);
    if (!fichier) { setMsg({ tone: "warn", text: L.proof_needed }); return; }
    setBusy(true);
    const path = `${profile.association_id}/${s.member_id}/achat_${Date.now()}_${fichier.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("interac-proofs").upload(path, fichier);
    if (upErr) { setBusy(false); setMsg({ tone: "warn", text: errTxt(upErr, t) }); return; }
    const { error } = await supabase.rpc("achats_declarer_paiement", {
      p_achat: a.id, p_montant: Number(montant) || reste, p_mode: "interac", p_preuve_path: path, p_reference: reference || null,
    });
    setBusy(false);
    if (error) { setMsg({ tone: "warn", text: errTxt(error, t) }); return; }
    setShowInterac(false); setFichier(null); setReference(""); setMontant("");
    setMsg({ text: L.sent_ok });
    onReload();
  }

  return (
    <Card style={{ marginBottom: 16, borderTopColor: TEAL }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}><Wallet size={17} /> {L.my_share}</h3>
      {s.statut === "non_retenu" && <p style={{ fontSize: 13.5 }}>{L.not_retained}</p>}
      {s.statut === "desiste" && <p style={{ fontSize: 13.5, color: RED }}>{fill(L.desiste, { m: s.motif || "" })}</p>}
      {s.statut === "retenu" && <p style={{ fontSize: 13.5, margin: "0 0 8px" }}>{fill(L.my_alloc, { q: fmtQ(s.quantite_attribuee), u: uniteDe(L, a) })}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, fontSize: 13.5 }}>
        <div><div style={{ color: MUTED, fontSize: 12 }}>{s.part_reelle != null ? L.due_real : L.due_est}</div><b>{money(du, devise)}</b></div>
        <div><div style={{ color: MUTED, fontSize: 12 }}>{L.paid}</div><b>{money(paye, devise)}</b></div>
        {attente > 0 && <div><div style={{ color: MUTED, fontSize: 12 }}>{L.pending}</div><b style={{ color: AMBER }}>{money(attente, devise)}</b></div>}
        <div><div style={{ color: MUTED, fontSize: 12 }}>{L.balance}</div>
          <b style={{ color: solde < 0 ? RED : TEAL }}>{solde < 0 ? fill(L.to_pay, { m: money(-solde, devise) }) : solde > 0 ? fill(L.owed, { m: money(solde, devise) }) : L.settled}</b>
        </div>
      </div>
      <Message msg={msg} />
      {peutPayer && (
        <div style={{ marginTop: 12, padding: 12, background: "#F4F8F6", borderRadius: 10 }}>
          <b style={{ fontSize: 13.5 }}>{L.pay_modes}</b>
          <ModesPaiement L={L} a={a} association={association} avoir={avoir} devise={devise} />
        </div>
      )}
      {peutPayer && (
        <div style={{ ...ligneBtns, marginTop: 12 }}>
          <Btn onClick={() => { setShowInterac((v) => !v); setMontant(String(reste)); }}><Upload size={14} /> {L.pay_interac}</Btn>
          {avoir > 0 && (
            <Btn variant="outline" onClick={() => {
              const m = Math.min(avoir, reste);
              onAction("achats_declarer_paiement", { p_achat: a.id, p_montant: m, p_mode: "avoir", p_preuve_path: null, p_reference: null }, fill(L.confirm_credit, { m: money(m, devise) }));
            }}><PiggyBank size={14} /> {fill(L.pay_credit, { m: money(avoir, devise) })}</Btn>
          )}
        </div>
      )}
      {showInterac && peutPayer && (
        <div style={{ marginTop: 12, padding: 12, background: "#F7F8FA", borderRadius: 10 }}>
          <p style={{ fontSize: 12.5, color: MUTED, marginTop: 0 }}>{L.pay_interac_help}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0 12px" }}>
            <Field label={L.amount}><input type="number" min="0" step="0.01" style={inputStyle} value={montant} onChange={(e) => setMontant(e.target.value)} /></Field>
            <Field label={L.reference}><input style={inputStyle} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            <Field label={L.proof}><input type="file" accept="image/*,application/pdf" onChange={(e) => setFichier(e.target.files?.[0] || null)} /></Field>
          </div>
          <Btn onClick={envoyerInterac} disabled={busy}>{L.send}</Btn>
        </div>
      )}
      {peutConvertir && (
        <div style={{ marginTop: 12 }}>
          <Btn variant="outline" onClick={() => onAction("achats_convertir_avoir", { p_achat: a.id, p_member: s.member_id, p_montant: tropPercu }, fill(L.confirm_to_credit, { m: money(tropPercu, devise) }))}>
            <PiggyBank size={14} /> {L.to_credit} ({money(tropPercu, devise)})
          </Btn>
        </div>
      )}
    </Card>
  );
}

// ---------- Fiche détaillée d'un achat ----------
function AchatFiche({ L, t, lang, a, sous, mouvements, devise, profile, isBureau, members, tirage, association, onBack, onReload }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [edition, setEdition] = useState(false);
  const [qte, setQte] = useState("");
  const [charte, setCharte] = useState(false);
  const [mvtForm, setMvtForm] = useState(null);
  const [scan, setScan] = useState(false);
  const [remise, setRemise] = useState(null);
  const [noteCommande, setNoteCommande] = useState("");
  const [bilan, setBilan] = useState({ cout: a.cout_reel_produits ?? "", frais: a.frais_communs_reels ?? "", note: a.note_bilan || "" });
  const [accord, setAccord] = useState("");

  const u = uniteDe(L, a);
  const myMemberId = profile.member_id;
  const gestionnaire = isBureau || (!!myMemberId && a.porteur_member_id === myMemberId);
  const maSous = sous.find((s) => s.member_id === myMemberId);
  const sousActives = sous.filter((s) => s.statut !== "retire");
  const retenus = sous.filter((s) => s.statut === "retenu");
  const mvtsAchat = mouvements.filter((m) => m.achat_id === a.id);
  const ouvert = a.statut === "ouvert" && new Date(a.date_limite) > new Date();

  async function action(fn, args, confirmMsg, okMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return null;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setMsg({ tone: "warn", text: errTxt(error, t) }); return null; }
    if (okMsg) setMsg({ text: typeof okMsg === "function" ? okMsg(data) : okMsg });
    onReload();
    return data ?? true;
  }

  async function souscrire() {
    if (!charte) { setMsg({ tone: "warn", text: L.charte_needed }); return; }
    const q = Number(qte || maSous?.quantite_demandee);
    const ok = await action("achats_souscrire", { p_id: a.id, p_quantite: q, p_charte: true });
    if (ok) { setCharte(false); setQte(""); }
  }

  async function preparerTirage() {
    const ids = sous.filter((s) => s.statut === "inscrit").map((s) => s.member_id);
    if (!window.confirm(fill(L.confirm_draw, { n: ids.length }))) return;
    setBusy(true); setMsg(null);
    const { data: id, error } = await supabase.rpc("preparer_tirage", {
      p_titre: `${L.title} — ${a.titre}`, p_type: "libre", p_member_ids: ids, p_nb_gagnants: ids.length,
    });
    if (!error) {
      const { error: e2 } = await supabase.rpc("achats_lier_tirage", { p_id: a.id, p_tirage: id });
      setBusy(false);
      if (e2) { setMsg({ tone: "warn", text: errTxt(e2, t) }); return; }
      setMsg({ text: L.draw_ready });
      onReload();
      return;
    }
    setBusy(false);
    setMsg({ tone: "warn", text: errTxt(error, t) });
  }

  async function remettre(args) {
    const res = await action("achats_remettre", { p_id: a.id, p_token: null, p_sous: null, ...args });
    if (!res) return;
    if (!res.ok) setRemise({ tone: "warn", text: res.raison === "carte_inconnue" ? L.unknown_card : L.no_share });
    // Même carte relue juste après la remise (le membre garde son QR devant la
    // caméra) : on garde la confirmation au lieu d'afficher « Déjà remis ».
    else if (res.deja_remis && Date.now() - new Date(res.remis_le).getTime() < 120000) setRemise({ text: fill(L.handover_ok, { nom: res.member_nom, q: fmtQ(res.quantite), u }) });
    else if (res.deja_remis) setRemise({ tone: "warn", text: `${res.member_nom} — ${fill(L.handover_again, { date: formatEventDateTime(res.remis_le, lang), nom: res.remis_par_nom || "" })}` });
    else setRemise({ text: fill(L.handover_ok, { nom: res.member_nom, q: fmtQ(res.quantite), u }) });
  }

  // Aperçu du bilan (même calcul que achats_valider_bilan)
  const totalReel = r2((Number(a.cout_reel_produits) || 0) + (Number(a.frais_communs_reels) || 0));
  const apercu = retenus.map((s) => {
    const part = a.total_attribue > 0 ? r2(totalReel * Number(s.quantite_attribuee) / Number(a.total_attribue)) : 0;
    const est = Number(s.montant_du) || 0;
    return { s, part, est, pct: est > 0 ? ((part - est) / est) * 100 : 0 };
  });
  const maxPct = apercu.reduce((mx, x) => Math.max(mx, x.pct), 0);
  const depasse = maxPct > Number(a.plafond_complement_pct || 10);

  const ligneSous = (s) => {
    const c = comptesMembre(mouvements, a.id, s.member_id);
    const du = duDe(s, a);
    return { du, ...c, solde: r2(c.paye - du) };
  };
  const impayes = retenus.filter((s) => ligneSous(s).solde < 0).length;

  function exporterFiche(format) {
    const rows = sousActives.map((s) => {
      const l = ligneSous(s);
      return [s.member_nom, L[`s_${s.statut}`], fmtQ(s.quantite_demandee), fmtQ(s.quantite_attribuee), l.du.toFixed(2), l.paye.toFixed(2), l.solde.toFixed(2),
        s.remis_le ? new Date(s.remis_le).toLocaleString("fr-CA") : ""];
    });
    if (format === "csv") { telechargerCSV(`achat_${nomFichier(a.titre)}.csv`, L.csv_head_sheet, rows); return; }
    exporterPDF({
      association, titre: L.pdf_sheet, sousTitre: a.titre, fichier: `achat_${nomFichier(a.titre)}.pdf`,
      lignes: [
        `${L[`st_${a.statut}`]} · ${L.wholesale} ${money(a.prix_unitaire, devise)} / ${u}${a.prix_detail ? ` · ${L.retail} ${money(a.prix_detail, devise)}` : ""}`,
        [a.fournisseur && fill(L.supplier, { f: a.fournisseur }), a.porteur_nom && fill(L.carrier, { nom: a.porteur_nom }), fill(L.deadline, { date: formatEventDateTime(a.date_limite, lang) })].filter(Boolean).join(" · "),
        fill(L.progress, { total: fmtQ(a.total_attribue || a.total_demande), seuil: fmtQ(a.seuil_min), u }),
        a.bilan_valide_le ? fill(L.bilan_entered, { date: formatEventDateTime(a.bilan_saisi_le, lang), p: money(a.cout_reel_produits, devise), f: money(a.frais_communs_reels, devise), t: money(totalReel, devise) }) : "",
        L.accounts_note,
      ].filter(Boolean),
      tableaux: [
        { titre: L.subs_title, head: L.csv_head_sheet, body: rows },
        { titre: L.mvts_title, head: [L.col_date, L.col_member, L.col_kind, L.col_mode, L.col_amount, L.col_status, L.col_received, L.col_validated],
          body: mvtsAchat.map((m) => [new Date(m.declare_le).toLocaleDateString("fr-CA"), m.member_nom, `${L[`k_${m.sens}`]} (${L[`o_${m.objet}`]})`, L[`mo_${m.mode}`], Number(m.montant).toFixed(2), L[`ms_${m.statut}`], m.recu_par_nom || "", m.valide_par_nom || ""]) },
      ],
    }).catch((e) => alert(errTxt(e, t)));
  }

  if (edition) {
    return <AchatForm L={L} t={t} isBureau={isBureau} members={members} initial={a} profile={profile} onClose={() => setEdition(false)} onSaved={() => { setEdition(false); onReload(); }} />;
  }

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 600, marginBottom: 12, padding: 0 }}>
        <ArrowLeft size={16} /> {L.back}
      </button>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {a.photo_url && <img src={a.photo_url} alt="" style={{ width: 160, height: 160, objectFit: "cover", borderRadius: 12 }} />}
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <h2 style={{ margin: "0 0 6px", fontSize: 20 }}>{a.titre}</h2>
              <StatutPill L={L} statut={a.statut} />
            </div>
            <Prix L={L} a={a} devise={devise} />
            {a.description && <p style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{a.description}</p>}
            {["ouvert", "confirme", "commande", "propose"].includes(a.statut) && <Progression L={L} a={a} />}
            <div style={{ fontSize: 12.5, color: MUTED, display: "flex", flexDirection: "column", gap: 2 }}>
              <span>{fill(L.deadline, { date: formatEventDateTime(a.date_limite, lang) })}</span>
              {a.fournisseur && <span>{fill(L.supplier, { f: a.fournisseur })}</span>}
              {a.porteur_nom && <span>{fill(L.carrier, { nom: a.porteur_nom })}</span>}
              {Number(a.frais_estimes) > 0 && <span>{fill(L.est_fees, { m: money(a.frais_estimes, devise) })}</span>}
              {a.stock_max && <span>{fill(L.stock, { n: fmtQ(a.stock_max), u })} · {L[`m_${a.mode_repartition}`]}</span>}
              {a.propose_par_nom && <span>{fill(L.proposed_by, { nom: a.propose_par_nom })}</span>}
              {tirage && <span>{fill(L.tirage_linked, { titre: tirage.titre, statut: tirage.statut })}</span>}
              {a.motif && <span style={{ color: RED }}>{fill(L.reason, { m: a.motif })}</span>}
              {a.perissable && <span>❄ {L.f_cold}</span>}
            </div>
          </div>
        </div>
      </Card>

      <Message msg={msg} />

      {/* Souscription du membre */}
      {ouvert && myMemberId && (
        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{L.charte_title}</h3>
          <ol style={{ fontSize: 13, margin: "0 0 10px", paddingLeft: 20, color: "#3D4350" }}>
            {L.charte.map((c) => <li key={c} style={{ marginBottom: 3 }}>{c}</li>)}
          </ol>
          {maSous && maSous.statut === "inscrit" && <p style={{ fontSize: 13.5, fontWeight: 700, color: TEAL }}>{fill(L.my_sub, { q: fmtQ(maSous.quantite_demandee), u })}</p>}
          <div style={{ ...ligneBtns, alignItems: "flex-end" }}>
            <div style={{ width: 160 }}>
              <Field label={fill(L.qty, { u })}>
                <input type="number" min="0" step={["piece", "lot"].includes(a.unite) ? "1" : "any"} style={inputStyle}
                  value={qte} placeholder={maSous?.statut === "inscrit" ? String(maSous.quantite_demandee) : ""} onChange={(e) => setQte(e.target.value)} />
              </Field>
            </div>
            <label style={{ fontSize: 13.5, marginBottom: 14 }}><input type="checkbox" checked={charte} onChange={(e) => setCharte(e.target.checked)} /> {L.charte_accept}</label>
          </div>
          {Number(qte) > 0 && <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 10px" }}>≈ {money(Number(qte) * Number(a.prix_unitaire), devise)}{a.prix_detail ? ` (${L.retail} ${money(Number(qte) * Number(a.prix_detail), devise)})` : ""}</p>}
          <div style={ligneBtns}>
            <Btn onClick={souscrire} disabled={busy || !(Number(qte) > 0 || maSous?.statut === "inscrit")}>{maSous?.statut === "inscrit" ? L.update_sub : L.subscribe}</Btn>
            {maSous?.statut === "inscrit" && <Btn variant="outline" onClick={() => action("achats_retirer", { p_id: a.id }, L.confirm_withdraw)} disabled={busy}>{L.withdraw}</Btn>}
          </div>
        </Card>
      )}

      {maSous?.statut === "inscrit" && ["ouvert", "propose"].includes(a.statut) && (
        <Card style={{ marginBottom: 16, borderTopColor: AMBER }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}><Wallet size={17} /> {L.pay_modes}</h3>
          <p style={{ fontSize: 13, margin: "0 0 4px" }}>{L.pay_when}</p>
          <p style={{ fontSize: 13, fontWeight: 700, margin: "0 0 4px" }}>{fill(L.pay_est, { m: money(Number(maSous.quantite_demandee || 0) * Number(a.prix_unitaire || 0), devise) })}</p>
          <ModesPaiement L={L} a={a} association={association} avoir={avoirDisponible(mouvements, maSous.member_id)} devise={devise} />
        </Card>
      )}

      {maSous && ["retenu", "non_retenu", "desiste"].includes(maSous.statut) && (
        <MaPart L={L} t={t} a={a} s={maSous} mouvements={mouvements} devise={devise} profile={profile} association={association} onReload={onReload}
          onAction={(fn, args, c) => action(fn, args, c)} />
      )}

      {/* Gestion (bureau ou porteur) */}
      {gestionnaire && (
        <Card style={{ marginBottom: 16, borderTopColor: "var(--primary)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>{L.manage}</h3>
            <div style={ligneBtns}>
              <Btn variant="outline" style={petitBtn} onClick={() => exporterFiche("pdf")}><FileDown size={13} /> {L.export_pdf}</Btn>
              <Btn variant="outline" style={petitBtn} onClick={() => exporterFiche("csv")}><Download size={13} /> {L.export_csv}</Btn>
            </div>
          </div>

          <div style={ligneBtns}>
            {isBureau && ["propose", "ouvert"].includes(a.statut) && <Btn variant="outline" onClick={() => setEdition(true)}><Pencil size={14} /> {L.edit}</Btn>}
            {isBureau && a.statut === "propose" && <>
              <Btn onClick={() => action("achats_valider_proposition", { p_id: a.id, p_ok: true, p_motif: null })} disabled={busy}><CheckCircle2 size={14} /> {L.approve}</Btn>
              <Btn variant="outline" onClick={() => { const m = window.prompt(L.refuse_prompt); if (m && m.trim()) action("achats_valider_proposition", { p_id: a.id, p_ok: false, p_motif: m.trim() }); }} disabled={busy}>{L.refuse}</Btn>
            </>}
            {a.statut === "ouvert" && (
              <Btn onClick={() => action("achats_cloturer", { p_id: a.id }, L.confirm_close, (r) => (r === "annule" ? L.closed_ko : L.closed_ok))} disabled={busy}><Lock size={14} /> {L.close_subs}</Btn>
            )}
            {isBureau && a.statut === "confirme" && (
              <Btn onClick={() => action("achats_passer_commande", { p_id: a.id, p_note: noteCommande || null }, L.confirm_order)} disabled={busy || impayes > 0}><Receipt size={14} /> {L.order}</Btn>
            )}
            {a.statut === "commande" && <Btn onClick={() => action("achats_marquer_livre", { p_id: a.id }, L.confirm_delivered)} disabled={busy}><Truck size={14} /> {L.delivered}</Btn>}
            {isBureau && ["propose", "ouvert", "confirme"].includes(a.statut) && (
              <Btn variant="danger" onClick={() => { const m = window.prompt(L.cancel_prompt); if (m && m.trim()) action("achats_annuler", { p_id: a.id, p_motif: m.trim() }); }} disabled={busy}><Ban size={14} /> {L.cancel}</Btn>
            )}
          </div>

          {a.statut === "ouvert" && a.stock_max && Number(a.total_demande) > Number(a.stock_max) && (
            <div style={{ marginTop: 12, padding: 12, background: AMBER_LIGHT, borderRadius: 10, fontSize: 13 }}>
              <AlertTriangle size={14} color={AMBER} /> {fill(L.stock_short, { d: fmtQ(a.total_demande), s: fmtQ(a.stock_max), u })} {L[`m_${a.mode_repartition}`]}.
              {a.mode_repartition === "tirage" && isBureau && (!tirage || tirage.statut === "annule") && (
                <div style={{ marginTop: 8 }}><Btn style={petitBtn} onClick={preparerTirage} disabled={busy}><Dices size={13} /> {L.prepare_draw}</Btn></div>
              )}
            </div>
          )}

          {isBureau && a.statut === "confirme" && (
            <div style={{ marginTop: 12 }}>
              {impayes > 0 && <Message msg={{ tone: "warn", text: fill(L.order_blocked, { n: impayes }) }} />}
              <Field label={L.order_note}><input style={inputStyle} value={noteCommande} onChange={(e) => setNoteCommande(e.target.value)} /></Field>
            </div>
          )}

          {/* Formulaire d'encaissement / remboursement */}
          {mvtForm && (
            <div style={{ marginTop: 12, padding: 12, background: "#F7F8FA", borderRadius: 10 }}>
              <strong style={{ fontSize: 13.5 }}>{fill(mvtForm.sens === "entree" ? L.mvt_form_in : L.mvt_form_out, { nom: mvtForm.nom })}</strong>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0 12px", marginTop: 8 }}>
                <Field label={L.amount}><input type="number" min="0" step="0.01" style={inputStyle} value={mvtForm.montant} onChange={(e) => setMvtForm({ ...mvtForm, montant: e.target.value })} /></Field>
                <Field label={L.mode}>
                  <select style={inputStyle} value={mvtForm.mode} onChange={(e) => setMvtForm({ ...mvtForm, mode: e.target.value })}>
                    {["especes", "interac", "virement"].map((m) => <option key={m} value={m}>{L[`mo_${m}`]}</option>)}
                  </select>
                </Field>
                <Field label={L.note}><input style={inputStyle} value={mvtForm.note} onChange={(e) => setMvtForm({ ...mvtForm, note: e.target.value })} /></Field>
              </div>
              <div style={ligneBtns}>
                <Btn onClick={async () => {
                  const ok = await action("achats_enregistrer_mouvement", { p_achat: a.id, p_member: mvtForm.member_id, p_sens: mvtForm.sens, p_montant: Number(mvtForm.montant), p_mode: mvtForm.mode, p_note: mvtForm.note || null }, null, L.mvt_saved);
                  if (ok) setMvtForm(null);
                }} disabled={busy || !(Number(mvtForm.montant) > 0)}>{L.submit_save}</Btn>
                <Btn variant="outline" onClick={() => setMvtForm(null)}>{t("action_cancel")}</Btn>
              </div>
            </div>
          )}

          {/* Remise */}
          {["livre", "cloture"].includes(a.statut) && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ margin: "0 0 6px", fontSize: 14.5, display: "flex", alignItems: "center", gap: 6 }}><PackageCheck size={15} /> {L.handover_title}
                <span style={{ fontWeight: 400, color: MUTED, fontSize: 12.5 }}>— {fill(L.handed_count, { n: retenus.filter((s) => s.remis_le).length, t: retenus.length })}</span></h4>
              <Btn variant={scan ? "outline" : "primary"} style={petitBtn} onClick={() => { setScan((v) => !v); setRemise(null); }}><QrCode size={13} /> {scan ? L.scan_stop : L.scan_start}</Btn>
              <QrScanner active={scan} L={L} onDecode={(token) => remettre({ p_token: token })} />
              {remise && <div style={{ fontSize: 16, fontWeight: 700 }}><Message msg={remise} /></div>}
            </div>
          )}

          {/* Souscripteurs */}
          <h4 style={{ margin: "18px 0 8px", fontSize: 14.5, display: "flex", alignItems: "center", gap: 6 }}><Users size={15} /> {L.subs_title} ({sousActives.length})</h4>
          {sousActives.length > 0 && (
            <Table head={[L.col_member, L.col_asked, L.col_alloc, L.col_due, L.col_paid, L.col_balance, L.col_status, L.col_handover, L.col_actions]} minWidth={860}>
              {sousActives.map((s) => {
                const l = ligneSous(s);
                const dispoRemb = r2(l.solde - l.sortiesAttente);
                return (
                  <tr key={s.id}>
                    <td style={td}>{s.member_nom}</td>
                    <td style={td}>{fmtQ(s.quantite_demandee)}</td>
                    <td style={td}>{s.statut === "inscrit" ? "—" : fmtQ(s.quantite_attribuee)}</td>
                    <td style={td}>{money(l.du, devise)}</td>
                    <td style={td}>{money(l.paye, devise)}{l.attente > 0 && <span style={{ color: AMBER }}> (+{money(l.attente, devise)})</span>}</td>
                    <td style={{ ...td, fontWeight: 700, color: l.solde < 0 ? RED : l.solde > 0 ? AMBER : TEAL }}>{money(l.solde, devise)}</td>
                    <td style={td}>{L[`s_${s.statut}`]}</td>
                    <td style={td}>{s.remis_le ? fill(L.handed, { date: new Date(s.remis_le).toLocaleDateString("fr-CA") }) : "—"}</td>
                    <td style={td}>
                      <div style={ligneBtns}>
                        {s.statut === "retenu" && l.solde + l.attente < 0 && a.statut !== "annule" && (
                          <Btn style={petitBtn} onClick={() => setMvtForm({ member_id: s.member_id, nom: s.member_nom, sens: "entree", montant: String(r2(-(l.solde + l.attente))), mode: "especes", note: "" })}>{L.cash_in}</Btn>
                        )}
                        {dispoRemb > 0 && (
                          <Btn variant="outline" style={petitBtn} onClick={() => setMvtForm({ member_id: s.member_id, nom: s.member_nom, sens: "sortie", montant: String(dispoRemb), mode: "interac", note: "" })}>{L.refund}</Btn>
                        )}
                        {dispoRemb > 0 && isBureau && (["cloture", "annule"].includes(a.statut) || ["desiste", "non_retenu"].includes(s.statut)) && (
                          <Btn variant="outline" style={petitBtn} onClick={() => action("achats_convertir_avoir", { p_achat: a.id, p_member: s.member_id, p_montant: dispoRemb }, fill(L.confirm_to_credit, { m: money(dispoRemb, devise) }))}>{L.to_credit}</Btn>
                        )}
                        {isBureau && ["ouvert", "confirme"].includes(a.statut) && ["inscrit", "retenu"].includes(s.statut) && (
                          <Btn variant="outline" style={petitBtn} onClick={() => { const m = window.prompt(L.remove_prompt); if (m && m.trim()) action("achats_retirer_souscripteur", { p_sous: s.id, p_motif: m.trim() }); }}>{L.remove}</Btn>
                        )}
                        {["livre", "cloture"].includes(a.statut) && s.statut === "retenu" && !s.remis_le && (
                          <Btn style={petitBtn} onClick={() => remettre({ p_sous: s.id })}><PackageCheck size={12} /> {L.hand_over}</Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}

          {/* Mouvements */}
          <h4 style={{ margin: "18px 0 4px", fontSize: 14.5, display: "flex", alignItems: "center", gap: 6 }}><Wallet size={15} /> {L.mvts_title}</h4>
          <p style={{ fontSize: 12, color: MUTED, margin: "0 0 8px" }}>{L.to_control_help}</p>
          <TableMouvements L={L} t={t} lang={lang} mouvements={mvtsAchat} devise={devise} achatsParId={{ [a.id]: a }} profile={profile}
            isBureau={isBureau} peutGerer={() => gestionnaire} onAction={(fn, args) => action(fn, args)} />

          {/* Bilan */}
          {["commande", "livre", "cloture"].includes(a.statut) && (
            <div style={{ marginTop: 18 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 14.5, display: "flex", alignItems: "center", gap: 6 }}><BarChart3 size={15} /> {L.bilan_title}</h4>
              {a.statut === "cloture" ? (
                <p style={{ fontSize: 13.5 }}>
                  {fill(L.bilan_entered, { date: formatEventDateTime(a.bilan_saisi_le, lang), p: money(a.cout_reel_produits, devise), f: money(a.frais_communs_reels, devise), t: money(totalReel, devise) })}<br />
                  {fill(L.bilan_done, { date: formatEventDateTime(a.bilan_valide_le, lang) })}
                  {a.accord_depassement && <><br />{L.accord} : {a.accord_depassement}</>}
                </p>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
                    <Field label={L.bilan_cost}><input type="number" min="0" step="0.01" style={inputStyle} value={bilan.cout} onChange={(e) => setBilan({ ...bilan, cout: e.target.value })} /></Field>
                    <Field label={L.bilan_fees}><input type="number" min="0" step="0.01" style={inputStyle} value={bilan.frais} onChange={(e) => setBilan({ ...bilan, frais: e.target.value })} /></Field>
                    <Field label={L.bilan_note}><input style={inputStyle} value={bilan.note} onChange={(e) => setBilan({ ...bilan, note: e.target.value })} /></Field>
                  </div>
                  <Btn variant="outline" onClick={() => action("achats_saisir_bilan", { p_id: a.id, p_cout_produits: Number(bilan.cout) || 0, p_frais_communs: Number(bilan.frais) || 0, p_note: bilan.note || null }, null, L.bilan_saved)} disabled={busy || bilan.cout === ""}>{L.bilan_save}</Btn>
                  {a.bilan_saisi_le && (
                    <div style={{ marginTop: 12 }}>
                      <p style={{ fontSize: 13 }}>{fill(L.bilan_entered, { date: formatEventDateTime(a.bilan_saisi_le, lang), p: money(a.cout_reel_produits, devise), f: money(a.frais_communs_reels, devise), t: money(totalReel, devise) })}</p>
                      <strong style={{ fontSize: 13 }}>{L.bilan_preview}</strong>
                      <Table head={[L.col_member, L.col_alloc, L.col_est, L.col_real, L.col_diff]}>
                        {apercu.map(({ s, part, est, pct }) => (
                          <tr key={s.id}>
                            <td style={td}>{s.member_nom}</td><td style={td}>{fmtQ(s.quantite_attribuee)}</td>
                            <td style={td}>{money(est, devise)}</td><td style={td}>{money(part, devise)}</td>
                            <td style={{ ...td, color: part > est ? RED : TEAL }}>{money(r2(part - est), devise)} ({pct >= 0 ? "+" : ""}{pct.toFixed(1)} %)</td>
                          </tr>
                        ))}
                      </Table>
                      {depasse && (
                        <div style={{ marginTop: 10 }}>
                          <Message msg={{ tone: "warn", text: fill(L.over_cap, { cap: Number(a.plafond_complement_pct || 10), max: maxPct.toFixed(1) }) }} />
                          <Field label={L.accord}><input style={inputStyle} value={accord} onChange={(e) => setAccord(e.target.value)} /></Field>
                        </div>
                      )}
                      {isBureau && (a.bilan_saisi_par === profile.id
                        ? <p style={{ fontSize: 12.5, color: AMBER, marginTop: 10 }}><Lock size={12} /> {L.other_must_validate}</p>
                        : <div style={{ marginTop: 10 }}><Btn onClick={() => action("achats_valider_bilan", { p_id: a.id, p_accord: accord || null }, L.confirm_bilan)} disabled={busy || (depasse && !accord.trim())}><ShieldCheck size={14} /> {L.bilan_validate}</Btn></div>)}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------- Relevé du membre ----------
function Releve({ L, t, lang, achats, sous, mouvements, devise, profile, association }) {
  const myId = profile.member_id;
  const mesSous = sous.filter((s) => s.member_id === myId && s.statut !== "retire");
  const mesMvts = mouvements.filter((m) => m.member_id === myId);
  const parId = Object.fromEntries(achats.map((a) => [a.id, a]));
  const avoir = avoirDisponible(mouvements, myId);
  const lignes = mesSous.map((s) => {
    const a = parId[s.achat_id];
    const du = duDe(s, a);
    const c = comptesMembre(mouvements, s.achat_id, myId);
    const eco = a?.prix_detail && s.statut === "retenu" && a.statut === "cloture" ? r2(Number(a.prix_detail) * Number(s.quantite_attribuee) - du) : 0;
    return { s, a, du, ...c, solde: r2(c.paye - du), eco };
  }).filter((l) => l.a);
  const totalPaye = r2(lignes.reduce((n, l) => n + l.paye, 0));
  const totalEco = r2(lignes.reduce((n, l) => n + Math.max(0, l.eco), 0));
  const head = [L.col_purchase, L.col_status, L.col_alloc, L.col_due, L.col_paid, L.col_balance, L.col_handover];
  const rows = lignes.map((l) => [l.a.titre, L[`st_${l.a.statut}`], `${fmtQ(l.s.quantite_attribuee || l.s.quantite_demandee)} ${uniteDe(L, l.a)}`, l.du.toFixed(2), l.paye.toFixed(2), l.solde.toFixed(2), l.s.remis_le ? new Date(l.s.remis_le).toLocaleDateString("fr-CA") : ""]);

  if (!myId) return <p style={{ color: MUTED }}>{L.releve_empty}</p>;
  return (
    <div>
      <p style={{ fontSize: 13.5, color: MUTED }}>{L.releve_intro}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Card><div style={{ fontSize: 12, color: MUTED }}>{L.total_paid}</div><b style={{ fontSize: 20 }}>{money(totalPaye, devise)}</b></Card>
        <Card><div style={{ fontSize: 12, color: MUTED }}>{L.credit_available}</div><b style={{ fontSize: 20, color: TEAL }}>{money(avoir, devise)}</b></Card>
        <Card><div style={{ fontSize: 12, color: MUTED }}>{L.total_saving}</div><b style={{ fontSize: 20, color: TEAL }}>{money(totalEco, devise)}</b></Card>
      </div>
      {lignes.length === 0 ? <p style={{ color: MUTED, fontStyle: "italic" }}>{L.releve_empty}</p> : (
        <>
          <div style={{ ...ligneBtns, marginBottom: 8 }}>
            <Btn variant="outline" style={petitBtn} onClick={() => exporterPDF({ association, titre: L.pdf_releve, sousTitre: profile.nom_complet || "", fichier: "releve_achats_groupes.pdf",
              lignes: [`${L.total_paid} : ${money(totalPaye, devise)} · ${L.credit_available} : ${money(avoir, devise)} · ${L.total_saving} : ${money(totalEco, devise)}`],
              tableaux: [{ head, body: rows }, { titre: L.my_mvts, head: [L.col_date, L.col_purchase, L.col_kind, L.col_mode, L.col_amount, L.col_status],
                body: mesMvts.map((m) => [new Date(m.declare_le).toLocaleDateString("fr-CA"), parId[m.achat_id]?.titre || L.o_ristourne, L[`k_${m.sens}`], L[`mo_${m.mode}`], Number(m.montant).toFixed(2), L[`ms_${m.statut}`]]) }],
            }).catch((e) => alert(errTxt(e, t)))}><FileDown size={13} /> PDF</Btn>
            <Btn variant="outline" style={petitBtn} onClick={() => telechargerCSV("releve_achats_groupes.csv", head, rows)}><Download size={13} /> CSV</Btn>
          </div>
          <Table head={head} minWidth={720}>
            {lignes.map((l) => (
              <tr key={l.s.id}>
                <td style={td}>{l.a.titre}</td>
                <td style={td}><StatutPill L={L} statut={l.a.statut} /></td>
                <td style={td}>{fmtQ(l.s.quantite_attribuee || l.s.quantite_demandee)} {uniteDe(L, l.a)}</td>
                <td style={td}>{money(l.du, devise)}</td>
                <td style={td}>{money(l.paye, devise)}{l.attente > 0 && <span style={{ color: AMBER }}> (+{money(l.attente, devise)})</span>}</td>
                <td style={{ ...td, fontWeight: 700, color: l.solde < 0 ? RED : TEAL }}>{money(l.solde, devise)}</td>
                <td style={td}>{l.s.remis_le ? new Date(l.s.remis_le).toLocaleDateString("fr-CA") : "—"}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <h4 style={{ margin: "20px 0 8px", fontSize: 14.5 }}>{L.my_mvts}</h4>
      <TableMouvements L={L} t={t} lang={lang} mouvements={mesMvts} devise={devise} achatsParId={parId} profile={profile}
        isBureau={false} peutGerer={() => false} onAction={() => {}} montrerAchat />
    </div>
  );
}

// ---------- Bilan annuel (bureau) ----------
function BilanAnnuel({ L, t, achats, sous, devise, association, onReload }) {
  const annees = [...new Set(achats.filter((a) => a.cloture_le).map((a) => new Date(a.cloture_le).getFullYear()))];
  const courante = new Date().getFullYear();
  if (!annees.includes(courante)) annees.push(courante);
  annees.sort((x, y) => y - x);
  const [annee, setAnnee] = useState(courante);
  const [montant, setMontant] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const clotures = achats.filter((a) => a.statut === "cloture" && a.cloture_le && new Date(a.cloture_le).getFullYear() === annee);
  const ids = new Set(clotures.map((a) => a.id));
  const parId = Object.fromEntries(clotures.map((a) => [a.id, a]));
  const lignesAchats = clotures.map((a) => {
    const cout = r2(Number(a.cout_reel_produits || 0) + Number(a.frais_communs_reels || 0));
    const detail = a.prix_detail ? r2(Number(a.prix_detail) * Number(a.total_attribue)) : null;
    return { a, cout, detail, eco: detail != null ? r2(detail - cout) : null };
  });
  const parMembre = {};
  for (const s of sous) {
    if (!ids.has(s.achat_id) || s.statut !== "retenu") continue;
    const a = parId[s.achat_id];
    const x = parMembre[s.member_id] || (parMembre[s.member_id] = { nom: s.member_nom, total: 0, eco: 0, n: 0 });
    const part = Number(s.part_reelle) || 0;
    x.total = r2(x.total + part);
    x.n += 1;
    if (a.prix_detail) x.eco = r2(x.eco + Number(a.prix_detail) * Number(s.quantite_attribuee) - part);
  }
  const membres = Object.values(parMembre).sort((x, y) => y.total - x.total);
  const totalCout = r2(lignesAchats.reduce((n, l) => n + l.cout, 0));
  const totalEco = r2(lignesAchats.reduce((n, l) => n + (l.eco || 0), 0));

  const headA = [L.col_purchase, L.col_qty, L.col_cost, L.col_retail_value, L.col_saving];
  const rowsA = lignesAchats.map((l) => [l.a.titre, `${fmtQ(l.a.total_attribue)} ${uniteDe(L, l.a)}`, l.cout.toFixed(2), l.detail != null ? l.detail.toFixed(2) : "", l.eco != null ? l.eco.toFixed(2) : ""]);
  const headM = [L.col_member, L.y_purchases, L.col_purchases_total, L.col_saving];
  const rowsM = membres.map((m) => [m.nom, String(m.n), m.total.toFixed(2), m.eco.toFixed(2)]);

  async function ristourne() {
    const m = Number(montant);
    if (!(m > 0) || !window.confirm(fill(L.confirm_ristourne, { m: money(m, devise), y: annee }))) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("achats_ristourne", { p_annee: annee, p_montant: m, p_note: note || null });
    setBusy(false);
    if (error) { setMsg({ tone: "warn", text: errTxt(error, t) }); return; }
    setMsg({ text: fill(L.ristourne_done, { n: data ?? 0 }) });
    setMontant(""); setNote("");
    onReload();
  }

  return (
    <div>
      <div style={{ ...ligneBtns, marginBottom: 14 }}>
        <label style={{ fontSize: 13.5, fontWeight: 600 }}>{L.year}{" "}
          <select style={{ ...inputStyle, width: "auto", display: "inline-block" }} value={annee} onChange={(e) => setAnnee(Number(e.target.value))}>
            {annees.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <Btn variant="outline" style={petitBtn} onClick={() => exporterPDF({ association, titre: fill(L.pdf_bilan, { y: annee }), fichier: `bilan_achats_groupes_${annee}.pdf`,
          lignes: [`${L.y_purchases} : ${clotures.length} · ${L.y_volume} : ${money(totalCout, devise)} · ${L.y_saving} : ${money(totalEco, devise)} · ${L.y_members} : ${membres.length}`, L.accounts_note],
          tableaux: [{ head: headA, body: rowsA }, { titre: L.per_member, head: headM, body: rowsM }] }).catch((e) => alert(errTxt(e, t)))}><FileDown size={13} /> PDF</Btn>
        <Btn variant="outline" style={petitBtn} onClick={() => telechargerCSV(`bilan_achats_groupes_${annee}.csv`, headA, rowsA)}><Download size={13} /> CSV ({L.col_purchase})</Btn>
        <Btn variant="outline" style={petitBtn} onClick={() => telechargerCSV(`bilan_achats_groupes_membres_${annee}.csv`, headM, rowsM)}><Download size={13} /> CSV ({L.per_member})</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Card><div style={{ fontSize: 12, color: MUTED }}>{L.y_purchases}</div><b style={{ fontSize: 20 }}>{clotures.length}</b></Card>
        <Card><div style={{ fontSize: 12, color: MUTED }}>{L.y_volume}</div><b style={{ fontSize: 20 }}>{money(totalCout, devise)}</b></Card>
        <Card><div style={{ fontSize: 12, color: MUTED }}>{L.y_saving}</div><b style={{ fontSize: 20, color: TEAL }}>{money(totalEco, devise)}</b></Card>
        <Card><div style={{ fontSize: 12, color: MUTED }}>{L.y_members}</div><b style={{ fontSize: 20 }}>{membres.length}</b></Card>
      </div>
      {clotures.length === 0 ? <p style={{ color: MUTED, fontStyle: "italic" }}>{L.bilan_empty}</p> : (
        <>
          <Table head={headA} minWidth={600}>
            {rowsA.map((r, i) => <tr key={lignesAchats[i].a.id}>{r.map((c, j) => <td key={j} style={td}>{j >= 2 && c !== "" ? money(c, devise) : c}</td>)}</tr>)}
          </Table>
          <h4 style={{ margin: "18px 0 8px", fontSize: 14.5 }}>{L.per_member}</h4>
          <Table head={headM} minWidth={500}>
            {rowsM.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={td}>{j >= 2 ? money(c, devise) : c}</td>)}</tr>)}
          </Table>
        </>
      )}
      <Card style={{ marginTop: 18 }}>
        <h4 style={{ margin: "0 0 6px", fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}><PiggyBank size={16} /> {L.ristourne_title}</h4>
        <p style={{ fontSize: 12.5, color: MUTED, marginTop: 0 }}>{L.ristourne_help}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
          <Field label={L.ristourne_amount}><input type="number" min="0" step="0.01" style={inputStyle} value={montant} onChange={(e) => setMontant(e.target.value)} /></Field>
          <Field label={L.note}><input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <Message msg={msg} />
        <Btn onClick={ristourne} disabled={busy || !(Number(montant) > 0) || membres.length === 0}>{L.ristourne_btn}</Btn>
      </Card>
      <p style={{ fontSize: 12, color: MUTED, marginTop: 14 }}>{L.accounts_note}</p>
    </div>
  );
}

// =====================================================================
export default function AchatsGroupes({ profile, isBureau, association }) {
  const { t, lang } = useLang();
  const L = TXT[lang === "en" ? "en" : "fr"];
  const devise = association?.devise_monetaire || "CAD";
  const [achats, setAchats] = useState([]);
  const [sous, setSous] = useState([]);
  const [mouvements, setMouvements] = useState([]);
  const [members, setMembers] = useState([]);
  const [tirages, setTirages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [vue, setVue] = useState("achats");
  const [selection, setSelection] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    const assoc = profile.association_id;
    const [{ data: ac }, { data: so }, { data: mv }, { data: mb }, { data: tr }] = await Promise.all([
      supabase.from("achats_groupes").select("*").eq("association_id", assoc).order("created_at", { ascending: false }),
      supabase.from("achats_souscriptions").select("*").eq("association_id", assoc).order("created_at"),
      supabase.from("achats_mouvements").select("*").eq("association_id", assoc).order("created_at", { ascending: false }),
      isBureau ? supabase.from("members").select("id, nom").eq("association_id", assoc).order("nom") : Promise.resolve({ data: [] }),
      supabase.from("tirages").select("id, titre, statut").eq("association_id", assoc),
    ]);
    setAchats(ac || []);
    setSous(so || []);
    setMouvements(mv || []);
    setMembers(mb || []);
    setTirages(tr || []);
    setLoading(false);
  }, [profile.association_id, isBureau]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Container><Section><p>{t("loading")}</p></Section></Container>;

  const parId = Object.fromEntries(achats.map((a) => [a.id, a]));
  const peutGerer = (a) => !!a && (isBureau || (!!profile.member_id && a.porteur_member_id === profile.member_id));
  const aControler = mouvements.filter((m) => m.achat_id && (m.statut === "declare" || m.statut === "recu") && peutGerer(parId[m.achat_id]));
  const achatSel = selection ? parId[selection] : null;
  const onglets = [["achats", L.tab_achats], ["releve", L.tab_releve], ...(isBureau ? [["bilan", L.tab_bilan]] : [])];

  async function actionGlobale(fn, args) {
    const { error } = await supabase.rpc(fn, args);
    if (error) alert(errTxt(error, t));
    load();
  }

  return (
    <Container>
      <Section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 22, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 10 }}><ShoppingBasket size={22} /> {L.title}</h2>
            <p style={{ fontSize: 13, color: MUTED, margin: 0, maxWidth: 680 }}>{L.intro}</p>
          </div>
          {vue === "achats" && !achatSel && !showForm && (isBureau || profile.member_id) && (
            <Btn onClick={() => setShowForm(true)}><Plus size={14} /> {isBureau ? L.new_btn : L.propose_btn}</Btn>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {onglets.map(([id, label]) => (
            <button key={id} onClick={() => { setVue(id); setSelection(null); setShowForm(false); }}
              style={{ padding: "7px 14px", borderRadius: 999, border: "1.5px solid var(--primary)", cursor: "pointer", fontWeight: 600, fontSize: 13,
                background: vue === id ? "var(--primary)" : "transparent", color: vue === id ? "white" : "var(--primary)" }}>{label}</button>
          ))}
        </div>

        {vue === "achats" && achatSel && (
          <AchatFiche key={achatSel.id} L={L} t={t} lang={lang} a={achatSel} sous={sous.filter((s) => s.achat_id === achatSel.id)} mouvements={mouvements}
            devise={devise} profile={profile} isBureau={isBureau} members={members} tirage={tirages.find((x) => x.id === achatSel.tirage_id)}
            association={association} onBack={() => setSelection(null)} onReload={load} />
        )}

        {vue === "achats" && !achatSel && (
          <>
            {showForm && <AchatForm L={L} t={t} isBureau={isBureau} members={members} profile={profile} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
            {aControler.length > 0 && (
              <Card style={{ marginBottom: 16, borderTopColor: AMBER }}>
                <h3 style={{ margin: "0 0 4px", fontSize: 15.5, display: "flex", alignItems: "center", gap: 8 }}><ShieldCheck size={16} /> {fill(L.to_control, { n: aControler.length })}</h3>
                <p style={{ fontSize: 12, color: MUTED, margin: "0 0 8px" }}>{L.to_control_help}</p>
                <TableMouvements L={L} t={t} lang={lang} mouvements={aControler} devise={devise} achatsParId={parId} profile={profile}
                  isBureau={isBureau} peutGerer={peutGerer} onAction={actionGlobale} montrerAchat />
              </Card>
            )}
            {achats.length === 0 && !showForm && <p style={{ color: MUTED, fontStyle: "italic" }}>{L.empty}</p>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
              {achats.map((a) => (
                <AchatCarte key={a.id} L={L} a={a} devise={devise} lang={lang} onOpen={() => setSelection(a.id)}
                  maSous={sous.find((s) => s.achat_id === a.id && s.member_id === profile.member_id)} />
              ))}
            </div>
          </>
        )}

        {vue === "releve" && <Releve L={L} t={t} lang={lang} achats={achats} sous={sous} mouvements={mouvements} devise={devise} profile={profile} association={association} />}
        {vue === "bilan" && isBureau && <BilanAnnuel L={L} t={t} achats={achats} sous={sous} devise={devise} association={association} onReload={load} />}
      </Section>
    </Container>
  );
}
