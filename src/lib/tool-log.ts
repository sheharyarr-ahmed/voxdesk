// The single choke point for both tool routes, SPEC.md section 4.2.
//
// It enforces, in this order: shared secret verification, Zod parse of input,
// the 3s budget, Zod parse of output, and the tool_invocations write. A tool
// route that bypasses it fails review.
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import {
  ConversationAnchor,
  TOOL_FALLBACK,
  TOOL_SCHEMAS,
  TOOL_TIMEOUT,
  type ToolInput,
  type ToolName,
  type ToolOutput,
} from '@/lib/schemas';
import { verifyToolSecret } from '@/lib/verify-hmac';

// SPEC.md section 6.2 gives the route 3s and the Cal.com fetch 2500ms. This
// backstop only fires when a handler hangs somewhere other than that fetch, and
// it leaves roughly 200ms for the log write and serialisation.
const HANDLER_BUDGET_MS = 2800;

const BUDGET_EXCEEDED = Symbol('tool.budget_exceeded');

/**
 * Renders Zod issues without going through z.treeifyError. Because `name` is
 * generic, TOOL_SCHEMAS[name] is a union of two schema types, and so is the
 * resulting ZodError. Zod's helpers are invariant in that type parameter and
 * reject the union. Reading .issues directly is structural and sidesteps it.
 */
function describeIssues(error: { issues: readonly z.core.$ZodIssue[] }): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function recordInvocation(a: {
  elConversationId: string | null;
  toolName: ToolName;
  request: unknown;
  response: unknown;
  latencyMs: number;
  statusCode: number;
}): Promise<void> {
  // No conversation_id means no foreign key anchor and therefore no row. This is
  // the only path other than 401 that writes nothing.
  if (a.elConversationId === null) return;

  try {
    // One statement, one round trip. SPEC.md section 5.1 writes DO NOTHING, but
    // DO NOTHING returns no row on conflict, so resolving the id would need a
    // second round trip or a fallback SELECT that reads the same MVCC snapshot
    // and comes back empty when a concurrent transaction has inserted but not
    // committed, producing a NULL and a not null violation on the foreign key.
    // The no op DO UPDATE always returns the row and takes the row lock that
    // serialises the race. It never modifies the row. Deviation 7.
    await db.execute(sql`
      WITH upserted AS (
        INSERT INTO conversations (el_conversation_id, status)
        VALUES (${a.elConversationId}, 'in_progress')
        ON CONFLICT (el_conversation_id)
          DO UPDATE SET status = conversations.status
        RETURNING id
      )
      INSERT INTO tool_invocations
        (conversation_id, tool_name, request_payload, response_payload, latency_ms, status_code)
      SELECT
        upserted.id,
        ${a.toolName},
        ${JSON.stringify(a.request)}::jsonb,
        ${JSON.stringify(a.response)}::jsonb,
        ${a.latencyMs},
        ${a.statusCode}
      FROM upserted
    `);
  } catch (error) {
    // Observability must never take down the call it is observing.
    console.error(`[tool:${a.toolName}] tool_invocations write failed`, error);
  }
}

/**
 * SPEC.md section 4.2 declares withToolLogging<I, O>(name, handler). The
 * declared signature takes no schemas, yet the choke point must parse both
 * directions. The registry in schemas.ts is keyed by the tool name literal, so
 * `name` selects the schemas and the input type is computed from N rather than
 * being a free type parameter. That removes the cast that a free I would
 * otherwise need at exactly the point where runtime validation meets the type
 * system. Runtime signature, arity and every call site are unchanged.
 * Deviation 6.
 */
export function withToolLogging<N extends ToolName, O extends ToolOutput<N> = ToolOutput<N>>(
  name: N,
  handler: (input: ToolInput<N>) => Promise<O>,
): (req: Request) => Promise<Response> {
  const schemas = TOOL_SCHEMAS[name];

  return async function handleToolRequest(req: Request): Promise<Response> {
    const startedAt = performance.now();

    // 1. Shared secret. The body is not read, parsed or logged before this
    //    passes, and a failure writes nothing to the database.
    if (!verifyToolSecret(req.headers.get('x-vd-tool-secret'), env.TOOL_SHARED_SECRET)) {
      return jsonResponse(401, { ok: false, reason: 'unauthorized' });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(await req.text());
    } catch {
      return jsonResponse(400, { ok: false, reason: 'invalid_json' });
    }

    const anchor = ConversationAnchor.safeParse(payload);
    const elConversationId = anchor.success ? anchor.data.conversation_id : null;

    // The clock stops when the body is decided, before the log write, so
    // latency_ms measures what the agent waited and never its own insertion.
    const finish = async (statusCode: number, body: unknown): Promise<Response> => {
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      // Awaited rather than deferred. The SPEC.md section 11.2 gate asserts row
      // existence immediately after two curls, and after() would make that a
      // race. The cost is one round trip to a database in the same region.
      await recordInvocation({
        elConversationId,
        toolName: name,
        request: payload,
        response: body,
        latencyMs,
        statusCode,
      });
      return jsonResponse(statusCode, body);
    };

    // 2. Input parse.
    const input = schemas.input.safeParse(payload);
    if (!input.success) {
      return finish(400, {
        ok: false,
        reason: 'invalid_input',
        issues: describeIssues(input.error),
      });
    }

    // 3. Budget.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: O | typeof BUDGET_EXCEEDED;
    try {
      outcome = await Promise.race([
        handler(input.data as ToolInput<N>),
        new Promise<typeof BUDGET_EXCEEDED>((resolve) => {
          timer = setTimeout(() => resolve(BUDGET_EXCEEDED), HANDLER_BUDGET_MS);
        }),
      ]);
    } catch (error) {
      console.error(`[tool:${name}] handler threw`, error);
      return finish(200, TOOL_FALLBACK[name]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    if (outcome === BUDGET_EXCEEDED) {
      console.error(`[tool:${name}] handler exceeded ${HANDLER_BUDGET_MS}ms`);
      return finish(200, TOOL_TIMEOUT[name]);
    }

    // 4. Output parse. A handler bug must not put an unvalidated body in front of
    //    the agent, because the agent reads whatever is there out loud.
    const output = schemas.output.safeParse(outcome);
    if (!output.success) {
      console.error(`[tool:${name}] output rejected by schema`, describeIssues(output.error));
      return finish(200, TOOL_FALLBACK[name]);
    }

    // status_code is the status THIS route put on the wire, never Cal.com's. On
    // the timeout path it is 200, because section 4.1 requires a structured 200
    // so the agent reads our sentence instead of improvising. The failure mode
    // is carried by response_payload.reason.
    return finish(200, output.data);
  };
}
