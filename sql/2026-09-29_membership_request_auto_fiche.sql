-- =====================================================================
-- Fiche adhérent automatique à l'approbation d'une demande d'adhésion
-- publique (suite 93)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Complément
-- direct de la vitrine publique (Phase 4, suite 91,
-- sql/2026-09-28i_vitrine_publique.sql) : approuver une demande n'y
-- créait rien dans Adhérents/Inscription — c'était le comportement voulu
-- au départ (juste un courriel avec le code d'invitation, le bureau
-- devait ensuite créer la fiche à la main). Testé en conditions réelles
-- le 2026-09-29 : l'utilisateur veut que la fiche soit créée
-- automatiquement, avec les informations déjà collectées dans le
-- formulaire public plutôt que ressaisies. Décidé avec l'utilisateur
-- (`AskUserQuestion`, 2026-09-29) :
--   - Champs ajoutés au formulaire public : sexe, date de naissance,
--     quartier (les mêmes que la fiche Adhérents, moins compétences et
--     disponibilité bénévolat — jugées plus « vie associative » que
--     « inscription », le bureau peut les compléter après coup).
--   - Statut initial de la fiche créée : "Actif" immédiatement, même
--     comportement que l'ajout manuel actuel dans Adhérents (le paiement
--     de l'inscription reste suivi séparément dans l'onglet Inscription).
--
-- CE QUE CE SCRIPT CHANGE :
--   1. `membership_requests` gagne 3 colonnes optionnelles : sexe,
--      date_naissance, quartier.
--   2. `resolve_membership_request()` : à l'approbation, crée
--      automatiquement une fiche dans `members` (statut "Actif") — SAUF
--      si une fiche avec le même courriel existe déjà dans l'association
--      (évite les doublons sur une double demande, ou un membre déjà
--      inscrit qui soumet le formulaire par erreur). Le courriel avec le
--      code d'invitation continue d'être envoyé comme avant : quand la
--      personne crée ensuite son compte avec ce code, le rattachement
--      automatique déjà en place (join_association_with_code(), suite
--      33) la relie à cette fiche via la correspondance par courriel —
--      aucun changement nécessaire de ce côté, le mécanisme existant
--      suffit.
-- =====================================================================

alter table public.membership_requests
  add column if not exists sexe text check (sexe in ('M', 'F')),
  add column if not exists date_naissance date,
  add column if not exists quartier text;

comment on column public.membership_requests.sexe is 'Optionnel, collecté par le formulaire public (suite 93) — repris tel quel sur la fiche members créée à l''approbation.';
comment on column public.membership_requests.date_naissance is 'Optionnel, collecté par le formulaire public (suite 93) — repris tel quel sur la fiche members créée à l''approbation.';
comment on column public.membership_requests.quartier is 'Optionnel, collecté par le formulaire public (suite 93) — repris tel quel sur la fiche members créée à l''approbation.';

create or replace function public.resolve_membership_request(p_request_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_req record;
  v_association record;
  v_api_key text;
  v_html text;
  v_existing_member_id uuid;
begin
  select * into v_req from public.membership_requests where id = p_request_id;
  if v_req is null then
    raise exception 'Demande introuvable.';
  end if;
  if not public.is_staff() or v_req.association_id <> public.current_association_id() then
    raise exception 'Non autorisé.';
  end if;
  if p_action not in ('approuver', 'rejeter') then
    raise exception 'Action invalide.';
  end if;
  if v_req.statut <> 'en_attente' then
    raise exception 'Cette demande a déjà été traitée.';
  end if;

  update public.membership_requests
    set statut = case when p_action = 'approuver' then 'approuve' else 'rejete' end,
        traite_par = auth.uid(),
        traite_le = now()
    where id = p_request_id;

  if p_action = 'approuver' then
    select * into v_association from public.associations where id = v_req.association_id;

    -- Fiche membre automatique (suite 93) — sauf doublon par courriel
    -- (déjà présent dans l'association, insensible à la casse).
    select id into v_existing_member_id
    from public.members
    where association_id = v_req.association_id
      and email is not null
      and lower(email) = lower(v_req.courriel)
    limit 1;

    if v_existing_member_id is null then
      insert into public.members (
        association_id, nom, email, telephone, sexe, date_naissance, quartier,
        date_adhesion, statut, disponible_benevolat
      ) values (
        v_req.association_id, v_req.nom, v_req.courriel, v_req.telephone, v_req.sexe, v_req.date_naissance, v_req.quartier,
        current_date, 'Actif', false
      );
    end if;

    if coalesce(v_association.adhesion_notif_auto, true) then
      select decrypted_secret into v_api_key from vault.decrypted_secrets where name = 'resend_api_key';
      if v_api_key is not null then
        v_html := $html$<p>Bonjour $html$ || v_req.nom
          || $html$,</p><p>Votre demande d'adhésion à $html$ || coalesce(v_association.nom, 'l''association')
          || $html$ a été approuvée.</p><p>Utilisez le code d'invitation suivant pour créer votre compte depuis l'écran de connexion (« Rejoindre avec un code ») :</p><p style="font-size:20px;font-weight:700;letter-spacing:2px;">$html$
          || coalesce(v_association.code_invitation, '')
          || $html$</p>$html$;

        perform net.http_post(
          url := 'https://api.resend.com/emails',
          headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
          body := jsonb_build_object(
            'from', 'AREM <onboarding@resend.dev>',
            'to', array[v_req.courriel],
            'subject', $texte$Votre demande d'adhésion a été approuvée$texte$,
            'html', v_html
          )
        );
      end if;
    end if;
  end if;
end;
$fn$;

comment on function public.resolve_membership_request(uuid, text) is
  'Approuve ou rejette une demande d''adhésion publique. Réservé au bureau de l''association concernée (is_staff() + association_id = current_association_id()). En approbation : crée automatiquement une fiche dans members (statut Actif), sauf si une fiche avec le même courriel existe déjà (évite les doublons) — puis envoie un courriel avec le code d''invitation uniquement si associations.adhesion_notif_auto = true (suite 93, 2026-09-29).';

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'membership_requests'
--     and column_name in ('sexe', 'date_naissance', 'quartier');
--   -- doit afficher 3 lignes
--
-- Test réel : approuve une demande de test dans Gestion des accès, puis
-- vérifie qu'une nouvelle fiche est apparue dans l'onglet Adhérents avec
-- le même nom/courriel.
-- =====================================================================
