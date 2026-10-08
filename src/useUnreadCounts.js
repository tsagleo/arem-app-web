import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

export function useUnreadCounts() {
  const [counts, setCounts] = useState({});

  const refresh = useCallback(async () => {
    const [{ data, error }, { data: vaCount, error: vaError }] = await Promise.all([
      supabase.rpc("get_unread_counts"),
      // Compteur séparé (2026-09-29, refonte « réseau social » de Vie
      // associative) — volontairement PAS fusionné dans get_unread_counts()
      // côté base : cette fonction existante fonctionne bien, on évite de la
      // toucher. Compte les réactions/commentaires reçus sur MES propres
      // publications depuis ma dernière visite (voir sql/2026-09-29_vieassociative_reseau_social.sql).
      supabase.rpc("get_vieassociative_unread_count"),
    ]);
    if (!error && data) setCounts((prev) => ({ ...prev, ...data, vieassociative: !vaError ? (vaCount || 0) : (prev.vieassociative || 0) }));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const markViewed = useCallback(async (section) => {
    await supabase.rpc("mark_section_viewed", { p_section: section });
    setCounts((prev) => ({ ...prev, [section]: 0 }));
  }, []);

  const total = Object.values(counts).reduce((sum, n) => sum + (n || 0), 0);

  return { counts, total, refresh, markViewed };
}