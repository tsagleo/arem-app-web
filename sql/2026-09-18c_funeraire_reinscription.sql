-- =====================================================================
-- Correctif : réinscription au programme funéraire après un retrait
-- =====================================================================
-- Suite 70 (complément, 2026-09-18). Bug signalé par l'utilisateur avec
-- capture d'écran : réinscrire un adhérent déjà retiré du programme
-- funéraire échouait avec le message brut :
--
--   Erreur : duplicate key value violates unique constraint
--   "funeraire_inscriptions_association_id_member_id_key"
--
-- Cause : la contrainte `unique (association_id, member_id)` posée dans
-- le script d'origine (2026-09-18b_funeraire.sql) interdit plus d'une
-- ligne par adhérent, pour toujours — y compris pour un adhérent dont le
-- statut est déjà « retiré » ou « transféré ». Or le retrait est conçu
-- comme un simple changement de statut (pas une suppression), donc
-- réinscrire ensuite le même adhérent crée forcément une deuxième ligne
-- et se heurte à la contrainte.
--
-- Correctif : remplacer la contrainte d'unicité globale par un index
-- unique PARTIEL, qui n'interdit qu'un second dossier ACTIF pour le même
-- adhérent — l'historique des inscriptions/retraits précédents reste
-- conservé, mais un adhérent retiré peut désormais être réinscrit.
-- =====================================================================

alter table public.funeraire_inscriptions
  drop constraint if exists funeraire_inscriptions_association_id_member_id_key;

create unique index if not exists funeraire_inscriptions_un_actif_par_membre
  on public.funeraire_inscriptions (association_id, member_id)
  where (statut = 'actif');

comment on index public.funeraire_inscriptions_un_actif_par_membre is
  'Un seul dossier d''inscription ACTIF par adhérent et par association — un adhérent retiré ou transféré (statut <> ''actif'') peut être réinscrit sans conflit, une nouvelle ligne est créée et l''historique des inscriptions précédentes est conservé. Suite 70 (complément, 2026-09-18).';
