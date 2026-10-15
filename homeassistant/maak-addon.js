#!/usr/bin/env node
// Synchroniseert de app (repo-root) naar de add-onmap weekmenu/app/.
// Home Assistant bouwt de add-on enkel met wat in weekmenu/ staat, dus na elke codewijziging uitvoeren.
//   node homeassistant/maak-addon.js           kopiëren
//   node homeassistant/maak-addon.js --check   controleren of alles gelijk is (GitHub Action)
'use strict';

const fs = require('fs');
const path = require('path');

const bron = path.join(__dirname, '..');
const doel = path.join(bron, 'weekmenu', 'app');
const BESTANDEN = ['weekmenu.js', 'index.html', 'css/style.css', 'js/thema.js', 'js/boodschappen.js', 'js/app.js'];

if (process.argv.includes('--check')) {
  const verschil = BESTANDEN.filter(b => {
    const d = path.join(doel, b);
    return !fs.existsSync(d) || !fs.readFileSync(path.join(bron, b)).equals(fs.readFileSync(d));
  });
  if (verschil.length) {
    console.error(`weekmenu/app loopt niet gelijk met de root: ${verschil.join(', ')}`);
    console.error('Voer "node homeassistant/maak-addon.js" uit en verhoog de version in weekmenu/config.yaml.');
    process.exit(1);
  }
  console.log('weekmenu/app is gelijk met de root.');
  process.exit(0);
}

fs.rmSync(doel, { recursive: true, force: true });
for (const b of BESTANDEN) {
  fs.mkdirSync(path.dirname(path.join(doel, b)), { recursive: true });
  fs.copyFileSync(path.join(bron, b), path.join(doel, b));
}
console.log(`Add-on bijgewerkt in ${path.join(bron, 'weekmenu')}`);
console.log('Verhoog "version" in weekmenu/config.yaml (en vul CHANGELOG.md aan) zodat Home Assistant de update aanbiedt.');
