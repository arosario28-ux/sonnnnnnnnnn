/* ============================================================================
   SUPABASE CONFIG
   ============================================================================
   Filled in with the Rocket Rush Supabase project's URL and anon (public)
   key. Safe to keep public -- Row Level Security policies (see README.md)
   are what actually protect the data, not hiding this key.
   ========================================================================= */

const SUPABASE_URL = "https://erfvaojivcwfhczykgjm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyZnZhb2ppdmN3ZmhjenlrZ2ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMzA4NTAsImV4cCI6MjEwNTgwNjg1MH0.Ts34KBh47yr1S37zxLV_17IBfTBZcPlrowLL7Z539dk";

// Only initialize if the placeholder values above have actually been
// replaced, and only if the Supabase SDK script loaded successfully (e.g.
// not blocked offline / by an ad-blocker). Either way, game.js checks for
// this itself and falls back to local-only mode cleanly -- nothing here is
// required to play locally.
try {
  if (
    typeof supabase !== "undefined" &&
    SUPABASE_URL.indexOf("YOUR_PROJECT_REF") === -1 &&
    SUPABASE_ANON_KEY !== "YOUR_ANON_PUBLIC_KEY"
  ) {
    // `sb` is the global game.js talks to (kept separate from the `supabase`
    // namespace object the CDN script exposes, which is just the factory).
    window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 20 } }
    });
  }
} catch (e) {
  console.warn("Supabase failed to initialize -- playing in local-only mode.", e);
}
