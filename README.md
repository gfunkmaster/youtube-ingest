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

| Verktyg | Beskrivning | Finns i MCP |
|---|---|---|
| `check_vault_for_video` | Finns redan en not för video-ID:t? (idempotent) | – |
| `fetch_youtube_metadata` | Titel/kanal/thumbnail via oEmbed (**ingen API-nyckel**) | ✅ |
| `fetch_youtube_transcript` | Transkript som en textsträng (officiell nyckel krävs ej) | ✅ |
| `write_source_note` | Skriver den färdiga noten (`completesRun: true`) | – |

MCP-servern exponerar de två **rent deterministiska** uppslagen. Filskrivningen
ligger kvar hos CLI-agenten, som känner till valvets regler och mallar.

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
--provider <id>      LLM-provider (valfri; se --list-providers)
--model <id>         Modell   (standard: providerns defaultModelId)
--vault <sökväg>     Valvets rot
--out <undermapp>    Mapp för källnoter (standard: 01-Raw/Videos)
--max-iterations <n> Tak för agentens loop
--no-transcript      Lägg inte in transkriptet i noten (mindre filer)
--playlist           Kör hela spellistan, inte bara videon i URL:en
--max-videos <n>     Tak för antal videor i en spellista (standard: 10)
--list-providers     Lista SDK:ns alla providers + nyckelvariabel + standardmodell
```

## Spellistor

En spelliste-URL körs automatiskt som spellista. En `watch?v=…&list=…`-URL är
tvetydig och stannar som **enskild video** — men säger det högt — tills du sätter
`--playlist`.

```bash
npm run dev -- "https://www.youtube.com/playlist?list=PL..." --dry-run
npm run dev -- "https://www.youtube.com/playlist?list=PL..." --max-videos 5
```

Flödet: `yt-dlp` räknar upp videorna → **samma per-video-flöde som förut** körs en
gång per video → en **hub-not** skrivs till `02-Wiki/Sources/`, samma mönster som
`Claude Academy` och `Cold State Capital`.

### Tre skydd inbyggda

1. **`--max-videos` (standard 10).** En felklistrad URL får inte kosta obegränsat
   med pengar. Varje video är en egen LLM-körning.
2. **En video kan inte fälla hela körningen.** Saknar en video textning hoppas den
   över, loggas, och sammanställningen i slutet säger hur många som blev klara.
3. **En video utan transkription blir ingen not.** Noten skulle bara kunna hittas
   på — så den skrivs inte alls (principen *hellre ingen träff än fel svar*).

### Varför `yt-dlp` och inte skrapning eller Data API

[verifierat] Ren HTML-skrapning fungerar inte: YouTube skickar en
samtyckesredirect (`consent.youtube.com`) och videoid:na finns inte i HTML:en
längre. YouTube Data API v3 hade fungerat men krävt ännu en nyckel. `yt-dlp`
kräver ingen nyckel och är samma *kategori* av verktyg som projektet redan
använder för transkript (`brew install yt-dlp`).

## Provider — vilken som helst, inte bara Anthropic

Appen är inte bunden till en leverantör. **Providerlistan, nyckelvariabeln och
standardmodellen läses ur Cline SDK:s register** — inget är hårdkodat. Just nu
innehåller registret **228 providers**, t.ex. `anthropic`, `deepseek`, `groq`,
`openai-native`, `gemini`, `xai`, `mistral`, `openrouter`, `together`,
`cerebras`, `fireworks`, `ollama`, `lmstudio`.

```bash
npm run dev -- --list-providers        # id + defaultModelId + nyckelvariabel
```

Byta till DeepSeek:

```bash
# i .env
YOUTUBE_INGEST_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...                # namn kommer från registret
# YOUTUBE_INGEST_MODEL=                 # lämna tom → deepseek-v4-flash
```

Samma sak utan att röra `.env`:

```bash
npm run dev -- "https://youtu.be/..." --provider deepseek
```

> **Modell är providerspecifik.** Sätter du `YOUTUBE_INGEST_MODEL` till en modell
> som hör till en *annan* provider varnar appen vid start och tipsar om
> providerns standard. Lämna variabeln tom för att alltid få rätt modell.

Lokala providers (t.ex. `ollama` på `http://localhost:11434`) känns igen på sin
baseUrl och kräver ingen nyckel.

## Konfiguration (miljövariabler)

| Variabel | Standard | Beskrivning |
|---|---|---|
| `YOUTUBE_INGEST_PROVIDER` | `anthropic` | Valfritt provider-id ur SDK-registret |
| `YOUTUBE_INGEST_MODEL` | (tom) | Tom → providerns `defaultModelId` |
| `<PROVIDER>_API_KEY` | – | Nyckelvariabeln kommer från registret: `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, ... |
| `YOUTUBE_INGEST_VAULT` | `/Users/elminnurkic/Documents/Second Brain` | Valvets rot |
| `YOUTUBE_INGEST_LANG` | – | Föredraget transkriptspråk (tom = original/engelska) |

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
  config.ts              Läser env + SDK-providerregistret → AppConfig
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

## MCP-server (Cline ⇄ YouTube i chatten)

Samma två deterministiska uppslag finns också som en **MCP-server** över stdio, så
att Cline (eller vilken MCP-klient som helst) kan anropa dem direkt i chatten.
Servern återanvänder **exakt samma funktioner** som agent-verktygen — en
implementation, två adaptrar — så beteendet kan inte glida isär.

```bash
npm run mcp          # startar MCP-servern på stdio
npm run mcp:smoke    # startar den som subprocess och anropar verktygen (riktig stdio)
```

> En stdio-MCP-server får **aldrig** skriva till stdout (det är protokollkanalen).
> Diagnostik går till stderr.

### Koppla in i Cline

Lägg till i `~/.cline/data/settings/cline_mcp_settings.json` (schemats stdio-form
är `{ type: "stdio", command, args?, cwd?, env? }`):

```json
{
  "mcpServers": {
    "youtube": {
      "transport": {
        "type": "stdio",
        "command": "node",
        "args": ["--env-file-if-exists=.env", "--import", "tsx", "src/mcp/main.ts"],
        "cwd": "/Users/elminnurkic/Documents/GitHub/youtube-ingest"
      }
    }
  }
}
```

Starta om Cline-sessionen. Verktygen dyker upp som `fetch_youtube_metadata` och
`fetch_youtube_transcript`. Kräver **ingen API-nyckel** — bara `npm install`.

## Verifierat (kört, inte påstått)

| Kontroll | Kommando | Resultat |
|---|---|---|
| Typer | `npm run typecheck` | 0 fel |
| Enhets-/integrationstester | `npm test` | **91/91** (video-ID, notbygge, hub, verktyg, agent-loop, MCP, config, spellista) |
| Spellisteuppräkning | `fetchPlaylistItems` mot riktig lista | `Claude Code`, 4/4 med `--max-videos 4`, ~1 s, ingen nyckel |
| Transkriptet till noten | live mot riktig video | 33 479 tecken i noten, modellen bar det aldrig |
| Kapad transkription | `--` på 4 h-kurs | varning överst i noten, `transcriptTruncated` obligatoriskt |
| Provider-registret | `npm run dev -- --list-providers` | 228 providers, med nyckelvariabel + standardmodell |
| Annan provider | `--provider deepseek` + `DEEPSEEK_API_KEY` | `modell: deepseek-v4-flash`, nådde DeepSeeks API (fejknyckel gav deras auth-fel) |
| Modellskydd | `--provider deepseek --model claude-sonnet-4-6` | varnar och tipsar om rätt standardmodell |
| Okänd provider | `--provider nope-not-real` | tydligt fel + hänvisning till `--list-providers` |
| Bygge | `npm run build` | rent (`dist/`) |
| Live: metadata + transkript | `npm run smoke` | titel/kanal/thumbnail korrekt; transkript på **engelska**, 885 segment, 33 479 tecken |
| MCP över riktig stdio | `npm run mcp:smoke` | båda verktygen listade; riktig metadata + engelskt transkript över protokollet |
| MCP klient↔server | `npm test` (`tests/mcp.test.ts`) | 4 tester via `InMemoryTransport`, ingen nätverk/subprocess |
| CLI-vägar | `--help`, ingen URL, okänd flagga, saknad nyckel | utskrift + exit-kod 0/2 som avsett |
| Agent ↔ provider | `npm run dev` med nyckel | nådde API:t och visade `API key is invalid.` (nyckeln saknas/är ogiltig i denna miljö) |

Agent-loopen testas **offline** med en scriptad fejkmodell (`tests/agent.test.ts`):
den anropar riktiga verktyg, verkställer `completesRun` och skriver en fil — utan
nätverk och utan API-nyckel.

`[osäkerhet]` Det sista steget — en full körning med en **riktig** nyckel — kunde
inte verifieras här, eftersom ingen giltig nyckel fanns i miljön. Allt fram till
provider-anropet är verifierat.

## Möjligt nästa steg

- Exponera även hela ingest-flödet (inkl. `write_source_note`) över MCP — kräver
  då att valvets skrivregler och en bekräftelse vägs in.
- Lägga till en `ingest`-körning efter skrivning (koncept/personer till `02-Wiki/`).
- Flera videor per körning (batch).
