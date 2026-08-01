// =====================================================================
// AREM — Configuration de connexion à Supabase
// Développé par Omnia Trade Solutions
// =====================================================================
// 1. Créez un projet gratuit sur https://supabase.com
// 2. Dans Project Settings > API, copiez "Project URL" et "anon public key"
// 3. Collez-les ci-dessous à la place des deux valeurs d'exemple
// 4. Exécutez arem_schema.sql dans Supabase > SQL Editor avant de lancer l'app
// =====================================================================
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://hqqvkwvobmesgwbdjdko.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_m4Oobyylt_POvDWzruTM7g_iTo4Xk9b";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
