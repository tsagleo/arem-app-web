-- =====================================================================
-- Courriel de confirmation au membre dès qu'une quote-part de
-- recouvrement (fonds d'urgence ou de secours) est marquée payée
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Phase 2 de
-- claude/feuille-de-route.md — extension de « Confirmation de paiement
-- reçu » (suite 40) aux quote-parts de recouvrement.
--
-- CE QUE CE SCRIPT AJOUTE :
--   Dès qu'une ligne de `fonds_recouvrements` passe de non payée à
--   payée (bouton « Marquer payé » dans l'écran Fonds d'urgence/Fonds de
--   secours, ou modification manuelle), un courriel de confirmation est
--   envoyé au membre concerné, à l'adresse enregistrée sur sa fiche
--   (`members.email`). C'est le pendant symétrique du rappel de retard
--   déjà construit pour ce même cas (`sql/2026-09-07j_...sql`).
--
--   Le courriel ne part qu'au moment précis où `paye` passe à `true`
--   (pas si on le remet à `false` par erreur, et pas de renvoi si la
--   ligne est ensuite re-sauvegardée sans changement de statut).
--
-- RÉUTILISE LA MÊME CLÉ API RESEND que les scripts précédents (secret
-- `resend_api_key`) — pas besoin de la reconfigurer. Sans clé configurée,
-- ce courriel ne part simplement pas, comme les autres notifications.
-- =====================================================================

create extension if not exists pg_net;

create or replace function public.notify_quotepart_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  rec record;
begin
  -- Ne réagit qu'au passage précis de non-payé à payé.
  if new.paye is not true or old.paye is true then
    return new;
  end if;

  select m.email, m.nom, m.statut,
         d.fonds, d.description, d.date as date_depense,
         a.nom as assoc_nom
    into rec
    from public.fonds_depenses d
    join public.members m on m.id = new.member_id
    join public.associations a on a.id = d.association_id
    where d.id = new.depense_id;

  if rec.email is null or rec.statut = 'Supprimé' then
    return new;
  end if;

  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  if api_key is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || api_key
    ),
    body := jsonb_build_object(
      'from', 'onboarding@resend.dev',
      'to', jsonb_build_array(rec.email),
      'subject', '[' || coalesce(rec.assoc_nom, 'Association') || '] Confirmation : quote-part réglée',
      'html',
        '<p>Bonjour ' || coalesce(rec.nom, '') || ',</p>' ||
        '<p>Nous confirmons la réception de votre quote-part de recouvrement (' ||
        (case when rec.fonds = 'urgence' then 'fonds d''urgence' else 'fonds de secours' end) ||
        (case when rec.description is not null and rec.description <> '' then ' — ' || rec.description else '' end) ||
        ') :</p>' ||
        '<p style="padding:12px;background:#EAF7F1;border-left:4px solid #2E8B74;border-radius:6px;">' ||
        'Montant reçu : <strong>' || to_char(new.quote_part, 'FM999999990.00') || ' $</strong><br/>' ||
        'Dépense du : ' || to_char(rec.date_depense::date, 'DD/MM/YYYY') ||
        '</p>' ||
        '<p>Merci de votre confiance !</p>'
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_quotepart_paid on public.fonds_recouvrements;
create trigger trg_notify_quotepart_paid
  after update on public.fonds_recouvrements
  for each row
  when (new.paye is distinct from old.paye)
  execute function public.notify_quotepart_paid();

-- =====================================================================
-- Vérification rapide après exécution :
--   select tgname from pg_trigger where tgname = 'trg_notify_quotepart_paid';
-- =====================================================================
