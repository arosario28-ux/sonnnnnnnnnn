// Online 1v1 over Supabase Realtime. There is no game server.
//
// Two players meet in a room: one Realtime channel whose presence list *is* the room. Both see
// the same list, ordered by when each joined; the earlier one is the host. A room is either
// private (a four-letter code to share) or one of the public quick-match rooms. As soon as two
// players are in, the host calls the start, and from then on the two exchange state packets
// (see the sync code in main.js). Nothing is written to the database.

const MAX_PLAYERS = 2;
const QUICK_ROOMS = 16;        // public rooms Q1..Q16, filled in order
const START_DELAY_MS = 1500;   // a beat for both sides to see each other before starting
const PEER_SILENCE_MS = 8000;  // no packets for this long means the opponent is gone
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOPIC = 'rr3d-room-';    // versioned so older builds of the game can't end up in these rooms

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

async function drop(sb, channel) {
  if (channel) { try { await sb.removeChannel(channel); } catch { /* already gone */ } }
}

// The client hands back its existing channel object for a topic it already knows, and a channel
// that has been left can't be joined again. So make sure any old one is fully gone first.
async function freshChannel(sb, topic, config) {
  for (let i = 0; i < 20; i++) {
    const stale = sb.getChannels().find((c) => c.topic === `realtime:${topic}`);
    if (!stale) break;
    if (i === 0) await drop(sb, stale); else await sleep(100);
  }
  return sb.channel(topic, { config });
}

// One visit to the online screen, from pressing a button to leaving. Everything it starts checks
// `dead` before acting, so a cancelled attempt can never come back to life alongside a newer one.
function openSession(sb, mode, code, me, handlers) {
  let dead = false;
  let room = null, roomCode = null;
  let timers = [];
  let match = null;         // { id, call, host } once a match has started
  let peerId = null, lastHeard = 0, pairSeenAt = 0;
  const every = (ms, fn) => { timers.push(setInterval(() => { if (!dead) fn(); }, ms)); };
  const send = (event, payload) => room?.send({ type: 'broadcast', event, payload }).catch(() => {});
  const presence = (playing) => ({ name: me.name, look: me.look, joinedAt: me.joinedAt, playing });

  function members() {
    const state = room ? room.presenceState() : {};
    return Object.entries(state)
      .map(([id, metas]) => ({ id, ...metas[metas.length - 1] }))
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
  }

  async function join(topicCode) {
    if (dead) return null;
    const ch = await freshChannel(sb, TOPIC + topicCode, { presence: { key: me.id }, broadcast: { self: false } });
    if (dead) { drop(sb, ch); return null; }
    room = ch;
    roomCode = topicCode;
    const synced = new Promise((resolve) => {
      ch.on('presence', { event: 'sync' }, () => { resolve(); if (!dead && room === ch) tick(); });
      setTimeout(resolve, 4000);
    });
    ch.on('broadcast', { event: 'start' }, ({ payload }) => { if (!dead && room === ch) onStartCall(payload); });
    ch.on('broadcast', { event: 's' }, ({ payload }) => {
      if (dead || !match || payload.m !== match.id) return;
      lastHeard = Date.now();
      handlers.onPacket(payload);
    });
    ch.on('broadcast', { event: 'bye' }, ({ payload }) => { if (payload.id === peerId) gone(); });
    ch.on('presence', { event: 'leave' }, ({ key }) => {
      // a dropped connection shows as a leave too; give it a moment to come back
      setTimeout(() => { if (!dead && match && key === peerId && Date.now() - lastHeard > 2500) gone(); }, 3000);
    });
    const joined = new Promise((resolve) => {
      ch.subscribe(async (status) => {
        if (dead || room !== ch) return;
        if (status === 'SUBSCRIBED') {
          me.joinedAt = me.joinedAt || Date.now();
          await ch.track(presence(false));
          resolve(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve(false);
      });
    });
    if (!(await joined)) { handlers.onError('Could not reach the online service. Check your connection and try again.'); return null; }
    await synced;
    return ch;
  }

  // Whether this player has a place in the room, or must look elsewhere.
  function placeIn() {
    const list = members();
    return { list, busy: list.some((m) => m.playing), full: list.findIndex((m) => m.id === me.id) >= MAX_PLAYERS };
  }

  async function findQuickRoom() {
    for (let n = 1; n <= QUICK_ROOMS && !dead; n++) {
      handlers.onRoom({ status: 'Finding a match…', players: [] });
      me.joinedAt = 0;
      if (!(await join(`Q${n}`))) return;
      const { busy, full } = placeIn();
      if (!busy && !full) return start();
      const ch = room;
      room = null;
      await drop(sb, ch);
    }
    if (!dead) handlers.onError('Every quick-match room is busy. Try again in a minute, or make a private room.');
  }

  async function joinCode(c) {
    handlers.onRoom({ status: mode === 'join' ? `Joining room ${c}…` : 'Opening a room…', players: [] });
    if (!(await join(c))) return;
    // the host can take a moment to show up after joining, so look for a while before deciding
    // the code is wrong
    for (let waited = 0; waited < 6000 && !dead && mode === 'join' && members().length < 2; waited += 250) await sleep(250);
    if (dead) return;
    const { list, busy, full } = placeIn();
    const fail = (text) => { handlers.onError(text); const ch = room; room = null; drop(sb, ch); };
    if (full) return fail(`Room ${c} is full.`);
    if (busy) return fail(`Room ${c} is in the middle of a match.`);
    if (mode === 'join' && list.length < 2) return fail(`Couldn't find anyone in room ${c}. Check the code, and that your friend still has the room open.`);
    start();
  }

  function start() {
    tick();
    every(500, tick);
    every(1000, () => {
      if (!match) return;
      if (match.host && Date.now() - match.startedAt < 4000) send('start', match.call);   // in case it was missed
      if (Date.now() - lastHeard > PEER_SILENCE_MS) gone();
    });
  }

  // Works out what the room is doing and, for the host, whether it is time to start.
  function tick() {
    if (!room || match) return;
    const list = members().slice(0, MAX_PLAYERS);
    const iHost = list[0]?.id === me.id;
    if (list.length >= 2) {
      pairSeenAt = pairSeenAt || Date.now();
      if (iHost && Date.now() - pairSeenAt >= START_DELAY_MS) return callStart(list);
    } else pairSeenAt = 0;
    handlers.onRoom({
      code: mode === 'quick' ? null : roomCode,
      status: list.length >= 2 ? 'Opponent found! Starting…' : mode === 'quick' ? 'Searching for an opponent…' : 'Share the code. Waiting for your friend to join…',
      players: list.map((m) => ({ id: m.id, name: m.name, host: m === list[0], me: m.id === me.id })),
    });
  }

  function callStart(list) {
    const call = { match: newId(), players: list.map((m) => ({ id: m.id, name: m.name, look: m.look })) };
    send('start', call);
    onStartCall(call, true);
  }

  function onStartCall(call, host = false) {
    if (match || !call.players.some((p) => p.id === me.id)) return;
    match = { id: call.match, call, host, startedAt: Date.now() };
    const peer = call.players.find((p) => p.id !== me.id);
    peerId = peer.id; lastHeard = Date.now();
    room.track(presence(true)).catch(() => {});
    handlers.onStart({ host, opponent: peer, matchId: call.match });
  }

  function gone() {
    if (dead || !match || !peerId) return;
    peerId = null;
    handlers.onPeerLeft();
  }

  const run = mode === 'quick' ? findQuickRoom() : joinCode(code);
  run.catch((err) => {
    console.warn('Online play unavailable', err);
    if (!dead) handlers.onError('Online play is unavailable right now. Check your connection and try again.');
  });

  return {
    get playing() { return !!match; },
    get host() { return !!match?.host; },
    sendState(packet) { if (!dead && match) { packet.m = match.id; send('s', packet); } },
    leave() {
      if (dead) return;
      dead = true;
      timers.forEach(clearInterval);
      if (match) send('bye', { id: me.id });
      const ch = room;
      room = null;
      setTimeout(() => drop(sb, ch), 200);   // give "bye" a moment to go out
    },
  };
}

// handlers:
//   onRoom({ code, status, players: [{ id, name, host, me }] }), onError(text),
//   onStart({ host, opponent: { id, name, look }, matchId }), onPacket(packet), onPeerLeft()
// profile: { name, look }
export function createOnline(sb, handlers) {
  let session = null;
  const open = (mode, code, profile) => {
    session?.leave();
    session = openSession(sb, mode, code, { id: newId(), ...profile }, handlers);
  };
  return {
    get active() { return !!session; },
    get playing() { return !!session?.playing; },
    get host() { return !!session?.host; },
    quick(profile) { open('quick', null, profile); },
    create(profile) { open('create', newCode(), profile); },
    join(code, profile) { open('join', code.trim().toUpperCase(), profile); },
    sendState(packet) { session?.sendState(packet); },
    leave() { session?.leave(); session = null; },
  };
}
