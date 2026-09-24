/* ============================================================================
   SUPABASE CONFIG
   ============================================================================
   Fill this in with YOUR Supabase project's URL and anon (public) key, then
   the game's login, cloud-saved inventory, and online multiplayer will all
   work.

   Until you do, this file intentionally does nothing (see the check below),
   and the game still runs fine as local-only single/2-player with an
   inventory saved to your browser instead of the cloud.

   How to get these values (free, no credit card -- see README.md for the
   full walkthrough, including the database tables and security rules to
   set up):
     1. Go to https://supabase.com/dashboard and create a project.
     2. In the project, go to Project Settings > API.
     3. Copy the "Project URL" and the "anon / public" key (NOT the
        "service_role" key -- that one is secret and must never go in
        client-side code) into the two constants below.
   ========================================================================= */

const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_PUBLIC_KEY";

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
