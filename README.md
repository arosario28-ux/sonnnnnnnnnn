# Rocket Rush

A 3D car-soccer game in the browser, built with [three.js](https://threejs.org/). Play against AI (1v1, 2v2 or 3v3), online 1v1, two players in split screen, or free play.

**Play:** https://arosario28-ux.github.io/sonnnnnnnnnn/

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` | Drive / reverse (in the air: pitch) |
| `A` / `D` | Steer (in the air: turn) |
| `Space` | Jump; again in the air to double jump; with a direction held, flip (dodge) |
| `Shift` / left click | Boost |
| `F` / right click | Powerslide; in the air, hold to air roll with `A`/`D` |
| `Q` / `E` | Air roll left / right |
| `C` | Ball cam on / off |
| `Esc` | Pause |

Player 2 (split screen): arrow keys, `-` jump, right `Shift` boost, `/` powerslide. Controllers work too (RT drive, LT reverse, A jump, B boost, X powerslide, Y ball cam).

## Physics

`js/physics.js` runs at 120 Hz in Unreal units and uses the published Rocket League numbers: 650 gravity, the standard 8192 x 10240 x 2044 field with 45 degree corners and curved wall joins, 2300 top speed (1410 without boost), 991.667 boost acceleration, 292 jump impulse with the 0.2 s hold, the 1.25 s double-jump/dodge window, 500 dodge impulse, the same air-control torques, ball restitution 0.6 and 6000 max ball speed, the standard 34 boost pad layout, and the extra car-to-ball impulse curve. Cars drive on walls, and a supersonic hit demolishes an opponent.

It is a close re-creation, not a copy of the real engine: collision shapes are simplified (one hitbox for every car, no wheel suspension), so some advanced mechanics will feel different.

## Online

Online 1v1 runs over Supabase Realtime with no game server (`js/net.js`). A room is one channel whose presence list is the player list; **Quick Match** joins the next open public room, **Create Private Room** gives a four-letter code to share. The earlier player is host and owns the clock, score and ball; each player owns their own car and the guest reports its own ball touches so they feel instant. No sign-in is needed. Signing in (Supabase Auth) saves your drops to the `inventories` table and shows your profile name.

`supabase-config.js` holds the project URL and the public anon key. Row Level Security on the tables is what protects the data. Realtime channels are public: anyone with the anon key could listen in on a match.

## Drops and Garage

Beat the All-Star AI or win an online match to earn a drop: a random paint, wheel color, boost color or goal explosion, Common through Mythic. Equip them in the Garage.

## Files

```
index.html, style.css     page and styling
supabase-config.js        Supabase URL + anon key
js/main.js                game loop, cameras, input, HUD, menus, online sync
js/physics.js             arena, ball and car physics
js/arena.js               pitch, walls, goals, pads, stadium
js/visuals.js             car and ball models, particles, explosions
js/ai.js                  bots
js/net.js                 online rooms
js/account.js             items, inventory, sign-in, garage, drops
js/audio.js               synthesised sound
```

Developer URL flags: `?auto=single|two|free` starts a match immediately, `&bot=1` lets a bot drive your car, `&sim=60` fast-forwards that many seconds and logs the state.

## Credits

- Ball: [Football](https://polyhaven.com/a/football) from Poly Haven (CC0)
- Sky and reflections: [Orlando Stadium](https://polyhaven.com/a/orlando_stadium) HDRI from Poly Haven (CC0)
- Floodlight towers: Kenney [Racing Kit](https://kenney.nl/assets/racing-kit) (CC0)
- Car: [Nissan Skyline GTR r35](https://sketchfab.com/3d-models/nissan-skyline-gtr-r35-7b142ea3376e4811a326256c59bbc7a2) by [Black Snow](https://sketchfab.com/BlackSnow02), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/), simplified and recompressed
- The arena, goals, stadium, effects and sounds are generated in code.
