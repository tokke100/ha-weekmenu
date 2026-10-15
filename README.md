# Weekmenu

Kiest elke week 7 willekeurige **hoofdgerechten** uit de [A-Z-index van Dagelijkse kost](https://dagelijksekost.vrt.be/az-index). Je krijgt per recept de ingrediënten en de volledige bereiding, en voor de hele week een boodschappenlijst. Het werkt als Home Assistant-add-on of gewoon op je pc.

> Persoonlijk hobbyproject, niet verbonden aan de VRT of Dagelijkse kost. De recepten blijven op hun site. Deze repo bevat geen receptdata; de app haalt per week enkel de gekozen recepten op, met een pauze tussen de verzoeken. Alleen voor persoonlijk gebruik.

## Home Assistant

[![Repository toevoegen aan Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Ftokke100%2Fha-weekmenu)

Vereist Home Assistant OS of Supervised (add-ons), 64-bit (aarch64/amd64).

1. **Instellingen → Add-ons → Add-on-winkel → ⋮ → Repositories** → `https://github.com/tokke100/ha-weekmenu` toevoegen (of de knop hierboven).
2. **Weekmenu** installeren → starten → *Weergeven in zijbalk*.
3. In de zijbalk: **Nieuw menu…**.
4. Automatisch elke week: zie [weekmenu/DOCS.md](weekmenu/DOCS.md) (`rest_command` + automatisering).

Updates verschijnen in Home Assistant zodra `version` in [weekmenu/config.yaml](weekmenu/config.yaml) verhoogd is.

> Waarom geen HACS? HACS verdeelt integraties, kaarten en thema's, geen add-ons. Deze app draait als Docker-container (Node.js), dus een add-on-repository is de juiste weg.

## Op de pc (Windows, Node.js 18+)

- Dubbelklik **`Weekmenu starten.cmd`**. Draait de server nog niet, dan start die, en daarna opent <http://127.0.0.1:8099> in je browser. Laat het consolevenster open, want sluiten stopt de server.
- Zonder server: `node weekmenu.js` maakt het menu en `index.html` toont het via dubbelklik. De knop **Nieuw menu** is er dan niet, en vervangingen en vinkjes blijven in die browser.

```powershell
node weekmenu.js              # menu voor de huidige week (een bestaand menu blijft behouden)
node weekmenu.js --volgende   # menu voor volgende week
node weekmenu.js --opnieuw    # het menu van deze week opnieuw kiezen
node weekmenu.js --server     # viewer + API op http://127.0.0.1:8099
node weekmenu.js --open       # server starten als hij nog niet draait + pagina openen
```

| Optie | Standaard | Betekenis |
|---|---|---|
| `--week 2026-W43` | huidige week | specifieke ISO-week |
| `--volgende` | | volgende week |
| `--opnieuw` | | bestaand menu voor die week opnieuw kiezen |
| `--weken N` | 8 | recepten uit de laatste N weken niet herhalen |
| `--reserve N` | 7 | extra hoofdgerechten ophalen voor "Vervang" |
| `--data` | | alleen `data/data.js` opnieuw schrijven |
| `--data-map <map>` | `data/` | andere map voor de data (of env `WEEKMENU_DATA`) |
| `--server`, `--poort`, `--host` | 8099, 127.0.0.1 | server starten |
| `--open` | | zie hierboven |

## Werking

1. De A-Z-index wordt opgehaald en 7 dagen bewaard in de cache (±3.770 recepten).
2. Het script kiest willekeurige recepten en slaat die uit de laatste N weken over, ook de vervangingen. De recepten worden één voor één opgehaald, met 0,8 s pauze ertussen.
3. Uit elke receptpagina worden twee bronnen gelezen:
   - de schema.org-`Recipe`-data: naam, categorie, tijd en ingrediënten;
   - de volledige bereiding uit de Next.js-payload (`recipeParts` → onderdelen, stappen en tips).

   De schema.org-data bevat vaak maar de eerste 2 stappen.
4. Alleen recepten met categorie **Hoofdgerecht** worden gehouden. De rest komt op een overslaanlijst, zodat die recepten niet opnieuw opgehaald worden.
5. Alles komt in `cache.json`. Recepten die met een oudere versie van het script zijn opgehaald (`RECEPT_VERSIE`), worden automatisch opnieuw opgehaald.

### API

| | Body | |
|---|---|---|
| `GET api/status` | | `{server, bezig, weken}` |
| `GET api/data` | | alle weken + recepten |
| `POST api/week` | `{"volgende":true}` of `{"week":"2026-W44","opnieuw":true}` | nieuw menu |
| `POST api/vervang` | `{"week","dag":0-6}` | dag vervangen (eerst uit cache, anders nieuw ophalen) |
| `POST api/herstel` | `{"week","dag"}` | origineel terug |
| `POST api/vinkje` | `{"week","sleutel","aan"}` (`sleutel:"*"` wist alles) | boodschappenlijst |

Er draait maar één actie tegelijk; een tweede verzoek krijgt `409`. Er is geen authenticatie: op de pc luistert de server alleen op `127.0.0.1`, en in Home Assistant alleen via Ingress en het interne netwerk.

## Ontwikkelen

De code staat in de root. Home Assistant bouwt de add-on enkel uit de map `weekmenu/`. Na een codewijziging doe je daarom het volgende:

1. `node homeassistant/maak-addon.js` kopieert de app naar `weekmenu/app/`.
2. Verhoog `version` in `weekmenu/config.yaml` en vul `weekmenu/CHANGELOG.md` aan.
3. Commit en push. De GitHub Action *Controle* faalt als `weekmenu/app/` niet gelijk loopt met de root.

```
repository.yaml              Home Assistant add-on-repository
weekmenu.js                  CLI + server: index ophalen, kiezen, recepten ophalen, API
index.html, css/, js/        viewer (werkt via file:// en via de server)
Weekmenu starten.cmd         Windows: server starten + pagina openen
homeassistant/
  maak-addon.js              app → weekmenu/app (en --check)
  automatisering.yaml        rest_command + automatisering
weekmenu/                    de add-on: config.yaml, Dockerfile, DOCS.md, CHANGELOG.md, app/
data/                        gegenereerd, niet in git
```

## Beperkingen

- Het samenvoegen van ingrediënten is heuristisch. Dezelfde naam met een andere eenheid ("200 g kikkererwten" en "1 blik kikkererwten") blijft op aparte regels, maar die staan wel naast elkaar.
- De categorie komt van de site, dus soms glipt er een vreemd "hoofdgerecht" tussen. Met **Vervang** los je dat op.
- De bereiding wordt gelezen uit de interne paginadata van de site. Verandert de opbouw van de site, dan valt het script terug op de (kortere) schema.org-stappen.
