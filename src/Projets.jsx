// =====================================================================
// Projets.jsx — Incubateur de suivi de projets (mise au point, budgétisation,
// échéancier avec dépendances, portefeuille multi-projets) + Kanban de tâches
// Développé par Omnia Trade Solutions
// =====================================================================
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Kanban, Plus, Pencil, Trash2, LayoutDashboard, Wallet, CalendarRange, Flag, AlertTriangle,
  CheckSquare, Square, MessageSquare, History, Copy, HeartHandshake, Award, Globe, Repeat, Users, FileDown, Send,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { enTeteOfficiel, piedsDePageOfficiels } from "./pdfOfficiel";
import { Section, Container, Card, Btn, Field, Table, Pill, StatCard, inputStyle, money, todayISO, useLang, TEAL, TEAL_LIGHT, RED, friendlyError, foldText } from "./shared";

const AMBER = "#8A5A00";

const COLUMNS = [
  { key: "a_faire", labelKey: "proj_col_a_faire" },
  { key: "en_cours", labelKey: "proj_col_en_cours" },
  { key: "termine", labelKey: "proj_col_termine" },
];
const STATUTS = ["propose", "actif", "en_pause", "termine", "annule"];
const PRIORITES = ["basse", "normale", "haute"];
const RECURRENCES = ["hebdomadaire", "mensuel"];

// ---------------------------------------------------------------------
// Rapport d'impact (PDF) — généré à la clôture ou à tout moment sur un
// projet, pour partage avec les donateurs/le Bureau. Réutilise le même
// patron que buildSessionPdf() (Présences).
// ---------------------------------------------------------------------
async function buildImpactReportPdf({ t, association, project, tasks, budgetLines, expenses, milestones, members, donationsTotal, devise }) {
  let jsPDFmod, autoTableMod;
  try {
    [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  } catch {
    throw new Error(t("rap_missing_deps"));
  }
  const { jsPDF } = jsPDFmod;
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 40;
  let y = 50;

  // Logo + mentions légales (pdfOfficiel.js) — demande de l'utilisateur
  // (2026-10-09) : sur tous les documents générés, pour leur authenticité.
  y = await enTeteOfficiel(doc, association, { marge: marginX });

  doc.setFontSize(14); doc.setTextColor(31, 56, 100); doc.setFont(undefined, "bold");
  doc.text(t("proj_impact_report_title") + " — " + project.nom, marginX, y); y += 20;

  const avancement = computeAvancement(tasks);
  const { prevu, depense } = computeBudgetTotals(budgetLines, expenses);
  const nbDone = tasks.filter((t2) => t2.colonne === "termine").length;
  const contributeurs = new Set(tasks.filter((t2) => t2.colonne === "termine" && t2.assigne_id).map((t2) => t2.assigne_id));

  doc.setFontSize(10.5); doc.setTextColor(60, 60, 60); doc.setFont(undefined, "normal");
  const summaryLines = [
    `${t("proj_progress_label")} : ${avancement}%`,
    `${t("proj_impact_tasks_done")} : ${nbDone} / ${tasks.length}`,
    `${t("proj_impact_contributors")} : ${contributeurs.size}`,
    `${t("proj_budget_summary_planned")} : ${money(prevu, devise)} — ${t("proj_budget_summary_spent")} : ${money(depense, devise)}`,
  ];
  if (donationsTotal > 0) summaryLines.push(`${t("proj_impact_donations")} : ${money(donationsTotal, devise)}`);
  summaryLines.forEach((line) => { doc.text(line, marginX, y); y += 15; });
  y += 6;

  if (milestones.length) {
    doc.setFontSize(12); doc.setTextColor(31, 56, 100); doc.setFont(undefined, "bold");
    doc.text(t("proj_milestones_title"), marginX, y); y += 6;
    autoTable(doc, {
      startY: y, margin: { left: marginX, right: marginX },
      head: [[t("proj_milestone_title_placeholder"), t("proj_milestone_status_atteint")]],
      body: milestones.map((m) => [m.titre, t("proj_milestone_status_" + m.statut)]),
      styles: { fontSize: 9.5, cellPadding: 5 },
      headStyles: { fillColor: [31, 56, 100], textColor: 255, fontSize: 9 },
    });
    y = doc.lastAutoTable.finalY + 16;
  }

  doc.setFontSize(12); doc.setTextColor(31, 56, 100); doc.setFont(undefined, "bold");
  doc.text(t("proj_tab_taches"), marginX, y); y += 6;
  autoTable(doc, {
    startY: y, margin: { left: marginX, right: marginX },
    head: [[t("proj_task_title_placeholder"), t("proj_assigned_to"), t("proj_task_percent")]],
    body: tasks.map((t2) => [t2.titre, members.find((m) => m.id === t2.assigne_id)?.nom || t("proj_unassigned"), `${t2.pourcentage || 0}%`]),
    styles: { fontSize: 9.5, cellPadding: 5 },
    headStyles: { fillColor: [31, 56, 100], textColor: 255, fontSize: 9 },
    alternateRowStyles: { fillColor: [247, 248, 250] },
  });

  if (project.notes) {
    y = doc.lastAutoTable.finalY + 18;
    doc.setFontSize(10.5); doc.setTextColor(60, 60, 60); doc.setFont(undefined, "normal");
    const lines = doc.splitTextToSize(project.notes, 520);
    doc.text(lines, marginX, y);
  }

  piedsDePageOfficiels(doc, association, { marge: marginX, texte: `${t("proj_impact_report_title")} - ${project.nom}` });
  return doc;
}

// =====================================================================
// Helpers de calcul (purs, sans dépendance à React) — tous les calculs
// du module se font ici, à partir des données chargées, comme demandé.
// =====================================================================
function computeAvancement(projectTasks) {
  if (!projectTasks.length) return 0;
  const sum = projectTasks.reduce((s, t2) => s + (Number(t2.pourcentage) || 0), 0);
  return Math.round(sum / projectTasks.length);
}
function computeBudgetTotals(lines, expenses) {
  const prevu = lines.reduce((s, l) => s + (Number(l.montant_prevu) || 0), 0);
  const depense = expenses.reduce((s, e) => s + (Number(e.montant) || 0), 0);
  const percent = prevu > 0 ? (depense / prevu) * 100 : 0;
  return { prevu, depense, ecart: prevu - depense, percent };
}
function computeForecast(depense, avancement) {
  if (!avancement) return null;
  return depense / (avancement / 100);
}
function nextMilestone(projectMilestones) {
  const upcoming = projectMilestones.filter((m) => m.statut !== "atteint" && m.date_cible);
  if (!upcoming.length) return null;
  return [...upcoming].sort((a, b) => a.date_cible.localeCompare(b.date_cible))[0];
}
// Toutes les tâches dont `id` dépend, directement ou indirectement (ses "ancêtres").
function ancestorsOf(tasksById, id, seen = new Set()) {
  const t2 = tasksById[id];
  if (!t2) return seen;
  for (const dep of t2.dependances || []) {
    if (!seen.has(dep)) { seen.add(dep); ancestorsOf(tasksById, dep, seen); }
  }
  return seen;
}
function statusPillColors(statut) {
  switch (statut) {
    case "actif": return { color: TEAL, bg: TEAL_LIGHT };
    case "en_pause": return { color: AMBER, bg: "#FBF3D9" };
    case "termine": return { color: "#182233", bg: "#EDEDEE" };
    case "annule": return { color: RED, bg: "#FBE4E1" };
    default: return { color: "#5B6B94", bg: "#EAEDF6" }; // propose
  }
}
function toDate(s) { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
function addDays(s, n) { const dt = toDate(s); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); }
function addMonths(s, n) { const dt = toDate(s); dt.setUTCMonth(dt.getUTCMonth() + n); return dt.toISOString().slice(0, 10); }

const overlay = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 };
const modalBox = { background: "white", borderRadius: 12, padding: 24, maxWidth: 560, width: "92%", maxHeight: "88vh", overflowY: "auto" };
const modalHeader = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 };
const closeBtnStyle = { background: "none", border: "none", cursor: "pointer", fontSize: 18 };

export default function Projets({ profile, isBureau, association }) {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [budgetLines, setBudgetLines] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [checklistItems, setChecklistItems] = useState([]);
  const [comments, setComments] = useState([]);
  const [donations, setDonations] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [portfolioView, setPortfolioView] = useState("portefeuille"); // "portefeuille" | "charge"
  const [activeTab, setActiveTab] = useState("apercu");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [activityLog, setActivityLog] = useState([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const { t } = useLang();
  // 2026-09-28 (suite 80) — devise réelle de l'association plutôt qu'un CAD
  // codé en dur : ce module (budgets/dépenses de projets) n'avait jamais été
  // corrigé lors du chantier devise (suite 78), tous les montants s'y
  // affichaient donc toujours en CAD quelle que soit la devise configurée.
  const devise = association?.devise_monetaire || "CAD";
  // Toute écriture Supabase passe par ce garde-fou : en cas d'erreur (RLS,
  // colonne manquante si le script SQL n'a pas été exécuté, etc.), affiche un
  // message à l'écran ET journalise l'erreur complète dans la console (F12)
  // plutôt que d'échouer silencieusement (limite constatée par l'utilisateur
  // à la livraison de la suite 54).
  function reportError(error) {
    if (error) { console.error("[Projets]", error); setErrorMsg(friendlyError(error, t)); return true; }
    return false;
  }

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: pr }, { data: tk }, { data: mem }, { data: bl }, { data: ex }, { data: ms }, { data: ci }, { data: cm }, { data: dn }] = await Promise.all([
      supabase.from("projects").select("*").eq("association_id", profile.association_id).order("created_at", { ascending: false }),
      supabase.from("project_tasks").select("*").eq("association_id", profile.association_id),
      supabase.from("members").select("id,nom").order("nom"),
      supabase.from("project_budget_lines").select("*").eq("association_id", profile.association_id).order("ordre"),
      supabase.from("project_expenses").select("*").eq("association_id", profile.association_id).order("date_depense", { ascending: false }),
      supabase.from("project_milestones").select("*").eq("association_id", profile.association_id).order("ordre"),
      supabase.from("project_task_checklist_items").select("*").eq("association_id", profile.association_id).order("ordre"),
      supabase.from("project_task_comments").select("*").eq("association_id", profile.association_id).order("created_at"),
      supabase.from("donations").select("id,montant,projet_id").eq("association_id", profile.association_id).not("projet_id", "is", null),
    ]);
    setProjects(pr || []); setTasks(tk || []); setMembers((mem || []).filter((m) => m.statut !== "Supprimé"));
    setBudgetLines(bl || []); setExpenses(ex || []); setMilestones(ms || []);
    setChecklistItems(ci || []); setComments(cm || []); setDonations(dn || []);
    setLoading(false);
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);

  // Historique/activité — chargé à la demande (onglet "Activité"), pas au
  // chargement initial : activity_log est une table transverse qui peut
  // devenir volumineuse, et seules les lignes concernant CE projet et ses
  // tâches sont utiles ici.
  const loadActivity = useCallback(async (projectId, projectTaskIds) => {
    const recordIds = [projectId, ...projectTaskIds];
    const { data } = await supabase.from("activity_log").select("*")
      .eq("association_id", profile.association_id)
      .in("table_name", ["projects", "project_tasks"])
      .in("record_id", recordIds)
      .order("created_at", { ascending: false })
      .limit(100);
    setActivityLog(data || []);
  }, [profile.association_id]);

  // ---------- Projets ----------
  const [newProject, setNewProject] = useState({ nom: "", description: "", responsable_id: "", categorie: "", priorite: "normale", date_debut: "", date_fin_prevue: "" });
  async function createProject() {
    if (!newProject.nom.trim() || !isBureau) return;
    if (!window.confirm(t("proj_confirm_create_project").replace("{nom}", newProject.nom.trim()))) return;
    const { data, error } = await supabase.from("projects").insert({
      association_id: profile.association_id, nom: newProject.nom, description: newProject.description,
      responsable_id: newProject.responsable_id || null, categorie: newProject.categorie.trim() || null,
      priorite: newProject.priorite, statut: "actif",
      date_debut: newProject.date_debut || null, date_fin_prevue: newProject.date_fin_prevue || null,
      budget_prevu: 0,
    }).select().single();
    if (reportError(error)) return;
    setProjects((p) => [data, ...p]); setSelectedProject(data.id); setActiveTab("apercu");
    setNewProject({ nom: "", description: "", responsable_id: "", categorie: "", priorite: "normale", date_debut: "", date_fin_prevue: "" });
  }

  const [editingProject, setEditingProject] = useState(null);
  async function updateProject(projectId, patch) {
    const { error } = await supabase.from("projects").update(patch).eq("id", projectId);
    if (reportError(error)) return;
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, ...patch } : p)));
  }
  async function deleteProject(projectId) {
    if (!window.confirm(t("proj_confirm_delete_project"))) return;
    // Enfants supprimés avant le projet (pas l'inverse) : project_tasks n'a pas
    // de contrainte ON DELETE CASCADE vers projects, donc supprimer le projet
    // en premier échouerait avec une violation de clé étrangère.
    await supabase.from("project_expenses").delete().eq("project_id", projectId);
    await supabase.from("project_budget_lines").delete().eq("project_id", projectId);
    await supabase.from("project_milestones").delete().eq("project_id", projectId);
    await supabase.from("project_tasks").delete().eq("project_id", projectId);
    const { error } = await supabase.from("projects").delete().eq("id", projectId);
    if (reportError(error)) return;
    setExpenses((prev) => prev.filter((e) => e.project_id !== projectId));
    setBudgetLines((prev) => prev.filter((l) => l.project_id !== projectId));
    setMilestones((prev) => prev.filter((m) => m.project_id !== projectId));
    setTasks((prev) => prev.filter((t2) => t2.project_id !== projectId));
    setProjects((prev) => {
      const remaining = prev.filter((p) => p.id !== projectId);
      setSelectedProject((sel) => (sel === projectId ? null : sel));
      return remaining;
    });
  }

  // ---------- Tâches ----------
  const [newTask, setNewTask] = useState({ titre: "", assigne_id: "", date_debut: "", echeance: "", recurrence: "" });
  async function addTask() {
    if (!newTask.titre.trim() || !selectedProject) return;
    if (!window.confirm(t("proj_confirm_add_task").replace("{titre}", newTask.titre.trim()))) return;
    const { data, error } = await supabase.from("project_tasks").insert({
      project_id: selectedProject, association_id: profile.association_id, titre: newTask.titre,
      assigne_id: newTask.assigne_id || null, date_debut: newTask.date_debut || null, echeance: newTask.echeance || null,
      colonne: "a_faire", pourcentage: 0, dependances: [], recurrence: newTask.recurrence || null,
    }).select().single();
    if (reportError(error)) return;
    setTasks((p) => [...p, data]); setNewTask({ titre: "", assigne_id: "", date_debut: "", echeance: "", recurrence: "" });
  }
  async function moveTask(taskId, colonne) {
    const task = tasks.find((t2) => t2.id === taskId);
    setTasks((prev) => prev.map((t2) => (t2.id === taskId ? { ...t2, colonne, pourcentage: colonne === "termine" ? 100 : t2.pourcentage } : t2)));
    const patch = colonne === "termine" ? { colonne, pourcentage: 100 } : { colonne };
    const { error } = await supabase.from("project_tasks").update(patch).eq("id", taskId);
    if (reportError(error)) return;
    // Tâches récurrentes (2026-09-30, modernisation) : marquer "Terminé"
    // une tâche portant une récurrence recrée automatiquement la
    // prochaine occurrence (mêmes titre/assigné, échéance décalée),
    // déclenché côté client comme documenté dans le script SQL.
    if (task && colonne === "termine" && task.recurrence && task.echeance) {
      const nextEcheance = task.recurrence === "hebdomadaire" ? addDays(task.echeance, 7) : addMonths(task.echeance, 1);
      const { data } = await supabase.from("project_tasks").insert({
        project_id: task.project_id, association_id: task.association_id, titre: task.titre,
        assigne_id: task.assigne_id, date_debut: null, echeance: nextEcheance,
        colonne: "a_faire", pourcentage: 0, dependances: [], recurrence: task.recurrence,
      }).select().single();
      if (data) setTasks((p) => [...p, data]);
    }
  }
  const [editingTask, setEditingTask] = useState(null);
  async function updateTask(taskId, patch) {
    const { error } = await supabase.from("project_tasks").update(patch).eq("id", taskId);
    if (reportError(error)) return;
    setTasks((prev) => prev.map((t2) => (t2.id === taskId ? { ...t2, ...patch } : t2)));
  }
  async function deleteTask(taskId) {
    if (!window.confirm(t("proj_confirm_delete_task"))) return;
    const { error } = await supabase.from("project_tasks").delete().eq("id", taskId);
    if (reportError(error)) return;
    setTasks((prev) => prev.filter((t2) => t2.id !== taskId));
  }

  // ---------- Sous-tâches (checklist) ----------
  async function addChecklistItem(taskId, texte) {
    if (!texte.trim()) return;
    const ordre = checklistItems.filter((c) => c.task_id === taskId).length;
    const { data, error } = await supabase.from("project_task_checklist_items").insert({
      association_id: profile.association_id, task_id: taskId, texte: texte.trim(), ordre,
    }).select().single();
    if (reportError(error)) return;
    setChecklistItems((p) => [...p, data]);
  }
  async function toggleChecklistItem(itemId, complete) {
    setChecklistItems((prev) => prev.map((c) => (c.id === itemId ? { ...c, complete } : c)));
    const { error } = await supabase.from("project_task_checklist_items").update({ complete }).eq("id", itemId);
    reportError(error);
  }
  async function deleteChecklistItem(itemId) {
    const { error } = await supabase.from("project_task_checklist_items").delete().eq("id", itemId);
    if (reportError(error)) return;
    setChecklistItems((prev) => prev.filter((c) => c.id !== itemId));
  }

  // ---------- Commentaires (Bureau, accès direct à la table) ----------
  async function addComment(taskId, contenu) {
    if (!contenu.trim()) return;
    const { data, error } = await supabase.from("project_task_comments").insert({
      association_id: profile.association_id, task_id: taskId, auteur_id: profile.id, auteur_nom: profile.nom_complet, contenu: contenu.trim(),
    }).select().single();
    if (reportError(error)) return;
    setComments((p) => [...p, data]);
  }
  async function deleteComment(commentId) {
    const { error } = await supabase.from("project_task_comments").delete().eq("id", commentId);
    if (reportError(error)) return;
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  }

  // ---------- Modèles de projet ----------
  async function createFromTemplate(modeleId, nouveauNom) {
    const { data, error } = await supabase.rpc("dupliquer_projet_depuis_modele", { p_modele_id: modeleId, p_nouveau_nom: nouveauNom });
    const row = Array.isArray(data) ? data[0] : data;
    if (reportError(error)) return;
    if (!row || row.status !== "cree") {
      setErrorMsg(t("proj_template_error_" + (row?.status || "inconnu")) || t("error_generic"));
      return;
    }
    await load();
    setSelectedProject(row.nouveau_projet_id);
    setActiveTab("apercu");
    setShowTemplateModal(false);
  }

  // ---------- Budget (lignes) ----------
  const [newBudgetLine, setNewBudgetLine] = useState({ categorie: "", libelle: "", montant_prevu: "" });
  async function addBudgetLine() {
    if (!newBudgetLine.libelle.trim() || !selectedProject) return;
    if (!window.confirm(t("proj_confirm_add_budget_line").replace("{libelle}", newBudgetLine.libelle.trim()))) return;
    const ordre = budgetLines.filter((l) => l.project_id === selectedProject).length;
    const { data, error } = await supabase.from("project_budget_lines").insert({
      association_id: profile.association_id, project_id: selectedProject,
      categorie: newBudgetLine.categorie.trim() || null, libelle: newBudgetLine.libelle.trim(),
      montant_prevu: Number(newBudgetLine.montant_prevu) || 0, ordre,
    }).select().single();
    if (reportError(error)) return;
    setBudgetLines((p) => [...p, data]); setNewBudgetLine({ categorie: "", libelle: "", montant_prevu: "" });
  }
  function editBudgetLineLocal(lineId, patch) { setBudgetLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...patch } : l))); }
  async function saveBudgetLine(lineId, patch) { const { error } = await supabase.from("project_budget_lines").update(patch).eq("id", lineId); reportError(error); }
  async function deleteBudgetLine(lineId) {
    if (!window.confirm(t("proj_budget_confirm_delete_line"))) return;
    const { error } = await supabase.from("project_budget_lines").delete().eq("id", lineId);
    if (reportError(error)) return;
    setBudgetLines((prev) => prev.filter((l) => l.id !== lineId));
  }

  // ---------- Budget (dépenses) ----------
  const [newExpense, setNewExpense] = useState({ date_depense: "", montant: "", description: "", budget_line_id: "" });
  async function addExpense() {
    if (!newExpense.montant || !selectedProject) return;
    if (!window.confirm(t("proj_confirm_add_expense").replace("{montant}", money(Number(newExpense.montant) || 0, devise)))) return;
    const { data, error } = await supabase.from("project_expenses").insert({
      association_id: profile.association_id, project_id: selectedProject,
      budget_line_id: newExpense.budget_line_id || null, date_depense: newExpense.date_depense || todayISO(),
      montant: Number(newExpense.montant) || 0, description: newExpense.description.trim() || null,
    }).select().single();
    if (reportError(error)) return;
    setExpenses((p) => [data, ...p]); setNewExpense({ date_depense: "", montant: "", description: "", budget_line_id: "" });
  }
  async function deleteExpense(id) {
    if (!window.confirm(t("proj_budget_confirm_delete_expense"))) return;
    const { error } = await supabase.from("project_expenses").delete().eq("id", id);
    if (reportError(error)) return;
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }

  // ---------- Jalons ----------
  const [newMilestone, setNewMilestone] = useState({ titre: "", date_cible: "" });
  async function addMilestone() {
    if (!newMilestone.titre.trim() || !selectedProject) return;
    if (!window.confirm(t("proj_confirm_add_milestone").replace("{titre}", newMilestone.titre.trim()))) return;
    const ordre = milestones.filter((m) => m.project_id === selectedProject).length;
    const { data, error } = await supabase.from("project_milestones").insert({
      association_id: profile.association_id, project_id: selectedProject,
      titre: newMilestone.titre.trim(), date_cible: newMilestone.date_cible || null, statut: "a_venir", ordre,
    }).select().single();
    if (reportError(error)) return;
    setMilestones((p) => [...p, data]); setNewMilestone({ titre: "", date_cible: "" });
  }
  function editMilestoneLocal(id, patch) { setMilestones((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m))); }
  async function saveMilestone(id, patch) { const { error } = await supabase.from("project_milestones").update(patch).eq("id", id); reportError(error); }
  async function deleteMilestone(id) {
    if (!window.confirm(t("proj_milestone_confirm_delete"))) return;
    const { error } = await supabase.from("project_milestones").delete().eq("id", id);
    if (reportError(error)) return;
    setMilestones((prev) => prev.filter((m) => m.id !== id));
  }

  if (loading) return <Container><Section><p>{t("loading")}</p></Section></Container>;

  const project = projects.find((p) => p.id === selectedProject);
  const projectTasks = tasks.filter((t2) => t2.project_id === selectedProject);
  const projectLines = budgetLines.filter((l) => l.project_id === selectedProject);
  const projectExpenses = expenses.filter((e) => e.project_id === selectedProject);
  const projectMilestones = milestones.filter((m) => m.project_id === selectedProject);
  const tasksById = Object.fromEntries(tasks.map((t2) => [t2.id, t2]));
  const projectDonationsTotal = donations.filter((d) => d.projet_id === selectedProject).reduce((s, d) => s + (Number(d.montant) || 0), 0);
  const projectTaskIds = projectTasks.map((t2) => t2.id);
  const projectComments = comments.filter((c) => projectTaskIds.includes(c.task_id));

  const TABS = [
    { key: "apercu", labelKey: "proj_tab_apercu", Icon: LayoutDashboard },
    { key: "budget", labelKey: "proj_tab_budget", Icon: Wallet },
    { key: "taches", labelKey: "proj_tab_taches", Icon: Kanban },
    { key: "echeancier", labelKey: "proj_tab_echeancier", Icon: CalendarRange },
    { key: "activite", labelKey: "proj_tab_activite", Icon: History },
  ];

  function selectTab(key) {
    setActiveTab(key);
    if (key === "activite" && project) loadActivity(project.id, projectTaskIds);
  }

  const publicLink = project && association?.slug_public ? `${window.location.origin}/?pub=${association.slug_public}&projet=${project.id}` : "";
  function copyPublicLink() {
    navigator.clipboard?.writeText(publicLink);
    window.alert(t("proj_public_link_copied"));
  }

  return (
    <Container><Section>
      <h2 style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}><Kanban size={20} /> {t("nav_projects")}</h2>

      {errorMsg && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "#FBE4E1", color: RED, border: "1px solid #F3C6C0", borderRadius: 10, padding: "10px 14px", marginBottom: 18, fontSize: 12.5, fontWeight: 600 }}>
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg("")} style={{ background: "none", border: "none", color: RED, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
        <button onClick={() => setSelectedProject(null)} style={{
          padding: "8px 14px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
          display: "inline-flex", alignItems: "center", gap: 6,
          background: selectedProject === null ? "var(--primary)" : "white", color: selectedProject === null ? "white" : "var(--primary)",
          boxShadow: "0 2px 8px rgba(0,0,0,.08)",
        }}><LayoutDashboard size={13} /> {t("proj_view_portfolio")}</button>
        {projects.map((p) => (
          <button key={p.id} onClick={() => setSelectedProject(p.id)} style={{
            padding: "8px 14px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
            background: selectedProject === p.id ? "var(--primary)" : "white", color: selectedProject === p.id ? "white" : "var(--primary)",
            boxShadow: "0 2px 8px rgba(0,0,0,.08)", display: "inline-flex", alignItems: "center", gap: 6,
          }}>{p.nom}{p.est_modele && <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.75 }}>· {t("proj_template_tag")}</span>}</button>
        ))}
      </div>

      {selectedProject === null && (
        <>
          {isBureau && (
            <Card style={{ marginBottom: 24, maxWidth: 620 }}>
              <h3 style={{ fontSize: 13, marginBottom: 10 }}>{t("proj_new_title")}</h3>
              <Field label={t("proj_name")}><input style={inputStyle} value={newProject.nom} onChange={(e) => setNewProject({ ...newProject, nom: e.target.value })} /></Field>
              <Field label={t("description")}><input style={inputStyle} value={newProject.description} onChange={(e) => setNewProject({ ...newProject, description: e.target.value })} /></Field>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label={t("proj_manager")}>
                  <select style={inputStyle} value={newProject.responsable_id} onChange={(e) => setNewProject({ ...newProject, responsable_id: e.target.value })}>
                    <option value="">{t("proj_choose")}</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                  </select>
                </Field></div>
                <div style={{ flex: 1 }}><Field label={t("proj_priority")}>
                  <select style={inputStyle} value={newProject.priorite} onChange={(e) => setNewProject({ ...newProject, priorite: e.target.value })}>
                    {PRIORITES.map((s) => <option key={s} value={s}>{t("proj_priority_" + s)}</option>)}
                  </select>
                </Field></div>
              </div>
              <Field label={t("proj_category")}><input style={inputStyle} placeholder={t("proj_category_placeholder")} value={newProject.categorie} onChange={(e) => setNewProject({ ...newProject, categorie: e.target.value })} /></Field>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label={t("proj_date_start")}><input type="date" style={inputStyle} value={newProject.date_debut} onChange={(e) => setNewProject({ ...newProject, date_debut: e.target.value })} /></Field></div>
                <div style={{ flex: 1 }}><Field label={t("proj_date_end_planned")}><input type="date" style={inputStyle} value={newProject.date_fin_prevue} onChange={(e) => setNewProject({ ...newProject, date_fin_prevue: e.target.value })} /></Field></div>
              </div>
              <Btn onClick={createProject}><Plus size={14} /> {t("proj_create_btn")}</Btn>
              {projects.some((p) => p.est_modele) && (
                <button onClick={() => setShowTemplateModal(true)} style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: "var(--primary)", background: "none", border: "1px solid #DDD", borderRadius: 8, padding: "7px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Copy size={13} /> {t("proj_create_from_template_btn")}
                </button>
              )}
            </Card>
          )}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setPortfolioView("portefeuille")} style={{ fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: portfolioView === "portefeuille" ? "var(--primary)" : "#EEF0F3", color: portfolioView === "portefeuille" ? "white" : "#5B6270" }}>{t("proj_portfolio_title")}</button>
            <button onClick={() => setPortfolioView("charge")} style={{ fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: portfolioView === "charge" ? "var(--primary)" : "#EEF0F3", color: portfolioView === "charge" ? "white" : "#5B6270", display: "inline-flex", alignItems: "center", gap: 6 }}><Users size={13} /> {t("proj_workload_title")}</button>
          </div>
          {portfolioView === "portefeuille" ? (
            <PortfolioView projects={projects} tasks={tasks} budgetLines={budgetLines} expenses={expenses} milestones={milestones} members={members} t={t} devise={devise} onSelect={setSelectedProject} />
          ) : (
            <WorkloadView projects={projects} tasks={tasks} members={members} t={t} />
          )}
        </>
      )}

      {project && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: 18 }}>{project.nom}</h3>
                <Pill {...statusPillColors(project.statut)}>{t("proj_status_" + project.statut)}</Pill>
              </div>
              {project.description && <div style={{ fontSize: 12.5, color: "#666", maxWidth: 560 }}>{project.description}</div>}
            </div>
            {isBureau && (
              <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                {project.public_suivi && association?.vitrine_active && association?.slug_public && (
                  <button onClick={copyPublicLink} title={t("proj_public_link_copy_btn")} style={{ fontSize: 11, fontWeight: 600, color: TEAL, background: TEAL_LIGHT, border: "none", borderRadius: 999, padding: "4px 10px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Globe size={11} /> {t("proj_public_link_copy_btn")}
                  </button>
                )}
                <button onClick={() => setEditingProject(project)} title={t("proj_edit_btn")} style={{ fontSize: 11, fontWeight: 600, color: "var(--primary)", background: "none", border: "1px solid #DDD", borderRadius: 999, padding: "4px 10px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Pencil size={11} /> {t("proj_edit_btn")}
                </button>
                <button onClick={() => deleteProject(project.id)} title={t("proj_delete_btn")} style={{ fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "4px 10px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Trash2 size={11} /> {t("proj_delete_btn")}
                </button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20, borderBottom: "1px solid #E7E9F1" }}>
            {TABS.map(({ key, labelKey, Icon }) => (
              <button key={key} onClick={() => selectTab(key)} style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", fontSize: 12.5, fontWeight: 700,
                background: "none", border: "none", cursor: "pointer", borderBottom: activeTab === key ? "2.5px solid var(--accent)" : "2.5px solid transparent",
                color: activeTab === key ? "var(--primary)" : "#8A8F98",
              }}><Icon size={14} /> {t(labelKey)}</button>
            ))}
          </div>

          {activeTab === "apercu" && (
            <OverviewTab project={project} tasks={projectTasks} budgetLines={projectLines} expenses={projectExpenses} milestones={projectMilestones}
              members={members} t={t} devise={devise} donationsTotal={projectDonationsTotal} association={association} />
          )}
          {activeTab === "budget" && (
            <BudgetTab isBureau={isBureau} budgetLines={projectLines} expenses={projectExpenses}
              newBudgetLine={newBudgetLine} setNewBudgetLine={setNewBudgetLine} addBudgetLine={addBudgetLine}
              editBudgetLineLocal={editBudgetLineLocal} saveBudgetLine={saveBudgetLine} deleteBudgetLine={deleteBudgetLine}
              newExpense={newExpense} setNewExpense={setNewExpense} addExpense={addExpense} deleteExpense={deleteExpense}
              t={t} devise={devise} project={project} updateProject={updateProject} />
          )}
          {activeTab === "taches" && (
            <TasksTab tasks={projectTasks} tasksById={tasksById} members={members} isBureau={isBureau}
              newTask={newTask} setNewTask={setNewTask} addTask={addTask} moveTask={moveTask}
              setEditingTask={setEditingTask} deleteTask={deleteTask} t={t}
              checklistItems={checklistItems} addChecklistItem={addChecklistItem} toggleChecklistItem={toggleChecklistItem} deleteChecklistItem={deleteChecklistItem}
              comments={projectComments} addComment={addComment} deleteComment={deleteComment} />
          )}
          {activeTab === "echeancier" && (
            <TimelineTab tasks={projectTasks} milestones={projectMilestones} members={members} isBureau={isBureau}
              newMilestone={newMilestone} setNewMilestone={setNewMilestone} addMilestone={addMilestone}
              editMilestoneLocal={editMilestoneLocal} saveMilestone={saveMilestone} deleteMilestone={deleteMilestone} t={t} />
          )}
          {activeTab === "activite" && <ActivityTab log={activityLog} t={t} />}
        </>
      )}

      {showTemplateModal && (
        <TemplateModal projects={projects.filter((p) => p.est_modele)} onClose={() => setShowTemplateModal(false)} onCreate={createFromTemplate} t={t} />
      )}

      {editingProject && (
        <EditProjectModal project={editingProject} members={members} onClose={() => setEditingProject(null)} onSave={updateProject} t={t} />
      )}
      {editingTask && (
        <EditTaskModal task={editingTask} members={members} allTasks={projectTasks} tasksById={tasksById} onClose={() => setEditingTask(null)} onSave={updateTask} t={t} />
      )}
    </Section></Container>
  );
}

// =====================================================================
// Vue portefeuille (multi-projets)
// =====================================================================
function PortfolioView({ projects, tasks, budgetLines, expenses, milestones, members, t, devise, onSelect }) {
  if (!projects.length) return <p style={{ color: "#686F7D", fontStyle: "italic" }}>{t("proj_portfolio_empty")}</p>;

  const rows = projects.map((p) => {
    const pTasks = tasks.filter((t2) => t2.project_id === p.id);
    const pLines = budgetLines.filter((l) => l.project_id === p.id);
    const pExpenses = expenses.filter((e) => e.project_id === p.id);
    const pMilestones = milestones.filter((m) => m.project_id === p.id);
    const avancement = computeAvancement(pTasks);
    const { prevu, depense, percent } = computeBudgetTotals(pLines, pExpenses);
    const nm = nextMilestone(pMilestones);
    let alert = "ontrack";
    if (p.statut !== "annule") {
      if (prevu > 0 && depense > prevu) alert = "over";
      else if (prevu > 0 && avancement > 0 && percent - avancement > 20) alert = "watch";
    }
    return { p, avancement, prevu, depense, nm, alert };
  });
  const totals = rows.reduce((acc, r) => {
    if (r.p.statut !== "annule") { acc.prevu += r.prevu; acc.depense += r.depense; }
    return acc;
  }, { prevu: 0, depense: 0 });
  const alertStyles = {
    over: { bg: "#FBE4E1", color: RED, label: t("proj_portfolio_alert_over") },
    watch: { bg: "#FBF3D9", color: AMBER, label: t("proj_portfolio_alert_watch") },
    ontrack: { bg: TEAL_LIGHT, color: TEAL, label: t("proj_portfolio_alert_ontrack") },
  };

  return (
    <>
      <h3 style={{ fontSize: 15, marginBottom: 12 }}>{t("proj_portfolio_title")}</h3>
      <Card style={{ marginBottom: 20, display: "flex", gap: 28, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8A8F98", textTransform: "uppercase", marginBottom: 4 }}>{t("proj_portfolio_total_label")}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#8A8F98" }}>{t("proj_portfolio_total_planned")}</div>
          <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 18 }}>{money(totals.prevu, devise)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#8A8F98" }}>{t("proj_portfolio_total_spent")}</div>
          <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 18, color: totals.prevu > 0 && totals.depense > totals.prevu ? RED : "var(--primary)" }}>{money(totals.depense, devise)}</div>
        </div>
      </Card>
      <Table head={[t("proj_portfolio_col_project"), t("proj_portfolio_col_status"), t("proj_portfolio_col_progress"), t("proj_portfolio_col_budget"), t("proj_portfolio_col_next_milestone"), t("proj_portfolio_col_manager"), ""]}>
        {rows.map(({ p, avancement, prevu, depense, nm, alert }) => (
          <tr key={p.id} style={{ borderBottom: "1px solid #F0F0F0", cursor: "pointer" }} onClick={() => onSelect(p.id)}>
            <td style={{ padding: "8px 9px" }}>
              <b>{p.nom}</b>{p.categorie ? <div style={{ fontSize: 10.5, color: "#686F7D" }}>{p.categorie}</div> : null}
            </td>
            <td style={{ padding: "8px 9px" }}><Pill {...statusPillColors(p.statut)}>{t("proj_status_" + p.statut)}</Pill></td>
            <td style={{ padding: "8px 9px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 64, height: 6, borderRadius: 999, background: "#E7EAF2", overflow: "hidden" }}><div style={{ height: "100%", width: `${avancement}%`, background: TEAL }} /></div>
                <span style={{ fontSize: 11, fontWeight: 700 }}>{avancement}%</span>
              </div>
            </td>
            <td style={{ padding: "8px 9px", whiteSpace: "nowrap" }}>{money(depense, devise)} / {money(prevu, devise)}</td>
            <td style={{ padding: "8px 9px" }}>{nm ? `${nm.titre} — ${nm.date_cible}` : t("proj_portfolio_no_milestone")}</td>
            <td style={{ padding: "8px 9px" }}>{members.find((m) => m.id === p.responsable_id)?.nom || "—"}</td>
            <td style={{ padding: "8px 9px" }}><span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: alertStyles[alert].bg, color: alertStyles[alert].color, textTransform: "uppercase", whiteSpace: "nowrap" }}>{alertStyles[alert].label}</span></td>
          </tr>
        ))}
      </Table>
    </>
  );
}

// =====================================================================
// Onglet Aperçu (fiche + KPI)
// =====================================================================
function OverviewTab({ project, tasks, budgetLines, expenses, milestones, members, t, devise, donationsTotal, association }) {
  const avancement = computeAvancement(tasks);
  const { prevu, depense, ecart } = computeBudgetTotals(budgetLines, expenses);
  const forecast = computeForecast(depense, avancement);
  const nm = nextMilestone(milestones);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  async function handleGenerateReport() {
    setGenerating(true); setGenError("");
    try {
      const doc = await buildImpactReportPdf({ t, association, project, tasks, budgetLines, expenses, milestones, members, donationsTotal, devise });
      doc.save(`${t("proj_impact_report_title").replace(/\s+/g, "_")}_${project.nom.replace(/\s+/g, "_")}.pdf`);
    } catch (e) {
      setGenError(e.message || t("error_generic"));
    }
    setGenerating(false);
  }

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 20 }}>
        <StatCard label={t("proj_progress_label")} value={`${avancement}%`} accent={TEAL} />
        <StatCard label={t("proj_budget_summary_planned")} value={money(prevu, devise)} />
        <StatCard label={t("proj_budget_summary_spent")} value={money(depense, devise)} accent={depense > prevu && prevu > 0 ? RED : undefined} />
        <StatCard label={t("proj_budget_summary_variance")} value={money(ecart, devise)} accent={ecart < 0 ? RED : TEAL} />
        <StatCard label={t("proj_budget_forecast_label")} value={forecast == null ? t("proj_budget_forecast_na") : money(forecast, devise)} />
        <StatCard label={t("proj_portfolio_col_next_milestone")} value={nm ? `${nm.titre} (${nm.date_cible})` : t("proj_portfolio_no_milestone")} />
        {donationsTotal > 0 && <StatCard label={t("proj_impact_donations")} value={money(donationsTotal, devise)} accent={TEAL} />}
      </div>
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: project.sponsor || project.notes ? 14 : 0 }}>
          <div><div style={{ fontSize: 11, fontWeight: 700, color: "#8A8F98", textTransform: "uppercase" }}>{t("proj_priority")}</div><div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("proj_priority_" + (project.priorite || "normale"))}</div></div>
          <div><div style={{ fontSize: 11, fontWeight: 700, color: "#8A8F98", textTransform: "uppercase" }}>{t("proj_category")}</div><div style={{ fontSize: 13.5, fontWeight: 600 }}>{project.categorie || "—"}</div></div>
          <div><div style={{ fontSize: 11, fontWeight: 700, color: "#8A8F98", textTransform: "uppercase" }}>{t("proj_date_start")}</div><div style={{ fontSize: 13.5, fontWeight: 600 }}>{project.date_debut || "—"}</div></div>
          <div><div style={{ fontSize: 11, fontWeight: 700, color: "#8A8F98", textTransform: "uppercase" }}>{t("proj_date_end_planned")}</div><div style={{ fontSize: 13.5, fontWeight: 600 }}>{project.date_fin_prevue || "—"}</div></div>
          <div><div style={{ fontSize: 11, fontWeight: 700, color: "#8A8F98", textTransform: "uppercase" }}>{t("proj_date_end_real")}</div><div style={{ fontSize: 13.5, fontWeight: 600 }}>{project.date_fin_reelle || "—"}</div></div>
        </div>
        {project.sponsor && <div style={{ marginBottom: 10 }}><b style={{ fontSize: 12.5 }}>{t("proj_sponsor")} :</b> <span style={{ fontSize: 12.5 }}>{project.sponsor}</span></div>}
        {project.notes && <div style={{ fontSize: 12.5, color: "#555", whiteSpace: "pre-wrap" }}>{project.notes}</div>}
      </Card>
      <Card>
        <h3 style={{ fontSize: 13, marginBottom: 8 }}>{t("proj_impact_report_title")}</h3>
        <p style={{ fontSize: 12, color: "#8A8F98", marginBottom: 12 }}>{t("proj_impact_report_note")}</p>
        {genError && <p style={{ color: RED, fontSize: 12, marginBottom: 10 }}>{genError}</p>}
        <Btn onClick={handleGenerateReport} disabled={generating}><FileDown size={14} /> {generating ? t("loading") : t("proj_impact_report_btn")}</Btn>
      </Card>
    </>
  );
}

// =====================================================================
// Charge de travail — vue transverse (toutes les tâches, tous projets
// actifs confondus) groupée par bénévole assigné.
// =====================================================================
function WorkloadView({ projects, tasks, members, t }) {
  const activeProjectIds = new Set(projects.filter((p) => p.statut === "actif").map((p) => p.id));
  const relevant = tasks.filter((t2) => activeProjectIds.has(t2.project_id) && t2.colonne !== "termine");
  const byMember = {};
  relevant.forEach((t2) => {
    const key = t2.assigne_id || "_sans";
    if (!byMember[key]) byMember[key] = [];
    byMember[key].push(t2);
  });
  const rows = Object.entries(byMember).map(([memberId, list]) => ({
    memberId, nom: memberId === "_sans" ? t("proj_unassigned") : (members.find((m) => m.id === memberId)?.nom || "—"),
    total: list.length, enCours: list.filter((t2) => t2.colonne === "en_cours").length, aFaire: list.filter((t2) => t2.colonne === "a_faire").length,
  })).sort((a, b) => b.total - a.total);

  if (!rows.length) return <p style={{ color: "#686F7D", fontStyle: "italic" }}>{t("proj_workload_empty")}</p>;
  return (
    <>
      <h3 style={{ fontSize: 15, marginBottom: 12 }}>{t("proj_workload_title")}</h3>
      <Table head={[t("proj_workload_col_member"), t("proj_workload_col_total"), t("proj_col_en_cours"), t("proj_col_a_faire")]}>
        {rows.map((r) => (
          <tr key={r.memberId} style={{ borderBottom: "1px solid #F0F0F0" }}>
            <td style={{ padding: "8px 9px" }}><b>{r.nom}</b></td>
            <td style={{ padding: "8px 9px" }}>{r.total}</td>
            <td style={{ padding: "8px 9px" }}>{r.enCours}</td>
            <td style={{ padding: "8px 9px" }}>{r.aFaire}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

// =====================================================================
// Historique/Activité — activity_log (générique, déjà branché sur
// projects/project_tasks) filtré au projet courant.
// =====================================================================
function ActivityTab({ log, t }) {
  if (!log.length) return <p style={{ color: "#686F7D", fontStyle: "italic" }}>{t("proj_activity_empty")}</p>;
  return (
    <Card>
      <h3 style={{ fontSize: 13, marginBottom: 12 }}>{t("proj_tab_activite")}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {log.map((entry) => (
          <div key={entry.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5, borderBottom: "1px solid #F3F3F3", paddingBottom: 8 }}>
            <History size={13} color="#8A8F98" style={{ marginTop: 2, flexShrink: 0 }} />
            <div>
              <div><b>{entry.user_nom || "—"}</b> — {entry.action}</div>
              <div style={{ fontSize: 10.5, color: "#686F7D" }}>{new Date(entry.created_at).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// =====================================================================
// Modèles de projet — modale de création à partir d'un modèle existant.
// =====================================================================
function TemplateModal({ projects, onClose, onCreate, t }) {
  const [modeleId, setModeleId] = useState(projects[0]?.id || "");
  const [nom, setNom] = useState("");
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("proj_create_from_template_btn")}</h3>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>
        <Field label={t("proj_template_choose_label")}>
          <select style={inputStyle} value={modeleId} onChange={(e) => setModeleId(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select>
        </Field>
        <Field label={t("proj_name")}><input style={inputStyle} value={nom} onChange={(e) => setNom(e.target.value)} /></Field>
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <Btn onClick={() => nom.trim() && modeleId && onCreate(modeleId, nom.trim())}>{t("proj_create_btn")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("action_close")}</Btn>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Onglet Budget (lignes + dépenses + calculs)
// =====================================================================
function BudgetTab({ isBureau, budgetLines, expenses, newBudgetLine, setNewBudgetLine, addBudgetLine, editBudgetLineLocal, saveBudgetLine, deleteBudgetLine, newExpense, setNewExpense, addExpense, deleteExpense, t, devise, project, updateProject }) {
  const { prevu, depense, ecart, percent } = computeBudgetTotals(budgetLines, expenses);
  const barColor = percent > 100 ? RED : percent > 80 ? AMBER : TEAL;
  return (
    <>
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
          <div><div style={{ fontSize: 11, color: "#8A8F98" }}>{t("proj_budget_summary_planned")}</div><div style={{ fontWeight: 700, fontSize: 17 }}>{money(prevu, devise)}</div></div>
          <div><div style={{ fontSize: 11, color: "#8A8F98" }}>{t("proj_budget_summary_spent")}</div><div style={{ fontWeight: 700, fontSize: 17, color: percent > 100 ? RED : "var(--primary)" }}>{money(depense, devise)}</div></div>
          <div><div style={{ fontSize: 11, color: "#8A8F98" }}>{t("proj_budget_summary_remaining")}</div><div style={{ fontWeight: 700, fontSize: 17 }}>{money(prevu - depense, devise)}</div></div>
          <div><div style={{ fontSize: 11, color: "#8A8F98" }}>{t("proj_budget_summary_variance")}</div><div style={{ fontWeight: 700, fontSize: 17, color: ecart < 0 ? RED : TEAL }}>{money(ecart, devise)}</div></div>
          <div><div style={{ fontSize: 11, color: "#8A8F98" }}>{t("proj_budget_summary_percent")}</div><div style={{ fontWeight: 700, fontSize: 17 }}>{Math.round(percent)}%</div></div>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: "#E7EAF2", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, percent)}%`, background: barColor }} /></div>
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 13, marginBottom: 12 }}>{t("proj_budget_lines_title")}</h3>
        {isBureau && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <input style={{ ...inputStyle, flex: 1, minWidth: 120 }} placeholder={t("proj_budget_line_category")} value={newBudgetLine.categorie} onChange={(e) => setNewBudgetLine({ ...newBudgetLine, categorie: e.target.value })} />
            <input style={{ ...inputStyle, flex: 2, minWidth: 140 }} placeholder={t("proj_budget_line_label")} value={newBudgetLine.libelle} onChange={(e) => setNewBudgetLine({ ...newBudgetLine, libelle: e.target.value })} />
            <input type="number" style={{ ...inputStyle, flex: 1, minWidth: 110 }} placeholder={t("proj_budget_line_amount")} value={newBudgetLine.montant_prevu} onChange={(e) => setNewBudgetLine({ ...newBudgetLine, montant_prevu: e.target.value })} />
            <Btn onClick={addBudgetLine}><Plus size={14} /></Btn>
          </div>
        )}
        {budgetLines.length ? (
          <Table head={[t("proj_budget_line_label"), t("proj_budget_line_category"), t("proj_budget_line_amount"), t("proj_budget_summary_spent"), ""]}>
            {budgetLines.map((line) => {
              const spent = expenses.filter((e) => e.budget_line_id === line.id).reduce((s, e) => s + (Number(e.montant) || 0), 0);
              return (
                <tr key={line.id} style={{ borderBottom: "1px solid #F0F0F0" }}>
                  <td style={{ padding: "6px 9px" }}>{isBureau ? <input style={{ ...inputStyle, minWidth: 140 }} value={line.libelle} onChange={(e) => editBudgetLineLocal(line.id, { libelle: e.target.value })} onBlur={(e) => saveBudgetLine(line.id, { libelle: e.target.value })} /> : line.libelle}</td>
                  <td style={{ padding: "6px 9px" }}>{isBureau ? <input style={{ ...inputStyle, minWidth: 110 }} value={line.categorie || ""} onChange={(e) => editBudgetLineLocal(line.id, { categorie: e.target.value })} onBlur={(e) => saveBudgetLine(line.id, { categorie: e.target.value })} /> : (line.categorie || "—")}</td>
                  <td style={{ padding: "6px 9px" }}>{isBureau ? <input type="number" style={{ ...inputStyle, width: 110 }} value={line.montant_prevu} onChange={(e) => editBudgetLineLocal(line.id, { montant_prevu: e.target.value })} onBlur={(e) => saveBudgetLine(line.id, { montant_prevu: Number(e.target.value) || 0 })} /> : money(line.montant_prevu, devise)}</td>
                  <td style={{ padding: "6px 9px" }}>{money(spent, devise)}</td>
                  <td style={{ padding: "6px 9px" }}>{isBureau && <button onClick={() => deleteBudgetLine(line.id)} title={t("proj_budget_line_delete")} style={{ background: "none", border: "none", cursor: "pointer", color: RED }}><Trash2 size={14} /></button>}</td>
                </tr>
              );
            })}
          </Table>
        ) : <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 12.5 }}>{t("proj_budget_empty_lines")}</p>}
      </Card>

      <Card>
        <h3 style={{ fontSize: 13, marginBottom: 12 }}>{t("proj_budget_expenses_title")}</h3>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 14, padding: "10px 12px", borderRadius: 10, background: "#FBF6EC", cursor: isBureau ? "pointer" : "default" }}>
          <input type="checkbox" style={{ marginTop: 2 }} disabled={!isBureau} checked={!!project?.finance_caisse_generale}
            onChange={(e) => updateProject(project.id, { finance_caisse_generale: e.target.checked })} />
          <span style={{ fontSize: 12 }}>
            <span style={{ fontWeight: 600 }}>{t("proj_finance_caisse_label")}</span>
            <br /><span style={{ color: "#8A8F98" }}>{t("proj_finance_caisse_note")}</span>
          </span>
        </label>
        {isBureau && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <input type="date" style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={newExpense.date_depense} onChange={(e) => setNewExpense({ ...newExpense, date_depense: e.target.value })} />
            <input type="number" style={{ ...inputStyle, flex: 1, minWidth: 100 }} placeholder={t("proj_budget_expense_amount")} value={newExpense.montant} onChange={(e) => setNewExpense({ ...newExpense, montant: e.target.value })} />
            <select style={{ ...inputStyle, flex: 1, minWidth: 140 }} value={newExpense.budget_line_id} onChange={(e) => setNewExpense({ ...newExpense, budget_line_id: e.target.value })}>
              <option value="">{t("proj_budget_expense_no_line")}</option>
              {budgetLines.map((l) => <option key={l.id} value={l.id}>{l.libelle}</option>)}
            </select>
            <input style={{ ...inputStyle, flex: 2, minWidth: 140 }} placeholder={t("proj_budget_expense_description")} value={newExpense.description} onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })} />
            <Btn onClick={addExpense}><Plus size={14} /></Btn>
          </div>
        )}
        {expenses.length ? (
          <Table head={[t("proj_budget_expense_date"), t("proj_budget_expense_amount"), t("proj_budget_expense_line"), t("proj_budget_expense_description"), ""]}>
            {expenses.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid #F0F0F0" }}>
                <td style={{ padding: "6px 9px" }}>{e.date_depense}</td>
                <td style={{ padding: "6px 9px" }}>{money(e.montant, devise)}</td>
                <td style={{ padding: "6px 9px" }}>{budgetLines.find((l) => l.id === e.budget_line_id)?.libelle || t("proj_budget_expense_no_line")}</td>
                <td style={{ padding: "6px 9px" }}>{e.description || "—"}</td>
                <td style={{ padding: "6px 9px" }}>{isBureau && <button onClick={() => deleteExpense(e.id)} title={t("proj_budget_expense_delete")} style={{ background: "none", border: "none", cursor: "pointer", color: RED }}><Trash2 size={14} /></button>}</td>
              </tr>
            ))}
          </Table>
        ) : <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 12.5 }}>{t("proj_budget_empty_expenses")}</p>}
      </Card>
    </>
  );
}

// =====================================================================
// Onglet Tâches (Kanban)
// =====================================================================
function TasksTab({ tasks, tasksById, members, isBureau, newTask, setNewTask, addTask, moveTask, setEditingTask, deleteTask, t,
  checklistItems, addChecklistItem, toggleChecklistItem, deleteChecklistItem, comments, addComment, deleteComment }) {
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  return (
    <>
      {isBureau && (
        <Card style={{ marginBottom: 20, maxWidth: 680 }}>
          <h3 style={{ fontSize: 13, marginBottom: 10 }}>{t("proj_add_task")}</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <input style={{ ...inputStyle, flex: 2, minWidth: 140 }} placeholder={t("proj_task_title_placeholder")} value={newTask.titre} onChange={(e) => setNewTask({ ...newTask, titre: e.target.value })} />
            <select style={{ ...inputStyle, flex: 1, minWidth: 120 }} value={newTask.assigne_id} onChange={(e) => setNewTask({ ...newTask, assigne_id: e.target.value })}>
              <option value="">{t("proj_assigned_to")}</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </select>
            <input type="date" title={t("proj_task_start")} style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={newTask.date_debut} onChange={(e) => setNewTask({ ...newTask, date_debut: e.target.value })} />
            <input type="date" title={t("proj_task_end")} style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={newTask.echeance} onChange={(e) => setNewTask({ ...newTask, echeance: e.target.value })} />
            <select title={t("proj_task_recurrence")} style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={newTask.recurrence || ""} onChange={(e) => setNewTask({ ...newTask, recurrence: e.target.value })}>
              <option value="">{t("proj_task_recurrence_none")}</option>
              {RECURRENCES.map((r) => <option key={r} value={r}>{t("proj_task_recurrence_" + r)}</option>)}
            </select>
            <Btn onClick={addTask}><Plus size={14} /></Btn>
          </div>
        </Card>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {COLUMNS.map((col) => (
          <div key={col.key} style={{ background: "#EEF0F3", borderRadius: 12, padding: 12, minHeight: 200 }}>
            <h4 style={{ fontSize: 12.5, fontWeight: 700, color: "var(--primary)", textTransform: "uppercase", marginBottom: 10 }}>{t(col.labelKey)} ({tasks.filter((t2) => t2.colonne === col.key).length})</h4>
            {tasks.filter((t2) => t2.colonne === col.key).map((t2) => {
              const violated = (t2.dependances || []).some((depId) => { const dep = tasksById[depId]; return dep && dep.echeance && t2.date_debut && t2.date_debut < dep.echeance; });
              return (
                <Card key={t2.id} style={{ marginBottom: 10, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6, marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>{violated && <AlertTriangle size={12} color={RED} />} {t2.titre}</div>
                    {isBureau && (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button onClick={() => setEditingTask(t2)} title={t("proj_edit_task_btn")} style={{ width: 20, height: 20, borderRadius: "50%", background: "none", border: "1px solid #DDD", color: "var(--primary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                          <Pencil size={10} />
                        </button>
                        <button onClick={() => deleteTask(t2.id)} title={t("proj_delete_task_btn")} style={{ width: 20, height: 20, borderRadius: "50%", background: "none", border: `1px solid ${RED}`, color: RED, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                          <Trash2 size={10} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#686F7D", marginBottom: 6 }}>
                    {members.find((m) => m.id === t2.assigne_id)?.nom || t("proj_unassigned")} {t2.echeance ? `· ${t2.date_debut ? t2.date_debut + " → " : ""}${t2.echeance}` : ""} {t2.recurrence && <Repeat size={10} style={{ verticalAlign: "middle", marginLeft: 2 }} title={t("proj_task_recurrence_" + t2.recurrence)} />}
                  </div>
                  <div style={{ height: 5, borderRadius: 999, background: "#E7EAF2", marginBottom: 8, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${t2.pourcentage || 0}%`, background: violated ? RED : TEAL, borderRadius: 999 }} />
                  </div>
                  {isBureau && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                      {COLUMNS.filter((c) => c.key !== col.key).map((c) => (
                        <button key={c.key} onClick={() => { if (window.confirm(t("proj_confirm_move_task").replace("{titre}", t2.titre).replace("{colonne}", t(c.labelKey)))) moveTask(t2.id, c.key); }} style={{ fontSize: 10, padding: "3px 6px", borderRadius: 6, border: "1px solid #DDD", background: "white", cursor: "pointer" }}>
                          → {t(c.labelKey)}
                        </button>
                      ))}
                    </div>
                  )}
                  <TaskDetailsToggle task={t2} isBureau={isBureau} expanded={expandedTaskId === t2.id} onToggle={() => setExpandedTaskId(expandedTaskId === t2.id ? null : t2.id)}
                    checklistItems={checklistItems.filter((c) => c.task_id === t2.id)} addChecklistItem={addChecklistItem} toggleChecklistItem={toggleChecklistItem} deleteChecklistItem={deleteChecklistItem}
                    comments={comments.filter((c) => c.task_id === t2.id)} addComment={addComment} deleteComment={deleteComment} members={members} t={t} />
                </Card>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Zone de saisie avec autocomplétion "@Nom" — même patron que la barre
// de composition de VieAssociative.jsx. Indispensable ici : la
// notification (notify_mentions() côté SQL) ne reconnaît que le nom
// EXACT de l'annuaire ("@" + members.nom tel quel, espace/accents
// compris) — sans cette aide, taper "@Prénom" à la main ne correspond
// jamais et la mention ne notifie personne, en silence. Correctif du
// complément « modernisation Projets » (2026-09-30, suite).
// ---------------------------------------------------------------------
function MentionInput({ value, onChange, onSubmit, members, placeholder }) {
  const [query, setQuery] = useState(null);
  const inputRef = useRef(null);
  function handleChange(e) {
    const val = e.target.value;
    const pos = e.target.selectionStart ?? val.length;
    onChange(val);
    const uptoCaret = val.slice(0, pos);
    const m = /@([^\s@]{0,25})$/.exec(uptoCaret);
    setQuery(m ? m[1] : null);
  }
  const suggestions = query !== null ? members.filter((mb) => foldText(mb.nom).includes(foldText(query))).slice(0, 6) : [];
  function insert(member) {
    const el = inputRef.current;
    const pos = el ? (el.selectionStart ?? value.length) : value.length;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const replacedBefore = before.replace(/@([^\s@]{0,25})$/, `@${member.nom} `);
    onChange(replacedBefore + after);
    setQuery(null);
    requestAnimationFrame(() => el?.focus());
  }
  function handleKeyDown(e) {
    if (query !== null && suggestions.length > 0 && e.key === "Enter") { e.preventDefault(); insert(suggestions[0]); return; }
    if (e.key === "Enter" && query === null) { e.preventDefault(); onSubmit?.(); }
  }
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <input ref={inputRef} style={{ ...inputStyle, fontSize: 11.5, padding: "5px 8px", width: "100%" }} placeholder={placeholder} value={value}
        onChange={handleChange} onKeyDown={handleKeyDown} />
      {query !== null && suggestions.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "white", border: "1px solid #DDD", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,.15)", zIndex: 10, marginTop: 2, maxHeight: 160, overflowY: "auto" }}>
          {suggestions.map((mb) => (
            <button key={mb.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(mb)} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", fontSize: 11.5, background: "none", border: "none", cursor: "pointer" }}>
              {mb.nom}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Affiche un texte de commentaire avec ses "@Nom complet" reconnus mis en
// évidence — même repère visuel que VieAssociative.jsx, pour confirmer
// à l'œil qu'une mention a bien été reconnue (et donc notifiée) avant
// même d'envoyer.
function renderMentions(text, members) {
  if (!text) return text;
  const names = (members || []).map((m) => m.nom).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`@(${escaped.join("|")})(?![\\p{L}\\p{N}])`, "gu");
  const parts = [];
  let last = 0, m, key = 0;
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<span key={`men-${key++}`} style={{ color: "var(--primary)", fontWeight: 700, background: "rgba(31,56,100,.08)", borderRadius: 4, padding: "0 3px" }}>@{m[1]}</span>);
    last = regex.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ---------------------------------------------------------------------
// Sous-tâches (checklist) + commentaires — panneau repliable d'une carte
// de tâche, accessible au Bureau (accès direct aux deux tables, RLS
// bureau-only). Complément « modernisation Projets » (2026-09-30).
// ---------------------------------------------------------------------
function TaskDetailsToggle({ task, isBureau, expanded, onToggle, checklistItems, addChecklistItem, toggleChecklistItem, deleteChecklistItem, comments, addComment, deleteComment, members, t }) {
  const [newItem, setNewItem] = useState("");
  const [newComment, setNewComment] = useState("");
  const nbDone = checklistItems.filter((c) => c.complete).length;
  return (
    <div style={{ borderTop: "1px solid #EEE", paddingTop: 8 }}>
      <button onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", fontSize: 10.5, color: "#8A8F98", padding: 0, width: "100%" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><CheckSquare size={11} /> {nbDone}/{checklistItems.length}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><MessageSquare size={11} /> {comments.length}</span>
        <span style={{ marginLeft: "auto" }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 10 }}>
            {checklistItems.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, marginBottom: 4 }}>
                <button onClick={() => isBureau && toggleChecklistItem(c.id, !c.complete)} style={{ background: "none", border: "none", cursor: isBureau ? "pointer" : "default", padding: 0, color: c.complete ? TEAL : "#B7BFCC" }}>
                  {c.complete ? <CheckSquare size={13} /> : <Square size={13} />}
                </button>
                <span style={{ flex: 1, textDecoration: c.complete ? "line-through" : "none", color: c.complete ? "#686F7D" : "inherit" }}>{c.texte}</span>
                {isBureau && <button onClick={() => deleteChecklistItem(c.id)} style={{ background: "none", border: "none", cursor: "pointer", color: RED, padding: 0 }}><Trash2 size={11} /></button>}
              </div>
            ))}
            {isBureau && (
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input style={{ ...inputStyle, flex: 1, fontSize: 11.5, padding: "5px 8px" }} placeholder={t("proj_checklist_add_placeholder")} value={newItem}
                  onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newItem.trim()) { addChecklistItem(task.id, newItem); setNewItem(""); } }} />
                <button onClick={() => { if (newItem.trim()) { addChecklistItem(task.id, newItem); setNewItem(""); } }} style={{ background: "none", border: "1px solid #DDD", borderRadius: 6, cursor: "pointer", padding: "4px 8px" }}><Plus size={12} /></button>
              </div>
            )}
          </div>
          <div>
            {comments.map((c) => (
              <div key={c.id} style={{ fontSize: 11, marginBottom: 6, background: "#F8F9FC", borderRadius: 6, padding: "6px 8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <b>{c.auteur_nom || "—"}</b>
                  {isBureau && <button onClick={() => deleteComment(c.id)} style={{ background: "none", border: "none", cursor: "pointer", color: RED, padding: 0 }}><Trash2 size={10} /></button>}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{renderMentions(c.contenu, members)}</div>
              </div>
            ))}
            {isBureau && (
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <MentionInput value={newComment} onChange={setNewComment} members={members} placeholder={t("proj_comment_add_placeholder")}
                  onSubmit={() => { if (newComment.trim()) { addComment(task.id, newComment); setNewComment(""); } }} />
                <button onClick={() => { if (newComment.trim()) { addComment(task.id, newComment); setNewComment(""); } }} style={{ background: "none", border: "1px solid #DDD", borderRadius: 6, cursor: "pointer", padding: "4px 8px" }}><Send size={12} /></button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Onglet Échéancier (jalons + vue chronologique avec dépendances)
// =====================================================================
function TimelineTab({ tasks, milestones, isBureau, newMilestone, setNewMilestone, addMilestone, editMilestoneLocal, saveMilestone, deleteMilestone, t }) {
  return (
    <>
      <Card style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 13, marginBottom: 12 }}>{t("proj_milestones_title")}</h3>
        {isBureau && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <input style={{ ...inputStyle, flex: 2, minWidth: 160 }} placeholder={t("proj_milestone_title_placeholder")} value={newMilestone.titre} onChange={(e) => setNewMilestone({ ...newMilestone, titre: e.target.value })} />
            <input type="date" style={{ ...inputStyle, flex: 1, minWidth: 140 }} value={newMilestone.date_cible} onChange={(e) => setNewMilestone({ ...newMilestone, date_cible: e.target.value })} />
            <Btn onClick={addMilestone}><Plus size={14} /></Btn>
          </div>
        )}
        {milestones.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {milestones.map((m) => {
              const dotColor = m.statut === "atteint" ? TEAL : m.statut === "en_retard" ? RED : AMBER;
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "#F8F9FC", flexWrap: "wrap" }}>
                  <Flag size={14} color={dotColor} />
                  {isBureau ? (
                    <input style={{ ...inputStyle, flex: 1, minWidth: 140 }} value={m.titre} onChange={(e) => editMilestoneLocal(m.id, { titre: e.target.value })} onBlur={(e) => saveMilestone(m.id, { titre: e.target.value })} />
                  ) : <div style={{ flex: 1, minWidth: 140, fontSize: 13, fontWeight: 600 }}>{m.titre}</div>}
                  {isBureau ? (
                    <input type="date" style={{ ...inputStyle, width: 150 }} value={m.date_cible || ""} onChange={(e) => { editMilestoneLocal(m.id, { date_cible: e.target.value }); saveMilestone(m.id, { date_cible: e.target.value }); }} />
                  ) : <div style={{ fontSize: 12, color: "#686F7D" }}>{m.date_cible || "—"}</div>}
                  {isBureau ? (
                    <select style={{ ...inputStyle, width: 130 }} value={m.statut} onChange={(e) => { editMilestoneLocal(m.id, { statut: e.target.value }); saveMilestone(m.id, { statut: e.target.value }); }}>
                      <option value="a_venir">{t("proj_milestone_status_a_venir")}</option>
                      <option value="atteint">{t("proj_milestone_status_atteint")}</option>
                      <option value="en_retard">{t("proj_milestone_status_en_retard")}</option>
                    </select>
                  ) : <Pill color={dotColor} bg={m.statut === "atteint" ? TEAL_LIGHT : m.statut === "en_retard" ? "#FBE4E1" : "#FBF3D9"}>{t("proj_milestone_status_" + m.statut)}</Pill>}
                  {isBureau && <button onClick={() => deleteMilestone(m.id)} title={t("proj_milestone_delete")} style={{ background: "none", border: "none", cursor: "pointer", color: RED }}><Trash2 size={14} /></button>}
                </div>
              );
            })}
          </div>
        ) : <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 12.5 }}>{t("no_data")}</p>}
      </Card>
      <Card>
        <h3 style={{ fontSize: 13, marginBottom: 14 }}>{t("proj_timeline_title")}</h3>
        <GanttChart tasks={tasks} milestones={milestones} t={t} />
      </Card>
    </>
  );
}

// =====================================================================
// Vue chronologique (Gantt léger) avec connecteurs de dépendance
// =====================================================================
function GanttChart({ tasks, milestones, t }) {
  const dated = tasks.filter((t2) => t2.echeance);
  const datedMilestones = milestones.filter((m) => m.date_cible);
  const undated = tasks.filter((t2) => !t2.echeance);
  if (!dated.length && !datedMilestones.length) {
    return <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 12.5 }}>{t("proj_timeline_empty")}</p>;
  }
  const allDates = [todayISO()];
  dated.forEach((t2) => { allDates.push(t2.date_debut || t2.echeance); allDates.push(t2.echeance); });
  datedMilestones.forEach((m) => allDates.push(m.date_cible));
  const minD = allDates.reduce((a, b) => (a < b ? a : b));
  const maxD = allDates.reduce((a, b) => (a > b ? a : b));
  const rangeStart = addDays(minD, -1);
  const rangeEnd = addDays(maxD, 2);
  const totalDays = diffDays(rangeStart, rangeEnd) + 1;
  const pxPerDay = totalDays > 90 ? 10 : totalDays > 45 ? 16 : 26;
  const chartWidth = totalDays * pxPerDay;
  const xFor = (d) => diffDays(rangeStart, d) * pxPerDay;
  const rowH = 34;
  const sortedTasks = [...dated].sort((a, b) => (a.date_debut || a.echeance).localeCompare(b.date_debut || b.echeance));
  const tasksById = Object.fromEntries(tasks.map((t2) => [t2.id, t2]));
  const idxById = Object.fromEntries(sortedTasks.map((t2, i) => [t2.id, i]));
  const ticks = [];
  for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 7)) ticks.push(d);
  const todayX = todayISO() >= rangeStart && todayISO() <= rangeEnd ? xFor(todayISO()) : null;

  return (
    <div>
      {datedMilestones.length > 0 && (
        <div style={{ display: "flex", marginBottom: 6 }}>
          <div style={{ width: 180, flexShrink: 0 }} />
          <div style={{ overflowX: "auto", flex: 1 }}>
            <div style={{ position: "relative", width: chartWidth, height: 26 }}>
              {datedMilestones.map((m) => (
                <div key={m.id} title={`${m.titre} (${m.date_cible})`} style={{
                  position: "absolute", left: xFor(m.date_cible) - 6, top: 6, width: 12, height: 12, transform: "rotate(45deg)",
                  background: m.statut === "atteint" ? TEAL : m.statut === "en_retard" ? RED : AMBER,
                }} />
              ))}
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "flex" }}>
        <div style={{ width: 180, flexShrink: 0 }}>
          <div style={{ height: 22 }} />
          {sortedTasks.map((t2) => (
            <div key={t2.id} style={{ height: rowH, display: "flex", alignItems: "center", fontSize: 11.5, fontWeight: 600, paddingRight: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t2.titre}</div>
          ))}
        </div>
        <div style={{ overflowX: "auto", flex: 1 }}>
          <div style={{ position: "relative", width: chartWidth }}>
            <div style={{ position: "relative", height: 22, borderBottom: "1px solid #EEE" }}>
              {ticks.map((d) => (
                <div key={d} style={{ position: "absolute", left: xFor(d), top: 0, fontSize: 9.5, color: "#686F7D", borderLeft: "1px solid #EEE", height: 22, paddingLeft: 3 }}>{d.slice(5)}</div>
              ))}
            </div>
            <div style={{ position: "relative", height: rowH * sortedTasks.length }}>
              {todayX != null && <div title={t("proj_gantt_today")} style={{ position: "absolute", left: todayX, top: 0, bottom: 0, width: 1, background: RED, zIndex: 2 }} />}
              <svg width={chartWidth} height={rowH * sortedTasks.length} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
                {sortedTasks.flatMap((t2) => (t2.dependances || []).map((depId) => {
                  const dep = tasksById[depId];
                  if (!dep || idxById[depId] == null) return null;
                  const y1 = idxById[depId] * rowH + rowH / 2;
                  const y2 = idxById[t2.id] * rowH + rowH / 2;
                  const x1 = xFor(dep.echeance);
                  const x2 = xFor(t2.date_debut || t2.echeance);
                  const violated = !!(t2.date_debut && dep.echeance && t2.date_debut < dep.echeance);
                  const midX = x1 + 10;
                  const path = `M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2},${y2}`;
                  return <path key={`${depId}-${t2.id}`} d={path} fill="none" stroke={violated ? RED : "#B7BFCC"} strokeWidth={violated ? 2 : 1.4} />;
                }))}
              </svg>
              {sortedTasks.map((t2, i) => {
                const start = t2.date_debut || t2.echeance;
                const end = t2.echeance;
                const x = xFor(start);
                const w = Math.max(pxPerDay * 0.7, (diffDays(start, end) + 1) * pxPerDay);
                const violated = (t2.dependances || []).some((depId) => { const dep = tasksById[depId]; return dep && dep.echeance && t2.date_debut && t2.date_debut < dep.echeance; });
                const fill = violated ? RED : Number(t2.pourcentage) >= 100 ? TEAL : "#C7CEDC";
                return (
                  <div key={t2.id} title={`${t2.titre} (${t2.pourcentage || 0}%)`} style={{ position: "absolute", left: x, top: i * rowH + 6, width: w, height: rowH - 12, borderRadius: 6, background: "#EDEFF4", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, t2.pourcentage || 0))}%`, background: fill }} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {undated.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 11.5, color: "#686F7D" }}>{t("proj_timeline_task_no_dates")} {undated.map((t2) => t2.titre).join(", ")}</div>
      )}
    </div>
  );
}

// =====================================================================
// Modales
// =====================================================================
function EditProjectModal({ project, members, onClose, onSave, t }) {
  const [form, setForm] = useState({
    nom: project.nom || "", description: project.description || "", responsable_id: project.responsable_id || "",
    statut: project.statut || "actif", priorite: project.priorite || "normale", categorie: project.categorie || "",
    date_debut: project.date_debut || "", date_fin_prevue: project.date_fin_prevue || "", date_fin_reelle: project.date_fin_reelle || "",
    sponsor: project.sponsor || "", notes: project.notes || "",
    est_modele: project.est_modele || false, public_suivi: project.public_suivi || false,
  });
  function handleSave() {
    if (!form.nom.trim()) return;
    if (!window.confirm(t("proj_confirm_save_project").replace("{nom}", form.nom.trim()))) return;
    onSave(project.id, {
      nom: form.nom.trim(), description: form.description.trim() || null, responsable_id: form.responsable_id || null,
      statut: form.statut, priorite: form.priorite, categorie: form.categorie.trim() || null,
      date_debut: form.date_debut || null, date_fin_prevue: form.date_fin_prevue || null, date_fin_reelle: form.date_fin_reelle || null,
      sponsor: form.sponsor.trim() || null, notes: form.notes.trim() || null,
      est_modele: form.est_modele, public_suivi: form.public_suivi,
    });
    onClose();
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("proj_edit_title")}</h3>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>
        <Field label={t("proj_name")}><input style={inputStyle} value={form.nom} onChange={(e) => setForm((p) => ({ ...p, nom: e.target.value }))} /></Field>
        <Field label={t("description")}><input style={inputStyle} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></Field>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><Field label={t("proj_status")}>
            <select style={inputStyle} value={form.statut} onChange={(e) => setForm((p) => ({ ...p, statut: e.target.value }))}>
              {STATUTS.map((s) => <option key={s} value={s}>{t("proj_status_" + s)}</option>)}
            </select>
          </Field></div>
          <div style={{ flex: 1 }}><Field label={t("proj_priority")}>
            <select style={inputStyle} value={form.priorite} onChange={(e) => setForm((p) => ({ ...p, priorite: e.target.value }))}>
              {PRIORITES.map((s) => <option key={s} value={s}>{t("proj_priority_" + s)}</option>)}
            </select>
          </Field></div>
        </div>
        <Field label={t("proj_manager")}>
          <select style={inputStyle} value={form.responsable_id} onChange={(e) => setForm((p) => ({ ...p, responsable_id: e.target.value }))}>
            <option value="">{t("proj_choose")}</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </select>
        </Field>
        <Field label={t("proj_category")}><input style={inputStyle} placeholder={t("proj_category_placeholder")} value={form.categorie} onChange={(e) => setForm((p) => ({ ...p, categorie: e.target.value }))} /></Field>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><Field label={t("proj_date_start")}><input type="date" style={inputStyle} value={form.date_debut} onChange={(e) => setForm((p) => ({ ...p, date_debut: e.target.value }))} /></Field></div>
          <div style={{ flex: 1 }}><Field label={t("proj_date_end_planned")}><input type="date" style={inputStyle} value={form.date_fin_prevue} onChange={(e) => setForm((p) => ({ ...p, date_fin_prevue: e.target.value }))} /></Field></div>
          <div style={{ flex: 1 }}><Field label={t("proj_date_end_real")}><input type="date" style={inputStyle} value={form.date_fin_reelle} onChange={(e) => setForm((p) => ({ ...p, date_fin_reelle: e.target.value }))} /></Field></div>
        </div>
        <Field label={t("proj_sponsor")}><input style={inputStyle} value={form.sponsor} onChange={(e) => setForm((p) => ({ ...p, sponsor: e.target.value }))} /></Field>
        <Field label={t("proj_notes")}><textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></Field>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10, padding: "10px 12px", borderRadius: 10, background: "#FBF6EC", cursor: "pointer" }}>
          <input type="checkbox" style={{ marginTop: 2 }} checked={form.est_modele} onChange={(e) => setForm((p) => ({ ...p, est_modele: e.target.checked }))} />
          <span style={{ fontSize: 12 }}><span style={{ fontWeight: 600 }}>{t("proj_est_modele_label")}</span><br /><span style={{ color: "#8A8F98" }}>{t("proj_est_modele_note")}</span></span>
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10, padding: "10px 12px", borderRadius: 10, background: "#FBF6EC", cursor: "pointer" }}>
          <input type="checkbox" style={{ marginTop: 2 }} checked={form.public_suivi} onChange={(e) => setForm((p) => ({ ...p, public_suivi: e.target.checked }))} />
          <span style={{ fontSize: 12 }}><span style={{ fontWeight: 600 }}>{t("proj_public_suivi_label")}</span><br /><span style={{ color: "#8A8F98" }}>{t("proj_public_suivi_note")}</span></span>
        </label>
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <Btn onClick={handleSave}>{t("action_save")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("action_close")}</Btn>
        </div>
      </div>
    </div>
  );
}

function EditTaskModal({ task, members, allTasks, tasksById, onClose, onSave, t }) {
  const [form, setForm] = useState({
    titre: task.titre || "", assigne_id: task.assigne_id || "", echeance: task.echeance || "",
    date_debut: task.date_debut || "", pourcentage: task.pourcentage ?? 0, dependances: task.dependances || [],
    recurrence: task.recurrence || "",
  });
  function toggleDep(id) {
    setForm((p) => {
      const has = p.dependances.includes(id);
      return { ...p, dependances: has ? p.dependances.filter((d) => d !== id) : [...p.dependances, id] };
    });
  }
  function handleSave() {
    if (!form.titre.trim()) return;
    if (!window.confirm(t("proj_confirm_save_task").replace("{titre}", form.titre.trim()))) return;
    onSave(task.id, {
      titre: form.titre.trim(), assigne_id: form.assigne_id || null, echeance: form.echeance || null,
      date_debut: form.date_debut || null, pourcentage: Number(form.pourcentage) || 0, dependances: form.dependances,
      recurrence: form.recurrence || null,
    });
    onClose();
  }
  const candidates = allTasks.filter((t2) => t2.id !== task.id);
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("proj_edit_task_title")}</h3>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>
        <Field label={t("proj_task_title_placeholder")}><input style={inputStyle} value={form.titre} onChange={(e) => setForm((p) => ({ ...p, titre: e.target.value }))} /></Field>
        <Field label={t("proj_assigned_to")}>
          <select style={inputStyle} value={form.assigne_id} onChange={(e) => setForm((p) => ({ ...p, assigne_id: e.target.value }))}>
            <option value="">{t("proj_unassigned")}</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </select>
        </Field>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><Field label={t("proj_task_start")}><input type="date" style={inputStyle} value={form.date_debut} onChange={(e) => setForm((p) => ({ ...p, date_debut: e.target.value }))} /></Field></div>
          <div style={{ flex: 1 }}><Field label={t("proj_task_end")}><input type="date" style={inputStyle} value={form.echeance} onChange={(e) => setForm((p) => ({ ...p, echeance: e.target.value }))} /></Field></div>
        </div>
        <Field label={`${t("proj_task_percent")} : ${form.pourcentage}%`}>
          <input type="range" min="0" max="100" step="5" value={form.pourcentage} onChange={(e) => setForm((p) => ({ ...p, pourcentage: Number(e.target.value) }))} style={{ width: "100%" }} />
        </Field>
        <Field label={t("proj_task_recurrence")}>
          <select style={inputStyle} value={form.recurrence} onChange={(e) => setForm((p) => ({ ...p, recurrence: e.target.value }))}>
            <option value="">{t("proj_task_recurrence_none")}</option>
            {RECURRENCES.map((r) => <option key={r} value={r}>{t("proj_task_recurrence_" + r)}</option>)}
          </select>
        </Field>
        <Field label={t("proj_task_dependencies")}>
          {candidates.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 140, overflowY: "auto", border: "1px solid #E7E7E7", borderRadius: 8, padding: 8 }}>
              {candidates.map((c) => {
                const forbidden = ancestorsOf(tasksById, c.id).has(task.id);
                const checked = form.dependances.includes(c.id);
                return (
                  <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, opacity: forbidden && !checked ? 0.4 : 1 }}>
                    <input type="checkbox" disabled={forbidden && !checked} checked={checked} onChange={() => toggleDep(c.id)} /> {c.titre}
                  </label>
                );
              })}
            </div>
          ) : <div style={{ fontSize: 12, color: "#686F7D" }}>{t("proj_task_dependencies_none")}</div>}
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
// "Mon espace" — bénévolat en libre-service pour TOUT adhérent (pas
// seulement le Bureau) : mes tâches assignées (marquer terminée,
// commenter), occasions de bénévolat (se porter volontaire), mes
// badges de reconnaissance. Passe exclusivement par les RPC dédiées
// (aucun accès direct à project_tasks/project_task_comments, réservées
// au Bureau) — voir sql/2026-09-30_projets_modernisation.sql, section 6/7.
// Complément « modernisation Projets » (2026-09-30).
// =====================================================================
export function MyVolunteerSpace() {
  const { t } = useLang();
  const [myTasks, setMyTasks] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [badges, setBadges] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [taskComments, setTaskComments] = useState({});
  const [newComment, setNewComment] = useState("");
  const [busyTaskId, setBusyTaskId] = useState(null);

  function reportError(error) {
    if (error) { console.error("[MyVolunteerSpace]", error); setErrorMsg(friendlyError(error, t)); return true; }
    return false;
  }

  const load = useCallback(async () => {
    setLoading(true);
    // `members` (annuaire complet, id+nom) est lisible par tout adhérent
    // authentifié (RLS "members select" : association_id = ... , sans
    // condition is_bureau()) — chargé ici uniquement pour l'autocomplétion
    // "@Nom" des commentaires, même patron que VieAssociative.jsx.
    const [{ data: mt, error: e1 }, { data: opp, error: e2 }, { data: bd, error: e3 }, { data: mem }] = await Promise.all([
      supabase.rpc("mes_taches_projet"),
      supabase.rpc("taches_disponibles_benevolat"),
      supabase.from("member_badges").select("*").order("attribue_le", { ascending: false }),
      supabase.from("members").select("id,nom,statut").order("nom"),
    ]);
    reportError(e1 || e2 || e3);
    setMyTasks(mt || []); setOpportunities(opp || []); setBadges(bd || []);
    setMembers((mem || []).filter((m) => m.statut !== "Supprimé"));
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  async function volunteer(taskId) {
    setBusyTaskId(taskId);
    const { data, error } = await supabase.rpc("se_porter_volontaire", { p_task_id: taskId });
    const row = Array.isArray(data) ? data[0] : data;
    setBusyTaskId(null);
    if (reportError(error)) return;
    if (!row || row.status !== "inscrit") { setErrorMsg(t("proj_volunteer_error_" + (row?.status || "inconnu"))); return; }
    await load();
  }

  async function markDone(taskId) {
    if (!window.confirm(t("proj_mark_done_confirm"))) return;
    setBusyTaskId(taskId);
    const { data, error } = await supabase.rpc("marquer_ma_tache_terminee", { p_task_id: taskId });
    const row = Array.isArray(data) ? data[0] : data;
    setBusyTaskId(null);
    if (reportError(error)) return;
    if (!row || row.status !== "termine") { setErrorMsg(t("proj_mark_done_error_" + (row?.status || "inconnu"))); return; }
    await load();
  }

  async function toggleComments(taskId) {
    if (expandedTaskId === taskId) { setExpandedTaskId(null); return; }
    setExpandedTaskId(taskId);
    if (!taskComments[taskId]) {
      const { data, error } = await supabase.rpc("commentaires_de_ma_tache", { p_task_id: taskId });
      if (!reportError(error)) setTaskComments((p) => ({ ...p, [taskId]: data || [] }));
    }
  }

  async function submitComment(taskId) {
    if (!newComment.trim()) return;
    const { data, error } = await supabase.rpc("commenter_ma_tache", { p_task_id: taskId, p_contenu: newComment.trim() });
    const row = Array.isArray(data) ? data[0] : data;
    if (reportError(error)) return;
    if (row?.status === "ajoute") {
      setNewComment("");
      const { data: refreshed } = await supabase.rpc("commentaires_de_ma_tache", { p_task_id: taskId });
      setTaskComments((p) => ({ ...p, [taskId]: refreshed || [] }));
    }
  }

  // Pas de <Container><Section> ici : ce composant est destiné à être
  // intégré dans la section "Mon espace" existante (même patron que
  // MyAttendanceHistory dans Presences.jsx), pas monté comme un onglet
  // autonome — il ne doit donc pas imbriquer un second Container/Section.
  if (loading) return <Card style={{ marginTop: 18 }}><p>{t("loading")}</p></Card>;

  return (
    <>
      <h3 style={{ margin: "18px 0 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}><HeartHandshake size={17} /> {t("proj_my_space_title")}</h3>

      {errorMsg && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "#FBE4E1", color: RED, border: "1px solid #F3C6C0", borderRadius: 10, padding: "10px 14px", marginBottom: 18, fontSize: 12.5, fontWeight: 600 }}>
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg("")} style={{ background: "none", border: "none", color: RED, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
      )}

      <Card style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><Kanban size={15} /> {t("proj_my_tasks_title")}</h3>
        {myTasks.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {myTasks.map((mt2) => (
              <div key={mt2.task_id} style={{ border: "1px solid #EEE", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{mt2.titre}</div>
                    <div style={{ fontSize: 11, color: "#686F7D" }}>{mt2.projet_nom} {mt2.echeance ? `· ${t("proj_task_end")} ${mt2.echeance}` : ""}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Pill color={mt2.colonne === "termine" ? TEAL : "#5B6B94"} bg={mt2.colonne === "termine" ? TEAL_LIGHT : "#EAEDF6"}>{t("proj_col_" + mt2.colonne)}</Pill>
                    {mt2.colonne !== "termine" && (
                      <button disabled={busyTaskId === mt2.task_id} onClick={() => markDone(mt2.task_id)} style={{ fontSize: 11, fontWeight: 600, color: TEAL, background: TEAL_LIGHT, border: "none", borderRadius: 999, padding: "5px 10px", cursor: "pointer" }}>
                        {t("proj_mark_done_btn")}
                      </button>
                    )}
                  </div>
                </div>
                <button onClick={() => toggleComments(mt2.task_id)} style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", fontSize: 10.5, color: "#8A8F98", padding: 0 }}>
                  <MessageSquare size={11} /> {t("proj_task_comments_toggle")} {expandedTaskId === mt2.task_id ? "▲" : "▼"}
                </button>
                {expandedTaskId === mt2.task_id && (
                  <div style={{ marginTop: 8 }}>
                    {(taskComments[mt2.task_id] || []).map((c) => (
                      <div key={c.id} style={{ fontSize: 11, marginBottom: 6, background: "#F8F9FC", borderRadius: 6, padding: "6px 8px" }}>
                        <b>{c.auteur_nom || "—"}</b>
                        <div style={{ whiteSpace: "pre-wrap" }}>{renderMentions(c.contenu, members)}</div>
                      </div>
                    ))}
                    {!(taskComments[mt2.task_id] || []).length && <p style={{ fontSize: 11, color: "#686F7D", fontStyle: "italic" }}>{t("proj_task_comments_empty")}</p>}
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <MentionInput value={newComment} onChange={setNewComment} members={members} placeholder={t("proj_comment_add_placeholder")}
                        onSubmit={() => submitComment(mt2.task_id)} />
                      <button onClick={() => submitComment(mt2.task_id)} style={{ background: "none", border: "1px solid #DDD", borderRadius: 6, cursor: "pointer", padding: "4px 8px" }}><Send size={12} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 12.5 }}>{t("proj_my_tasks_empty")}</p>}
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><HeartHandshake size={15} /> {t("proj_opportunities_title")}</h3>
        {opportunities.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {opportunities.map((o) => (
              <div key={o.task_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid #EEE", borderRadius: 10, padding: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{o.titre}</div>
                  <div style={{ fontSize: 11, color: "#686F7D" }}>{o.projet_nom} {o.echeance ? `· ${t("proj_task_end")} ${o.echeance}` : ""}</div>
                </div>
                <button disabled={busyTaskId === o.task_id} onClick={() => volunteer(o.task_id)} style={{ fontSize: 12, fontWeight: 700, color: "white", background: "var(--primary)", border: "none", borderRadius: 999, padding: "7px 14px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <HeartHandshake size={13} /> {t("proj_volunteer_btn")}
                </button>
              </div>
            ))}
          </div>
        ) : <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 12.5 }}>{t("proj_opportunities_empty")}</p>}
      </Card>

      <Card>
        <h3 style={{ fontSize: 14, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><Award size={15} /> {t("proj_my_badges_title")}</h3>
        {badges.length ? (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {badges.map((b) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#FBF3D9", border: "1px solid #F0DFA0", borderRadius: 10, padding: "10px 14px", minWidth: 200 }}>
                <Award size={20} color={AMBER} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12.5 }}>{t("proj_badge_pilier_projet")}</div>
                  <div style={{ fontSize: 10.5, color: "#8A8F98" }}>{b.projet_nom}</div>
                </div>
              </div>
            ))}
          </div>
        ) : <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 12.5 }}>{t("proj_my_badges_empty")}</p>}
      </Card>
    </>
  );
}
