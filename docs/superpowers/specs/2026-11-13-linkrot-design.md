# linkrot: ontwerp (versie 1)

Datum: 2026-11-13 · Eigenaar: Hans (hans2103) · Status: goedgekeurd (13-11-2026)

Naam: `linkrot` (repo `hans2103/linkrot`).

## Waarom

`broken-link-checker` (blc) was Hans' vaste tool om dode links te vinden. Het pakket is sinds
2017 niet onderhouden en doet op Node 24 niets meer (stopt zonder melding, ook op example.com).
Hans wil een opvolger die op de command line net zo makkelijk is als blc, maar beter.

Hij gebruikt hem op twee momenten:

1. **Na een oplevering**: zelf in de terminal, één keer grondig over de hele site.
2. **Periodiek**: de tool draait vanzelf en meldt alleen als er iets kapot is.
   - Site met GitHub-repo: als GitHub Action, melding als GitHub-issue.
   - Site zonder repo: als cronjob op de server (web01/web02/web03, CloudPanel), melding per mail.
   - Het meldkanaal is per site instelbaar.

## Uitgangspunten (besloten)

- **Eigen tool, lychee als motor.** Voor de gebruiker is het een eigen commando met eigen uitvoer.
  Het controleren van URL's doet [lychee](https://github.com/lycheeverse/lychee); geen fork.
  Crawlen, standaardregels, groeperen van de uitvoer en melden doet de tool zelf.
  Lychee is een verwisselbaar onderdeel (later eventueel eigen checker zonder dat de CLI verandert).
- **Publieke repo** onder https://github.com/hans2103.
- **Versie 1** = vervanger van blc, maar beter (onderstaand). **Versie 2** = extra checks tijdens
  het crawlen (ankers naar niet-bestaande `id`, gemengde content, ontbrekende alt-teksten, meta);
  niet in deze versie, maar het ontwerp moet ruimte laten om ze tijdens het crawlen in te haken.

## Bewezen in een proef (13-11-2026, degoedehoop.info, 144 pagina's, 909 unieke links)

- Lychee zonder config: 9,5 minuut en 270 meldingen, allemaal loos alarm
  (Outlook-"toevoegen aan agenda"-links antwoorden niet aan bots; `webcal:` "unsupported").
- Lychee met onderstaande regels: **28 s, 0 meldingen**; tweede run met cache 18 s.
  Een proefpagina met twee echte 404's: beide gemeld met regel/kolom, exitcode 2.
- Lychee crawlt niet zelf (geen recursie); de pagina's moesten uit de sitemap worden gehaald.
- Lychee groepeert per pagina: een kapotte footer-link verschijnt dan 144 keer.

## Wat versie 1 doet

### 1. Eén commando met alleen een URL

```
linkrot https://degoedehoop.info
```

- **Pagina's verzamelen**: eerst de sitemap (via `robots.txt` → `Sitemap:`, anders `/sitemap.xml`,
  sitemap-indexen volgen). Is er geen sitemap, dan zelf crawlen: interne links volgen vanaf de
  opgegeven URL. Een optie dwingt crawlen af, ook als er een sitemap is (een sitemap mist
  pagina's, en crawlen vindt ook links die nergens in de sitemap staan).
- Alleen HTML-pagina's van hetzelfde domein worden gecrawld; assets en externe links worden
  alleen gecontroleerd, niet gevolgd.
- Grenzen om te voorkomen dat hij eindeloos doorloopt: maximaal aantal pagina's en diepte
  (met ruime standaard), querystrings die alleen sorteren/pagineren niet eindeloos volgen.
- Ook gecontroleerd: `src`, `srcset` (let op: URL's met komma's, zoals ImageKit
  `tr:w-320,q-80`), stylesheets, scripts, iframes.

### 2. Slimme standaarden ingebouwd

Gelden voor elke site, zonder config:

- Uitgesloten: bekende bot-onvriendelijke diensten waarvan de links voor mensen werken
  (Outlook-agenda; uitbreidbaar lijstje in de tool), niet-HTTP-schema's (`mailto:`, `tel:`,
  `webcal:`, `javascript:`, `data:`).
- `429` en `403` van bekende bot-blokkers (LinkedIn, Facebook, Instagram e.d.) zijn **twijfel**,
  niet **kapot**: apart getoond, telt niet voor de exitcode en niet als melding.
- Time-out 10 s, één herhaling, cache van één dag.
- Canonical- en `og:url`-links naar een ander domein (bijv. bewust naar productie vanaf een
  testomgeving) niet als fout melden.

Uitzonderingen per site in een configbestand in de repo/werkmap (bijv. `.linkrot.toml`):
extra uitsluitingen, extra startpagina's, grenzen, meldkanaal.

### 3. Uitvoer per kapotte link

- Terminal: één regel per kapotte link (status + URL), daaronder de pagina's waar hij op staat
  (eerste paar, plus "en N meer"). Daarna "twijfel" apart. Afsluitend: aantal pagina's,
  links, kapot, twijfel, duur.
- Voortgang tijdens het draaien (crawlen: N pagina's; controleren: N/M links), stil in CI.
- Ook machineleesbaar: JSON (voor de Action en voor eigen scripts) en Markdown (voor het issue
  en de mail).
- Exitcode: 0 = niets kapot, 1 = kapotte links gevonden, 2 = de tool zelf faalde
  (site onbereikbaar, lychee ontbreekt, ongeldige config). Twijfel geeft 0.

### 4. Melden

Alleen als er iets kapot is, plus het afsluiten als het weer goed is.

- **GitHub-issue**: één issue per site, herkenbaar aan een label/marker. Kapot → issue openen
  of de inhoud bijwerken (geen nieuw issue per run). Alles weer goed → issue sluiten met een
  korte opmerking. Werkt in de Action met `GITHUB_TOKEN`; lokaal via `gh` of een token.
- **Mail via SMTP** met inloggegevens uit de omgeving of een credentialsbestand (zoals
  `~/.smtp-credentials` op de servers); `sendmail` alleen als terugval. Ontvanger en afzender
  staan in de siteconfig. (Keuze van Claude: SMTP omdat Postfix op de servers direct aflevert.)
- **Mail**: lijst met kapotte links (Markdown-overzicht als platte tekst/HTML). Alles goed →
  geen mail. Om niet elke nacht dezelfde mail te krijgen: alleen mailen als de set kapotte links
  is veranderd sinds de vorige run (staat bijhouden in een klein statebestand), met een optie
  om toch altijd te mailen. Wordt de lijst weer leeg, dan één mail "alles weer in orde", zodat
  "opgelost" te onderscheiden is van "cron draait niet meer". (Keuze van Claude.)
- **Periodieke modus faalt niet op kapotte links** (keuze van Claude): met een meldkanaal
  ingesteld is de exitcode 0 bij kapotte links en is er geen uitvoer op stdout (alleen bij een
  fout van de tool zelf, exitcode 2). Zo geeft de Action geen rode run plus GitHub-faalmail, en
  stuurt cron via `MAILTO` geen extra mail. Een optie zet het falen terug aan (voor CI-poorten).

## Installatie en gebruik

- **Servers (nagekeken 13-11-2026)**: web01/02/03 zijn Ubuntu 26.04, x86_64, **zonder Node**
  en zonder Homebrew; site-users zijn geen root. Postfix levert direct af (geen relayhost), dus
  `sendmail` belandt makkelijk in spam. Per site staat er wel `~/.smtp-credentials` (MailerSend).
- **Daarom één losse binary** (keuze van Claude): de tool wordt gecompileerd tot een standalone
  programma per platform (macOS arm64 en x64, Linux x64), zodat er op de servers geen Node
  nodig is. Releases via GitHub Releases.
- **Mac**: `brew install hans2103/tap/linkrot` (eigen tap `hans2103/homebrew-tap`, bestaat nog
  niet), met lychee als brew-dependency.
- **Server**: één regel `curl … | sh` die de tool-binary en de lychee-binary (lychee publiceert
  Linux-binaries) in `~/.local/bin` van de site-user zet. Geen root nodig.
- Geen npm-publicatie in versie 1.
- **GitHub Action** in dezelfde repo, voor gebruik in een site-repo met een paar regels workflow
  (schema, URL, meldkanaal). Installeert lychee zelf.
- **Cron op de server**: één regel in de crontab van de site-user.
- `linkrot --help` en een README met voorbeelden voor alle drie.

## Techniek (keuzes van Claude, niet van Hans)

- JavaScript/TypeScript, gecompileerd tot standalone binary (Bun `--compile` of Node SEA, aan
  de bouwer); zo weinig dependencies als redelijk.
- Lychee wordt aangeroepen als los programma (minimaal versie 0.24), met de verzamelde URL's
  als invoer en JSON-uitvoer, die de tool omzet naar eigen groepering en formaten.
- Tests met een lokale testserver (pagina's met bekende kapotte en goede links, sitemap,
  sitemap-index, geen sitemap, komma-URL's); geen tests tegen echte sites.
- Licentie: MIT.
- README en CLI-teksten in het Engels (publieke repo).

## Niet in versie 1

- De extra checks van versie 2.
- Een webinterface of dashboard.
- JavaScript uitvoeren (pagina's die links pas via JS opbouwen); alleen de geleverde HTML.
- Inloggen achter wachtwoorden; wel basic-auth via een optie als dat eenvoudig kan.

## Mislukt als

- Hij in de praktijk loos alarm geeft, zodat Hans meldingen gaat negeren.
- Installeren meer is dan één commando, of hij stil faalt zoals blc.
- Dezelfde dode link tientallen keren in beeld staat.
- Elke nacht dezelfde mail of een nieuw issue.

## Aan de bouwer

Interne opbouw, naamgeving van opties, formaat van het configbestand, hoe de tool
lychee vindt/controleert, de precieze crawlgrenzen, en hoe de statebestanden heten.
