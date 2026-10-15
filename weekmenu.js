#!/usr/bin/env node
// Weekmenu – kiest elke week 7 hoofdgerechten uit de A-Z-index van Dagelijkse kost.
// CLI:    node weekmenu.js [--week 2026-W43 | --volgende] [--opnieuw] [--weken 8] [--reserve 7]
// Server: node weekmenu.js --server [--poort 8099] [--host 127.0.0.1]   (viewer + API, ook voor de HA-add-on)
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const BASIS = 'https://dagelijksekost.vrt.be';
const INDEX_GELDIG_DAGEN = 7;
const PAUZE_MS = 800;
const MAX_POGINGEN = 120;
const RECEPT_VERSIE = 3; // verhogen als het uitlezen van recepten verandert; oudere worden opnieuw opgehaald

let DATA_MAP = path.join(__dirname, 'data');
const cachePad = () => path.join(DATA_MAP, 'cache.json');
const dataJsPad = () => path.join(DATA_MAP, 'data.js');

function args() {
  const a = process.argv.slice(2);
  const opt = { week: null, volgende: false, opnieuw: false, weken: 8, reserve: 7, alleenData: false,
    server: false, poort: 8099, host: '127.0.0.1', dataMap: process.env.WEEKMENU_DATA || null };
  for (let i = 0; i < a.length; i++) {
    switch (a[i]) {
      case '--week': opt.week = a[++i]; break;
      case '--volgende': opt.volgende = true; break;
      case '--opnieuw': opt.opnieuw = true; break;
      case '--weken': opt.weken = parseInt(a[++i], 10); break;
      case '--reserve': opt.reserve = parseInt(a[++i], 10); break;
      case '--data': opt.alleenData = true; break;
      case '--server': opt.server = true; break;
      case '--poort': opt.poort = parseInt(a[++i], 10); break;
      case '--host': opt.host = a[++i]; break;
      case '--data-map': opt.dataMap = a[++i]; break;
      case '--open': opt.open = true; break;
      case '-h': case '--help':
        console.log([
          'node weekmenu.js               weekmenu voor de huidige week (bestaand menu blijft behouden)',
          '  --volgende                   menu voor volgende week',
          '  --week 2026-W43              menu voor een specifieke ISO-week',
          '  --opnieuw                    bestaand menu voor die week opnieuw kiezen',
          '  --weken 8                    recepten van de laatste N weken niet herhalen',
          '  --reserve 7                  extra hoofdgerechten ophalen voor "Vervang"',
          '  --data                       alleen data/data.js opnieuw schrijven',
          '  --data-map <map>             andere map voor cache.json/data.js (of env WEEKMENU_DATA)',
          '',
          'node weekmenu.js --server      viewer + API op http://127.0.0.1:8099',
          '  --poort 8099  --host 0.0.0.0',
          'node weekmenu.js --open        server starten als hij nog niet draait en de pagina openen'
        ].join('\n'));
        process.exit(0);
    }
  }
  if (opt.dataMap) DATA_MAP = path.resolve(opt.dataMap);
  return opt;
}

// ---------- ISO-week ----------
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dag);
  const jaar = t.getUTCFullYear();
  const nr = Math.ceil(((t - Date.UTC(jaar, 0, 1)) / 86400000 + 1) / 7);
  return `${jaar}-W${String(nr).padStart(2, '0')}`;
}
function maandagVan(week) {
  const m = /^(\d{4})-W(\d{2})$/.exec(week || '');
  if (!m) throw new Error(`Ongeldige week "${week}" (verwacht bv. 2026-W43)`);
  const jan4 = new Date(Date.UTC(+m[1], 0, 4));
  const ma = new Date(jan4);
  ma.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (+m[2] - 1) * 7);
  return ma.toISOString().slice(0, 10);
}
function weekIndex(week) {
  return Date.parse(maandagVan(week)) / (7 * 86400000);
}
function doelWeek(o) {
  if (o.week) { maandagVan(o.week); return o.week; }
  const nu = new Date();
  return isoWeek(o.volgende ? new Date(nu.getTime() + 7 * 86400000) : nu);
}

// ---------- cache ----------
function leesCache() {
  const c = fs.existsSync(cachePad()) ? JSON.parse(fs.readFileSync(cachePad(), 'utf8')) : {};
  c.index = c.index || { opgehaald: null, slugs: [] };
  c.recepten = c.recepten || {};
  c.overslaan = c.overslaan || {};
  c.weken = c.weken || {};
  return c;
}
function schrijfCache(c) {
  fs.mkdirSync(DATA_MAP, { recursive: true });
  const tmp = cachePad() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 1), 'utf8');
  fs.renameSync(tmp, cachePad());
}
function viewerData(c) {
  return { gegenereerd: new Date().toISOString(), aantalIndex: c.index.slugs.length, weken: c.weken, recepten: c.recepten };
}
function dataJs(c) {
  // < escapen zodat geen enkele tekst de script-context kan verlaten
  return `window.WM_DATA = ${JSON.stringify(viewerData(c)).replace(/</g, '\\u003c')};\n`;
}
function schrijfDataJs(c) {
  fs.mkdirSync(DATA_MAP, { recursive: true });
  fs.writeFileSync(dataJsPad(), dataJs(c), 'utf8');
}
function bewaar(c) {
  schrijfCache(c);
  schrijfDataJs(c);
}

// ---------- ophalen ----------
const slaap = ms => new Promise(r => setTimeout(r, ms));
async function haal(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Weekmenu (persoonlijk gebruik)', 'Accept-Language': 'nl' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} – ${url}`);
  return res.text();
}

async function haalIndex(c, log) {
  const oud = c.index.opgehaald ? (Date.now() - Date.parse(c.index.opgehaald)) / 86400000 : Infinity;
  if (oud < INDEX_GELDIG_DAGEN && c.index.slugs.length) return;
  const html = await haal(`${BASIS}/az-index`);
  const set = new Set();
  for (const m of html.matchAll(/href="\/gerechten\/([a-z0-9_-]+)"/g)) {
    if (m[1] !== 'zoeken') set.add(m[1]);
  }
  if (!set.size) throw new Error('Geen recepten gevonden in de A-Z-index (structuur van de site gewijzigd?)');
  c.index = { opgehaald: new Date().toISOString(), slugs: [...set].sort() };
  log(`A-Z-index: ${set.size} recepten.`);
}

function tekst(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}
function minuten(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso || '');
  return m ? (+(m[1] || 0)) * 60 + (+(m[2] || 0)) : null;
}
function lijst(x) {
  return x == null ? [] : (Array.isArray(x) ? x : [x]);
}
function ldStappen(instr) {
  const uit = [];
  const loop = (x, sectie) => {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(y => loop(y, sectie));
    if (typeof x === 'string') return void uit.push({ sectie, tekst: tekst(x), tip: null });
    if (x['@type'] === 'HowToSection') return loop(x.itemListElement, tekst(x.name));
    if (x.text) uit.push({ sectie, tekst: tekst(x.text), tip: null });
  };
  loop(instr, null);
  return uit.filter(s => s.tekst);
}

// De schema.org-data bevat vaak maar de eerste stappen; de volledige bereiding zit in de
// Next.js-payload (self.__next_f) als "recipeParts":[{title, instructions:[{step, description, tip}]}].
function jsonVanaf(t, start) {
  let diepte = 0, inString = false;
  for (let j = start; j < t.length; j++) {
    const ch = t[j];
    if (inString) {
      if (ch === '\\') j++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[' || ch === '{') diepte++;
    else if ((ch === ']' || ch === '}') && --diepte === 0) return JSON.parse(t.slice(start, j + 1));
  }
  return null;
}
function payloadStappen(html) {
  let payload = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { payload += JSON.parse(m[1]); } catch (_) { /* fragment overslaan */ }
  }
  const arrayNa = sleutel => {
    const i = payload.indexOf(sleutel);
    if (i < 0) return null;
    try { const a = jsonVanaf(payload, payload.indexOf('[', i)); return Array.isArray(a) ? a : null; } catch (_) { return null; }
  };
  // Recepten met onderdelen: "recipeParts"; zonder onderdelen: rechtstreeks "instructions":[{step, description}]
  let delen = arrayNa('"recipeParts":[') || [];
  delen = delen.filter(d => d && !d.placeholderPart && (d.instructions || []).length);
  if (!delen.length) {
    const instr = arrayNa('"instructions":[{');
    if (instr && instr.some(s => s && s.description)) delen = [{ title: null, instructions: instr }];
  }
  const uit = [];
  for (const d of delen) {
    const sectie = delen.length > 1 || d.title ? tekst(d.title) || null : null;
    for (const s of d.instructions) {
      if (!s) continue;
      const t = tekst(s.description);
      if (t) uit.push({ sectie, tekst: t, tip: tekst(s.tip) || null });
    }
  }
  return uit.length ? uit : null;
}

async function haalRecept(slug) {
  const url = `${BASIS}/gerechten/${slug}`;
  const html = await haal(url);
  let r = null;
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      const kand = [j, ...lijst(j['@graph'])].find(x => x && lijst(x['@type']).includes('Recipe'));
      if (kand) { r = kand; break; }
    } catch (_) { /* ongeldig blok overslaan */ }
  }
  if (!r) return null;
  const ld = ldStappen(r.recipeInstructions);
  const volledig = payloadStappen(html);
  return {
    slug, url,
    naam: tekst(r.name),
    beschrijving: tekst(r.description),
    categorie: lijst(r.recipeCategory).map(tekst),
    trefwoorden: lijst(r.keywords).flatMap(k => String(k).split(',')).map(tekst).filter(Boolean),
    keuken: lijst(r.recipeCuisine).map(tekst).join(', '),
    tijd: minuten(r.totalTime) || minuten(r.cookTime),
    personen: tekst(lijst(r.recipeYield)[0]),
    score: r.aggregateRating ? { waarde: r.aggregateRating.ratingValue, aantal: r.aggregateRating.ratingCount } : null,
    ingredienten: lijst(r.recipeIngredient).map(tekst).filter(Boolean),
    stappen: volledig && volledig.length >= ld.length ? volledig : ld,
    versie: RECEPT_VERSIE,
    opgehaald: new Date().toISOString()
  };
}
const isHoofdgerecht = r => [...r.categorie, ...r.trefwoorden].some(c => c.toLowerCase() === 'hoofdgerecht');

function schud(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- logica ----------
function menuVan(w) {
  return w.recepten.map((s, i) => (w.vervangen && w.vervangen[i]) || s);
}
// recepten uit de laatste N weken vóór `week` (incl. vervangingen)
function recenteRecepten(c, week, weken) {
  const wi = weekIndex(week);
  const set = new Set();
  for (const [w, data] of Object.entries(c.weken)) {
    const d = wi - weekIndex(w);
    if (w !== week && d >= 0 && d <= weken) menuVan(data).forEach(s => set.add(s));
  }
  return set;
}

// Recepten die nog niet de huidige versie hebben opnieuw ophalen (bv. na een verbetering van het uitlezen).
async function verversOud(c, slugs, log) {
  for (const slug of slugs) {
    const r = c.recepten[slug];
    if (!r || r.versie === RECEPT_VERSIE) continue;
    try {
      const nieuw = await haalRecept(slug);
      if (nieuw) { c.recepten[slug] = nieuw; log(`  ~ ${nieuw.naam} (bijgewerkt)`); }
    } catch (e) { log(`  ! ${e.message}`); }
    await slaap(PAUZE_MS);
  }
}

// Kiest willekeurig `aantal` hoofdgerechten uit de index die niet in `uitsluiten` zitten;
// recepten die al in de cache zitten worden niet opnieuw opgehaald.
async function zoekRecepten(c, aantal, uitsluiten, log) {
  await haalIndex(c, log);
  const gekozen = [];
  const kandidaten = schud(c.index.slugs.filter(s => !uitsluiten.has(s) && !c.overslaan[s]));
  let pogingen = 0;
  for (const slug of kandidaten) {
    if (gekozen.length >= aantal || pogingen >= MAX_POGINGEN) break;
    let r = c.recepten[slug];
    if (!r) {
      pogingen++;
      try {
        r = await haalRecept(slug);
      } catch (e) {
        log(`  ! ${e.message}`);
        await slaap(PAUZE_MS);
        continue;
      }
      await slaap(PAUZE_MS);
      if (!r || !isHoofdgerecht(r) || !r.ingredienten.length) {
        c.overslaan[slug] = r ? (r.categorie[0] || 'geen categorie') : 'geen receptdata';
        continue;
      }
      c.recepten[slug] = r;
      log(`  + ${r.naam}`);
    }
    gekozen.push(slug);
  }
  return gekozen;
}

async function maakWeek(c, o, log) {
  const week = doelWeek(o);
  if (c.weken[week] && !o.opnieuw) return { week, nieuw: false };
  const uitsluiten = recenteRecepten(c, week, o.weken);
  const gekozen = await zoekRecepten(c, 7 + Math.max(0, o.reserve), uitsluiten, log);
  if (gekozen.length < 7) throw new Error(`Slechts ${gekozen.length} hoofdgerechten gevonden – probeer opnieuw.`);
  c.weken[week] = { maandag: maandagVan(week), gemaakt: new Date().toISOString(), recepten: gekozen.slice(0, 7) };
  await verversOud(c, c.weken[week].recepten, log);
  bewaar(c);
  return { week, nieuw: true };
}

// Eén dag vervangen: eerst uit de cache, anders een nieuw recept ophalen.
async function vervangDag(c, week, dag, o, log) {
  const w = c.weken[week];
  if (!w) throw new Error(`Week ${week} bestaat niet`);
  if (!(dag >= 0 && dag < 7)) throw new Error('Ongeldige dag');
  const uitsluiten = recenteRecepten(c, week, o.weken);
  w.recepten.forEach(s => uitsluiten.add(s));
  menuVan(w).forEach(s => uitsluiten.add(s));
  let kandidaten = Object.keys(c.recepten).filter(s => !uitsluiten.has(s));
  let slug = kandidaten[Math.floor(Math.random() * kandidaten.length)];
  if (!slug) slug = (await zoekRecepten(c, 1, uitsluiten, log))[0];
  if (!slug) throw new Error('Geen ander hoofdgerecht gevonden');
  await verversOud(c, [slug], log);
  w.vervangen = w.vervangen || [null, null, null, null, null, null, null];
  w.vervangen[dag] = slug;
  bewaar(c);
  return slug;
}
function herstelDag(c, week, dag) {
  const w = c.weken[week];
  if (!w || !w.vervangen) return;
  w.vervangen[dag] = null;
  if (!w.vervangen.some(Boolean)) delete w.vervangen;
  bewaar(c);
}
function zetVinkje(c, week, sleutel, aan) {
  const w = c.weken[week];
  if (!w) throw new Error(`Week ${week} bestaat niet`);
  w.vinkjes = w.vinkjes || {};
  if (sleutel === '*') w.vinkjes = {};
  else if (aan) w.vinkjes[sleutel] = true;
  else delete w.vinkjes[sleutel];
  if (!Object.keys(w.vinkjes).length) delete w.vinkjes;
  bewaar(c);
}

// ---------- server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const STATISCH = new Set(['index.html', 'css/style.css', 'js/thema.js', 'js/boodschappen.js', 'js/app.js']);

function server(o) {
  let c = leesCache();
  let bezig = null; // lopende actie (één tegelijk: de cache is één bestand)
  const log = m => console.log(`[${new Date().toISOString()}] ${m}`);

  const stuur = (res, code, body, type) => {
    res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const leesBody = req => new Promise((ok, nok) => {
    let b = '';
    req.on('data', d => { b += d; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { nok(new Error('Ongeldige JSON')); } });
    req.on('error', nok);
  });
  const metSlot = async (naam, fn) => {
    if (bezig) { const e = new Error(`Even geduld: ${bezig} is nog bezig`); e.code = 409; throw e; }
    bezig = naam;
    try { return await fn(); } finally { bezig = null; }
  };

  const srv = http.createServer(async (req, res) => {
    try {
      // Home Assistant Ingress stuurt het pad al zonder prefix door; de viewer gebruikt enkel relatieve URL's.
      const p = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '');

      if (req.method === 'GET' && p === 'api/status') return stuur(res, 200, { server: true, bezig, weken: Object.keys(c.weken).length });
      if (req.method === 'GET' && p === 'api/data') return stuur(res, 200, viewerData(c));
      if (req.method === 'GET' && p === 'data/data.js') return stuur(res, 200, dataJs(c), MIME['.js']);

      if (req.method === 'POST' && p.startsWith('api/')) {
        const b = await leesBody(req);
        const opties = { week: b.week || null, volgende: !!b.volgende, opnieuw: !!b.opnieuw,
          weken: Number.isInteger(b.weken) ? b.weken : o.weken, reserve: Number.isInteger(b.reserve) ? b.reserve : o.reserve };
        if (p === 'api/week') {
          const r = await metSlot('nieuw menu', async () => {
            log(`Nieuw menu (${JSON.stringify(b)})`);
            c = leesCache();
            const uit = await maakWeek(c, opties, log);
            log(uit.nieuw ? `Menu ${uit.week} klaar` : `Menu ${uit.week} bestond al`);
            return uit;
          });
          return stuur(res, 200, r);
        }
        if (p === 'api/vervang') {
          const slug = await metSlot('vervangen', () => vervangDag(c, b.week, +b.dag, opties, log));
          return stuur(res, 200, { slug });
        }
        if (p === 'api/herstel') {
          await metSlot('herstellen', async () => herstelDag(c, b.week, +b.dag));
          return stuur(res, 200, { ok: true });
        }
        if (p === 'api/vinkje') {
          await metSlot('vinkje', async () => zetVinkje(c, b.week, String(b.sleutel || ''), !!b.aan));
          return stuur(res, 200, { ok: true });
        }
        return stuur(res, 404, { fout: 'Onbekende API' });
      }

      if (req.method === 'GET') {
        const bestand = p === '' || p.endsWith('/') ? 'index.html' : p;
        if (!STATISCH.has(bestand)) return stuur(res, 404, 'Niet gevonden', 'text/plain; charset=utf-8');
        return stuur(res, 200, fs.readFileSync(path.join(__dirname, bestand)), MIME[path.extname(bestand)]);
      }
      stuur(res, 405, { fout: 'Methode niet toegelaten' });
    } catch (e) {
      log(`Fout: ${e.message}`);
      stuur(res, e.code === 409 ? 409 : 500, { fout: e.message });
    }
  });
  srv.listen(o.poort, o.host, () => {
    console.log(`Weekmenu-server op ${serverUrl(o)}  (data: ${DATA_MAP})`);
    console.log('Dit venster open laten; sluiten stopt de server.');
    if (o.open) openBrowser(serverUrl(o));
  });
}

const serverUrl = o => `http://${o.host === '0.0.0.0' ? '127.0.0.1' : o.host}:${o.poort}/`;
function openBrowser(url) {
  const { spawn } = require('child_process');
  const [cmd, argv] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, argv, { detached: true, stdio: 'ignore' }).unref();
}
// --open: draait de server al, dan enkel de pagina openen; anders de server starten en daarna openen.
async function openOfStart(o) {
  try {
    const r = await fetch(serverUrl(o) + 'api/status', { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      console.log(`Server draait al op ${serverUrl(o)}`);
      openBrowser(serverUrl(o));
      return;
    }
  } catch (_) { /* draait nog niet */ }
  server(o);
}

// ---------- hoofdprogramma ----------
async function main() {
  const o = args();
  if (o.open) return openOfStart(o);
  if (o.server) return server(o);

  const c = leesCache();
  if (o.alleenData) { schrijfDataJs(c); console.log(`Geschreven: ${dataJsPad()}`); return; }

  const { week, nieuw } = await maakWeek(c, o, m => console.log(m));
  if (!nieuw) {
    console.log(`Week ${week} bestaat al (gebruik --opnieuw om opnieuw te kiezen).`);
    await verversOud(c, Object.keys(c.recepten), m => console.log(m));
    bewaar(c);
    return;
  }
  const dagen = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
  console.log(`\nWeekmenu ${week} (vanaf ${c.weken[week].maandag}):`);
  c.weken[week].recepten.forEach((s, i) => {
    const r = c.recepten[s];
    console.log(`  ${dagen[i]}  ${r.naam}${r.tijd ? ` (${r.tijd} min)` : ''}`);
  });
  console.log(`\nIn cache: ${Object.keys(c.recepten).length} hoofdgerechten. Open index.html of start de server (--server).`);
}

main().catch(e => { console.error(`Fout: ${e.message}`); process.exit(1); });
