# Weekmenu

Kiest elke week 7 hoofdgerechten uit de A-Z-index van [Dagelijkse kost](https://dagelijksekost.vrt.be/az-index), met ingrediënten, volledige bereiding en een boodschappenlijst. Enkel voor persoonlijk gebruik; niet verbonden aan de VRT.

## Gebruik

- Open **Weekmenu** in de zijbalk en kies **Nieuw menu…** om een menu voor deze of volgende week te maken (10–40 seconden).
- **Vervang** kiest voor één dag een ander hoofdgerecht; **Origineel terug** zet het oorspronkelijke recept terug.
- **Boodschappen**: alle ingrediënten van de week samengevoegd, herrekend voor het gekozen aantal personen, met vinkjes.
- Vervangingen en vinkjes worden in de add-on bewaard (`/data`, zit in de HA-back-ups) en zijn op elk toestel hetzelfde.
- Recepten uit de laatste 8 weken worden niet herhaald.

## Automatisch elke week

In `configuration.yaml`:

```yaml
rest_command:
  weekmenu_nieuw:
    url: "http://local-weekmenu:8099/api/week"
    method: POST
    content_type: "application/json"
    payload: '{"volgende": true}'
    timeout: 180
```

De hostname staat op de infopagina van de add-on. Bij installatie via een repository is dat `<repo-hash>-weekmenu`, bij een lokale add-on `local-weekmenu`.

Daarna een automatisering, bijvoorbeeld elke zaterdag om 10:00:

```yaml
alias: Weekmenu – menu voor volgende week
triggers:
  - trigger: time
    at: "10:00:00"
conditions:
  - condition: time
    weekday:
      - sat
actions:
  - action: rest_command.weekmenu_nieuw
mode: single
```

## API

| | Body |
|---|---|
| `POST api/week` | `{"volgende": true}` of `{"week": "2026-W44", "opnieuw": true}` |
| `POST api/vervang` | `{"week": "2026-W44", "dag": 0}` (0 = maandag) |
| `GET api/data` | alle weken en recepten |

De API heeft geen eigen authenticatie en is enkel bereikbaar binnen Home Assistant (Ingress en het interne netwerk); er wordt geen poort naar buiten opengezet.
