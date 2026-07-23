# SaiPa lipputilanne

Julkinen, epävirallinen seurantasivu SaiPan Kisapuiston kotiottelujen ja
kausikorttien lipunmyynnille. Ei backendia eikä tietokantaa: GitHub Actions
-työnkulku hakee tiedot säännöllisesti [elippu.net/saipa](https://elippu.net/saipa)
-kaupasta, tallentaa ne JSON-tiedostoina tähän repoon, ja staattinen
frontend (GitHub Pages) lukee nämä tiedostot.

Tämä repo on tällä hetkellä vaiheessa **1–3**: scraperi + parseri
yksikkötesteineen, sen ajaminen oikeaa kauppaa vasten, ja staattinen frontend.
GitHub Actions -workflow (automaattinen ajastettu haku) tulee myöhemmin.

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

## Frontend

`index.html` + `style.css` + `js/*.js` muodostavat staattisen sivun, joka lukee
`data/`-kansion JSON-tiedostot suoraan selaimessa (ei build-vaihetta). Aja
paikallisesti esim. `npx serve .` repon juuresta ja avaa selain.

## Manuaalinen luokittelu (`data/overrides.json`)

Scraperi ei koskaan kirjoita tähän tiedostoon — se on olemassa vain manuaalista
muokkausta varten. Kentät (kaikki valinnaisia):

- `gameType`: `"kausikortti" | "harjoitusottelu" | "runkosarja" | "playoffs" | "muu"`
- `season`: esim. `"2026-27"`
- `hidden`: `true` piilottaa tapahtuman kokonaan sivulta
- `displayName`: korvaa scrapatun nimen
- `note`: vapaa teksti, näytetään kortissa

Avaimena käytetään tapahtuman id:tä **väliviiva-muodossa** (esim. `"53-575"`,
ei `"53:575"`), sama muoto kuin `data/events/`-kansioiden nimissä.

**Muokkausvuo:** muokkaa `data/overrides.json` paikallisesti tekstieditorilla,
committaa ja pushaa muutos normaalisti omalla git-identiteetillasi. (Ei GitHubin
web-editoria — sen kautta tehdyt committit näkyvät aina kirjautuneen
GitHub-tilin nimissä, ei paikallisen git-identiteetin, mikä ei ole toivottua
tässä projektissa.)

Esimerkki:

```json
{
  "53-575": { "gameType": "kausikortti" },
  "53-580": { "gameType": "harjoitusottelu", "season": "2026-27" }
}
```
