# SaiPa lipputilanne

Julkinen, epävirallinen seurantasivu SaiPan Kisapuiston kotiottelujen ja
kausikorttien lipunmyynnille: <https://ehken.github.io/ticket-tracker/>.

Ei backendia eikä tietokantaa: GitHub Actions -työnkulku hakee tiedot
säännöllisesti [elippu.net/saipa](https://elippu.net/saipa)-kaupasta,
tallentaa ne JSON-tiedostoina tähän repoon (git toimii tietokantana), ja
staattinen frontend (GitHub Pages) lukee nämä tiedostot suoraan selaimessa —
ei build-vaihetta, ei ulkoisia ajonaikaisia riippuvuuksia.

## Arkkitehtuuri

`scripts/fetch.js`:ää ajaa kaksi erillistä GitHub Actions -työnkulkua, kaksi
eri kadenssia varten:

- **`.github/workflows/fetch.yml`** — tunneittain, klo `:17` (ei `:00` —
  GitHubin jaettu ajastin on ruuhkautunut tasatunnin kohdalla; oikean datan
  aikaleimat näyttivät jopa ~55 minuutin viiveitä ja kokonaan väliin
  jääneitä ajoja tasatunnilla). Ei koskaan portitoitu.
- **`.github/workflows/fetch-intensive.yml`** — 10 minuutin välein klo
  8–20 (Europe/Helsinki, molemmat kesäaika-tilanteet huomioiden;
  tarkoituksella väliaikainen leveä ikkuna, ks. `scripts/lib/gameWindow.js`)
  sekä
  `data/watchDates.json`:iin merkittyinä päivinä (esim. lipunmyynnin
  avautumispäivä — ei ole otteluohjelman fixture, siksi oma
  tiedostonsa). `scripts/checkGameWindow.js` päättää portitoinnin
  `data/events.json`:n ja `data/watchDates.json`:n perusteella
  (`scripts/lib/gameWindow.js`); muina hetkinä tämä ajo on käytännössä
  no-op — myös silloin kun se käynnistetään käsin ("Run workflow").
  **Manuaaliseen kertahakuun käytä `fetch.yml`:ää** — se ei ole koskaan
  portitoitu.

Ajo hakee jokaisen `elippu.net/saipa`:n listalla olevan tapahtuman erikseen,
eristäen yhden tapahtuman virheen (parametrivirhe, tilapäinen verkko-ongelma)
niin ettei se estä muiden tapahtumien päivittymistä. Onnistuneet muutokset
committoidaan ja pushataan `data/`-kansioon `github-actions[bot]`-identiteetillä
— checkoutin git-kredentiaali ei jää voimaan pidempään kuin sen tarvitseva
askel (`persist-credentials: false`), ja komento käyttää ajon oman
`GITHUB_TOKEN`:in kanssa muodostettua etätunnusta vain silloin kun sitä
tarvitaan.

### Ulkoinen käynnistin

GitHubin oma ajastin ei toimittanut kumpaakaan yllä olevaa kadenssia
luotettavasti: ensimmäisen 24h aikana `:17`-ajastuksen käyttöönotosta
(27.7.) odotetuista 24 ajosta toteutui 9 (aukot 1h35min–3h48min, hajallaan
läpi vuorokauden); 10 minuutin ajastuksesta odotetuista ~90:stä toteutui 4
(~4 %). GitHub dokumentoi tämän itse: ajastetut tapahtumat voivat
viivästyä tai jäädä kokonaan pois kuormituksen alla, ja tiheämmät
ajastukset kärsivät pahemmin. Molempien yllä kuvattujen ajastusten
`cron`-rivit ovat siis tästä lähtien vain varajärjestely — varsinaisen
kadenssin ajaa ulkoinen palvelu lähettämällä
[`repository_dispatch`](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#repository_dispatch)-tapahtumia:

- `scrape` → käynnistää `fetch.yml`:n (tunneittainen kadenssi)
- `scrape-intensive` → käynnistää `fetch-intensive.yml`:n (10 min
  kadenssi, silti aina portitoitu samoin kuin ajastettunakin)

Kumpikin osoittaa samaan `concurrency`-ryhmään (`fetch-and-commit`), joten
ne eivät koskaan pushaa päällekkäin.

Ulkoinen palvelu tunnistautuu tähän repoon rajatulla ("fine-grained")
henkilökohtaisella tokenilla, jolla on vain `Contents: write` -oikeus tähän
yhteen repoon. Token on olemassa vain ulkoisen palvelun päässä — **ei tässä
repossa** — ja sillä on vanhenemispäivä, joka pitää muistaa uusia siellä
ennen erääntymistä (repo itsessään ei tarvitse mitään toimenpiteitä sen
vuoksi, paitsi jos käynnistin lakkaa toimimasta — ks. alla).

**Tarkista että käynnistin on hengissä:** `gh run list --event
repository_dispatch` (tai GitHubin Actions-välilehti, suodatettuna
"Event"-sarakkeen mukaan) näyttää viimeisimmät ulkoisen käynnistimen
laukaisemat ajot. Jos näitä ei näy odotetulla tiheydellä, käynnistin on
lakannut toimimasta ja `:17`/10 min -ajastukset ovat ainoa jäljellä oleva
kadenssi (epäluotettavana, yllä kuvatulla tavalla) kunnes se korjataan.

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
  events/{id}/seasonBaseline.json         # kausikorttitapahtumille: johdettu todellinen kausikorttimäärä, ks. "Kausikorttien laskenta"
  events/{id}/seasonBaselineHistory.json  # johdetun kausikorttimäärän aikasarja
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

## Kausikorttien laskenta

Lippukaupan kausikorttilistauksen oma "myyty"-luku lakkaa kuvaamasta
kausikortteja siinä vaiheessa, kun yksittäisten otteluiden lipunmyynti
alkaa: yksittäisen ottelulipun osto varaa saman paikan myös
kausikorttilistauksesta, joten listauksen luku kasvaa irtolippujen tahdissa
vaikka yhtään uutta kausikorttia ei myytäisi.

Todellinen kausikorttimäärä johdetaan siksi ottelukohtaisesta datasta
(`scripts/lib/seasonBaseline.js`): kausikortiksi lasketaan paikka, joka on
myyty kausikorttilistauksessa **ja** kauden jokaisessa tulevassa
ottelussa — aito kausikortti näkyy myytynä joka ottelussa, irtolippu vain
yhdessä. Seisomakatsomolle (ei paikka-ID:itä) käytetään otteluiden
pienintä myytyä määrää. Tulos kirjoitetaan tiedostoon
`events/{id}/seasonBaseline.json`, ja kausikorttikortti, istumakarttojen
kausikortti/irtolippu-jako sekä dashboardin irtolippulaskenta käyttävät
sitä listauksen raakalukujen sijaan. Jos johdettua tiedostoa ei ole (kauden
otteluita ei vielä myynnissä), käytetään listauksen omia lukuja — ne ovat
silloin vielä puhtaita.

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
