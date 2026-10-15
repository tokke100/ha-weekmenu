// Boodschappenlijst: ingrediëntregels ontleden en samenvoegen over de recepten van de week.
var Boodschappen = (function () {
  'use strict';

  // eenheid -> [genormaliseerde eenheid, factor]
  var EENHEDEN = {
    'g': ['g', 1], 'gr': ['g', 1], 'gram': ['g', 1], 'kg': ['g', 1000], 'kilogram': ['g', 1000],
    'ml': ['ml', 1], 'milliliter': ['ml', 1], 'cl': ['ml', 10], 'centiliter': ['ml', 10],
    'dl': ['ml', 100], 'deciliter': ['ml', 100], 'l': ['ml', 1000], 'liter': ['ml', 1000],
    'eetlepel': ['eetlepel', 1], 'eetlepels': ['eetlepel', 1], 'el': ['eetlepel', 1],
    'theelepel': ['theelepel', 1], 'theelepels': ['theelepel', 1], 'koffielepel': ['theelepel', 1], 'koffielepels': ['theelepel', 1], 'tl': ['theelepel', 1],
    'teentje': ['teentje', 1], 'teentjes': ['teentje', 1],
    'bosje': ['bosje', 1], 'bosjes': ['bosje', 1],
    'blik': ['blik', 1], 'blikken': ['blik', 1], 'blikje': ['blik', 1], 'blikjes': ['blik', 1],
    'bakje': ['bakje', 1], 'bakjes': ['bakje', 1], 'potje': ['potje', 1], 'potjes': ['potje', 1],
    'pot': ['potje', 1], 'zakje': ['zakje', 1], 'zakjes': ['zakje', 1], 'pak': ['pak', 1], 'pakje': ['pak', 1],
    'fles': ['fles', 1], 'flessen': ['fles', 1], 'flesje': ['fles', 1], 'flesjes': ['fles', 1],
    'stengel': ['stengel', 1], 'stengels': ['stengel', 1], 'sneetje': ['sneetje', 1], 'sneetjes': ['sneetje', 1],
    'plakje': ['plakje', 1], 'plakjes': ['plakje', 1], 'stuk': ['stuk', 1], 'stuks': ['stuk', 1],
    'takje': ['takje', 1], 'takjes': ['takje', 1], 'blaadje': ['blaadje', 1], 'blaadjes': ['blaadje', 1],
    'snuifje': ['snuifje', 1], 'snuif': ['snuifje', 1], 'scheutje': ['scheutje', 1], 'scheut': ['scheutje', 1],
    'klontje': ['klontje', 1], 'klont': ['klontje', 1], 'eierdopje': ['eierdopje', 1], 'dopje': ['dopje', 1]
  };
  var MEERVOUD = { teentje: 'teentjes', bosje: 'bosjes', blik: 'blikken', bakje: 'bakjes', potje: 'potjes', zakje: 'zakjes',
    pak: 'pakken', fles: 'flessen', stengel: 'stengels', sneetje: 'sneetjes', plakje: 'plakjes', stuk: 'stuks',
    takje: 'takjes', blaadje: 'blaadjes', snuifje: 'snuifjes', scheutje: 'scheutjes', klontje: 'klontjes',
    eierdopje: 'eierdopjes', dopje: 'dopjes' };
  // eenheden die eerder "naar smaak" zijn dan iets om te kopen
  var KLEIN = { snuifje: 1, scheutje: 1, klontje: 1, eierdopje: 1, dopje: 1, blaadje: 1, theelepel: 1 };
  var VOORRAAD = ['zout', 'keukenzout', 'grof zout', 'zeezout', 'peper', 'zwarte peper', 'peper van de molen', 'water',
    'olijfolie', 'arachideolie', 'zonnebloemolie', 'boter', 'bloem', 'suiker', 'kristalsuiker', 'azijn', 'nootmuskaat',
    'mosterd', 'ketchup', 'mayonaise', 'laurier', 'laurierblaadjes', 'kruidnagel', 'currypoeder', 'kurkuma', 'komijn',
    'paprikapoeder', 'gerookt paprikapoeder', 'cayennepeper', 'oregano', 'gedroogde oregano', 'gedroogde tijm',
    'provençaalse kruiden', 'kippenkruiden', 'knoflookpoeder', 'chiliflakes', 'garam masala', 'kaneel', 'sojasaus',
    'vissaus', 'citroensap', 'lookolie', 'zwarte peperbol', 'peperbol', 'raz-el-hannout', 'ras-el-hanout', 'witte peper'];
  var SYNONIEM = { 'look': 'knoflook', 'ajuin': 'ui', 'ajuinen': 'ui', 'uien': 'ui', 'eigeel': 'eierdooier', 'eigelen': 'eierdooier', 'eierdooiers': 'eierdooier' };

  function getal(s) {
    s = s.replace(',', '.');
    if (s === '½') return 0.5;
    if (s === '¼') return 0.25;
    if (s === '¾') return 0.75;
    var b = /^(\d+)\/(\d+)$/.exec(s);
    if (b) return +b[1] / +b[2];
    return parseFloat(s);
  }

  function sleutelVan(naam) {
    var k = naam.toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\b(vers|verse|grote|grote|kleine|dikke|flinke|enkele|een)\b/g, ' ')
      .replace(/[’']/g, "'")
      .replace(/\s+/g, ' ').trim();
    if (SYNONIEM[k]) return SYNONIEM[k];
    // eenvoudige enkelvoudsvorm: wortelen→wortel, sjalotten→sjalot, paprika's→paprika
    k = k.replace(/'s$/, '');
    if (k.length > 5 && /en$/.test(k)) {
      k = k.slice(0, -2);
      if (/([bdfgklmnprst])\1$/.test(k)) k = k.slice(0, -1);
    }
    return SYNONIEM[k] || k;
  }

  // "1 kg aardappelen (loskokend)" -> {hoeveelheid: 1000, eenheid: 'g', naam: 'aardappelen (loskokend)'}
  function ontleed(regel) {
    var r = regel.trim();
    var m = /^(\d+(?:[.,]\d+)?|\d+\/\d+|[½¼¾])\s+(.*)$/.exec(r);
    var hoeveelheid = null, eenheid = '', rest = r;
    if (m) {
      hoeveelheid = getal(m[1]);
      rest = m[2];
      // "1 een flinke scheut…", "1 enkele blaadjes…": hoeveelheid is betekenisloos
      if (/^(een|enkele)\b/i.test(rest)) { hoeveelheid = null; }
    }
    rest = rest.replace(/^(een|enkele)\s+(flinke\s+)?/i, '').replace(/^flinke\s+/i, '');
    var w = /^(\S+)\s+(.*)$/.exec(rest);
    if (w && EENHEDEN[w[1].toLowerCase()]) {
      var e = EENHEDEN[w[1].toLowerCase()];
      eenheid = e[0];
      if (hoeveelheid != null) hoeveelheid *= e[1];
      rest = w[2].replace(/^(enkele\s+\S+\s+)/i, '');
    }
    return { hoeveelheid: hoeveelheid, eenheid: eenheid, naam: rest.trim(), origineel: regel };
  }

  function rond(x) {
    if (x >= 10) return Math.round(x);
    return Math.round(x * 4) / 4;
  }
  function getalTekst(x) {
    var r = rond(x);
    var heel = Math.floor(r), frac = r - heel;
    var f = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : '';
    if (frac && !f) return String(r).replace('.', ',');
    return (heel ? String(heel) : (f ? '' : '0')) + f;
  }
  function hoeveelheidTekst(q, eenheid) {
    if (q == null) return '';
    if (eenheid === 'g') return q >= 1000 ? getalTekst(q / 1000) + ' kg' : getalTekst(q) + ' g';
    if (eenheid === 'ml') return q >= 1000 ? getalTekst(q / 1000) + ' l' : (q >= 100 ? getalTekst(q / 100) + ' dl' : getalTekst(q) + ' ml');
    if (!eenheid) return getalTekst(q);
    return getalTekst(q) + ' ' + (rond(q) > 1 && MEERVOUD[eenheid] ? MEERVOUD[eenheid] : eenheid);
  }

  // recepten: [{dag, recept}] ; factor: personen / receptpersonen
  function maak(recepten, personen) {
    var items = {};
    recepten.forEach(function (x) {
      var basis = parseFloat(x.recept.personen) || 4;
      var factor = personen / basis;
      x.recept.ingredienten.forEach(function (regel) {
        var p = ontleed(regel);
        var sleutel = sleutelVan(p.naam) + '|' + p.eenheid;
        var it = items[sleutel];
        if (!it) {
          it = items[sleutel] = { sleutel: sleutel, naam: p.naam, eenheid: p.eenheid, hoeveelheid: null, zonder: false, dagen: [], regels: [] };
        }
        if (p.hoeveelheid != null) it.hoeveelheid = (it.hoeveelheid || 0) + p.hoeveelheid * factor;
        else it.zonder = true;
        if (it.dagen.indexOf(x.dag) < 0) it.dagen.push(x.dag);
        it.regels.push(x.dag + ': ' + regel);
      });
    });
    var lijst = Object.keys(items).map(function (k) {
      var it = items[k];
      var basisNaam = sleutelVan(it.naam);
      it.voorraad = KLEIN[it.eenheid] === 1 ||
        VOORRAAD.indexOf(basisNaam) >= 0 || VOORRAAD.indexOf(it.naam.toLowerCase()) >= 0;
      it.tekst = hoeveelheidTekst(it.hoeveelheid, it.eenheid);
      return it;
    });
    lijst.sort(function (a, b) { return a.naam.localeCompare(b.naam, 'nl', { sensitivity: 'base' }); });
    return lijst;
  }

  return { maak: maak, ontleed: ontleed };
})();
