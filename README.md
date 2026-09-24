# Rocket Rush

A 2D arcade car-soccer game — original art (all canvas-drawn), original sounds
(all synthesized with WebAudio), single-player vs AI, local 2-player, a
drops/inventory system with a Garage to customize your car, and online
multiplayer with real accounts.

## Files

```
index.html            -- page structure
style.css              -- all styling
game.js                 -- all game logic (physics, AI, drops, garage, multiplayer)
supabase-config.js      -- YOUR Supabase project URL + key go here
README.md              -- this file
```

## Quick start (no setup required)

Just open `index.html` in a browser, or push this folder to a GitHub repo and
turn on GitHub Pages (Settings → Pages → deploy from the `main` branch). The
game fully works with **zero configuration**: local single-player vs AI,
local 2-player on one keyboard, drops, and a Garage — all saved to your
browser's local storage.

**Online multiplayer and cloud accounts need Supabase**, which is free and
takes about 10 minutes to set up. Until you do that, the "Online Match"
button will tell the player Supabase isn't configured — everything else
works as-is.

## Setting up Supabase (free, no credit card)

1. Go to **https://supabase.com/dashboard** and sign in (GitHub login works).
   Click **New project**, give it a name and a database password (you won't
   need the password day-to-day — Supabase generates it for the underlying
   Postgres database), pick any region, and wait ~2 minutes for it to spin up.
2. Once it's ready, go to **Project Settings → API**. Copy the **Project
   URL** and the **`anon` / `public` key** (NOT the `service_role` key — that
   one is secret and must never go in client-side code). Paste both into
   `supabase-config.js` in this project, replacing the placeholder values.
3. Go to **Authentication → Providers**, open **Email**, and **turn off
   "Confirm email"**. This lets accounts (including the dev account below,
   which uses a fake email) sign in immediately after signing up instead of
   waiting on a confirmation link nobody can click.
4. Go to the **SQL Editor** (left sidebar), open a new query, paste the
   schema below, and run it.

### Database schema + security rules

```sql
-- Player display names
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  name text,
  created_at timestamptz default now()
);

-- Drops/inventory, synced with the in-game Garage
create table inventories (
  id uuid references auth.users on delete cascade primary key,
  owned jsonb default '[]'::jsonb,
  equipped jsonb default '{"paint":null,"wheel":null,"boost":null,"celebration":null}'::jsonb,
  updated_at timestamptz default now()
);

-- Online-match pairing (the live gameplay data itself travels over
-- Realtime Broadcast, not this table -- this table just handles matchmaking)
create table matches (
  pair_key text primary key,
  p1 uuid not null,
  p2 uuid not null,
  p1_name text,
  p2_name text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table inventories enable row level security;
alter table matches enable row level security;

create policy "read own profile" on profiles for select using (auth.uid() = id);
create policy "write own profile" on profiles for insert with check (auth.uid() = id);
create policy "update own profile" on profiles for update using (auth.uid() = id);

create policy "read own inventory" on inventories for select using (auth.uid() = id);
create policy "write own inventory" on inventories for insert with check (auth.uid() = id);
create policy "update own inventory" on inventories for update using (auth.uid() = id);

create policy "read own matches" on matches for select using (auth.uid() = p1 or auth.uid() = p2);
create policy "create own matches" on matches for insert with check (auth.uid() = p1 or auth.uid() = p2);
create policy "delete own matches" on matches for delete using (auth.uid() = p1 or auth.uid() = p2);
```

This means: a signed-in player can only read/write their own profile and
inventory rows, and can only see or create match rows they're actually part
of. `matches.pair_key` is a database primary key, which is what makes
matchmaking safe from double-booking — two players' browsers can both try to
create the same match row at the same time, and Postgres guarantees only one
insert wins; the code treats the resulting "already exists" error as success
and just reads the row back.

No extra setup is needed for the live gameplay sync itself (car positions,
ball, score) — that travels over Supabase Realtime's **Broadcast** and
**Presence** features, which work channel-to-channel without touching the
database at all, so there's nothing to enable for that beyond having created
the project.

That's it — reload the page, `supabase-config.js` will pick up your real
values, and Sign In / Online Match will start working.

## Deploying to GitHub Pages

1. Create a new GitHub repo and push these files to it (`index.html`,
   `style.css`, `game.js`, `supabase-config.js` with your real values filled
   in).
2. In the repo, go to **Settings → Pages**, set **Source** to
   "Deploy from a branch", pick `main` and `/ (root)`, save.
3. GitHub gives you a URL like `https://yourname.github.io/reponame/` — that's
   your live game.

Your Supabase URL and anon key will be publicly visible in
`supabase-config.js` once pushed to a public repo — that's expected and fine.
The anon key is meant to be embedded in client-side code (it's called
"public" for a reason); the **Row Level Security policies above are what
actually protect your data**, not hiding this key. Never put the
`service_role` key anywhere in this project.

## The dev/showcase account

I set up a special check in the code (not a real pre-made account — I don't
have access to your Supabase project to create one for you). To activate it:

1. After you've set up Supabase (above, including turning off "Confirm
   email"), open the game and click **Sign In → Sign Up**.
2. Create an account with **exactly** these credentials:
   - Email: `dev@rocketrush.game`
   - Password: `GooseDev2026!`
3. From then on, whenever you log in with that email, the game automatically
   grants **every single item** (all car paints, wheels, boost colors, and
   goal celebrations, Common through Mythic) and equips the flashiest set
   (Prism Shift paint, Chroma Spin wheels, Prismatic Flame boost, Mythic
   Vortex celebration). You can still re-equip anything differently from the
   Garage afterward — the full-unlock just reapplies fresh on every login.

You only need to create this account once. If you want a *different*
email/password for it, open `game.js`, search for `DEV_EMAIL`, and change the
constant — then sign up with your new email instead.

## How the online multiplayer actually works

Worth understanding, since GitHub Pages only serves static files — there's no
game server running anywhere:

- **Matchmaking**: signed-in players wanting a match join a shared
  "lobby-queue" Realtime Presence channel (this is a live who's-here list,
  not a database table). When two players see each other there, they race to
  insert a row into the `matches` table keyed by their sorted user IDs —
  Postgres's primary key guarantees only one of those inserts actually
  "wins," and both players end up agreeing on the same match either way.
  Whoever's user ID sorts first becomes the **host**.
- **No dedicated server, so the host's browser is authoritative**: the host
  runs the *real* ball physics, collisions, and scoring — same code as
  single-player — and broadcasts the ball/score/state to the other player
  over a Realtime **Broadcast** channel about 8 times a second. The other
  player (**guest**) drives their own car with full local responsiveness,
  but their view of the ball and the host's car is smoothed network data,
  not locally simulated.
- **Practical effect**: your own car always feels perfectly responsive to
  you, no matter which role you get. The ball can feel very slightly
  "correcting" for the guest right after a hit, since the authoritative
  bounce comes from the host's next update rather than the guest's own
  instant local physics. For a casual arcade game over a good connection
  this is barely noticeable; it's the tradeoff for having no server to run
  or pay for.
- **If someone closes the tab or loses connection**, Realtime Presence
  detects them leaving the match channel and the other player gets an
  "Opponent Disconnected" notice and returns to the menu — there's no
  reconnect/resume, you'd start a new match.
- Boost pads are **not synced** between the two players — each of you sees
  your own independent pad states. This keeps the network traffic light and
  is a common simplification in casual browser multiplayer; it means you
  might occasionally see a pad as available that your opponent already used,
  which is a minor cosmetic inconsistency, not a gameplay-breaking one.
- Cosmetics (paint/wheels/boost color) only apply to **your own** car, same
  as in local play — your opponent sees their own equipped items on their
  car, not yours, and vice versa.
- One more honest limitation: the Broadcast/Presence channels above aren't
  further locked down by the RLS policies (those only govern the database
  tables) — anyone with your public anon key could technically listen in on
  a match's live channel. For a casual hobby project this is a reasonable
  tradeoff; it's not something to build anything sensitive on top of without
  adding Supabase's channel-level authorization on top.

None of this requires you to run or maintain anything — Supabase's free tier
handles the realtime data and database, no server to keep alive or wake up.
