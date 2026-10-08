// =====================================================================
// FinancesElargies.jsx — Dons, Emprunts, Budgets de projets
// Développé par Omnia Trade Solutions
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Gift, Landmark, Plus, Printer, FileText, Pencil, Trash2, History } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Field, Table, td, inputStyle, money, montantEnLettres, todayISO, useLang, RuleBox, RED, SignatureLine, friendlyError, OrgLegalSubline, NATURE_DON_OPTIONS, FORME_DON_OPTIONS, MODE_VERSEMENT_OPTIONS, BASE_LEGALE_OPTIONS, RECU_CATEGORIES, calculerMontantAdmissibleCanada, RECU_CA_FMV_SEUIL_EVALUATEUR } from "./shared";

export default function FinancesElargies({ profile, isBureau, mode, association }) {
  // mode: 'dons' | 'emprunts'
  const [members, setMembers] = useState([]);
  const [donations, setDonations] = useState([]);
  const [loans, setLoans] = useState([]);
  const [repayments, setRepayments] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const { t, lang } = useLang();
  // 2026-09-28 (suite 80) — devise réelle de l'association plutôt qu'un CAD
  // codé en dur, oublié lors du chantier devise de la suite 78 pour ce
  // fichier (Dons/Emprunts). Voir aussi DonReceiptModal et LoanHistoryModal
  // plus bas, qui avaient chacun leur propre "CAD" en dur à corriger.
  const devise = association?.devise_monetaire || "CAD";

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: mem }, { data: dons }, { data: lns }, { data: rep }, { data: proj }] = await Promise.all([
      supabase.from("members").select("id,nom").order("nom"),
      supabase.from("donations").select("*").eq("association_id", profile.association_id).order("date", { ascending: false }),
      supabase.from("loans").select("*").eq("association_id", profile.association_id).order("date_pret", { ascending: false }),
      supabase.from("loan_repayments").select("*"),
      // projects/project_tasks restent réservées au Bureau (RLS) : pour un
      // adhérent simple, cette requête renvoie simplement 0 ligne (pas
      // d'erreur) — le nom du projet financé ne s'affiche alors pas pour
      // lui dans le tableau des dons, seul le lien reste enregistré.
      supabase.from("projects").select("id,nom").eq("association_id", profile.association_id),
    ]);
    setMembers((mem || []).filter((m) => m.statut !== "Supprimé")); setDonations(dons || []); setLoans(lns || []); setRepayments(rep || []);
    setProjects(proj || []);
    setLoading(false);
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);

  // ---------- Approbation des suppressions (transactions financières) ----------
  // Même mécanisme que dans App.jsx (dépenses de fonds, séances de tontine/
  // collation) : si l'association a désigné un approbateur et que ce n'est
  // pas la personne connectée, la suppression n'a pas lieu immédiatement —
  // une demande est créée dans `deletion_requests`, à approuver depuis
  // l'onglet "Demandes de suppression" (App.jsx).
  async function requestOrDelete({ tableName, recordId, description }, performDelete) {
    const approverId = association?.approbateur_suppression_id;
    if (!approverId || approverId === profile.id) {
      await performDelete();
      return true;
    }
    const { error } = await supabase.from("deletion_requests").insert({
      association_id: profile.association_id, table_name: tableName, record_id: recordId,
      description, requested_by: profile.id, requested_by_nom: profile.nom_complet,
    });
    if (error) { alert(friendlyError(error, t)); return false; }
    alert(t("del_req_sent_alert").replace("{name}", t("del_req_sent_alert_fallback")));
    return false;
  }

  // ---------- Dons ----------
  // donateur_adresse/nature_don/forme_don/mode_versement/base_legale : mentions
  // obligatoires du reçu fiscal conforme France (CERFA 2041-RD, 2026-10-06).
  // lieu_delivrance/valeur_avantage/description_avantage/avantage_type_exclu/
  // description_bien_nature/evaluateur_nom/evaluateur_adresse : mentions du
  // reçu officiel conforme Canada (règles de l'ARC, même date) — voir
  // claude/resume-arem-app.md pour le détail des deux juridictions.
  // Valeurs par défaut (numéraire, déclaration unilatérale, virement,
  // article 200, aucun avantage) correspondant au cas le plus courant, pour
  // qu'une association qui n'émet aucun reçu conforme n'ait jamais à s'en
  // soucier.
  const newDonDefaults = {
    donateur_nom: "", donateur_email: "", donateur_adresse: "", montant: "", message: "", projet_id: "",
    nature_don: "numeraire", forme_don: "declaration_unilaterale", mode_versement: "virement", base_legale: "art200",
    lieu_delivrance: "", valeur_avantage: "", description_avantage: "", avantage_type_exclu: false, description_bien_nature: "",
    evaluateur_nom: "", evaluateur_adresse: "",
  };
  const [newDon, setNewDon] = useState(newDonDefaults);
  const [showRecuFields, setShowRecuFields] = useState(false);
  const isFranceCerfa = !!association?.recu_categorie_eligibilite;
  const isCanadaCRA = !!association?.recu_numero_organisme_bienfaisance;
  async function addDonation() {
    if (!newDon.donateur_nom.trim() || !newDon.montant) return;
    if (!window.confirm(t("don_confirm_add").replace("{montant}", money(Number(newDon.montant) || 0, devise)).replace("{donateur}", newDon.donateur_nom.trim()))) return;
    const { data, error } = await supabase.from("donations").insert({
      association_id: profile.association_id, donateur_nom: newDon.donateur_nom, donateur_email: newDon.donateur_email,
      donateur_adresse: newDon.donateur_adresse || null,
      montant: Number(newDon.montant), message: newDon.message, date: todayISO(), projet_id: newDon.projet_id || null,
      nature_don: newDon.nature_don, forme_don: newDon.forme_don,
      mode_versement: newDon.nature_don === "numeraire" ? newDon.mode_versement : null,
      base_legale: newDon.base_legale,
      lieu_delivrance: newDon.lieu_delivrance || null,
      valeur_avantage: newDon.valeur_avantage ? Number(newDon.valeur_avantage) : null,
      description_avantage: newDon.description_avantage || null,
      avantage_type_exclu: !!newDon.avantage_type_exclu,
      description_bien_nature: newDon.nature_don === "nature" ? (newDon.description_bien_nature || null) : null,
      evaluateur_nom: newDon.evaluateur_nom || null, evaluateur_adresse: newDon.evaluateur_adresse || null,
    }).select().single();
    if (!error) { setDonations((p) => [data, ...p]); setNewDon(newDonDefaults); }
  }
  async function toggleRecu(id, val) {
    await supabase.from("donations").update({ recu_emis: val }).eq("id", id);
    setDonations((prev) => prev.map((d) => (d.id === id ? { ...d, recu_emis: val } : d)));
  }
  const totalDons = donations.reduce((s, d) => s + Number(d.montant), 0);
  // Agrégats pour la déclaration annuelle obligatoire des dons (France,
  // demarches-simplifiees.fr) : montant total + nombre de reçus émis sur
  // l'exercice en cours. Année civile simple (pas l'exercice comptable
  // configurable de l'association) — suffisant pour cette estimation,
  // la personne ajuste si son exercice ne correspond pas à l'année civile.
  const anneeEnCours = new Date().getFullYear();
  const donationsThisYear = donations.filter((d) => d.date && new Date(d.date).getFullYear() === anneeEnCours);

  // ---------- Modifier / Supprimer un don ----------
  const [editingDon, setEditingDon] = useState(null);
  async function updateDonation(id, patch) {
    if (!window.confirm(t("don_confirm_edit").replace("{donateur}", patch.donateur_nom || "—").replace("{montant}", money(patch.montant ?? 0, devise)))) return;
    const { error } = await supabase.from("donations").update(patch).eq("id", id);
    if (!error) setDonations((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }
  async function deleteDonation(id) {
    if (!window.confirm(t("don_confirm_delete"))) return;
    const d = donations.find((x) => x.id === id);
    const description = t("del_desc_donation")
      .replace("{donateur}", d?.donateur_nom || "—").replace("{amount}", money(d?.montant || 0, devise)).replace("{date}", d?.date || "");
    await requestOrDelete({ tableName: "donations", recordId: id, description }, async () => {
      await supabase.from("donations").delete().eq("id", id);
      setDonations((prev) => prev.filter((x) => x.id !== id));
    });
  }

  // ---------- Reçu de don (imprimable / téléchargeable) ----------
  const [receiptDonId, setReceiptDonId] = useState(null);

  // ---------- Emprunts ----------
  const [newLoan, setNewLoan] = useState({ member_id: "", montant_pret: "", taux_interet: "0", date_echeance: "" });
  async function addLoan() {
    if (!newLoan.member_id || !newLoan.montant_pret) return;
    const nomEmprunteur = members.find((m) => m.id === newLoan.member_id)?.nom || "—";
    if (!window.confirm(t("loan_confirm_grant").replace("{montant}", money(Number(newLoan.montant_pret) || 0, devise)).replace("{nom}", nomEmprunteur).replace("{taux}", String(Number(newLoan.taux_interet) || 0)))) return;
    const { data, error } = await supabase.from("loans").insert({
      association_id: profile.association_id, member_id: newLoan.member_id, montant_pret: Number(newLoan.montant_pret),
      taux_interet: Number(newLoan.taux_interet) || 0, date_pret: todayISO(), date_echeance: newLoan.date_echeance || null,
    }).select().single();
    if (!error) { setLoans((p) => [data, ...p]); setNewLoan({ member_id: "", montant_pret: "", taux_interet: "0", date_echeance: "" }); }
  }
  function loanRepaid(loanId) { return repayments.filter((r) => r.loan_id === loanId).reduce((s, r) => s + Number(r.montant), 0); }
  // Intérêts simples (taux appliqué une fois sur le capital, tel qu'accordé au prêt) —
  // le "capital avec les intérêts produits" est donc le montant réellement dû à recouvrer.
  function loanInterest(l) { return Number(l.montant_pret) * (Number(l.taux_interet) || 0) / 100; }
  function loanTotalDue(l) { return Number(l.montant_pret) + loanInterest(l); }
  const [repayDraft, setRepayDraft] = useState({});
  async function addRepayment(loanId) {
    const montant = Number(repayDraft[loanId]);
    if (!montant) return;
    if (!window.confirm(t("loan_confirm_repayment").replace("{montant}", money(montant, devise)))) return;
    const { data, error } = await supabase.from("loan_repayments").insert({
      loan_id: loanId, association_id: profile.association_id, montant, date: todayISO(),
    }).select().single();
    if (!error) {
      setRepayments((p) => [...p, data]);
      setRepayDraft((p) => ({ ...p, [loanId]: "" }));
      const loan = loans.find((l) => l.id === loanId);
      // Le prêt n'est considéré remboursé qu'une fois le capital ET les intérêts couverts.
      if (loan && loanRepaid(loanId) + montant >= loanTotalDue(loan)) {
        await supabase.from("loans").update({ statut: "rembourse" }).eq("id", loanId);
        setLoans((prev) => prev.map((l) => (l.id === loanId ? { ...l, statut: "rembourse" } : l)));
      }
    }
  }

  // ---------- Modifier / Supprimer un prêt ----------
  const [editingLoan, setEditingLoan] = useState(null);
  const [historyLoanId, setHistoryLoanId] = useState(null);
  async function updateLoan(id, patch) {
    const nomEmprunteur = members.find((m) => m.id === patch.member_id)?.nom || "—";
    if (!window.confirm(t("loan_confirm_edit").replace("{nom}", nomEmprunteur).replace("{montant}", money(patch.montant_pret ?? 0, devise)))) return;
    const { error } = await supabase.from("loans").update(patch).eq("id", id);
    if (!error) setLoans((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  async function deleteLoan(id) {
    if (!window.confirm(t("loan_confirm_delete"))) return;
    const l0 = loans.find((x) => x.id === id);
    const emprunteur = members.find((m) => m.id === l0?.member_id)?.nom || "—";
    const description = t("del_desc_loan").replace("{emprunteur}", emprunteur).replace("{amount}", money(l0?.montant_pret || 0, devise));
    await requestOrDelete({ tableName: "loans", recordId: id, description }, async () => {
      // Suppression en cascade : les remboursements du prêt d'abord, puis le prêt lui-même.
      await supabase.from("loan_repayments").delete().eq("loan_id", id);
      await supabase.from("loans").delete().eq("id", id);
      setRepayments((prev) => prev.filter((r) => r.loan_id !== id));
      setLoans((prev) => prev.filter((x) => x.id !== id));
    });
  }

  if (loading) return <Container><Section><p>{t("loading")}</p></Section></Container>;

  if (mode === "dons") {
    return (
      <Container><Section>
        <h2 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><Gift size={20} /> {t("nav_donations")}</h2>
        <RuleBox>{t("don_rule")}</RuleBox>
        <div style={{ marginBottom: 20 }}>
          <b>{t("don_total_received")} </b>{money(totalDons, devise)}
        </div>
        {isBureau && isFranceCerfa && (
          <Card style={{ marginBottom: 20, background: "#FBF3D9", border: "1px solid #EEDDA0" }}>
            <h3 style={{ fontSize: 13, marginBottom: 6 }}>{t("recu_annual_declaration_title")}</h3>
            <p style={{ fontSize: 12, color: "#5B6270", marginBottom: 10 }}>{t("recu_annual_declaration_text")}</p>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
              <div><b>{t("recu_annual_total_amount")} :</b> {money(donationsThisYear.reduce((s, d) => s + Number(d.montant), 0), devise)}</div>
              <div><b>{t("recu_annual_total_count")} :</b> {donationsThisYear.filter((d) => d.numero_recu).length}</div>
            </div>
          </Card>
        )}
        {isBureau && isCanadaCRA && (
          <Card style={{ marginBottom: 20, background: "#FBF3D9", border: "1px solid #EEDDA0" }}>
            <h3 style={{ fontSize: 13, marginBottom: 6 }}>{t("recu_t3010_title")}</h3>
            <p style={{ fontSize: 12, color: "#5B6270", marginBottom: 10 }}>{t("recu_t3010_text")}</p>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
              <div><b>{t("recu_annual_total_amount")} :</b> {money(donationsThisYear.reduce((s, d) => s + Number(d.montant), 0), devise)}</div>
              <div><b>{t("recu_annual_total_count")} :</b> {donationsThisYear.filter((d) => d.numero_recu).length}</div>
            </div>
          </Card>
        )}
        {isBureau && (
          // 2026-10-06 — la carte de saisie n'est plus dans une grille à
          // côté du tableau : avec les colonnes France/Canada ajoutées
          // ci-dessous, le tableau a besoin de toute la largeur disponible
          // (quitte à défiler horizontalement) pour rester lisible. La
          // carte de saisie occupe donc sa propre ligne, au-dessus.
          <Card style={{ marginBottom: 22, maxWidth: 480 }}>
            <h3 style={{ fontSize: 13, marginBottom: 10 }}>{t("don_record_title")}</h3>
              <Field label={t("don_donor_name")}><input style={inputStyle} value={newDon.donateur_nom} onChange={(e) => setNewDon({ ...newDon, donateur_nom: e.target.value })} /></Field>
              <Field label={t("don_donor_email")}><input style={inputStyle} value={newDon.donateur_email} onChange={(e) => setNewDon({ ...newDon, donateur_email: e.target.value })} /></Field>
              <Field label={t("don_amount")}><input type="number" style={inputStyle} value={newDon.montant} onChange={(e) => setNewDon({ ...newDon, montant: e.target.value })} /></Field>
              <Field label={t("don_message")}><input style={inputStyle} value={newDon.message} onChange={(e) => setNewDon({ ...newDon, message: e.target.value })} /></Field>
              {/* Mentions des reçus fiscaux conformes (France CERFA 2041-RD
                  et/ou Canada ARC) — repliées par défaut (showRecuFields) :
                  une association qui n'a configuré ni l'une ni l'autre
                  juridiction en Configuration n'a jamais besoin d'y toucher,
                  les valeurs par défaut (newDonDefaults) suffisent déjà si
                  elle ouvre quand même la section. Le libellé du bouton
                  s'adapte à la juridiction réellement configurée plutôt que
                  d'afficher "France" sans discernement. */}
              <button type="button" onClick={() => setShowRecuFields((v) => !v)} style={{ background: "none", border: "none", color: "var(--primary)", fontSize: 12, cursor: "pointer", padding: 0, marginBottom: showRecuFields ? 10 : 16, textDecoration: "underline" }}>
                {isCanadaCRA && !isFranceCerfa ? t("recu_officiel_canada_badge") : isFranceCerfa ? t("recu_fiscal_france_badge") : t("recu_fiscal_section_generic")} {showRecuFields ? "▲" : "▼"}
              </button>
              {showRecuFields && (
                <>
                  <Field label={t("recu_donor_address")}><textarea style={{ ...inputStyle, minHeight: 50, resize: "vertical" }} value={newDon.donateur_adresse} onChange={(e) => setNewDon({ ...newDon, donateur_adresse: e.target.value })} /></Field>
                  <Field label={t("recu_nature_label")}>
                    <select style={inputStyle} value={newDon.nature_don} onChange={(e) => setNewDon({ ...newDon, nature_don: e.target.value })}>
                      {NATURE_DON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
                    </select>
                  </Field>
                  {newDon.nature_don === "nature" && (
                    <Field label={t("recu_description_bien_label")}>
                      <input style={inputStyle} value={newDon.description_bien_nature} onChange={(e) => setNewDon({ ...newDon, description_bien_nature: e.target.value })} />
                    </Field>
                  )}
                  {isFranceCerfa && (
                    <>
                      {newDon.nature_don === "numeraire" && (
                        <Field label={t("recu_mode_label")}>
                          <select style={inputStyle} value={newDon.mode_versement} onChange={(e) => setNewDon({ ...newDon, mode_versement: e.target.value })}>
                            {MODE_VERSEMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
                          </select>
                        </Field>
                      )}
                      <Field label={t("recu_forme_label")}>
                        <select style={inputStyle} value={newDon.forme_don} onChange={(e) => setNewDon({ ...newDon, forme_don: e.target.value })}>
                          {FORME_DON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
                        </select>
                      </Field>
                      <Field label={t("recu_base_legale_label")}>
                        <select style={inputStyle} value={newDon.base_legale} onChange={(e) => setNewDon({ ...newDon, base_legale: e.target.value })}>
                          {BASE_LEGALE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
                        </select>
                      </Field>
                    </>
                  )}
                  {isCanadaCRA && (
                    <>
                      <Field label={t("recu_lieu_delivrance_label")}>
                        <input style={inputStyle} value={newDon.lieu_delivrance} onChange={(e) => setNewDon({ ...newDon, lieu_delivrance: e.target.value })} />
                      </Field>
                      {newDon.nature_don === "nature" && Number(newDon.montant) > RECU_CA_FMV_SEUIL_EVALUATEUR && (
                        <>
                          <p style={{ fontSize: 11, color: "#686F7D", margin: "2px 0 8px" }}>{t("recu_evaluateur_section")}</p>
                          <Field label={t("recu_evaluateur_nom_label")}><input style={inputStyle} value={newDon.evaluateur_nom} onChange={(e) => setNewDon({ ...newDon, evaluateur_nom: e.target.value })} /></Field>
                          <Field label={t("recu_evaluateur_adresse_label")}><input style={inputStyle} value={newDon.evaluateur_adresse} onChange={(e) => setNewDon({ ...newDon, evaluateur_adresse: e.target.value })} /></Field>
                        </>
                      )}
                      <p style={{ fontSize: 11, color: "#686F7D", margin: "2px 0 8px" }}>{t("recu_avantage_section")}</p>
                      <Field label={t("recu_avantage_valeur_label")}>
                        <input type="number" style={inputStyle} value={newDon.valeur_avantage} onChange={(e) => setNewDon({ ...newDon, valeur_avantage: e.target.value })} />
                      </Field>
                      {Number(newDon.valeur_avantage) > 0 && (
                        <>
                          <Field label={t("recu_avantage_description_label")}>
                            <input style={inputStyle} value={newDon.description_avantage} onChange={(e) => setNewDon({ ...newDon, description_avantage: e.target.value })} />
                          </Field>
                          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, marginBottom: 14, cursor: "pointer" }}>
                            <input type="checkbox" checked={!!newDon.avantage_type_exclu} onChange={(e) => setNewDon({ ...newDon, avantage_type_exclu: e.target.checked })} style={{ marginTop: 2 }} />
                            {t("recu_avantage_type_exclu_label")}
                          </label>
                          {(() => {
                            const calc = calculerMontantAdmissibleCanada({ montant: newDon.montant, valeurAvantage: newDon.valeur_avantage, avantageTypeExclu: newDon.avantage_type_exclu });
                            return (
                              <>
                                {calc.regle80Depassee && <div style={{ fontSize: 12, color: RED, background: "#FBE4E1", padding: "8px 10px", borderRadius: 8, marginBottom: 12 }}>{t("recu_advantage_warning_80")}</div>}
                                <p style={{ fontSize: 12.5, marginBottom: 14 }}><b>{t("recu_eligible_amount_label")} :</b> {money(calc.admissible, devise)}</p>
                              </>
                            );
                          })()}
                        </>
                      )}
                    </>
                  )}
                </>
              )}
              {projects.length > 0 && (
                <Field label={t("don_target_project_label")}>
                  <select style={inputStyle} value={newDon.projet_id} onChange={(e) => setNewDon({ ...newDon, projet_id: e.target.value })}>
                    <option value="">{t("don_target_project_none")}</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                  </select>
                </Field>
              )}
              <Btn onClick={addDonation}><Plus size={14} /> {t("action_save")}</Btn>
          </Card>
        )}
        {/* 2026-10-06 — tableau des dons étendu : toutes les mentions des
            reçus conformes (France CERFA et/ou Canada ARC) sont désormais
            visibles directement dans le tableau, sans devoir ouvrir le reçu
            de chaque don un par un. Les colonnes propres à chaque juridiction
            ne s'affichent que si l'association l'a effectivement configurée
            (isFranceCerfa / isCanadaCRA), pour ne pas élargir inutilement le
            tableau d'une association qui n'émet aucun reçu conforme. Avec
            les deux juridictions actives à la fois, le tableau devient large
            : minWidth force le défilement horizontal (table-scroll, déjà
            prévu par le composant Table) plutôt que de compresser les
            colonnes jusqu'à les rendre illisibles. */}
        {(() => {
          const donColCount =
            4 + // Donateur, Montant, Projet, Date
            (isFranceCerfa || isCanadaCRA ? 2 : 0) + // Adresse, Nature
            (isFranceCerfa ? 3 : 0) + // Forme, Mode, Base légale
            (isCanadaCRA ? 5 : 0) + // Lieu, Bien, Évaluateur, Avantage, Admissible
            2 + // Reçu émis, bouton Voir le reçu
            (isBureau ? 1 : 0); // Actions
          const donTableMinWidth = 560 + (isFranceCerfa ? 330 : 0) + (isCanadaCRA ? 560 : 0);
          return (
            <Table
              minWidth={donTableMinWidth}
              head={[
                t("don_col_donor"), t("don_col_amount"), t("don_target_project_label"), t("don_col_date"),
                ...(isFranceCerfa || isCanadaCRA ? [t("recu_col_address"), t("recu_col_nature")] : []),
                ...(isFranceCerfa ? [t("recu_col_forme"), t("recu_col_mode"), t("recu_col_base_legale")] : []),
                ...(isCanadaCRA ? [t("recu_col_lieu"), t("recu_col_bien"), t("recu_col_evaluateur"), t("recu_col_avantage"), t("recu_col_admissible")] : []),
                t("don_col_receipt"), "", ...(isBureau ? [t("don_col_actions")] : []),
              ]}
            >
              {donations.map((d) => {
                const natureLabel = NATURE_DON_OPTIONS.find((o) => o.value === d.nature_don)?.labelKey;
                const formeLabel = FORME_DON_OPTIONS.find((o) => o.value === d.forme_don)?.labelKey;
                const modeLabel = MODE_VERSEMENT_OPTIONS.find((o) => o.value === d.mode_versement)?.labelKey;
                const baseLabel = BASE_LEGALE_OPTIONS.find((o) => o.value === d.base_legale)?.labelKey;
                const calcCanada = isCanadaCRA
                  ? calculerMontantAdmissibleCanada({ montant: d.montant, valeurAvantage: d.valeur_avantage, avantageTypeExclu: d.avantage_type_exclu })
                  : null;
                return (
                  <tr key={d.id}>
                    <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>
                      {d.donateur_nom}
                      {d.donateur_email && <div style={{ fontSize: 10.5, fontWeight: 400, color: "#686F7D" }}>{d.donateur_email}</div>}
                    </td>
                    <td style={td}>{money(d.montant, devise)}</td>
                    <td style={td}>{d.projet_id ? (projects.find((p) => p.id === d.projet_id)?.nom || "—") : t("don_target_project_none")}</td>
                    <td style={td}>{d.date}</td>
                    {(isFranceCerfa || isCanadaCRA) && (
                      <>
                        <td style={{ ...td, fontSize: 11.5, whiteSpace: "pre-wrap" }}>{d.donateur_adresse || "—"}</td>
                        <td style={td}>{natureLabel ? t(natureLabel) : "—"}</td>
                      </>
                    )}
                    {isFranceCerfa && (
                      <>
                        <td style={td}>{formeLabel ? t(formeLabel) : "—"}</td>
                        <td style={td}>{d.nature_don === "numeraire" && modeLabel ? t(modeLabel) : "—"}</td>
                        <td style={td}>{baseLabel ? t(baseLabel) : "—"}</td>
                      </>
                    )}
                    {isCanadaCRA && (
                      <>
                        <td style={td}>{d.lieu_delivrance || "—"}</td>
                        <td style={{ ...td, fontSize: 11.5 }}>{d.nature_don === "nature" ? (d.description_bien_nature || "—") : "—"}</td>
                        <td style={{ ...td, fontSize: 11.5 }}>{d.nature_don === "nature" && d.evaluateur_nom ? d.evaluateur_nom : "—"}</td>
                        <td style={td}>{d.valeur_avantage ? money(d.valeur_avantage, devise) : "—"}</td>
                        <td style={{ ...td, fontWeight: calcCanada?.regle80Depassee ? 700 : 400, color: calcCanada?.regle80Depassee ? RED : "inherit" }}>
                          {d.valeur_avantage ? money(calcCanada.admissible, devise) : money(d.montant, devise)}
                        </td>
                      </>
                    )}
                    <td style={{ ...td, color: d.recu_emis ? "#1F8A5C" : "#C0392B", fontWeight: 700 }}>
                      {d.recu_emis ? t("mem_yes") : t("mem_no")}
                      {d.numero_recu && <div style={{ fontSize: 10, fontWeight: 400, color: "#686F7D" }}>{t("don_col_numero")} {String(d.numero_recu).padStart(6, "0")}</div>}
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button onClick={() => setReceiptDonId(d.id)} title={t("don_receipt_btn")} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, border: "1px solid var(--primary)", color: "var(--primary)", background: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <FileText size={11} /> {t("don_receipt_btn")}
                        </button>
                        {isBureau && !d.recu_emis && <button onClick={() => { if (!window.confirm(t("don_confirm_mark_issued").replace("{donateur}", d.donateur_nom).replace("{montant}", money(d.montant, devise)))) return; toggleRecu(d.id, true); }} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, border: "1px solid #1F8A5C", color: "#1F8A5C", background: "none", cursor: "pointer" }}>{t("don_mark_issued")}</button>}
                      </div>
                    </td>
                    {isBureau && (
                      <td style={td}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => setEditingDon(d)} title={t("don_edit_btn")} style={{ width: 22, height: 22, borderRadius: "50%", background: "none", border: "1px solid #DDD", color: "var(--primary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                            <Pencil size={11} />
                          </button>
                          <button onClick={() => deleteDonation(d.id)} title={t("don_delete_btn")} style={{ width: 22, height: 22, borderRadius: "50%", background: "none", border: `1px solid ${RED}`, color: RED, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {donations.length === 0 && <tr><td colSpan={donColCount} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
            </Table>
          );
        })()}

        {editingDon && (
          <EditDonationModal donation={editingDon} projects={projects} onClose={() => setEditingDon(null)} onSave={updateDonation} t={t} />
        )}
        {receiptDonId && (() => {
          const d = donations.find((x) => x.id === receiptDonId);
          if (!d) return null;
          return (
            <DonReceiptModal
              donation={d} association={association} t={t} lang={lang}
              onClose={() => setReceiptDonId(null)}
              onPrinted={() => { if (!d.recu_emis) toggleRecu(d.id, true); }}
              onNumeroAssigned={(numero) => setDonations((prev) => prev.map((x) => (x.id === d.id ? { ...x, numero_recu: numero } : x)))}
            />
          );
        })()}
      </Section></Container>
    );
  }

  // mode === 'emprunts'
  return (
    <Container><Section>
      <h2 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><Landmark size={20} /> {t("nav_loans")}</h2>
      <RuleBox>{t("loan_rule")}</RuleBox>
      {isBureau && (
        <Card style={{ marginBottom: 22, maxWidth: 520 }}>
          <h3 style={{ fontSize: 13, marginBottom: 10 }}>{t("loan_grant_title")}</h3>
          <Field label={t("loan_member_field")}>
            <select style={inputStyle} value={newLoan.member_id} onChange={(e) => setNewLoan({ ...newLoan, member_id: e.target.value })}>
              <option value="">{t("proj_choose")}</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </select>
          </Field>
          <Field label={t("loan_amount_field")}><input type="number" style={inputStyle} value={newLoan.montant_pret} onChange={(e) => setNewLoan({ ...newLoan, montant_pret: e.target.value })} /></Field>
          <Field label={t("loan_interest_field")}><input type="number" style={inputStyle} value={newLoan.taux_interet} onChange={(e) => setNewLoan({ ...newLoan, taux_interet: e.target.value })} /></Field>
          <Field label={t("loan_due_field")}><input type="date" style={inputStyle} value={newLoan.date_echeance} onChange={(e) => setNewLoan({ ...newLoan, date_echeance: e.target.value })} /></Field>
          <Btn onClick={addLoan}><Plus size={14} /> {t("loan_grant_btn")}</Btn>
        </Card>
      )}
      {/* 2026-10-06 — même traitement que le tableau des Dons juste au-dessus
          dans ce fichier : avec 11-12 colonnes, ce tableau se compressait
          jusqu'à devenir illisible plutôt que de défiler. minWidth force le
          défilement horizontal (table-scroll, déjà prévu par le composant
          Table) pour que les deux tableaux de la section Finances aient la
          même disposition. */}
      <Table
        minWidth={950 + (isBureau ? 140 : 0)}
        head={[
          t("loan_col_member"), t("loan_col_lent"), t("loan_col_rate"), t("loan_col_interest"), t("loan_col_total_due"),
          t("loan_col_repaid"), t("loan_col_balance"), t("loan_col_loan_date"), t("loan_col_due"), t("loan_col_status"),
          t("loan_col_repay"), ...(isBureau ? [t("loan_col_actions")] : []),
        ]}
      >
        {loans.map((l) => {
          const repaid = loanRepaid(l.id);
          const interet = loanInterest(l);
          const totalDue = loanTotalDue(l);
          const solde = totalDue - repaid;
          return (
            <tr key={l.id}>
              <td style={td}>
                <button onClick={() => setHistoryLoanId(l.id)} title={t("loan_hist_btn")} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 600, color: "var(--primary)", textDecoration: "underline", fontSize: "inherit", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <History size={11} /> {members.find((m) => m.id === l.member_id)?.nom || "—"}
                </button>
              </td>
              <td style={td}>{money(l.montant_pret, devise)}</td>
              <td style={td}>{Number(l.taux_interet) || 0}%</td>
              <td style={td}>{money(interet, devise)}</td>
              <td style={{ ...td, fontWeight: 600 }}>{money(totalDue, devise)}</td>
              <td style={td}>{money(repaid, devise)}</td>
              <td style={{ ...td, fontWeight: 700, color: solde > 0 ? "#C0392B" : "#1F8A5C" }}>{money(Math.max(solde, 0), devise)}</td>
              <td style={td}>{l.date_pret || "—"}</td>
              <td style={td}>{l.date_echeance || "—"}</td>
              <td style={td}>{l.statut === "actif" ? t("loan_status_actif") : l.statut === "rembourse" ? t("loan_status_rembourse") : l.statut}</td>
              <td style={td}>
                {isBureau && l.statut === "actif" && (
                  <div style={{ display: "flex", gap: 4 }}>
                    <input type="number" placeholder={t("loan_repay_placeholder")} value={repayDraft[l.id] || ""} onChange={(e) => setRepayDraft((p) => ({ ...p, [l.id]: e.target.value }))} style={{ ...inputStyle, width: 80, padding: "3px 6px", fontSize: 11 }} />
                    <button onClick={() => addRepayment(l.id)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, border: "1px solid #1F8A5C", color: "#1F8A5C", background: "none", cursor: "pointer" }}>{t("loan_repay_btn")}</button>
                  </div>
                )}
              </td>
              {isBureau && (
                <td style={td}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => setEditingLoan(l)} title={t("loan_edit_btn")} style={{ width: 22, height: 22, borderRadius: "50%", background: "none", border: "1px solid #DDD", color: "var(--primary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                      <Pencil size={11} />
                    </button>
                    <button onClick={() => deleteLoan(l.id)} title={t("loan_delete_btn")} style={{ width: 22, height: 22, borderRadius: "50%", background: "none", border: `1px solid ${RED}`, color: RED, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          );
        })}
        {loans.length === 0 && <tr><td colSpan={12} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
      </Table>

      {editingLoan && (
        <EditLoanModal loan={editingLoan} members={members} onClose={() => setEditingLoan(null)} onSave={updateLoan} t={t} />
      )}
      {historyLoanId && (() => {
        const l = loans.find((x) => x.id === historyLoanId);
        if (!l) return null;
        return (
          <LoanHistoryModal
            loan={l} borrowerName={members.find((m) => m.id === l.member_id)?.nom || "—"}
            members={members} onClose={() => setHistoryLoanId(null)} t={t} lang={lang} devise={devise}
          />
        );
      })()}
    </Section></Container>
  );
}

function EditDonationModal({ donation, projects, onClose, onSave, t }) {
  const [form, setForm] = useState({
    donateur_nom: donation.donateur_nom || "", donateur_email: donation.donateur_email || "",
    montant: donation.montant ?? "", message: donation.message || "", date: donation.date || todayISO(),
    projet_id: donation.projet_id || "",
  });
  function handleSave() {
    if (!form.donateur_nom.trim() || !form.montant) return;
    onSave(donation.id, {
      donateur_nom: form.donateur_nom.trim(), donateur_email: form.donateur_email.trim() || null,
      montant: Number(form.montant), message: form.message.trim() || null, date: form.date,
      projet_id: form.projet_id || null,
    });
    onClose();
  }
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 480, width: "92%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("don_edit_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <Field label={t("don_donor_name")}><input style={inputStyle} value={form.donateur_nom} onChange={(e) => setForm((p) => ({ ...p, donateur_nom: e.target.value }))} /></Field>
        <Field label={t("don_donor_email")}><input style={inputStyle} value={form.donateur_email} onChange={(e) => setForm((p) => ({ ...p, donateur_email: e.target.value }))} /></Field>
        <Field label={t("don_amount")}><input type="number" style={inputStyle} value={form.montant} onChange={(e) => setForm((p) => ({ ...p, montant: e.target.value }))} /></Field>
        <Field label={t("date")}><input type="date" style={inputStyle} value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} /></Field>
        <Field label={t("don_message")}><input style={inputStyle} value={form.message} onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))} /></Field>
        {projects.length > 0 && (
          <Field label={t("don_target_project_label")}>
            <select style={inputStyle} value={form.projet_id} onChange={(e) => setForm((p) => ({ ...p, projet_id: e.target.value }))}>
              <option value="">{t("don_target_project_none")}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </select>
          </Field>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <Btn onClick={handleSave}>{t("action_save")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("action_close")}</Btn>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// DonReceiptModal — reçu de don imprimable / téléchargeable (même pattern
// que DechargeModal dans App.jsx et ElectionPVModal dans Gouvernance.jsx :
// portail plein écran dont seul le contenu est visible à l'impression).
// =====================================================================
function DonReceiptModal({ donation, association, t, lang, onClose, onPrinted, onNumeroAssigned }) {
  const devise = association?.devise_monetaire || "CAD";
  const todayFormatted = new Date().toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA");
  const dateDon = donation.date ? new Date(donation.date).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA") : "—";
  // Reçu fiscal conforme activé uniquement si l'association a renseigné,
  // en Configuration (Informations légales et reçus), sa catégorie
  // d'éligibilité France (CERFA 2041-RD) et/ou son numéro d'organisme de
  // bienfaisance canadien (ARC) — sinon le reçu générique existant
  // (inchangé) reste affiché, pour ne rien changer aux associations qui
  // émettent déjà leurs propres reçus sans juridiction configurée.
  const isFranceCerfa = !!association?.recu_categorie_eligibilite;
  const isCanadaCRA = !!association?.recu_numero_organisme_bienfaisance;
  const [numeroRecu, setNumeroRecu] = useState(donation.numero_recu || null);
  useEffect(() => {
    if ((!isFranceCerfa && !isCanadaCRA) || numeroRecu) return;
    (async () => {
      const { data, error } = await supabase.rpc("assign_recu_numero", { p_donation_id: donation.id });
      if (!error && data) { setNumeroRecu(data); onNumeroAssigned?.(data); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFranceCerfa, isCanadaCRA, donation.id]);
  const receiptNo = (isFranceCerfa || isCanadaCRA)
    ? (numeroRecu ? String(numeroRecu).padStart(6, "0") : "…")
    : `D-${new Date(donation.date || Date.now()).getFullYear()}-${String(donation.id).slice(0, 8).toUpperCase()}`;
  const natureLabel = t(NATURE_DON_OPTIONS.find((o) => o.value === (donation.nature_don || "numeraire"))?.labelKey || "recu_nature_numeraire");
  const formeLabel = t(FORME_DON_OPTIONS.find((o) => o.value === (donation.forme_don || "declaration_unilaterale"))?.labelKey || "recu_forme_declaration");
  const modeLabel = donation.mode_versement ? t(MODE_VERSEMENT_OPTIONS.find((o) => o.value === donation.mode_versement)?.labelKey || "") : null;
  const baseLegaleLabel = t(BASE_LEGALE_OPTIONS.find((o) => o.value === (donation.base_legale || "art200"))?.labelKey || "recu_base_art200");
  const categorieLabel = t(RECU_CATEGORIES.find((c) => c.value === association?.recu_categorie_eligibilite)?.labelKey || "");
  const calcCanada = isCanadaCRA ? calculerMontantAdmissibleCanada({ montant: donation.montant, valeurAvantage: donation.valeur_avantage, avantageTypeExclu: donation.avantage_type_exclu }) : null;
  function handlePrint() { onPrinted?.(); window.print(); }
  return createPortal(
    <div className="don-print-root" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }} onClick={onClose}>
      <style>{`
        @media print {
          body > *:not(.don-print-root) { display: none !important; }
          .don-print-root { position: static !important; background: white !important; padding: 0 !important; display: block !important; }
          .don-no-print { display: none !important; }
          .don-card { box-shadow: none !important; max-height: none !important; overflow: visible !important; width: 100% !important; max-width: 100% !important; }
        }
      `}</style>
      <div className="don-card" style={{ background: "white", borderRadius: 12, padding: 32, maxWidth: 560, width: "94%", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="don-no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("don_receipt_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        {isCanadaCRA && (
          <p style={{ fontSize: 12.5, fontWeight: 700, textAlign: "center", margin: "0 0 14px", color: "var(--primary)" }}>{t("recu_cra_bilingual_mention")}</p>
        )}
        <h3 style={{ marginBottom: 4 }}>{association?.nom}</h3>
        <OrgLegalSubline association={association} />
        {isFranceCerfa && association?.recu_objet_social && (
          <p style={{ fontSize: 11.5, color: "#666", margin: "2px 0 10px" }}><b>{t("recu_object_label")} :</b> {association.recu_objet_social}</p>
        )}
        {isFranceCerfa && categorieLabel && (
          <p style={{ fontSize: 11.5, color: "#666", margin: "2px 0 10px" }}>{categorieLabel}</p>
        )}
        {isCanadaCRA && (
          <p style={{ fontSize: 11.5, color: "#666", margin: "2px 0 10px" }}><b>{t("recu_numero_bienfaisance_label")} :</b> {association.recu_numero_organisme_bienfaisance}</p>
        )}
        <h4 style={{ marginBottom: 4, fontWeight: 600 }}>{t("don_receipt_title")}</h4>
        <p style={{ fontSize: 12, color: "#686F7D", marginBottom: 20 }}>{(isFranceCerfa || isCanadaCRA ? t("recu_receipt_number_prefix") : t("don_receipt_number_label"))} : {receiptNo}</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
          {isCanadaCRA && association?.adresse && <div><b>{t("recu_issued_place_label")} :</b> {donation.lieu_delivrance || association.adresse}</div>}
          <div><b>{t("don_col_donor")} :</b> {donation.donateur_nom}</div>
          {donation.donateur_email && <div><b>{t("don_donor_email")} :</b> {donation.donateur_email}</div>}
          {(isFranceCerfa || isCanadaCRA) && donation.donateur_adresse && <div style={{ whiteSpace: "pre-wrap" }}><b>{t("recu_donor_address")} :</b> {donation.donateur_adresse}</div>}
          <div><b>{isCanadaCRA ? t("recu_amount_gift_label") : t("don_amount")} :</b> {money(donation.montant, devise)}</div>
          {isFranceCerfa && <div style={{ fontStyle: "italic", fontSize: 12.5 }}><b>{t("recu_amount_words_label")} :</b> {montantEnLettres(donation.montant, devise)}</div>}
          <div><b>{t("date")} :</b> {dateDon}</div>
          {isFranceCerfa && (
            <>
              <div><b>{t("recu_nature_label")} :</b> {natureLabel}</div>
              {modeLabel && <div><b>{t("recu_mode_label")} :</b> {modeLabel}</div>}
              <div><b>{t("recu_forme_label")} :</b> {formeLabel}</div>
              <div><b>{t("recu_base_legale_label")} :</b> {baseLegaleLabel}</div>
            </>
          )}
          {isCanadaCRA && (
            <>
              <div><b>{t("recu_nature_label")} :</b> {natureLabel}</div>
              {donation.nature_don === "nature" && donation.description_bien_nature && (
                <div><b>{t("recu_description_bien_label")} :</b> {donation.description_bien_nature}</div>
              )}
              {donation.nature_don === "nature" && Number(donation.montant) > RECU_CA_FMV_SEUIL_EVALUATEUR && donation.evaluateur_nom && (
                <div><b>{t("recu_evaluateur_nom_label")} :</b> {donation.evaluateur_nom}{donation.evaluateur_adresse ? ` — ${donation.evaluateur_adresse}` : ""}</div>
              )}
              {Number(donation.valeur_avantage) > 0 && (
                <>
                  <div><b>{t("recu_avantage_description_label")} :</b> {donation.description_avantage || "—"} ({money(donation.valeur_avantage, devise)})</div>
                  {calcCanada?.regle80Depassee && (
                    <div style={{ fontSize: 12, color: RED, background: "#FBE4E1", padding: "8px 10px", borderRadius: 8 }}>{t("recu_advantage_warning_80")}</div>
                  )}
                </>
              )}
              <div style={{ fontWeight: 700 }}><b>{t("recu_eligible_amount_label")} :</b> {money(calcCanada?.admissible ?? donation.montant, devise)}</div>
            </>
          )}
          {donation.message && <div><b>{t("don_receipt_message_label")} :</b> {donation.message}</div>}
        </div>

        <p style={{ fontSize: 13, color: "#5B6270", marginTop: 24 }}>{t("don_receipt_thanks")}</p>
        {isFranceCerfa && (
          <p style={{ fontSize: 10.5, color: "#8A8F98", marginTop: 14, whiteSpace: "pre-wrap" }}>{t("recu_legal_mention_cerfa")}</p>
        )}
        {isCanadaCRA && (
          <>
            <p style={{ fontSize: 10.5, color: "#8A8F98", marginTop: 14, whiteSpace: "pre-wrap" }}>{t("recu_cra_legal_mention")}</p>
            <p style={{ fontSize: 10.5, color: "#8A8F98", marginTop: 4 }}>{t("recu_cra_website_mention")}</p>
          </>
        )}
        {association?.recu_mention_legale && (
          <p style={{ fontSize: 11, color: "#686F7D", marginTop: 10, whiteSpace: "pre-wrap" }}>{association.recu_mention_legale}</p>
        )}

        <div style={{ marginTop: 50 }}>
          <p style={{ fontSize: 11.5, color: "#5B6270", fontStyle: "italic", marginBottom: 18 }}>{t("gov_pv_esignature_notice")}</p>
          <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
            <SignatureLine label={t("gov_pv_signature_president")} printClass="don-no-print" t={t} />
            <SignatureLine label={t("don_receipt_signature_tresorier")} printClass="don-no-print" t={t} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#5B6270", marginTop: 6 }}>{t("don_receipt_issued_on")} : <b>{todayFormatted}</b></div>

        <div className="don-no-print" style={{ display: "flex", gap: 10, marginTop: 30 }}>
          <Btn onClick={handlePrint}><Printer size={14} /> {t("fin_print_btn")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("tont_decharge_close")}</Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}

function EditLoanModal({ loan, members, onClose, onSave, t }) {
  const [form, setForm] = useState({
    member_id: loan.member_id || "", montant_pret: loan.montant_pret ?? "",
    taux_interet: loan.taux_interet ?? 0, date_echeance: loan.date_echeance || "", statut: loan.statut || "actif",
  });
  function handleSave() {
    if (!form.member_id || !form.montant_pret) return;
    onSave(loan.id, {
      member_id: form.member_id, montant_pret: Number(form.montant_pret),
      taux_interet: Number(form.taux_interet) || 0, date_echeance: form.date_echeance || null, statut: form.statut,
    });
    onClose();
  }
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 480, width: "92%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("loan_edit_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <Field label={t("loan_member_field")}>
          <select style={inputStyle} value={form.member_id} onChange={(e) => setForm((p) => ({ ...p, member_id: e.target.value }))}>
            <option value="">{t("proj_choose")}</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </select>
        </Field>
        <Field label={t("loan_amount_field")}><input type="number" style={inputStyle} value={form.montant_pret} onChange={(e) => setForm((p) => ({ ...p, montant_pret: e.target.value }))} /></Field>
        <Field label={t("loan_interest_field")}><input type="number" style={inputStyle} value={form.taux_interet} onChange={(e) => setForm((p) => ({ ...p, taux_interet: e.target.value }))} /></Field>
        <Field label={t("loan_due_field")}><input type="date" style={inputStyle} value={form.date_echeance} onChange={(e) => setForm((p) => ({ ...p, date_echeance: e.target.value }))} /></Field>
        <Field label={t("loan_col_status")}>
          <select style={inputStyle} value={form.statut} onChange={(e) => setForm((p) => ({ ...p, statut: e.target.value }))}>
            <option value="actif">{t("loan_status_actif")}</option>
            <option value="rembourse">{t("loan_status_rembourse")}</option>
          </select>
        </Field>
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <Btn onClick={handleSave}>{t("action_save")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("action_close")}</Btn>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// LoanHistoryModal — historique complet lié à un prêt : octroi, modifications
// (capital, taux, échéance, emprunteur, statut) et chaque remboursement
// enregistré, reconstitué à partir du journal d'activité (`activity_log`,
// déjà alimenté automatiquement pour les tables "loans" et "loan_repayments" —
// voir MemberHistoryModal dans App.jsx qui l'utilise déjà, côté membre).
// =====================================================================
function LoanHistoryModal({ loan, borrowerName, members, onClose, t, lang, devise }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      setLoading(true);
      const [loanRes, repayRes] = await Promise.all([
        supabase.from("activity_log").select("*").eq("table_name", "loans").eq("record_id", loan.id).order("created_at", { ascending: false }),
        // Les remboursements n'ont pas de "member_id" propre indexé dans `details` (contrairement
        // aux tables utilisées par MemberHistoryModal) : on filtre donc sur l'enregistrement complet
        // capturé par le déclencheur (`details.nouveau`/`details.ancien`), qui contient toujours loan_id.
        supabase.from("activity_log").select("*").eq("table_name", "loan_repayments")
          .or(`details->nouveau->>loan_id.eq.${loan.id},details->ancien->>loan_id.eq.${loan.id}`)
          .order("created_at", { ascending: false }),
      ]);
      const combined = [...(loanRes.data || []), ...(repayRes.data || [])];
      combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setLogs(combined);
      setLoading(false);
    }
    loadHistory();
  }, [loan.id]);

  function nameOf(memberId) { return members.find((m) => m.id === memberId)?.nom || "—"; }
  function statusLabel(s) { return s === "actif" ? t("loan_status_actif") : s === "rembourse" ? t("loan_status_rembourse") : s; }

  function describe(log) {
    if (log.table_name === "loan_repayments") {
      if (log.action === "INSERT") return t("loan_hist_repayment").replace("{amount}", money(log.details?.nouveau?.montant, devise));
      if (log.action === "DELETE") return t("loan_hist_repayment_removed");
      return null;
    }
    // table_name === "loans"
    if (log.action === "INSERT") return t("loan_hist_granted").replace("{amount}", money(log.details?.nouveau?.montant_pret, devise));
    if (log.action === "DELETE") return t("loan_hist_deleted");
    if (log.action === "UPDATE" && log.details?.ancien && log.details?.nouveau) {
      const a = log.details.ancien, n = log.details.nouveau;
      const lines = [];
      if (a.statut !== n.statut) {
        lines.push(n.statut === "rembourse" ? t("loan_hist_repaid_full") : t("loan_hist_status_changed").replace("{status}", statusLabel(n.statut)));
      }
      if (Number(a.montant_pret) !== Number(n.montant_pret)) {
        lines.push(t("loan_hist_amount_changed").replace("{old}", money(a.montant_pret, devise)).replace("{new}", money(n.montant_pret, devise)));
      }
      if (Number(a.taux_interet || 0) !== Number(n.taux_interet || 0)) {
        lines.push(t("loan_hist_rate_changed").replace("{old}", Number(a.taux_interet) || 0).replace("{new}", Number(n.taux_interet) || 0));
      }
      if ((a.date_echeance || "") !== (n.date_echeance || "")) {
        lines.push(t("loan_hist_due_changed").replace("{old}", a.date_echeance || "—").replace("{new}", n.date_echeance || "—"));
      }
      if (a.member_id !== n.member_id) {
        lines.push(t("loan_hist_borrower_changed").replace("{old}", nameOf(a.member_id)).replace("{new}", nameOf(n.member_id)));
      }
      return lines.length ? lines.join(" — ") : null;
    }
    return null;
  }

  const entries = logs.map((log) => ({ log, text: describe(log) })).filter((e) => e.text);

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 560, width: "92%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("loan_hist_title")} — {borrowerName}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {loading ? (
          <p style={{ color: "#686F7D" }}>{t("loading")}</p>
        ) : entries.length === 0 ? (
          <p style={{ color: "#686F7D", fontStyle: "italic" }}>{t("loan_hist_empty")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {entries.map(({ log, text }) => (
              <div key={log.id} style={{ borderBottom: "1px solid #EEE", paddingBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#686F7D", marginBottom: 2 }}>{new Date(log.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</div>
                <div style={{ fontSize: 13, color: "#333" }}>{text}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <Btn variant="outline" onClick={onClose}>{t("action_close")}</Btn>
        </div>
      </div>
    </div>
  );
}
