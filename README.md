# youtube-ingest

En liten **Cline SDK**-app (Node + TypeScript) som för in en YouTube-video som
källnot i Obsidian-valvet *Second Brain* — samma flöde som `/ingest`, men hämtat
automatiskt.

## Idén (varför en LLM här)

Appen delar arbetet på samma sätt som valvets regler kräver:

| Lager | Ansvar | Får inte |
|---|---|---|
| **Verktyg** (deterministiska) | Hämta metadata (oEmbed) och transkript, formatera YAML, skriva filen, dedup | Tolka, sammanfatta, ändra siffror |
| **Agenten** (LLM) | Skriva `Sammanfattning`, `Nyckelidéer`, `Citat`, `Kopplingar`, `tags` med epistemiska markörer | Ändra fakta från metadata/transkript |

Fakta (titel, kanal, URL, transkript) kommer alltid från verktygen. Modellen får
bara skriva tolkningen — vilket uppfyller valvets regel *"en LLM får aldrig ändra
siffror eller säkerhetsutfall"*.

## Verktyg

| Verktyg | Beskrivning |
|---|---|
| `check_vault_for_video` | Finns redan en not för video-ID:t? (idempotent) |
| `fetch_youtube_metadata` | Titel/kanal/thumbnail via oEmbed (**ingen API-nyckel**) |
| `fetch_youtube_transcript` | Transkript som en textsträng (officiell nyckel krävs ej) |
| `write_source_note` | Skriver den färdiga noten (`completesRun: true`) |

## Kom igång

```bash
npm install
cp .env.example .env      # fyll i ANTHROPIC_API_KEY (eller annan provider)

# Nätverkskoll utan LLM/API-nyckel (metadata + transkript):
npm run smoke

# kör utan att skriva något:
npm run dev -- "https://www.youtube.com/watch?v=45K3zHckCnQ" --dry-run

# riktig körning → skriver till 01-Raw/Videos/:
npm run dev -- "https://youtu.be/45K3zHckCnQ"
```

`.env` laddas automatiskt av npm-skripten via Node:s `--env-file-if-exists`
(ingen extra beroende behövs). Saknas filen fortsätter körningen med miljövariabler.

Efter en lyckad körning: kör `/ingest` i valvet för att lyfta ut koncept/personer
till `02-Wiki/` och logga i `99-System/log.md`.

## Flaggor

```
--dry-run            Skriv ingen fil; visa noten i terminalen
--force              Skriv över en befintlig not
--lang sv            Föredraget transkriptspråk
--provider <id>      LLM-provider (standard: anthropic)
--model <id>         Modell   (standard: claude-sonnet-4-6)
--vault <sökväg>     Valvets rot
--out <undermapp>    Mapp för källnoter (standard: 01-Raw/Videos)
--max-iterations <n> Tak för agentens loop
```

## Konfiguration (miljövariabler)

| Variabel | Standard | Beskrivning |
|---|---|---|
| `YOUTUBE_INGEST_PROVIDER` | `anthropic` | Provider-id i Cline SDK |
| `YOUTUBE_INGEST_MODEL` | `claude-sonnet-4-6` | Modell-id |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` | – | Nyckel för vald provider |
| `YOUTUBE_INGEST_VAULT` | `/Users/elminnurkic/Documents/Second Brain` | Valvets rot |
| `YOUTUBE_INGEST_LANG` | – | Föredraget transkriptspråk |

## Utveckling

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # tsc → dist/
```

## Arkitektur

```
src/
  index.ts               CLI (argument, miljö, utskrift)
  config.ts              Läser env → AppConfig
  prompts.ts             System- och användarprompt (svenska)
  agent/run.ts           Bygger Cline SDK-Agent + streamar text
  tools/youtube.ts       fetch_youtube_metadata, fetch_youtube_transcript
  tools/vault.ts         check_vault_for_video, write_source_note
  youtube/video-id.ts    Robust video-ID-parsning (shorts/live/embed/music)
  youtube/metadata.ts    oEmbed
  youtube/transcript.ts  youtube-transcript (utan tidsstämplar, se not nedan)
  vault/note.ts          Bygger Markdown enligt Templates/source.md
  vault/frontmatter.ts   YAML-escaping
  vault/paths.ts         Sökvägar
tests/                   Vitest
```

## Kända begränsningar (ärligt)

- **Transkript** hämtas från YouTubes inofficiella endpoint. Det kan sluta funka
  eller rate-limitas utan förvarning, och kräver att videon har ett undertextspår.
- **Språkvalet är en fallback-kedja**: `--lang` → engelska → videons standardspår.
  Anledning: biblioteket returnerar *vilket spår YouTube listar först*, vilket i
  praktiken kan vara en automatöversättning i ett orelaterat språk (en engelsk
  video kom tillbaka på **bengaliska** i ett riktigt test). Fältet `language` i
  verktygets svar visar vilket spår som faktiskt användes.
- **Tidsstämplar utelämnas** medvetet: `youtube-transcript` rapporterar `offset`
  i millisekunder för srv3-formatet men i sekunder för det äldre formatet.
  Enheten är inte pålitlig, så appen visar hellre ingen tid än fel tid.
- **Upphovsrätt:** transkriptet är YouTubes/skaparens innehåll. Privata
  valvanteckningar är en sak — att publicera transkriptet som egen text (t.ex.
  YouTube→blogg) är en annan. Gör inte det utan att kontrollera rättigheterna.

## Verifierat (kört, inte påstått)

| Kontroll | Kommando | Resultat |
|---|---|---|
| Typer | `npm run typecheck` | 0 fel |
| Enhets-/integrationstester | `npm test` | **34/34** (video-ID, notbygge, verktyg, agent-loop) |
| Bygge | `npm run build` | rent (`dist/`) |
| Live: metadata + transkript | `npm run smoke` | titel/kanal/thumbnail korrekt; transkript på **engelska**, 885 segment, 33 479 tecken |
| CLI-vägar | `--help`, ingen URL, okänd flagga, saknad nyckel | utskrift + exit-kod 0/2 som avsett |
| Agent ↔ provider | `npm run dev` med nyckel | nådde API:t och visade `API key is invalid.` (nyckeln saknas/är ogiltig i denna miljö) |

Agent-loopen testas **offline** med en scriptad fejkmodell (`tests/agent.test.ts`):
den anropar riktiga verktyg, verkställer `completesRun` och skriver en fil — utan
nätverk och utan API-nyckel.

`[osäkerhet]` Det sista steget — en full körning med en **riktig** nyckel — kunde
inte verifieras här, eftersom ingen giltig nyckel fanns i miljön. Allt fram till
provider-anropet är verifierat.

## Möjligt nästa steg

- Paketera verktygen som en **MCP-server** (samma två verktyg, eller hela
  ingest-flödet) så att Cline kan anropa dem direkt i chatten.
- Lägga till en `ingest`-körning efter skrivning (koncept/personer till `02-Wiki/`).
