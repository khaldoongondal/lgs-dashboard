/**
 * POST /api/ai/chat — Natural-language Q&A over the LGS data warehouse.
 *
 *   Body:    { messages: [{ role: 'user'|'assistant', content: string }, ...] }
 *   Returns: { ok, text, trace: [{ query, rows, error? }], usage }
 *
 * Calls OpenRouter (OpenAI-compatible) with a `run_sql` tool. The model loops
 * until it has enough data, then writes a final plain-English answer. Each SQL
 * call goes through the `lgs_exec_sql` Postgres RPC, which:
 *   - rejects anything that isn't SELECT or WITH
 *   - rejects multiple statements
 *   - caps results at 1000 rows
 *   - imposes a 10-second statement timeout
 *
 * Audit: every chat turn writes one row to ai_model_runs (run_type='chat').
 */

import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { serviceClient, maybeServiceClient } from '@/lib/supabase/server';
import { SCHEMA_REFERENCE } from '@/lib/ai/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_TOOL_HOPS  = 6;

type Role = 'system' | 'user' | 'assistant' | 'tool';
interface ChatMessage {
  role:          Role;
  content:       string | null;
  tool_calls?:   ToolCall[];
  tool_call_id?: string;
  name?:         string;
}
interface ToolCall {
  id:        string;
  type:      'function';
  function:  { name: string; arguments: string };
}
interface SqlTrace {
  query:     string;
  rows?:     unknown[];
  rowCount?: number;
  error?:    string;
}

function systemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `You are the LGS Growth Dashboard analyst. You answer questions about Meta ads, the GoHighLevel pipeline, sales reps, clients, and financials by running read-only SQL.`,
    ``,
    `Today's date is ${today} (UTC).`,
    ``,
    `RULES`,
    `1. Always use the run_sql tool to fetch data — never invent numbers.`,
    `2. Write Postgres SQL. SELECT or WITH only. One statement per call.`,
    `3. Prefer aggregate queries with explicit date ranges. Default range when the user is vague: last 30 days.`,
    `4. When asked "which X is best/worst", show top 5–10 with the relevant metrics — not raw rows.`,
    `5. Currency is CAD unless deal_value/currency says otherwise. Format money as $1,234.56.`,
    `6. Percentages: render as 12.3% (one decimal).`,
    `7. After your SQL calls, write a short plain-English answer. Lead with the punchline. Don't restate the SQL.`,
    `8. If a query returns no rows, say so — don't guess.`,
    `9. If a question can't be answered from the schema below, say "I can't answer that from the current data" and suggest what's missing.`,
    ``,
    `SCHEMA`,
    SCHEMA_REFERENCE,
  ].join('\n');
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'run_sql',
      description: 'Run a read-only Postgres query against the LGS data warehouse. Returns up to 1000 rows as JSON. SELECT and WITH only.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A single Postgres SELECT or WITH statement.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
];

async function runSql(query: string): Promise<{ rows?: unknown[]; error?: string }> {
  const sb = maybeServiceClient();
  if (!sb) return { error: 'Supabase not configured on the server.' };

  const { data, error } = await sb.rpc('lgs_exec_sql', { query });
  if (error) {
    return { error: error.message };
  }
  return { rows: Array.isArray(data) ? data : [] };
}

async function callOpenRouter(messages: ChatMessage[]): Promise<any> {
  const apiKey = env.openrouterApiKey();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization':   `Bearer ${apiKey}`,
      'Content-Type':    'application/json',
      'HTTP-Referer':    'https://leadder.io',
      'X-Title':         'LGS Growth Dashboard',
    },
    body: JSON.stringify({
      model: env.openrouterModel(),
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 500)}`);
  }
  return res.json();
}

export async function POST(req: Request) {
  if (!env.openrouterApiKey()) {
    return NextResponse.json(
      { ok: false, error: 'ai_not_configured', detail: 'Set OPENROUTER_API_KEY in env to enable Ask AI.' },
      { status: 503 },
    );
  }

  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const userMessages = (body.messages ?? []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
  );
  if (userMessages.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_messages' }, { status: 400 });
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt() },
    ...userMessages,
  ];

  const trace: SqlTrace[] = [];
  let totalIn = 0;
  let totalOut = 0;

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    let response: any;
    try {
      response = await callOpenRouter(messages);
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: 'upstream_error', detail: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }

    totalIn  += response.usage?.prompt_tokens     ?? 0;
    totalOut += response.usage?.completion_tokens ?? 0;

    const choice = response.choices?.[0];
    const msg    = choice?.message;
    if (!msg) {
      return NextResponse.json({ ok: false, error: 'empty_response' }, { status: 502 });
    }

    // Push the assistant turn into history (preserving tool_calls for OpenAI's loop)
    messages.push({
      role: 'assistant',
      content: msg.content ?? null,
      tool_calls: msg.tool_calls,
    });

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // Final answer
      const text = (msg.content ?? '').toString();

      // Audit (best-effort; ignore failures so chat keeps working)
      try {
        const sb = serviceClient();
        await sb.from('ai_model_runs').insert({
          run_type:     'chat',
          prompt:       userMessages[userMessages.length - 1]?.content ?? null,
          inputs:       { trace },
          raw_response: text,
          model:        env.openrouterModel(),
          tokens_in:    totalIn,
          tokens_out:   totalOut,
        });
      } catch {
        // swallow
      }

      return NextResponse.json({
        ok: true,
        text,
        trace,
        usage: { tokens_in: totalIn, tokens_out: totalOut, hops: hop + 1 },
      });
    }

    // Execute every tool call before looping back
    for (const tc of msg.tool_calls as ToolCall[]) {
      if (tc.function?.name !== 'run_sql') {
        messages.push({
          role:         'tool',
          tool_call_id: tc.id,
          name:         tc.function?.name,
          content:      JSON.stringify({ error: 'unknown_tool' }),
        });
        continue;
      }

      let args: { query?: string };
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }
      const query = (args.query || '').toString();

      const result = await runSql(query);
      const traceEntry: SqlTrace = {
        query,
        rows:     result.rows,
        rowCount: result.rows?.length,
        error:    result.error,
      };
      trace.push(traceEntry);

      messages.push({
        role:         'tool',
        tool_call_id: tc.id,
        name:         'run_sql',
        content:      JSON.stringify(result.error ? { error: result.error } : { rows: result.rows }),
      });
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: 'max_hops_exceeded',
      detail: `Model made ${MAX_TOOL_HOPS} tool calls without producing a final answer.`,
      trace,
    },
    { status: 504 },
  );
}
