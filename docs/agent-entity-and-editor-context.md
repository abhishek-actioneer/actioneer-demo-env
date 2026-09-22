# Reusable Agents + Agent Editor — Context

_Last updated: 2026-07-21. Status: built locally, **nothing committed**._

## What this work is

Turn the voice **Agent** into a real, reusable, first-class entity (it used to be a
read-only *projection* of campaigns), and give it a full-page **editor** modeled on
Bland's Persona editor. This is "Phase 1" of the agent-vs-campaign reuse model
researched earlier in the thread (design doc published as an artifact:
_Agents & Campaigns — A Reuse Model_).

**Mental model (the target):** one **Agent** = identity + behavior + knowledge, and
everything else (inbound numbers, and later campaigns) references it by id — never a
copy. Direction (inbound/outbound) is a binding on the number, not a separate agent
type. Industry-convergent (Vapi, Retell, ElevenLabs, Regal, Twilio, Salesforce, etc.).

## The problem it replaced

`VoiceCampaign` is a god-object embedding persona + prompt + audience + calls. There was
**no Agent entity** — `/agents` derived agents on the fly by grouping campaigns by
`name::voice` and calling "# of campaigns" the version number. "Reuse an agent" meant
copy-pasting the persona into a new campaign.

## What was built

### Agent as a real entity (Phase 1, additive — no campaign records mutated)
- `src/lib/agent-types.ts` — `Agent` interface (identity, behavior, `knowledgeIds`,
  `avatarSeed`, `source`, `primaryCampaignId`, `sourceCampaignIds`, `campaignCount`).
- `src/lib/agent-store.ts` — JSON store at `data/agents.json`.
- `src/lib/agent-backfill.ts` — `deriveAgentsFromCampaigns` / `syncAgentsFromCampaigns`
  (idempotent; **dataset-scoped** grouping via `agentIdFor(userId, datasetId, name, voice)`;
  preserves user edits like `knowledgeIds`). `agentIdForCampaign(campaign)`.
- `src/app/api/agents/route.ts` — `GET` backfills + lists (dataset-scoped, enriched with
  live `callCount`/`workflowNodes`); `POST` creates a from-scratch agent (`source:"manual"`).
- `src/app/api/agents/[id]/route.ts` — `GET` (agent + knowledge inventory); `PATCH`
  (persists `name, avatarSeed, role, voice, voiceName, language, systemPrompt,
  firstMessage, knowledgeIds`).

### Inbound repointed onto the Agent
- `inbound-agent-store.ts` binding now carries `agentId` (numbers normalized to digits).
- `inbound-agent-config.ts` resolves persona **and** knowledge from the Agent when
  `agentId` is set; **falls back to the campaign persona** otherwise (safety net — the
  live demo can't regress).
- `/api/inbound-agent` GET/POST are agent-aware; `set-context` writes the knowledge
  selection **onto the agent**; `activate` mints/binds the agent (`agentIdForCampaign`).
- Seeded: `912269870900` → Ananya agent (dataset `vastu-hfc`) in `data/inbound-agents.json`.

### `/agents` list + create
- `agents-library-page.tsx` reads `/api/agents` (real entities); versions now read `v1`
  (real), not campaign-count. Cards navigate to `/agents/[id]`. **Create Agent** dialog
  `POST`s a real agent and routes into the editor. Old localStorage-stub path removed.
- Card avatar (`VoxelAvatar`) respects `avatarSeed`.

### Full-page editor — `src/components/agents/agent-editor.tsx` at `/agents/[id]`
- Header: `Agents / {name}` + Live/Draft pill + **Save Changes** (only when dirty).
  (Scenarios/Versions/Dispatch buttons were removed.)
- Tab bar styled to match the **campaign page** (full-width grey bar, equal columns,
  uppercase + icons, amber active top-border).
- Right **Preview** panel (Voice/Chat only — SMS removed), voxel avatar + name + call
  widget. **Voice preview is live**: the green call button compiles the *draft*
  persona + knowledge (`POST /api/agents/[id]/preview`) and runs a real in-browser
  Gemini Live call via the reused `<VoiceTestPanel>` / `/voice-test-stream` bridge.
  (Chat preview is still "coming soon".)
- **Voxel avatar picker**: Avatar row → "Choose" popover of 12 orb variants → `avatarSeed`.
- Tabs today: **General** (identity rows w/ inline pencil-edit, language, background
  noise; Modalities incl. real inbound activate/pause; Guard Rails row), **Behavior**
  (Global Prompt + Opening message only), **Knowledge** (KB source picker over the
  agent's dataset, budget meter), **Security** (display), **Analysis** (decorative).

## Persisted vs decorative (in the editor)

- **Persisted (PATCH agent):** name, avatarSeed, role, language, Global Prompt
  (`systemPrompt`), Opening message (`firstMessage`), knowledge selection (`knowledgeIds`).
- **Real side-effect:** inbound activate/pause (Plivo number repoint); voice preview
  (real Gemini Live call over the draft persona + selected knowledge — ephemeral, not logged).
- **Decorative/local-only (not saved):** background noise, SMS/Web-Widget rows, Guard
  Rails row, Security tab, Analysis tab, Chat preview.

## Constraints / conventions honored
- Monochrome UI + existing `--brand-amber` for primary CTAs.
- All frontend calls via `apiFetch`. Clerk-protected routes.
- **Nothing committed** (standing instruction this session).

## Not done / next
- **Phase 2:** create-agent authoring UX depth; campaign wizard **references** an agent;
  campaigns stop embedding persona (touches the outbound send path).
- **Phase 3:** agent versioning (draft/published, pin at launch); two-slot numbers
  (`inbound_agent` / `outbound_agent`).
- Voice/model **picker** in the editor (voice row is display-only).
- **Manual agents** (no `primaryCampaignId`) can't be activated inbound yet — would need
  the number binding to accept a bare `agentId`.
- Pre-prod: `VOICE_ALLOW_UNSIGNED_WEBHOOKS=1` is local-only; must be OFF when deployed.
