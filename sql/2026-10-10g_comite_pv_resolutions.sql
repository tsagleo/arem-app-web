-- =====================================================================
-- Comité restreint — procès-verbal de chaque résolution (2026-10-10)
-- (à exécuter APRÈS 2026-10-09d_comite_restreint.sql)
-- =====================================================================
-- Demande de l'utilisateur : à la fin du processus (clôture du vote), un
-- procès-verbal de la résolution doit être généré automatiquement,
-- consigné et archivé, avec les informations légales, les noms de tous
-- les membres du comité, les informations de vote et les signatures.
--   • numero         : numéro de résolution, attribué à la clôture,
--                      continu par association et par année (2026-001…) ;
--   • membres_cloture: composition du comité AU MOMENT de la clôture
--                      (figée : le PV reste juste si le comité change) ;
--   • pv_document_id : PV archivé dans les documents confidentiels du
--                      comité (bucket privé comite-docs) — l'application
--                      le génère et l'archive automatiquement à la clôture.
-- Ré-exécutable sans risque.
-- =====================================================================

alter table public.comite_decisions add column if not exists numero integer;
alter table public.comite_decisions add column if not exists membres_cloture jsonb;
alter table public.comite_decisions add column if not exists pv_document_id uuid references public.comite_documents(id) on delete set null;

-- Clôture : décompte (inchangé) + numéro + composition figée.
create or replace function public.comite_cloturer(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_pour int; v_contre int; v_abst int; v_quorum int;
  v_assoc uuid;
  v_num int;
begin
  select count(*) filter (where choix = 'pour'), count(*) filter (where choix = 'contre'), count(*) filter (where choix = 'abstention')
    into v_pour, v_contre, v_abst from public.comite_votes where decision_id = p_id;
  select quorum, association_id into v_quorum, v_assoc from public.comite_decisions where id = p_id;

  select coalesce(max(d.numero), 0) + 1 into v_num
    from public.comite_decisions d
   where d.association_id = v_assoc and d.numero is not null
     and extract(year from d.cloture_le) = extract(year from now());

  update public.comite_decisions
     set pour = v_pour, contre = v_contre, abstention = v_abst, cloture_le = now(),
         statut = case when v_pour + v_contre + v_abst < v_quorum then 'sans_quorum'
                       when v_pour > v_contre then 'adoptee' else 'rejetee' end,
         numero = coalesce(numero, v_num),
         membres_cloture = coalesce(membres_cloture, (
           select jsonb_agg(jsonb_build_object('nom', e.nom, 'president', e.est_president) order by e.est_president desc, e.nom)
             from public.comite_effectif(v_assoc) e))
   where id = p_id;
end;
$fn$;
revoke all on function public.comite_cloturer(uuid) from public, anon, authenticated;

-- Décisions déjà closes avant ce script : numéro par ordre de clôture et
-- composition actuelle du comité (meilleure information disponible).
with n as (
  select d.id, row_number() over (partition by d.association_id, extract(year from d.cloture_le) order by d.cloture_le) as rn
    from public.comite_decisions d
   where d.statut <> 'en_vote' and d.numero is null and d.cloture_le is not null
)
update public.comite_decisions d set numero = n.rn from n where n.id = d.id;

update public.comite_decisions d
   set membres_cloture = (select jsonb_agg(jsonb_build_object('nom', e.nom, 'president', e.est_president) order by e.est_president desc, e.nom)
                            from public.comite_effectif(d.association_id) e)
 where d.statut <> 'en_vote' and d.membres_cloture is null;

-- Lien vers le PV archivé (un seul : le premier enregistré l'emporte).
create or replace function public.lier_pv_resolution(p_id uuid, p_document_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $fn$
declare
  v_n int;
begin
  if not public.is_comite_membre() then raise exception 'Non autorisé.'; end if;
  update public.comite_decisions
     set pv_document_id = p_document_id
   where id = p_id and association_id = public.current_association_id()
     and statut <> 'en_vote' and pv_document_id is null
     and exists (select 1 from public.comite_documents c where c.id = p_document_id and c.association_id = public.current_association_id());
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;
grant execute on function public.lier_pv_resolution(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select titre, numero, statut, pv_document_id is not null as pv_archive from public.comite_decisions order by created_at desc;
-- ---------------------------------------------------------------------
