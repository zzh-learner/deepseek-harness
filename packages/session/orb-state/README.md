# @deepseek-ai/dsh-orb-state

English | [中文](README.zh.md)

Function plugin registering the `orbActivity` projection unit: live per-session activity for the thinking-orb background — in-flight tool names, the open step's streaming bit, and distinct turn outcomes — folded from step boundaries, stream chunks, tool pairs, and turn ends, and served through the session-projection seam (registry snapshot, change feed, and every projection carrier). The reference consumer is the web `ui-orbs` background, which combines this value with session-list facts (running bits, pending interactions, lineage) into its animation state; the fold itself carries no wall clock, so a replayed cache reproduces the exact live value.

## Fold semantics

- `openTools` lists `tool/call` names whose `tool/result` has not landed, in call order; results pair by callId with an own-key check (callId is model-minted JSON, so a prototype property name on an unrecorded result reads as unmatched). `turn/end` sweeps any residue a cancelled or failed turn leaves behind — results land within their turn.
- `streaming` is the open step's chunk flag: set by any `assistant/chunk` belonging to that step, cleared by its assembled `assistant/message` (the step keeps running through its tool calls) and by `step/end`. Chunks from a foreign or closed step are ignored.
- `outcome` records `turn/end` reasons worth an animation: `completed` → `settle`, `error` (the structured `LlmFailure` kind) → `error`; aborted, blocked, max-tokens, and crash-closed turns settle as null. `outcomeSeq` counts non-null outcomes monotonically so clients edge-trigger animations without comparing payloads.
- Every field is event-derived; clients own all timing (outcome windows, streaming recency) against their own clocks.

## Composition

```yaml
- id: orb-state
  name: '@deepseek-ai/dsh-orb-state'
```

Injects `sessionProjections` — the plugin's whole purpose; in assemblies without the registry the fiber stays pending and nothing registers.

## Model Experience

None, as the plugin only computes a client-facing read model of already-logged session events and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **In-flight state is per-log, not per-window** — `openTools` and `streaming` describe the whole session's live turn only; a client paging older history never sees stale in-flight values because the fold state is the log tail by construction.
- **Outcome granularity is coarse** — `max-tokens` turns settle as null (the usage-host message already renders its own notice); a future surface wanting a distinct max-tokens animation extends the outcome union with a cache-compatible `stateVersion` bump.
- **Mounted only in the web-app bundle** — other assemblies serve no `orbActivity` key, and consumers fall back to session-list facts alone (running bits, pending interactions).
