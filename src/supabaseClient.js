import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://hqqvkwvobmesgwbdjdko.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_m4Oobyylt_POvDWzruTM7g_iTo4Xk9b";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);