-- =====================================================================
-- Fuseau horaire configurable par association
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Suite du plan
-- « internationalisation » (voir claude/internationalisation-universelle.md).
--
-- CE QUE CE SCRIPT AJOUTE :
--   1. Une colonne `associations.fuseau_horaire` (nom IANA, ex. "America/
--      Moncton", "Africa/Douala", "Europe/Paris") — valeur par défaut
--      'America/Moncton' pour préserver exactement le comportement actuel
--      d'AREM (Nouveau-Brunswick), qui ne remarquera aucun changement.
--   2. La correction du vrai problème : les 3 rappels automatiques par
--      courriel (`send_event_reminders`, `send_overdue_inscription_
--      reminders`, `send_overdue_quotepart_reminders`) tournaient jusqu'ici
--      À UNE SEULE HEURE FIXE EN UTC pour TOUTES les associations de la
--      base, quel que soit leur fuseau. Une association basée au Cameroun
--      (UTC+1) recevait ses rappels vers 9h locale — pas grave — mais une
--      association basée à Vancouver (UTC-7/-8) les recevait vers 0h-1h du
--      matin. Ce script fait passer les 3 tâches planifiées d'« une fois
--      par jour à heure UTC fixe » à « une fois par heure, toute la
--      journée », et chaque fonction ne traite désormais que les
--      associations dont il est actuellement ~8h du matin heure LOCALE
--      (donc chaque association reçoit ses rappels vers 8h chez elle,
--      peu importe son fuseau).
--
-- SANS RISQUE POUR LES DONNÉES : aucune table de rappel existante n'est
-- modifiée dans sa structure, seule la logique de sélection des lignes à
-- traiter change (comparaison de date/heure). Les 3 `cron.schedule(...)`
-- ci-dessous remplacent les planifications existantes (même nom de tâche
-- → `cron.schedule` les met à jour, ne les duplique pas).
-- =====================================================================

-- 1) Colonne fuseau horaire, par association.
alter table public.associations
  add column if not exists fuseau_horaire text not null default 'America/Moncton';

comment on column public.associations.fuseau_horaire is
  'Nom de fuseau horaire IANA (ex. America/Moncton, Africa/Douala, Europe/Paris) utilisé pour l''heure locale affichée et pour l''heure d''envoi des rappels automatiques.';

-- ---------------------------------------------------------------------
-- 2) Rappel d'événements — désormais conscient du fuseau horaire.
-- ---------------------------------------------------------------------
create or replace function public.send_event_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  ev record;
  rsvp record;
  assoc_nom text;
begin
  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  if api_key is null then
    return;
  end if;

  for ev in
    select e.*
    from public.events e
    join public.associations a on a.id = e.association_id
    where e.rappel_envoye = false
      -- "dans 2 jours", compté en date LOCALE de l'association (et non en UTC).
      and e.date_debut::date = ((now() at time zone coalesce(a.fuseau_horaire, 'America/Moncton'))::date + interval '2 days')::date
      -- ne traite cette association qu'une fois par jour, vers 8h heure locale
      -- (la tâche planifiée tourne désormais toutes les heures — voir plus bas).
      and extract(hour from (now() at time zone coalesce(a.fuseau_horaire, 'America/Moncton'))) = 8
  loop
    select a.nom into assoc_nom from public.associations a where a.id = ev.association_id;

    for rsvp in
      select m.email
      from public.event_rsvps r
      join public.members m on m.id = r.member_id
      where r.event_id = ev.id
        and r.statut = 'confirme'
        and m.email is not null
    loop
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || api_key
        ),
        body := jsonb_build_object(
          'from', 'onboarding@resend.dev',
          'to', jsonb_build_array(rsvp.email),
          'subject', '[' || coalesce(assoc_nom, 'Association') || '] Rappel : ' || ev.titre || ' dans 2 jours',
          'html',
            '<p>Bonjour,</p>' ||
            '<p>Ceci est un rappel : vous êtes inscrit(e) à l''événement suivant, qui a lieu dans 2 jours.</p>' ||
            '<p style="padding:12px;background:#f5f5f5;border-radius:6px;">' ||
            '<strong>' || ev.titre || '</strong><br/>' ||
            'Date : ' || to_char(ev.date_debut::date, 'DD/MM/YYYY') ||
            (case when ev.lieu is not null and ev.lieu <> '' then '<br/>Lieu : ' || ev.lieu else '' end) ||
            '</p>' ||
            '<p>À bientôt !</p>'
        )
      );
    end loop;

    update public.events set rappel_envoye = true where id = ev.id;
  end loop;
end;
$$;

-- Toutes les heures (la fonction elle-même ne fait quelque chose que pour
-- les associations dont il est ~8h du matin local à ce moment précis).
select cron.schedule(
  'rappel-evenements-quotidien',
  '0 * * * *',
  $$select public.send_event_reminders();$$
);

-- ---------------------------------------------------------------------
-- 3) Rappels de paiements en retard — même principe.
-- ---------------------------------------------------------------------
create or replace function public.send_overdue_inscription_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  seuil_jours constant int := 30; -- SEUIL : jours après l'adhésion avant le rappel
  rec record;
  montant_du numeric;
begin
  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  if api_key is null then
    return;
  end if;

  for rec in
    select m.id as member_id, m.email, m.nom, m.date_adhesion, m.inscription_paye,
           a.id as association_id, a.nom as assoc_nom, coalesce(a.inscription_montant, 25) as inscription_montant
    from public.members m
    join public.associations a on a.id = m.association_id
    where m.statut = 'Actif'
      and m.email is not null
      and m.date_adhesion is not null
      and m.date_adhesion <= ((now() at time zone coalesce(a.fuseau_horaire, 'America/Moncton'))::date - seuil_jours)
      and coalesce(m.inscription_paye, 0) < coalesce(a.inscription_montant, 25)
      and m.rappel_inscription_envoye = false
      and extract(hour from (now() at time zone coalesce(a.fuseau_horaire, 'America/Moncton'))) = 8
  loop
    montant_du := rec.inscription_montant - coalesce(rec.inscription_paye, 0);

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || api_key
      ),
      body := jsonb_build_object(
        'from', 'onboarding@resend.dev',
        'to', jsonb_build_array(rec.email),
        'subject', '[' || coalesce(rec.assoc_nom, 'Association') || '] Rappel : inscription non réglée',
        'html',
          '<p>Bonjour ' || coalesce(rec.nom, '') || ',</p>' ||
          '<p>Un solde reste dû sur votre inscription à ' || coalesce(rec.assoc_nom, 'l''association') || ' :</p>' ||
          '<p style="padding:12px;background:#f5f5f5;border-radius:6px;">' ||
          'Montant dû : <strong>' || to_char(montant_du, 'FM999999990.00') || ' $</strong>' ||
          '</p>' ||
          '<p>Merci de régulariser votre situation auprès du bureau dès que possible.</p>'
      )
    );

    update public.members set rappel_inscription_envoye = true where id = rec.member_id;
  end loop;
end;
$$;

create or replace function public.send_overdue_quotepart_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  seuil_jours constant int := 14; -- SEUIL : jours après la dépense avant le rappel
  rec record;
begin
  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  if api_key is null then
    return;
  end if;

  for rec in
    select r.id as recouvrement_id, r.quote_part, m.email, m.nom,
           d.fonds, d.date as date_depense, d.description,
           a.nom as assoc_nom
    from public.fonds_recouvrements r
    join public.fonds_depenses d on d.id = r.depense_id
    join public.members m on m.id = r.member_id
    join public.associations a on a.id = d.association_id
    where r.paye = false
      and d.date <= ((now() at time zone coalesce(a.fuseau_horaire, 'America/Moncton'))::date - seuil_jours)
      and r.rappel_envoye = false
      and m.email is not null
      and m.statut = 'Actif'
      and extract(hour from (now() at time zone coalesce(a.fuseau_horaire, 'America/Moncton'))) = 8
  loop
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || api_key
      ),
      body := jsonb_build_object(
        'from', 'onboarding@resend.dev',
        'to', jsonb_build_array(rec.email),
        'subject', '[' || coalesce(rec.assoc_nom, 'Association') || '] Rappel : quote-part non réglée',
        'html',
          '<p>Bonjour ' || coalesce(rec.nom, '') || ',</p>' ||
          '<p>Une quote-part de recouvrement reste due (' ||
          (case when rec.fonds = 'urgence' then 'fonds d''urgence' else 'fonds de secours' end) ||
          (case when rec.description is not null and rec.description <> '' then ' — ' || rec.description else '' end) ||
          ') :</p>' ||
          '<p style="padding:12px;background:#f5f5f5;border-radius:6px;">' ||
          'Montant dû : <strong>' || to_char(rec.quote_part, 'FM999999990.00') || ' $</strong><br/>' ||
          'Dépense du : ' || to_char(rec.date_depense::date, 'DD/MM/YYYY') ||
          '</p>' ||
          '<p>Merci de régulariser votre situation auprès du bureau dès que possible.</p>'
      )
    );

    update public.fonds_recouvrements set rappel_envoye = true where id = rec.recouvrement_id;
  end loop;
end;
$$;

-- Toutes les heures également (décalées de quelques minutes entre elles,
-- comme avant, pour éviter qu'elles ne tournent à la même seconde).
select cron.schedule(
  'rappel-inscriptions-impayees-quotidien',
  '15 * * * *',
  $$select public.send_overdue_inscription_reminders();$$
);

select cron.schedule(
  'rappel-quotes-parts-impayees-quotidien',
  '30 * * * *',
  $$select public.send_overdue_quotepart_reminders();$$
);

-- =====================================================================
-- Vérification rapide après exécution :
--   select jobname, schedule, active from cron.job where jobname like 'rappel-%';
--   -- doit afficher les 3 tâches, désormais avec un schedule "toutes les
--   -- heures" (0/15/30 * * * *), toutes active = true
--
--   select fuseau_horaire from public.associations;
--   -- doit afficher 'America/Moncton' pour les associations existantes
--
-- Pour tester immédiatement sans attendre la bonne heure locale, appelez
-- les fonctions directement (elles ignorent alors le filtre "8h locale") :
--   -- (aucune modification nécessaire pour tester : les 3 fonctions
--   -- exigent toujours qu'il soit ~8h heure locale de l'association pour
--   -- agir — c'est voulu, pour ne jamais spammer en dehors de la fenêtre
--   -- normale. Pour un test manuel immédiat quelle que soit l'heure,
--   -- changez temporairement `fuseau_horaire` de l'association de test
--   -- pour un fuseau où il est actuellement 8h, ou changez temporairement
--   -- le "= 8" ci-dessus en l'heure UTC actuelle, testez, puis remettez
--   -- 8 et relancez ce script).
-- =====================================================================
