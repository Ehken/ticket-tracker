# SaiPa lipputilanne

Julkinen, epävirallinen seurantasivu SaiPan Kisapuiston kotiottelujen ja
kausikorttien lipunmyynnille: <https://ehken.github.io/ticket-tracker/>.

Ei backendia eikä tietokantaa: GitHub Actions -työnkulku hakee tiedot
säännöllisesti [elippu.net/saipa](https://elippu.net/saipa)-kaupasta,
tallentaa ne JSON-tiedostoina tähän repoon (git toimii tietokantana), ja
staattinen frontend (GitHub Pages) lukee nämä tiedostot suoraan selaimessa —
ei build-vaihetta, ei ulkoisia ajonaikaisia riippuvuuksia.

## Arkkitehtuuri

`.github/workflows/fetch.yml` ajaa `scripts/fetch.js`:n kahdella ajastuksella:

- **Tunneittain**, klo `:17` (ei `:00` — GitHubin jaettu ajastin on
  ruuhkautunut tasatunnin kohdalla; oikean datan aikaleimat näyttivät jopa
  ~55 minuutin viiveitä ja kokonaan väliin jääneitä ajoja tasatunnilla).
- **10 minuutin välein klo 15–21** (Europe/Helsinki, molemmat
  kesäaika-tilanteet huomioiden) — mutta vain kun jokin seurattu ottelu on
  todella käynnissä sinä päivänä. `scripts/checkGameWindow.js` päättää tämän
  `data/events.json`:n perusteella ja portitoi ajon; muina päivinä tämä
  ajastus on käytännössä no-op.

Ajo hakee jokaisen `elippu.net/saipa`:n listalla olevan tapahtuman erikseen,
eristäen yhden tapahtuman virheen (parametrivirhe, tilapäinen verkko-ongelma)
niin ettei se estä muiden tapahtumien päivittymistä. Onnistuneet muutokset
committoidaan ja pushataan `data/`-kansioon `github-actions[bot]`-identiteetillä
— checkoutin git-kredentiaali ei jää voimaan pidempään kuin sen tarvitseva
askel (`persist-credentials: false`), ja komento käyttää ajon oman
`GITHUB_TOKEN`:in kanssa muodostettua etätunnusta vain silloin kun sitä
tarvitaan.

## Datalähde

Data haetaan elippu.net:n julkisilta kauppasivuilta — ei yksityistä rajapintaa.
Jokaisen tapahtuman myyntitiedot ovat upotettuna sivun HTML:ään
(`kit.start(...)`-kutsun sisällä), ja parseri (`scripts/lib/eventParser.js`)
purkaa ne. Katsomon paikkamäärät luetaan tapahtuman omasta `seatmap.svg`-kartasta
ja välimuistitetaan sisällön tiivisteen (SHA-1) mukaan `data/capacities/`-kansioon
— sekä paikkamäärät (`.json`) että itse SVG-kartta (`.svg`) tallennetaan tällä
tiivisteellä nimettynä, eikä kumpaakaan kirjoiteta uudelleen jos tiedosto on jo
olemassa. Jokaisesta hausta tallennetaan myös tapahtuman myydyt yksittäiset
paikka-ID:t (`data/events/{id}/seats.json`) — käytössä istumakartassa (ks.
alla).

## Data-kansion rakenne

```
data/
  events.json                    # indeksi kaikista nähdyistä tapahtumista + tila (upcoming/past)
  schedule.json                  # ihmisen ylläpitämä otteluohjelma-fixture — koodi ei koskaan kirjoita tähän
  overrides.json                 # ihmisen ylläpitämä manuaalinen luokittelu/piilotus, ks. alla — koodi ei koskaan kirjoita tähän
  autoclass.json                 # scraperin ylläpitämä, kertakirjoitettava automaattiluokittelu (ei koskaan ylikirjoiteta)
  events/{id}/latest.json        # tuorein tilannekuva per tapahtuma
  events/{id}/history.json       # myynnin aikasarja per tapahtuma (myyty/vapaa/ei-myynnissä/suljetut lohkot ajassa)
  events/{id}/seats.json         # tämänhetkiset myydyt paikka-ID:t (ei historiaa, ylikirjoitetaan joka haulla)
  capacities/{svg-hash}.json     # paikkamäärät per katsomonumero, versioitu SVG:n tiivisteellä
  capacities/{svg-hash}.svg      # sama kartta raakana SVG:nä, istumakarttaa varten
  mock/                          # kokonaan erillinen puu ?mock=1-tilalle, ks. alla — sama rakenne kuin yllä
```

Omistajuus: `schedule.json` ja `overrides.json` ovat **ihmisen omistamia** —
mikään skripti ei koskaan kirjoita niihin. `autoclass.json` on **scraperin
omistama ja kertakirjoitettava**: olemassa oleva merkintä ei koskaan muutu,
vaikka myöhempi ajo löytäisi eri ehdokkaan. Kaikki muu on koneen omistamaa.

## Frontend

`index.html` + `style.css` + `js/*.js` muodostavat staattisen sivun. Aja
paikallisesti esim. `npx serve .` repon juuresta ja avaa selain.

Ominaisuudet:

- **Kausikorttiraita** — kausikortin oma kortti aina ylimpänä, sisältää oman
  myyntikäyränsä ja täyttöprosenttinsa.
- **Karsivat suodattimet** (`js/filterBar.js`) — kausi, sarjataso, vastustaja,
  sekä valinta näytetäänkö jo pelatut ottelut (`?pelatut=1`).
- **Aikajana** (`#timeline`) — tulevat/pelatut ottelut kortteina, kunkin oma
  myyntikäyrä (Chart.js, ks. alla) ja tarkat luvut.
- **Istumakartta** — tapahtuman oma paikkakartta SVG:nä, väritettynä
  todellisen myyntitilanteen mukaan (kausikortti/irtolippu/vapaa/ei
  myynnissä), sisältäen seisomakatsomon pinofillin ja pyörätuolipaikkojen
  12 erillistä paikkaa. Kosketa/klikkaa lohkoa nähdäksesi tarkat luvut.

Kaaviokirjastot (Chart.js, Luxon, chartjs-adapter-luxon) on ladattu itse
(`vendor/`, ks. `vendor/README.md`) — ei CDN-pyyntöjä kävijöille.

## Testidata / suunnittelutila (`?mock=1`)

Sivu tukee pysyvää suunnittelu- ja testitilaa: `.../?mock=1` lataa oikean
`data/`-kansion sijaan `data/mock/`-kansion, joka sisältää generoidun,
realistisen näköisen testiaineiston (kaikki `data/schedule.json`:n 36
ottelua, muutama pelattu ottelu realistisilla täyttöprosenteilla, kaksi
kautta kausivalitsinta varten, moniosaiset myyntikäyrät, sekä yksi
luokittelematon ottelu). Tuotantokäyttäytyminen ei muutu millään tavalla —
testidata ei koskaan sekoitu oikeaan dataan. Sisääntulokohta:
`js/fetchData.js`:n `IS_MOCK`.

Generoi/päivitä testiaineisto:

```bash
npm run generate-mock
```

`scripts/generateMockData.js` käyttää siementä satunnaislukugeneraattoria,
joten sama komento tuottaa saman lopputuloksen uudelleen ajettuna (ellei
generointilogiikkaa tai `data/schedule.json`:ää muuteta).

## Yksityinen esikatselu (`?dashboard=1`)

`.../?dashboard=1` näyttää normaalin sivun sijaan sisäisen
seuranta-/analytiikkanäkymän (myyntinopeudet, sellout-ennusteet,
top-liikkujat) — ei linkitetty navigaatiosta. Sisääntulokohta:
`js/urlState.js`:n `IS_DASHBOARD`.

## Ajaminen paikallisesti

Vaatii Node.js version 20 tai uudemman. Ei ulkoisia ajonaikaisia
riippuvuuksia.

```bash
npm test          # aja yksikkötestit (node:test)
npm run fetch     # hae tuoreet tiedot elippu.net:stä ja päivitä data/-kansio
```

`npm run fetch` (`node scripts/fetch.js`) ei koskaan tee git-committeja itse —
se vain lukee/kirjoittaa `data/`-kansion tiedostot ja palauttaa exit-koodin
0 (onnistui) tai 1 (jokin tapahtuma epäonnistui parsittaessa). Tuotannossa
committauksen hoitaa `.github/workflows/fetch.yml`. Paikallisen ajon
jälkeen voit itse tarkistaa `data/`-kansion sisällön ja tehdä committin, kun
olet tyytyväinen tuloksiin.

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

## Data ja lisenssi

Koodi on MIT-lisensoitu, ks. [`LICENSE`](LICENSE). Lisenssi koskee vain
koodia: `data/`-kansion sisältö on johdettu elippu.net:n julkisesti
saatavilla olevilta sivuilta, ja se tarjotaan sellaisenaan ilman takuuta
tarkkuudesta. Tämä on epävirallinen, harrastajavetoinen seurantasivu, joka
ei ole SaiPan eikä elippu.net:n ylläpitämä tai siihen sidoksissa.
