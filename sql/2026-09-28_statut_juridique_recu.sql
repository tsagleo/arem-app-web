-- =====================================================================
-- Statut juridique / vocabulaire libre + reçu personnalisable
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Suite du plan
-- « internationalisation » (voir claude/internationalisation-universelle.md,
-- point 3 de la liste priorisée).
--
-- CE QUE CE SCRIPT AJOUTE (4 colonnes texte libres sur `associations`,
-- toutes optionnelles, aucune ne casse quoi que ce soit si elle reste
-- vide) :
--   - `statut_juridique` : le statut légal de l'organisme, dans le
--     vocabulaire propre à son pays (« OBNL », « ASBL », « Association loi
--     1901 », « 501(c)(3) », « NGO », « PBO »...) plutôt qu'un vocabulaire
--     supposé canadien codé en dur nulle part dans l'application.
--   - `numero_enregistrement` : le numéro d'enregistrement/d'immatriculation
--     officiel de l'organisme, si applicable dans son pays.
--   - `adresse` : l'adresse postale complète de l'organisme (souvent exigée
--     sur un reçu officiel).
--   - `recu_mention_legale` : un texte libre affiché en pied de page des
--     reçus (Mon espace + reçu de don), à la place du texte générique
--     actuel — permet à chaque association d'ajouter la mention légale
--     exigée dans son pays (ex. un énoncé fiscal officiel, une mise en
--     garde, ses coordonnées bancaires...). Reste vide par défaut : le
--     texte générique actuel continue de s'afficher tel quel si ce champ
--     n'est jamais rempli, aucun changement visible pour une association
--     qui ne configure rien.
-- =====================================================================

alter table public.associations
  add column if not exists statut_juridique text,
  add column if not exists numero_enregistrement text,
  add column if not exists adresse text,
  add column if not exists recu_mention_legale text;

comment on column public.associations.statut_juridique is
  'Statut légal de l''organisme, texte libre (ex. OBNL, ASBL, Association loi 1901, 501(c)(3), NGO) — affiché sur les reçus si rempli.';
comment on column public.associations.numero_enregistrement is
  'Numéro d''enregistrement/d''immatriculation officiel de l''organisme, texte libre — affiché sur les reçus si rempli.';
comment on column public.associations.adresse is
  'Adresse postale complète de l''organisme — affichée sur les reçus si remplie.';
comment on column public.associations.recu_mention_legale is
  'Mention légale personnalisée affichée en pied de page des reçus (Mon espace + reçu de don), à la place du texte générique par défaut si remplie.';

-- =====================================================================
-- Vérification rapide après exécution :
--   select statut_juridique, numero_enregistrement, adresse, recu_mention_legale
--   from public.associations;
--   -- doit afficher les 4 colonnes, toutes NULL pour les associations
--   -- existantes tant qu'elles ne sont pas remplies dans Configuration
-- =====================================================================
