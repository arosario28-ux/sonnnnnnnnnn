// Online matches over Supabase Realtime: 1v1, 2v2 or 3v3. There is no game server.
//
// Players meet in a room: one Realtime channel whose presence list *is* the room. Everyone sees
// the same list, ordered by when each joined; the earliest is the host. A room is either private
// (a four-letter code to share) or one of the public quick-match rooms for the chosen team size.
// The host starts the match when the room is full. If not enough players turn up, a quick match
// starts anyway after a short wait, with bots in the empty seats (a private room's host can do
// the same with "Start now"). From then on everyone broadcasts state packets (see main.js).
// Nothing is written to the database.

const QUICK_ROOMS = 16;        // public rooms per team size, filled in order
const START_DELAY_MS = 1500;   // a beat for everyone to see each other before starting
const FILL_WAIT_MS = 20000;    // quick match: start with bots if the room hasn't filled by then
const PEER_SILENCE_MS = 8000;  // no packets for this long means that player is gone
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOPIC = 'rr3d-room-v2-'; // versioned so older builds of the game can't end up in these rooms

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
function openSession(sb, mode, code, me, size, handlers) {
  let dead = false;
  let room = null, roomCode = null;
  let timers = [];
  let match = null;         // { id, call, host, hostId, peers } once a match has started
  let hostSince = 0, fullSince = 0, startNow = false;
  const heard = new Map();  // player id -> when we last had a packet from them
  const capacity = () => size * 2;
  const every = (ms, fn) => { timers.push(setInterval(() => { if (!dead) fn(); }, ms)); };
  const send = (event, payload) => room?.send({ type: 'broadcast', event, payload }).catch(() => {});
  const presence = (playing) => ({ name: me.name, look: me.look, joinedAt: me.joinedAt, playing, size });

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
      if (dead || !match || payload.m !== match.id || !match.peers.has(payload.f)) return;
      heard.set(payload.f, Date.now());
      handlers.onPacket(payload);
    });
    ch.on('broadcast', { event: 'bye' }, ({ payload }) => peerGone(payload.id));
    ch.on('presence', { event: 'leave' }, ({ key }) => {
      // a dropped connection shows as a leave too; give it a moment to come back
      setTimeout(() => { if (!dead && match && Date.now() - (heard.get(key) || 0) > 2500) peerGone(key); }, 3000);
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
    return { list, busy: list.some((m) => m.playing), full: list.findIndex((m) => m.id === me.id) >= capacity() };
  }

  async function findQuickRoom() {
    for (let n = 1; n <= QUICK_ROOMS && !dead; n++) {
      handlers.onRoom({ status: 'Finding a match…', players: [], capacity: capacity() });
      me.joinedAt = 0;
      if (!(await join(`Q${size}-${n}`))) return;
      const { busy, full } = placeIn();
      if (!busy && !full) return start();
      const ch = room;
      room = null;
      await drop(sb, ch);
    }
    if (!dead) handlers.onError('Every quick-match room is busy. Try again in a minute, or make a private room.');
  }

  async function joinCode(c) {
    handlers.onRoom({ status: mode === 'join' ? `Joining room ${c}…` : 'Opening a room…', players: [], capacity: capacity() });
    if (!(await join(c))) return;
    // the host can take a moment to show up after joining, so look for a while before deciding
    // the code is wrong
    for (let waited = 0; waited < 6000 && !dead && mode === 'join' && members().length < 2; waited += 250) await sleep(250);
    if (dead) return;
    // a private room's team size is whatever its host picked
    const host = members()[0];
    if (mode === 'join' && host && host.id !== me.id && host.size) size = host.size;
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
      for (const id of [...match.peers]) if (Date.now() - (heard.get(id) || 0) > PEER_SILENCE_MS) peerGone(id);
    });
  }

  // Works out what the room is doing and, for the host, whether it is time to start.
  function tick() {
    if (!room || match) return;
    const cap = capacity();
    const list = members().slice(0, cap);
    const iHost = list[0]?.id === me.id;
    const full = list.length >= cap;
    hostSince = iHost ? hostSince || Date.now() : 0;
    fullSince = full ? fullSince || Date.now() : 0;
    const fillLeft = mode === 'quick' && hostSince ? Math.max(0, FILL_WAIT_MS - (Date.now() - hostSince)) : Infinity;
    if (iHost && ((full && Date.now() - fullSince >= START_DELAY_MS) || startNow || fillLeft <= 0)) return callStart(list);
    const count = `${list.length}/${cap} players`;
    let status;
    if (full) status = 'Room full! Starting…';
    else if (mode === 'quick') status = iHost ? `Waiting for players (${count}). Bots fill the empty seats in ${Math.ceil(fillLeft / 1000)}s` : `Waiting for players (${count})…`;
    else status = `Share the code. Waiting for friends (${count})…`;
    handlers.onRoom({
      code: mode === 'quick' ? null : roomCode,
      status, capacity: cap, canStart: iHost && !full,
      players: list.map((m) => ({ id: m.id, name: m.name, host: m === list[0], me: m.id === me.id })),
    });
  }

  // Seats alternate blue, orange, blue, orange… in the order players joined; bots take the rest.
  function callStart(list) {
    const seat = (i) => ({ team: i % 2, slot: Math.floor(i / 2) });
    const players = list.map((m, i) => ({ id: m.id, name: m.name, look: m.look, ...seat(i) }));
    const bots = [];
    for (let i = list.length; i < capacity(); i++) bots.push(seat(i));
    const call = { match: newId(), size, host: me.id, players, bots };
    send('start', call);
    onStartCall(call, true);
  }

  function onStartCall(call, host = false) {
    if (match || !call.players.some((p) => p.id === me.id)) return;
    const peers = new Set(call.players.filter((p) => p.id !== me.id).map((p) => p.id));
    match = { id: call.match, call, host, hostId: call.host, peers, startedAt: Date.now() };
    for (const id of peers) heard.set(id, Date.now());
    room.track(presence(true)).catch(() => {});
    handlers.onStart({ host, me: me.id, call });
  }

  function peerGone(id) {
    if (dead || !match || !match.peers.has(id)) return;
    match.peers.delete(id);
    handlers.onPeerLeft({ id, wasHost: id === match.hostId });
  }

  const run = mode === 'quick' ? findQuickRoom() : joinCode(code);
  run.catch((err) => {
    console.warn('Online play unavailable', err);
    if (!dead) handlers.onError('Online play is unavailable right now. Check your connection and try again.');
  });

  return {
    get playing() { return !!match; },
    get host() { return !!match?.host; },
    startNow() { startNow = true; tick(); },
    sendState(packet) { if (!dead && match) { packet.m = match.id; packet.f = me.id; send('s', packet); } },
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
//   onRoom({ code, status, capacity, canStart, players: [{ id, name, host, me }] }), onError(text),
//   onStart({ host, me, call: { match, size, host, players: [{ id, name, look, team, slot }], bots: [{ team, slot }] } }),
//   onPacket(packet), onPeerLeft({ id, wasHost })
// profile: { name, look }; size: players per team (1, 2 or 3)
export function createOnline(sb, handlers) {
  let session = null;
  const open = (mode, code, profile, size) => {
    session?.leave();
    session = openSession(sb, mode, code, { id: newId(), ...profile }, size, handlers);
  };
  return {
    get active() { return !!session; },
    get playing() { return !!session?.playing; },
    get host() { return !!session?.host; },
    quick(profile, size) { open('quick', null, profile, size); },
    create(profile, size) { open('create', newCode(), profile, size); },
    join(code, profile) { open('join', code.trim().toUpperCase(), profile, 1); },
    startNow() { session?.startNow(); },
    sendState(packet) { session?.sendState(packet); },
    leave() { session?.leave(); session = null; },
  };
}
