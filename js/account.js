// Items, the inventory (browser storage, synced to Supabase when signed in), sign-in, the Garage
// and drop opening. Carried over from the 2D game; the items now colour the 3D car.
import { Sound } from './audio.js';

export const TIER_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
export const RARITY = {
  common: { label: 'Common', color: '#9aa5b1', weight: 100 },
  uncommon: { label: 'Uncommon', color: '#5ad16b', weight: 52 },
  rare: { label: 'Rare', color: '#3d9bff', weight: 24 },
  epic: { label: 'Epic', color: '#b24dff', weight: 9 },
  legendary: { label: 'Legendary', color: '#ff9d2e', weight: 2.4 },
  mythic: { label: 'Mythic', color: '#ff4d8d', weight: 0.5 },
};
const CAT_LABEL = { body: 'Car Body', paint: 'Car Paint', wheel: 'Wheel Color', boost: 'Boost Color', celebration: 'Goal Explosion' };

export const ITEMS = [
  // car bodies: `model` is the file in assets/cars (the starter GT-R needs no item)
  { id: 'body_evo', cat: 'body', name: 'Lancer Evo X', rarity: 'common', model: 'evo' },
  { id: 'body_m4', cat: 'body', name: 'BMW M4', rarity: 'uncommon', model: 'm4' },
  { id: 'body_c8', cat: 'body', name: 'Corvette C8', rarity: 'rare', model: 'c8' },
  { id: 'body_mclaren', cat: 'body', name: 'McLaren Spider', rarity: 'epic', model: 'mclaren' },
  { id: 'body_huracan', cat: 'body', name: 'Huracán EVO', rarity: 'legendary', model: 'huracan' },
  { id: 'body_veyron', cat: 'body', name: 'Bugatti Veyron', rarity: 'mythic', model: 'veyron' },
  { id: 'paint_slate', cat: 'paint', name: 'Slate Steel', rarity: 'common', color: '#7c8b9c' },
  { id: 'paint_forest', cat: 'paint', name: 'Forest Drift', rarity: 'uncommon', color: '#3f8f5c' },
  { id: 'paint_sunset', cat: 'paint', name: 'Sunset Blaze', rarity: 'rare', color: '#ff8a3d' },
  { id: 'paint_royal', cat: 'paint', name: 'Royal Volt', rarity: 'epic', color: '#7b5cff' },
  { id: 'paint_aurum', cat: 'paint', name: 'Golden Aurum', rarity: 'legendary', color: '#ffcf4d' },
  { id: 'paint_prism', cat: 'paint', name: 'Prism Shift', rarity: 'mythic', color: 'rainbow' },
  { id: 'wheel_steel', cat: 'wheel', name: 'Steel Rim', rarity: 'common', color: '#9aa3b0' },
  { id: 'wheel_copper', cat: 'wheel', name: 'Copper Spin', rarity: 'uncommon', color: '#b5651d' },
  { id: 'wheel_azure', cat: 'wheel', name: 'Azure Track', rarity: 'rare', color: '#2ea3ff' },
  { id: 'wheel_violet', cat: 'wheel', name: 'Violet Glow', rarity: 'epic', color: '#a13dff' },
  { id: 'wheel_molten', cat: 'wheel', name: 'Molten Gold', rarity: 'legendary', color: '#ffb02e' },
  { id: 'wheel_chroma', cat: 'wheel', name: 'Chroma Spin', rarity: 'mythic', color: 'rainbow' },
  { id: 'boost_amber', cat: 'boost', name: 'Amber Flame', rarity: 'common', color: '#ffb347' },
  { id: 'boost_cyan', cat: 'boost', name: 'Cyan Flame', rarity: 'uncommon', color: '#5fe3ff' },
  { id: 'boost_magenta', cat: 'boost', name: 'Magenta Flame', rarity: 'rare', color: '#ff4dd2' },
  { id: 'boost_emerald', cat: 'boost', name: 'Emerald Flame', rarity: 'epic', color: '#3dffa1' },
  { id: 'boost_solar', cat: 'boost', name: 'Solar Gold', rarity: 'legendary', color: '#ffe37a' },
  { id: 'boost_prism', cat: 'boost', name: 'Prismatic Flame', rarity: 'mythic', color: 'rainbow' },
  { id: 'cel_classic', cat: 'celebration', name: 'Classic Burst', rarity: 'common' },
  { id: 'cel_sparks', cat: 'celebration', name: 'Spark Shower', rarity: 'uncommon' },
  { id: 'cel_nova', cat: 'celebration', name: 'Starburst Nova', rarity: 'rare' },
  { id: 'cel_impact', cat: 'celebration', name: 'Shockwave Impact', rarity: 'epic' },
  { id: 'cel_rex', cat: 'celebration', name: 'Inferno Rex', rarity: 'legendary' },
  { id: 'cel_vortex', cat: 'celebration', name: 'Mythic Vortex', rarity: 'mythic' },
];

function rollItem() {
  const total = TIER_ORDER.reduce((s, k) => s + RARITY[k].weight, 0);
  let r = Math.random() * total, rarity = TIER_ORDER[0];
  for (const k of TIER_ORDER) { r -= RARITY[k].weight; if (r <= 0) { rarity = k; break; } }
  const pool = ITEMS.filter((i) => i.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

const SAVE_KEY = 'rocketrush_save_v1';
const NO_EQUIP = { body: null, paint: null, wheel: null, boost: null, celebration: null };
export const inventory = { owned: [], equipped: { ...NO_EQUIP } };
try {
  const parsed = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (parsed && Array.isArray(parsed.owned) && parsed.equipped) { inventory.owned = parsed.owned; inventory.equipped = { ...NO_EQUIP, ...parsed.equipped }; }
} catch (e) { /* storage unavailable: play without persistence */ }

// What the equipped items look like on a car: colours (or 'rainbow'), plus the goal explosion id.
export function currentLook() {
  const color = (cat) => ITEMS.find((i) => i.id === inventory.equipped[cat])?.color || null;
  const body = ITEMS.find((i) => i.id === inventory.equipped.body)?.model || null;
  return { body, paint: color('paint'), wheel: color('wheel'), boost: color('boost'), celebration: inventory.equipped.celebration || 'cel_classic' };
}

function swatchCss(item) {
  if (item.cat === 'celebration' || item.cat === 'body') return `background:linear-gradient(135deg, ${RARITY[item.rarity].color}, #0a0e17)`;
  if (item.color === 'rainbow') return 'background:conic-gradient(red,orange,yellow,green,blue,violet,red)';
  return `background:${item.color}`;
}

const $ = (sel) => document.querySelector(sel);
const DEV_EMAILS = ['dev@rocketrush.app', 'cburdick28@brewstermadrid.com'];
const sb = window.sb || null;
export const cloudReady = !!sb;
export const supabaseClient = sb;

export const account = { user: null, name: 'Guest' };
let hooks = { show() {}, toMenu() {}, lookChanged() {}, loggedOut() {} };

function saveInventory() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(inventory)); } catch (e) { /* ignore */ }
  saveCloudInventory();
  hooks.lookChanged();
}

function saveCloudInventory() {
  if (!cloudReady || !account.user) return;
  sb.from('inventories')
    .upsert({ id: account.user.id, owned: inventory.owned, equipped: inventory.equipped, updated_at: new Date().toISOString() })
    .then(({ error }) => { if (error) console.warn('Cloud inventory save failed:', error.message); }, () => {});
}

function loadCloudInventory(uid, email) {
  sb.from('inventories').select('*').eq('id', uid).maybeSingle().then(({ data: cloud }) => {
    if (DEV_EMAILS.includes(email)) {
      // dev/showcase account: everything unlocked
      const first = !cloud || !Array.isArray(cloud.owned) || !cloud.equipped;
      inventory.owned = ITEMS.map((i) => i.id);
      inventory.equipped = first ? { body: 'body_veyron', paint: 'paint_prism', wheel: 'wheel_chroma', boost: 'boost_prism', celebration: 'cel_vortex' } : { ...NO_EQUIP, ...cloud.equipped };
      saveInventory();
    } else if (cloud && Array.isArray(cloud.owned)) {
      inventory.owned = cloud.owned;
      inventory.equipped = { ...NO_EQUIP, ...(cloud.equipped || {}) };
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(inventory)); } catch (e) { /* ignore */ }
      hooks.lookChanged();
    } else {
      saveCloudInventory();   // first cloud login: push up whatever local drops already exist
    }
    if (!$('#menuGarage').classList.contains('hidden')) renderGarage();
  });
}

function updateAccountChip() {
  const text = $('#accountChipText'), btn = $('#btnAccountAction');
  if (!cloudReady) { text.textContent = 'Offline mode'; btn.classList.add('hidden'); return; }
  btn.classList.remove('hidden');
  text.textContent = account.user ? 'Signed in as ' + account.name : 'Playing as guest';
  btn.textContent = account.user ? 'Log Out' : 'Sign In';
}

// ---- garage
let garageCat = 'body';
function equipItem(cat, id) {
  inventory.equipped[cat] = id;
  saveInventory();
  Sound.click();
  renderGarage();
}
export function renderGarage() {
  const grid = $('#garageGrid');
  grid.innerHTML = '';
  const card = (cls, html, onClick) => {
    const el = document.createElement('div');
    el.className = 'itemCard ' + cls;
    el.innerHTML = html;
    if (onClick) el.addEventListener('click', onClick);
    grid.appendChild(el);
    return el;
  };
  const noneId = garageCat === 'celebration' ? 'cel_classic' : null;
  if (garageCat !== 'celebration') {
    card('owned' + (!inventory.equipped[garageCat] ? ' selected' : ''), '<div class="itemSwatch" style="background:linear-gradient(135deg,#1f7cff,#ff6a1f)"></div><div class="itemName">' + (garageCat === 'body' ? 'Skyline GT-R' : 'Team Color') + '</div><div class="itemRarity" style="color:#9aa5b1">Base</div>', () => equipItem(garageCat, null));
  }
  for (const item of ITEMS.filter((i) => i.cat === garageCat)) {
    const owned = inventory.owned.includes(item.id) || item.id === noneId;
    const info = RARITY[item.rarity];
    const selected = inventory.equipped[garageCat] === item.id || (item.id === noneId && !inventory.equipped[garageCat]);
    const el = card((owned ? 'owned' : 'locked') + (selected ? ' selected' : ''),
      `<div class="itemSwatch${owned ? '' : ' locked'}" style="${owned ? swatchCss(item) : ''}">${owned ? '' : '?'}</div><div class="itemName">${item.name}</div><div class="itemRarity" style="color:${info.color}">${info.label}</div>`,
      owned ? () => equipItem(garageCat, item.id) : null);
    el.style.setProperty('--rc', info.color);
  }
}

// ---- drops
function resetDropUI() {
  $('#dropCrateWrap').classList.remove('hidden');
  $('#reelViewport').classList.add('hidden');
  $('#dropResult').classList.add('hidden');
  $('#reelStrip').innerHTML = '';
  $('#reelStrip').style.transform = 'translateX(0px)';
  $('#dropTitle').textContent = 'You earned a drop!';
  $('#dropCrateBtn').style.pointerEvents = 'all';
}
function startDropOpen() {
  $('#dropCrateBtn').style.pointerEvents = 'none';
  const won = rollItem();
  Sound.tone(220, 0.4, 'sawtooth', 0.14, 110);
  $('#dropCrateWrap').classList.add('hidden');
  $('#reelViewport').classList.remove('hidden');
  const REVEAL_INDEX = 40, STRIP_LEN = 46, CARD_W = 96;
  const strip = $('#reelStrip');
  strip.innerHTML = '';
  for (let i = 0; i < STRIP_LEN; i++) {
    const it = i === REVEAL_INDEX ? won : ITEMS[Math.floor(Math.random() * ITEMS.length)];
    const el = document.createElement('div');
    el.className = 'reelItem';
    el.style.setProperty('--rc', RARITY[it.rarity].color);
    el.innerHTML = `<div class="reelSwatch" style="${swatchCss(it)}"></div><div class="reelName">${it.name}</div>`;
    strip.appendChild(el);
  }
  const targetX = -(REVEAL_INDEX * CARD_W + CARD_W / 2 - $('#reelViewport').clientWidth / 2) + (Math.random() * 26 - 13);
  const start = performance.now();
  let lastTick = -1;
  const step = (now) => {
    const t = Math.min(1, (now - start) / 4600);
    const x = targetX * (1 - Math.pow(1 - t, 5));
    strip.style.transform = `translateX(${x}px)`;
    const idx = Math.round(Math.abs(x) / CARD_W);
    if (idx !== lastTick) { lastTick = idx; Sound.reelTick(); }
    if (t < 1) requestAnimationFrame(step); else onReelStop(won);
  };
  requestAnimationFrame(step);
}
function onReelStop(item) {
  const info = RARITY[item.rarity], tier = TIER_ORDER.indexOf(item.rarity);
  const isNew = !inventory.owned.includes(item.id);
  if (isNew) inventory.owned.push(item.id);
  saveInventory();
  $('#reelViewport').classList.add('hidden');
  const result = $('#dropResult');
  result.className = 'dropResult rarity-' + item.rarity;
  result.style.setProperty('--rc', info.color);
  $('#resultGlow').style.setProperty('--rc', info.color);
  $('#resultRarity').textContent = info.label.toUpperCase();
  $('#resultRarity').style.color = info.color;
  $('#resultName').textContent = item.name;
  $('#resultCat').textContent = CAT_LABEL[item.cat] + (isNew ? '' : ' • Duplicate');
  const flash = $('#dropFlash');
  flash.style.background = info.color;
  flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
  const stage = document.querySelector('.dropStage');
  for (let i = 0; i < 10 + tier * 12; i++) {
    const el = document.createElement('div');
    el.className = 'confettiBit';
    el.style.background = Math.random() < 0.5 ? info.color : '#ffcf4d';
    const ang = Math.random() * Math.PI * 2, dist = 80 + Math.random() * 170;
    el.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    el.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
    el.style.left = '50%'; el.style.top = '36%';
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }
  if (tier >= 4) { const gw = $('#gameWrap'); gw.classList.remove('shake'); void gw.offsetWidth; gw.classList.add('shake'); }
  Sound.dropReveal(tier);
}
export function openDrop() { hooks.show('#menuDrop'); resetDropUI(); }

// hooks: show(selector) switches screen, toMenu() returns to the main menu, lookChanged() is
// called when the equipped items change, loggedOut() when the player signs out.
export function initAccount(h) {
  hooks = { ...hooks, ...h };
  const loginError = (msg) => { const el = $('#loginError'); el.textContent = msg; el.classList.remove('hidden'); };
  const NOT_SET_UP = 'Supabase isn’t configured yet. Fill in supabase-config.js (see README).';

  $('#btnAccountAction').addEventListener('click', () => {
    Sound.click();
    if (!account.user) return hooks.show('#menuLogin');
    hooks.loggedOut();
    sb.auth.signOut();
    account.user = null; account.name = 'Guest';
    updateAccountChip();
  });
  $('#closeLogin').addEventListener('click', () => { Sound.click(); hooks.toMenu(); });
  $('#btnGuestPlay').addEventListener('click', () => { Sound.click(); hooks.toMenu(); });
  $('#btnLoginSubmit').addEventListener('click', async () => {
    $('#loginError').classList.add('hidden');
    if (!cloudReady) return loginError(NOT_SET_UP);
    const email = $('#loginEmail').value.trim(), pass = $('#loginPass').value;
    if (!email || !pass) return loginError('Enter an email and password.');
    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) return loginError(error.message);
    hooks.toMenu();
  });
  $('#btnSignupSubmit').addEventListener('click', async () => {
    $('#loginError').classList.add('hidden');
    if (!cloudReady) return loginError(NOT_SET_UP);
    const email = $('#loginEmail').value.trim(), pass = $('#loginPass').value;
    const name = ($('#loginName').value.trim() || email.split('@')[0] || 'Player').slice(0, 18);
    if (!email || !pass) return loginError('Enter an email and password.');
    if (pass.length < 6) return loginError('Password must be at least 6 characters.');
    const { data, error } = await sb.auth.signUp({ email, password: pass });
    if (error) return loginError(error.message);
    if (!data.session) return loginError('Account created! If it doesn’t sign you in automatically, disable "Confirm email" in Supabase (Authentication → Providers → Email). See README.');
    await sb.from('profiles').upsert({ id: data.user.id, name, created_at: new Date().toISOString() });
    account.name = name;   // the auth listener's profile read can land before this write
    updateAccountChip();
    hooks.toMenu();
  });
  if (cloudReady) {
    sb.auth.onAuthStateChange((event, session) => {
      const user = session ? session.user : null;
      account.user = user;
      if (user) {
        sb.from('profiles').select('*').eq('id', user.id).maybeSingle().then(({ data: prof }) => {
          account.name = prof?.name || (user.email ? user.email.split('@')[0] : 'Player');
          updateAccountChip();
        });
        loadCloudInventory(user.id, user.email);
      } else updateAccountChip();
    });
  }
  updateAccountChip();

  document.querySelectorAll('.garageTab').forEach((t) => t.addEventListener('click', () => {
    Sound.click();
    document.querySelectorAll('.garageTab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    garageCat = t.dataset.cat;
    renderGarage();
  }));
  $('#dropCrateBtn').addEventListener('click', startDropOpen);
}
