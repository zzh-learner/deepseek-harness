/**
 * The `orbActivity` projection unit: mounting the plugin beside the
 * projection registry serves live activity folded from step boundaries,
 * chunks, tool pairs, and turn outcomes; replaying the same log reproduces
 * the same view (pure fold, persisted-cache precondition); unmounting the
 * plugin removes the key (HMR safety). Wall-clock-free semantics are pinned
 * here: outcomes are event-derived only, and in-flight state is swept at
 * turn end exactly when the turn's own events leave residue.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as OrbStatePlugin from '@deepseek-ai/dsh-orb-state'
import { orbActivityProjectionDefinition } from '@deepseek-ai/dsh-orb-state/src/projection.ts'
import type { OrbActivityProjection } from '@deepseek-ai/dsh-orb-state/types'

async function harness(withPlugin: boolean): Promise<{ ctx: Context; session: Session; orbFiber: object | null }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const orbFiber = withPlugin ? await ctx.plugin(OrbStatePlugin) : null
  return { ctx, session: ctx.sessions.create(SessionId('orbbed')), orbFiber }
}

/** The quiescent projection value plus overrides, for exact fold expectations. */
function activity(overrides: Partial<OrbActivityProjection> = {}): OrbActivityProjection {
  return { openTools: [], streaming: false, outcome: null, outcomeSeq: 0, ...overrides }
}

describe('orbActivity projection unit (registry drive)', () => {
  it('serves the quiescent value on the empty log', async () => {
    const { ctx, session } = await harness(true)
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity).toEqual(activity())
  })

  it('tracks streaming across the open step and clears it at the assembled message', async () => {
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'th' } })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity)
      .toEqual(activity({ streaming: true }))
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({ content: [], source: { provider: 'mock', model: 'mock' } }),
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity).toEqual(activity())
  })

  it('ignores chunks and messages from a foreign or closed step', async () => {
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('assistant/chunk', { turn: 1, step: 3, chunk: { type: 'text-delta', index: 0, text: 'x' } })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity).toEqual(activity())
    session.append('step/start', { turn: 1, step: 1 })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'x' } })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity).toEqual(activity())
    session.append('step/start', { turn: 1, step: 2 })
    session.append('assistant/message', {
      turn: 1,
      step: 9,
      message: createAssistantMessage({ content: [], source: { provider: 'mock', model: 'mock' } }),
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity).toEqual(activity())
  })

  it('holds streaming across a repeated chunk and drops it at a foreign message', async () => {
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } })
    // A second chunk on the same open step is reference-equal (no change feed).
    session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'b' } })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity)
      .toEqual(activity({ streaming: true }))
    // A message for a different step leaves the open step's flag alone.
    session.append('assistant/message', {
      turn: 1,
      step: 2,
      message: createAssistantMessage({ content: [], source: { provider: 'mock', model: 'mock' } }),
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity)
      .toEqual(activity({ streaming: true }))
  })

  it('treats a chunkless step message as no stream ever seen', async () => {
    // A pure tool-call step assembles its message without any delta chunk;
    // the fold keeps streaming false through both message arms.
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({ content: [], source: { provider: 'mock', model: 'mock' } }),
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity).toEqual(activity())
  })

  it('leaves a quiescent step/end as the same value', async () => {
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('step/end', { turn: 1, step: 1 })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity).toEqual(activity())
  })

  it('pairs tool calls with results by callId and keeps call order in the view', async () => {
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const callSeq = session.append('tool/call', { turn: 1, step: 1, callId: CallId('a'), name: 'web_search', arguments: '{}' }).seq
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('b'), name: 'edit', arguments: '{}' })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity)
      .toEqual(activity({ openTools: ['web_search', 'edit'] }))
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId: CallId('a'), content: [], isError: false }),
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity)
      .toEqual(activity({ openTools: ['edit'] }))
  })

  it('reads a prototype-named result on an unrecorded call as unmatched', async () => {
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const callSeq = session.append('tool/call', { turn: 1, step: 1, callId: CallId('real'), name: 'read', arguments: '{}' }).seq
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId: CallId('constructor'), content: [], isError: false }),
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity)
      .toEqual(activity({ openTools: ['read'] }))
  })

  it('sweeps in-flight residue and records the outcome at turn end', async () => {
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'x' } })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('gone'), name: 'bash', arguments: '{}' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity)
      .toEqual(activity({ outcome: 'settle', outcomeSeq: 1 }))
    session.append('turn/start', { turn: 2 })
    session.append('turn/end', { turn: 2, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity)
      .toEqual(activity({ outcome: 'error', outcomeSeq: 2 }))
  })

  it('settles aborted and blocked turns as no outcome and bumps no counter', async () => {
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'legacy' } } })
    session.append('turn/start', { turn: 2 })
    session.append('turn/end', { turn: 2, reason: { kind: 'blocked' } })
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity).toEqual(activity())
  })

  it('is unaffected by compositions without the plugin and removes its key on unload (HMR safety)', async () => {
    const without = await harness(false)
    expect(without.ctx.sessionProjections.snapshot(without.session).values.orbActivity).toBeUndefined()
    await without.ctx.fiber.dispose()

    const { ctx, session, orbFiber } = await harness(true)
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity).toBeDefined()
    await (orbFiber as { dispose(): Promise<void> }).dispose()
    expect(ctx.sessionProjections.snapshot(session).values.orbActivity).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

describe('orbActivity fold purity (definition drive)', () => {
  /** One turn that streams, calls two tools, settles one, and completes. */
  function* sampleLog(): Generator<SessionEvent> {
    let seq = 0
    const next = { get seq() { return seq++ } }
    yield { type: 'turn/start', ...next, time: 1, data: { turn: 1 } } as SessionEvent
    yield { type: 'step/start', ...next, time: 2, data: { turn: 1, step: 1 } } as SessionEvent
    yield { type: 'assistant/chunk', ...next, time: 3, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'x' } } } as SessionEvent
    yield { type: 'assistant/message', ...next, time: 4, data: { turn: 1, step: 1, message: createAssistantMessage({ content: [], source: { provider: 'mock', model: 'mock' } }) } } as SessionEvent
    yield { type: 'tool/call', ...next, time: 5, data: { turn: 1, step: 1, callId: CallId('a'), name: 'write', arguments: '{}' } } as SessionEvent
    yield { type: 'tool/result', ...next, time: 6, data: { turn: 1, step: 1, message: createToolResultMessage({ callId: CallId('a'), content: [], isError: false }) } } as SessionEvent
    yield { type: 'turn/end', ...next, time: 7, data: { turn: 1, reason: { kind: 'completed' } } } as SessionEvent
  }

  it('replays to the same view from the initial state', () => {
    let state = orbActivityProjectionDefinition.init()
    for (const event of sampleLog()) state = orbActivityProjectionDefinition.apply(state, event)
    expect(orbActivityProjectionDefinition.view(state))
      .toEqual(activity({ outcome: 'settle', outcomeSeq: 1 }))
    // A persisted cache replays the identical bytes: the fold is a pure
    // function of (state, event), never of wall time.
    let replay = orbActivityProjectionDefinition.init()
    for (const event of sampleLog()) replay = orbActivityProjectionDefinition.apply(replay, event)
    expect(orbActivityProjectionDefinition.view(replay))
      .toEqual(orbActivityProjectionDefinition.view(state))
  })
})
