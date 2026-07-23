# SaiPa lipputilanne

Julkinen, epävirallinen seurantasivu SaiPan Kisapuiston kotiottelujen ja
kausikorttien lipunmyynnille. Ei backendia eikä tietokantaa: GitHub Actions
-työnkulku hakee tiedot säännöllisesti [elippu.net/saipa](https://elippu.net/saipa)
-kaupasta, tallentaa ne JSON-tiedostoina tähän repoon, ja staattinen
frontend (GitHub Pages) lukee nämä tiedostot.

Tämä repo on tällä hetkellä vaiheessa **1–2**: scraperi + parseri
yksikkötesteineen, sekä sen ajaminen oikeaa kauppaa vasten. Frontend ja
GitHub Actions -workflow tulevat myöhemmin.

## Datalähde

Data haetaan elippu.net:n julkisilta kauppasivuilta — ei yksityistä rajapintaa.
Jokaisen tapahtuman myyntitiedot ovat upotettuna sivun HTML:ään
(`kit.start(...)`-kutsun sisällä), ja parseri (`scripts/lib/eventParser.js`)
purkaa ne. Katsomon paikkamäärät luetaan tapahtuman omasta `seatmap.svg`-kartasta
ja välimuistitetaan sisällön tiivisteen (SHA-1) mukaan `data/capacities/`-kansioon.

## Ajaminen paikallisesti

Vaatii Node.js version 20 tai uudemman. Ei ulkoisia riippuvuuksia.

```bash
npm test          # aja yksikkötestit (node:test)
npm run fetch     # hae tuoreet tiedot elippu.net:stä ja päivitä data/-kansio
```

`npm run fetch` (`node scripts/fetch.js`) ei koskaan tee git-committeja itse —
se vain lukee/kirjoittaa `data/`-kansion tiedostot ja palauttaa exit-koodin
0 (onnistui) tai 1 (jokin tapahtuma epäonnistui parsittaessa). Committaus
tapahtuu myöhemmin lisättävässä GitHub Actions -workflow'ssa. Ajon jälkeen
voit itse tarkistaa `data/`-kansion sisällön ja tehdä committin, kun olet
tyytyväinen tuloksiin.

## Data-kansion rakenne

```
data/
  capacities/{svg-hash}.json     # paikkamäärät per katsomonumero, versioitu SVG:n tiivisteellä
  events.json                    # indeksi kaikista nähdyistä tapahtumista + tila (upcoming/past)
  events/{id}/latest.json        # tuorein tilannekuva per tapahtuma
  events/{id}/history.json       # myynnin aikasarja per tapahtuma
```

`data/overrides.json` (manuaalinen luokittelu/piilotus ottelutapahtumille)
ja sen yhdistäminen frontendissä lisätään vaiheessa 3.
