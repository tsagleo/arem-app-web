-- =====================================================================
-- Réunions & webinaires — options avancées : transcription/notes,
-- rappels automatiques par courriel (fuseau horaire de l'association),
-- réunions récurrentes, suivi du quorum (AG), export de la feuille de
-- présence en PDF (ce dernier est généré côté client, rien ici).
-- =====================================================================
-- Suite de sql/2026-10-06_reunions_webinaires.sql. L'utilisateur a
-- demandé une transcription automatique des réunions ; comme le serveur
-- Jitsi Meet public (meet.jit.si) ne permet pas d'enregistrer une
-- réunion gratuitement, et que l'utilisateur a explicitement demandé un
-- outil GRATUIT, la solution retenue est la reconnaissance vocale déjà
-- intégrée aux navigateurs Chrome/Edge (Web Speech API) : elle tourne
-- entièrement côté navigateur, sans clé API, sans coût, et transcrit en
-- direct ce que le microphone de l'appareil capte pendant la réunion.
-- Le texte obtenu reste modifiable à la main (et sert aussi de zone de
-- notes manuelles pour qui n'utilise pas Chrome/Edge) avant d'être
-- enregistré comme procès-verbal.
--
-- SIMPLIFICATIONS ASSUMÉES (à ajuster sur demande) :
--   - La transcription automatique capte uniquement ce que le micro de
--     l'appareil qui a ouvert cette page entend (typiquement la
--     personne qui anime la réunion) — elle ne capte pas séparément
--     chaque participant distant. C'est une limite connue de toute
--     solution de transcription "navigateur" sans serveur
--     d'enregistrement dédié (Jibri ou équivalent payant).
--   - La récurrence ne couvre que deux motifs (hebdomadaire, mensuel à
--     la même date) plutôt qu'un moteur de règles complet (ex. "le
--     premier lundi du mois") — couvre la grande majorité des besoins
--     réels (conseil hebdomadaire, comité/AG mensuel) sans la
--     complexité d'un vrai moteur de récurrence façon calendrier.
--   - Le quorum se configure par réunion (et non une seule fois par
--     association) pour rester flexible (une AG extraordinaire peut
--     avoir un seuil différent d'une AG ordinaire).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Nouvelles colonnes sur meetings
-- ---------------------------------------------------------------------
alter table public.meetings add column if not exists transcription_text text;
alter table public.meetings add column if not exists rappel_envoye boolean not null default false;
alter table public.meetings add column if not exists rappel_heures_avant integer not null default 2;
alter table public.meetings drop constraint if exists meetings_rappel_heures_avant_check;
alter table public.meetings add constraint meetings_rappel_heures_avant_check check (rappel_heures_avant > 0 and rappel_heures_avant <= 168);

alter table public.meetings add column if not exists recurrence_regle text not null default 'aucune';
alter table public.meetings drop constraint if exists meetings_recurrence_regle_check;
alter table public.meetings add constraint meetings_recurrence_regle_check check (recurrence_regle in ('aucune', 'hebdomadaire', 'mensuel'));
alter table public.meetings add column if not exists recurrence_parent_id uuid references public.meetings(id) on delete set null;

alter table public.meetings add column if not exists quorum_requis_pourcentage integer;
alter table public.meetings drop constraint if exists meetings_quorum_check;
alter table public.meetings add constraint meetings_quorum_check check (quorum_requis_pourcentage is null or (quorum_requis_pourcentage between 1 and 100));

create index if not exists meetings_recurrence_parent_idx on public.meetings(recurrence_parent_id);

comment on column public.meetings.transcription_text is
  'Transcription (Web Speech API côté navigateur, Chrome/Edge) ou notes manuelles de la réunion — éditable, servant de base au procès-verbal.';
comment on column public.meetings.recurrence_parent_id is
  'Si non nul, cette occurrence fait partie d''une série récurrente générée côté client — pointe vers la première réunion de la série ("racine").';

-- Les colonnes héritent automatiquement des policies déjà en place sur
-- meetings (select = toute l'association, insert/update/delete =
-- is_bureau()) — aucune nouvelle policy nécessaire.

-- ---------------------------------------------------------------------
-- 2) Réarme le rappel si la date/heure de la réunion change (sinon une
--    réunion reportée ne recevrait jamais son rappel).
-- ---------------------------------------------------------------------
create or replace function public.trg_meetings_reset_rappel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.date_heure <> old.date_heure then
    new.rappel_envoye := false;
  end if;
  return new;
end;
$fn$;
drop trigger if exists meetings_reset_rappel_trigger on public.meetings;
create trigger meetings_reset_rappel_trigger
  before update on public.meetings
  for each row execute function public.trg_meetings_reset_rappel();

-- ---------------------------------------------------------------------
-- 3) Rappel automatique par courriel, respectant le fuseau horaire de
--    l'association (associations.fuseau_horaire, voir
--    sql/2026-09-27b_fuseau_horaire.sql) pour l'affichage de l'heure
--    dans le courriel. Le déclenchement lui-même (la fenêtre "dans N
--    heures") utilise une comparaison timestamptz absolue — donc sûre
--    quel que soit le fuseau, sans dépendre d'une troncature de date
--    locale. Tourne toutes les 15 minutes (plus fin que le rappel
--    quotidien des événements) pour respecter des délais de rappel en
--    heures, pas en jours.
-- ---------------------------------------------------------------------
create or replace function public.send_meeting_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  api_key text;
  m record;
  rsvp record;
  assoc record;
  sent_any boolean;
  heure_locale text;
begin
  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';
  if api_key is null then
    return;
  end if;

  for m in
    select mt.* from public.meetings mt
    where mt.rappel_envoye = false
      and mt.statut <> 'annulee'
      and mt.date_heure between now() and now() + (mt.rappel_heures_avant || ' hours')::interval
  loop
    select a.* into assoc from public.associations a where a.id = m.association_id;
    heure_locale := to_char(m.date_heure at time zone coalesce(assoc.fuseau_horaire, 'UTC'), 'DD/MM/YYYY à HH24:MI');
    sent_any := false;

    for rsvp in
      select mb.email
      from public.meeting_rsvps r
      join public.members mb on mb.id = r.member_id
      where r.meeting_id = m.id
        and r.statut in ('confirme', 'present')
        and mb.email is not null
    loop
      sent_any := true;
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || api_key),
        body := jsonb_build_object(
          'from', 'onboarding@resend.dev',
          'to', jsonb_build_array(rsvp.email),
          'subject', '[' || coalesce(assoc.nom, 'Association') || '] Rappel : ' || m.titre || ' dans ' || m.rappel_heures_avant || ' heure(s)',
          'html',
            '<p>Bonjour,</p>' ||
            '<p>Ceci est un rappel : vous avez confirmé votre présence à la réunion suivante, qui a lieu bientôt (heure locale de l''association).</p>' ||
            '<p style="padding:12px;background:#f5f5f5;border-radius:6px;"><strong>' || m.titre || '</strong><br/>' ||
            'Date et heure : ' || heure_locale ||
            (case when m.lien_visio is not null then '<br/><a href="' || m.lien_visio || '">Rejoindre la visioconférence</a>' else '' end) ||
            '</p><p>À bientôt !</p>'
        )
      );
    end loop;

    update public.meetings set rappel_envoye = true where id = m.id;
  end loop;
end;
$fn$;

select cron.schedule(
  'rappel-reunions-15min',
  '*/15 * * * *',
  $$select public.send_meeting_reminders();$$
);

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns
--   where table_name = 'meetings' and column_name in
--     ('transcription_text','rappel_envoye','rappel_heures_avant',
--      'recurrence_regle','recurrence_parent_id','quorum_requis_pourcentage');
--   -- doit afficher 6 lignes
--   select jobname, schedule, active from cron.job where jobname = 'rappel-reunions-15min';
--   -- doit afficher une ligne avec active = true
--
-- Pour tester sans attendre : select public.send_meeting_reminders();
-- (nécessite la clé Resend déjà configurée, et une réunion dont
-- date_heure tombe dans la fenêtre de rappel avec au moins un RSVP
-- confirmé ayant un courriel).
-- =====================================================================
