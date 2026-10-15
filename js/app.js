// Weekmenu-viewer: toont het menu, vervangen van recepten, nieuw menu en boodschappenlijst.
// Via file:// werkt alles lokaal (localStorage); via de server (node weekmenu.js --server of de
// Home Assistant-add-on) worden vervangingen en vinkjes centraal bewaard en kan een nieuw menu gestart worden.
(function () {
  'use strict';

  var DATA = window.WM_DATA || null;
  var SERVER = false;
  var DAGEN = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
  var KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
  var HERHAAL_WEKEN = 8;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- opslag (per browser) ----------
  function lees(sleutel, standaard) {
    try { var v = localStorage.getItem(sleutel); return v ? JSON.parse(v) : standaard; } catch (e) { return standaard; }
  }
  function bewaar(sleutel, waarde) {
    try { localStorage.setItem(sleutel, JSON.stringify(waarde)); } catch (e) { /* geen opslag */ }
  }
  var lokaalVervangen = lees('wm-vervangen', {});   // alleen file://  { week: [slug|null x7] }
  var lokaalVinkjes = lees('wm-vinkjes', {});       // alleen file://  { week: { sleutel: true } }
  var huidigeWeek = null;

  // ---------- server ----------
  function api(pad, body) {
    return fetch(pad, body === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.fout || ('HTTP ' + r.status));
        return j;
      });
    });
  }
  function herlaadData() {
    return api('api/data').then(function (d) { DATA = d; });
  }

  // ---------- hulpjes ----------
  function el(tag, attrs, kinderen) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'tekst') e.textContent = attrs[k];
      else if (k === 'klasse') e.className = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    });
    (kinderen || []).forEach(function (k) { if (k) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return e;
  }
  function datum(iso, plusDagen) {
    var d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + (plusDagen || 0));
    return d;
  }
  function datumTekst(d, opties) {
    return d.toLocaleDateString('nl-BE', Object.assign({ timeZone: 'UTC' }, opties));
  }
  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dag = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dag);
    var jaar = t.getUTCFullYear();
    var nr = Math.ceil(((t - Date.UTC(jaar, 0, 1)) / 86400000 + 1) / 7);
    return jaar + '-W' + (nr < 10 ? '0' : '') + nr;
  }
  function weekNr(week) { return parseInt(week.slice(6), 10); }
  function tijdTekst(min) {
    if (!min) return null;
    return min >= 60 ? Math.floor(min / 60) + ' u' + (min % 60 ? ' ' + (min % 60) + ' min' : '') : min + ' min';
  }
  var meldTimer = null;
  function meld(tekst, lang) {
    var m = $('melding');
    m.textContent = tekst;
    m.hidden = false;
    clearTimeout(meldTimer);
    meldTimer = setTimeout(function () { m.hidden = true; }, lang ? 6000 : 2500);
  }

  // ---------- menu van de week (origineel + vervangingen) ----------
  function vervangingen(week) {
    var w = DATA.weken[week] || {};
    var v = (w.vervangen || []).slice();
    if (!SERVER) (lokaalVervangen[week] || []).forEach(function (s, i) { if (s) v[i] = s; });
    return v;
  }
  function menu(week) {
    var v = vervangingen(week);
    return DATA.weken[week].recepten.map(function (slug, i) { return v[i] || slug; });
  }
  function vinkjes(week) {
    if (SERVER) return (DATA.weken[week] && DATA.weken[week].vinkjes) || {};
    return lokaalVinkjes[week] || {};
  }

  function vervangLokaal(i) {
    var w = huidigeWeek;
    var uitsluiten = {};
    DATA.weken[w].recepten.concat(menu(w)).forEach(function (s) { uitsluiten[s] = 1; });
    var ma = Date.parse(DATA.weken[w].maandag);
    Object.keys(DATA.weken).forEach(function (andere) {
      var verschil = (ma - Date.parse(DATA.weken[andere].maandag)) / (7 * 86400000);
      if (verschil > 0 && verschil <= HERHAAL_WEKEN) menu(andere).forEach(function (s) { uitsluiten[s] = 1; });
    });
    var kandidaten = Object.keys(DATA.recepten).filter(function (s) { return !uitsluiten[s]; });
    if (!kandidaten.length) {
      meld('Geen reserverecepten meer in de cache. Start de server of voer "node weekmenu.js --week ' + w + ' --opnieuw" uit.', true);
      return;
    }
    var nieuw = kandidaten[Math.floor(Math.random() * kandidaten.length)];
    lokaalVervangen[w] = lokaalVervangen[w] || [];
    lokaalVervangen[w][i] = nieuw;
    bewaar('wm-vervangen', lokaalVervangen);
    tekenAlles();
    meld(DAGEN[i] + ': ' + DATA.recepten[nieuw].naam);
  }
  function vervang(i, knop) {
    if (!SERVER) return vervangLokaal(i);
    knop.disabled = true;
    knop.textContent = 'Zoeken…';
    api('api/vervang', { week: huidigeWeek, dag: i })
      .then(function (r) { return herlaadData().then(function () { return r; }); })
      .then(function (r) { tekenAlles(); meld(DAGEN[i] + ': ' + DATA.recepten[r.slug].naam); })
      .catch(function (e) { meld('Vervangen mislukt: ' + e.message, true); knop.disabled = false; knop.textContent = 'Vervang'; });
  }
  function herstel(i) {
    if (!SERVER) {
      var v = lokaalVervangen[huidigeWeek];
      if (v) {
        v[i] = null;
        if (!v.some(Boolean)) delete lokaalVervangen[huidigeWeek];
        bewaar('wm-vervangen', lokaalVervangen);
      }
      return tekenAlles();
    }
    api('api/herstel', { week: huidigeWeek, dag: i }).then(herlaadData).then(tekenAlles)
      .catch(function (e) { meld('Herstellen mislukt: ' + e.message, true); });
  }

  // ---------- tekenen: menu ----------
  function tekenMenu() {
    var lijst = $('dagen');
    lijst.textContent = '';
    var w = DATA.weken[huidigeWeek];
    var isVervangen = vervangingen(huidigeWeek);
    menu(huidigeWeek).forEach(function (slug, i) {
      var r = DATA.recepten[slug];
      var d = datum(w.maandag, i);
      if (!r) {
        lijst.appendChild(el('li', { klasse: 'dag' }, [el('p', { tekst: 'Recept "' + slug + '" ontbreekt in de cache.' })]));
        return;
      }
      var meta = [tijdTekst(r.tijd), r.personen ? r.personen + ' pers.' : null, r.keuken || null,
        r.score && r.score.aantal ? '★ ' + String(r.score.waarde).replace('.', ',') + ' (' + r.score.aantal + ')' : null]
        .filter(Boolean);

      var stappenBlok = el('div', { klasse: 'stappen' });
      var huidigeLijst = null, vorigeSectie;
      r.stappen.forEach(function (s) {
        if (!huidigeLijst || s.sectie !== vorigeSectie) {
          if (s.sectie) stappenBlok.appendChild(el('h5', { tekst: s.sectie }));
          huidigeLijst = el('ol');
          stappenBlok.appendChild(huidigeLijst);
          vorigeSectie = s.sectie;
        }
        huidigeLijst.appendChild(el('li', null, [
          s.tekst,
          s.tip ? el('span', { klasse: 'tip', tekst: 'Tip: ' + s.tip }) : null
        ]));
      });

      var details = el('details', { klasse: 'recept' }, [
        el('summary', { tekst: 'Ingrediënten & bereiding' }),
        el('div', { klasse: 'recept-inhoud' }, [
          el('div', null, [
            el('h4', { tekst: 'Ingrediënten' + (r.personen ? ' (' + r.personen + ' personen)' : '') }),
            el('ul', { klasse: 'ingredienten' }, r.ingredienten.map(function (x) { return el('li', { tekst: x }); }))
          ]),
          el('div', null, [el('h4', { tekst: 'Bereiding' }), stappenBlok])
        ])
      ]);

      lijst.appendChild(el('li', { klasse: 'dag' + (isVervangen[i] ? ' vervangen' : '') }, [
        el('div', { klasse: 'dag-kop' }, [
          el('span', { klasse: 'dag-naam', tekst: DAGEN[i] }),
          el('span', { klasse: 'dag-datum', tekst: datumTekst(d, { day: 'numeric', month: 'short' }) }),
          isVervangen[i] ? el('span', { klasse: 'label', tekst: 'vervangen' }) : null
        ]),
        el('h3', null, [el('a', { href: r.url, target: '_blank', rel: 'noopener', tekst: r.naam, title: 'Open op dagelijksekost.vrt.be' })]),
        el('p', { klasse: 'meta', tekst: meta.join(' · ') }),
        r.beschrijving ? el('p', { klasse: 'beschrijving', tekst: r.beschrijving }) : null,
        details,
        el('div', { klasse: 'dag-acties' }, [
          el('button', { type: 'button', klasse: 'knop klein', tekst: 'Vervang', title: 'Kies een ander hoofdgerecht',
            onclick: function (ev) { vervang(i, ev.currentTarget); } }),
          isVervangen[i] ? el('button', { type: 'button', klasse: 'knop klein stil', tekst: 'Origineel terug', onclick: function () { herstel(i); } }) : null,
          el('a', { klasse: 'knop klein stil', href: r.url, target: '_blank', rel: 'noopener', tekst: 'Op de site ↗' })
        ])
      ]));
    });
  }

  // ---------- tekenen: boodschappen ----------
  var laatsteLijst = [];
  function zetVinkje(sleutel, aan) {
    if (SERVER) {
      var w = DATA.weken[huidigeWeek];
      w.vinkjes = w.vinkjes || {};
      if (aan) w.vinkjes[sleutel] = true; else delete w.vinkjes[sleutel];
      api('api/vinkje', { week: huidigeWeek, sleutel: sleutel, aan: aan })
        .catch(function (e) { meld('Vinkje niet bewaard: ' + e.message, true); });
      return;
    }
    lokaalVinkjes[huidigeWeek] = lokaalVinkjes[huidigeWeek] || {};
    if (aan) lokaalVinkjes[huidigeWeek][sleutel] = true; else delete lokaalVinkjes[huidigeWeek][sleutel];
    bewaar('wm-vinkjes', lokaalVinkjes);
  }
  function tekenBoodschappen() {
    var personen = Math.max(1, parseInt($('personen').value, 10) || 4);
    var recepten = menu(huidigeWeek).map(function (s, i) { return { dag: KORT[i], recept: DATA.recepten[s] }; })
      .filter(function (x) { return x.recept; });
    laatsteLijst = Boodschappen.maak(recepten, personen);
    var v = vinkjes(huidigeWeek);
    var kopen = $('lijstKopen'), voorraad = $('lijstVoorraad');
    kopen.textContent = '';
    voorraad.textContent = '';
    var aantal = 0;
    function telInfo() {
      $('lijstInfo').textContent = kopen.querySelectorAll('li.af').length + ' van ' + aantal + ' afgevinkt';
    }
    laatsteLijst.forEach(function (it) {
      var id = 'v-' + it.sleutel.replace(/[^a-z0-9]+/gi, '-');
      var cb = el('input', { type: 'checkbox', id: id });
      cb.checked = !!v[it.sleutel];
      var li = el('li', { klasse: cb.checked ? 'af' : '', title: it.regels.join('\n') }, [
        cb,
        el('label', { 'for': id }, [
          it.tekst ? el('span', { klasse: 'hoeveel', tekst: it.tekst }) : null,
          el('span', { klasse: 'naam', tekst: it.naam }),
          el('span', { klasse: 'wanneer', tekst: it.dagen.join(', ') })
        ])
      ]);
      cb.addEventListener('change', function () {
        zetVinkje(it.sleutel, cb.checked);
        li.classList.toggle('af', cb.checked);
        telInfo();
      });
      (it.voorraad ? voorraad : kopen).appendChild(li);
      if (!it.voorraad) aantal++;
    });
    telInfo();
  }

  function lijstAlsTekst() {
    var w = DATA.weken[huidigeWeek];
    var regels = ['Boodschappen ' + huidigeWeek + ' (' + $('personen').value + ' personen)', ''];
    var deel = function (titel, voorraad) {
      regels.push(titel);
      laatsteLijst.filter(function (it) { return it.voorraad === voorraad; }).forEach(function (it) {
        regels.push('- ' + (it.tekst ? it.tekst + ' ' : '') + it.naam);
      });
      regels.push('');
    };
    deel('Te kopen', false);
    deel('Voorraadkast & naar smaak', true);
    regels.push('Menu:');
    menu(huidigeWeek).forEach(function (s, i) {
      var r = DATA.recepten[s];
      if (r) regels.push(KORT[i] + ' ' + datumTekst(datum(w.maandag, i), { day: 'numeric', month: 'numeric' }) + '  ' + r.naam + '  ' + r.url);
    });
    return regels.join('\n');
  }

  // ---------- weken ----------
  function vulWeken(voorkeur) {
    var weken = Object.keys(DATA.weken).sort().reverse();
    var keuze = $('weekKeuze');
    keuze.textContent = '';
    weken.forEach(function (w) {
      keuze.appendChild(el('option', { value: w, tekst: 'Week ' + weekNr(w) + ' – ' + w.slice(0, 4) + ' (' + datumTekst(datum(DATA.weken[w].maandag), { day: 'numeric', month: 'short' }) + ')' }));
    });
    var nu = isoWeek(new Date());
    keuze.value = DATA.weken[voorkeur] ? voorkeur : (DATA.weken[nu] ? nu : weken[0]);
    return keuze.value;
  }
  function kiesWeek(week) {
    huidigeWeek = week;
    var w = DATA.weken[week];
    var van = datum(w.maandag, 0), tot = datum(w.maandag, 6);
    $('weekBereik').textContent = 'Week ' + weekNr(week) + ' · ' +
      datumTekst(van, { day: 'numeric', month: 'long' }) + ' – ' + datumTekst(tot, { day: 'numeric', month: 'long', year: 'numeric' });
    tekenAlles();
  }
  function tekenAlles() {
    tekenMenu();
    tekenBoodschappen();
    $('dataInfo').textContent = Object.keys(DATA.recepten).length + ' hoofdgerechten in cache · ' +
      (SERVER ? 'server' : 'lokaal bestand, start de server voor "Nieuw menu"');
  }

  // ---------- nieuw menu (alleen met server) ----------
  function openNieuwMenu() {
    var nu = isoWeek(new Date());
    var volgende = isoWeek(new Date(Date.now() + 7 * 86400000));
    var opties = [];
    if (!DATA.weken[volgende]) opties.push({ tekst: 'Menu voor volgende week (week ' + weekNr(volgende) + ')', body: { week: volgende } });
    if (!DATA.weken[nu]) opties.push({ tekst: 'Menu voor deze week (week ' + weekNr(nu) + ')', body: { week: nu } });
    if (huidigeWeek) opties.push({ tekst: 'Week ' + weekNr(huidigeWeek) + ' helemaal opnieuw kiezen', body: { week: huidigeWeek, opnieuw: true }, waarschuw: true });
    var keuzes = $('nieuwKeuzes');
    keuzes.textContent = '';
    $('nieuwStatus').textContent = '';
    opties.forEach(function (o) {
      keuzes.appendChild(el('button', { type: 'button', klasse: 'knop keuze' + (o.waarschuw ? '' : ' primair'), tekst: o.tekst,
        onclick: function () { startNieuw(o); } }));
    });
    $('nieuwDialoog').showModal();
  }
  function startNieuw(o) {
    if (o.waarschuw && !confirm('Het huidige menu (incl. vervangingen en vinkjes) van deze week wordt vervangen. Doorgaan?')) return;
    var knoppen = $('nieuwKeuzes').querySelectorAll('button');
    knoppen.forEach(function (b) { b.disabled = true; });
    $('nieuwStatus').textContent = 'Recepten ophalen… even geduld.';
    api('api/week', o.body)
      .then(function (r) { return herlaadData().then(function () { return r; }); })
      .then(function (r) {
        $('nieuwDialoog').close();
        kiesWeek(vulWeken(r.week));
        meld('Menu voor week ' + weekNr(r.week) + ' is klaar');
      })
      .catch(function (e) {
        $('nieuwStatus').textContent = 'Mislukt: ' + e.message;
        knoppen.forEach(function (b) { b.disabled = false; });
      });
  }

  // ---------- tabs & thema ----------
  function toonTab(naam) {
    document.querySelectorAll('.tab').forEach(function (t) {
      var actief = t.getAttribute('data-tab') === naam;
      t.classList.toggle('actief', actief);
      t.setAttribute('aria-selected', actief ? 'true' : 'false');
    });
    $('paneel-menu').hidden = naam !== 'menu';
    $('paneel-boodschappen').hidden = naam !== 'boodschappen';
    bewaar('wm-tab', naam);
  }
  function isDonker() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function themaKnop() {
    $('themaKnop').textContent = isDonker() ? '☀' : '☾';
    $('themaKnop').title = isDonker() ? 'Licht thema' : 'Donker thema';
  }

  // ---------- start ----------
  function toonLeeg(leeg) {
    $('leeg').hidden = !leeg;
    document.querySelector('.tabs').hidden = leeg;
    $('weekKeuze').disabled = leeg;
    if (leeg) { $('paneel-menu').hidden = true; $('paneel-boodschappen').hidden = true; }
  }
  function startMenu() {
    if (!DATA || !DATA.weken || !Object.keys(DATA.weken).length) {
      DATA = DATA || { weken: {}, recepten: {} };
      toonLeeg(true);
      return;
    }
    toonLeeg(false);
    kiesWeek(vulWeken(huidigeWeek));
    toonTab(lees('wm-tab', 'menu'));
  }

  function start() {
    themaKnop();
    $('themaKnop').addEventListener('click', function () {
      var naarDonker = !isDonker();
      document.documentElement.setAttribute('data-theme', naarDonker ? 'dark' : 'light');
      try { localStorage.setItem('wm-thema', naarDonker ? 'donker' : 'licht'); } catch (e) { /* geen opslag */ }
      themaKnop();
    });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { toonTab(t.getAttribute('data-tab')); });
    });
    $('afdrukken').addEventListener('click', function () { window.print(); });
    $('weekKeuze').addEventListener('change', function () { kiesWeek($('weekKeuze').value); });
    $('nieuwMenu').addEventListener('click', openNieuwMenu);
    $('personen').value = lees('wm-personen', 4);
    $('personen').addEventListener('input', function () {
      bewaar('wm-personen', parseInt($('personen').value, 10) || 4);
      if (huidigeWeek) tekenBoodschappen();
    });
    $('kopieer').addEventListener('click', function () {
      var tekst = lijstAlsTekst();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tekst).then(function () { meld('Boodschappenlijst gekopieerd'); },
          function () { meld('Kopiëren niet toegelaten door de browser'); });
      } else {
        meld('Kopiëren niet ondersteund in deze browser');
      }
    });
    $('wisVinkjes').addEventListener('click', function () {
      if (SERVER) {
        if (DATA.weken[huidigeWeek]) delete DATA.weken[huidigeWeek].vinkjes;
        api('api/vinkje', { week: huidigeWeek, sleutel: '*' }).catch(function (e) { meld('Mislukt: ' + e.message, true); });
      } else {
        delete lokaalVinkjes[huidigeWeek];
        bewaar('wm-vinkjes', lokaalVinkjes);
      }
      tekenBoodschappen();
    });

    if (/^https?:$/.test(location.protocol)) {
      api('api/status').then(function () {
        SERVER = true;
        $('nieuwMenu').hidden = false;
        $('leegServer').hidden = false;
        $('leegCli').hidden = true;
        return herlaadData();
      }).catch(function () { /* statisch gehost: zoals file:// */ }).then(startMenu);
    } else {
      startMenu();
    }
  }

  start();
})();
