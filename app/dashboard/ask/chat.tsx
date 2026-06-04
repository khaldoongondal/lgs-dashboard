'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';

interface SqlTrace {
  query:     string;
  rows?:     unknown[];
  rowCount?: number;
  error?:    string;
}

interface Turn {
  role:    'user' | 'assistant';
  content: string;
  trace?:  SqlTrace[];
  usage?:  { tokens_in: number; tokens_out: number; hops: number };
  error?:  string;
}

const STARTERS = [
  'Which ad has the highest close rate in the last 30 days?',
  'How much did we spend on Meta yesterday vs the day before?',
  'Which rep collected the most this month?',
  'Show me the funnel waterfall for the last 7 days.',
  'Which campaign drives clients with the longest tenure?',
];

export default function AskChat() {
  const [turns, setTurns]     = useState<Turn[]>([]);
  const [input, setInput]     = useState('');
  const [busy, setBusy]       = useState(false);
  const scroller              = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    const next: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns(next);
    setInput('');
    setBusy(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setTurns([...next, {
          role:    'assistant',
          content: '',
          error:   json.detail || json.error || `HTTP ${res.status}`,
          trace:   json.trace,
        }]);
      } else {
        setTurns([...next, {
          role:    'assistant',
          content: json.text || '',
          trace:   json.trace,
          usage:   json.usage,
        }]);
      }
    } catch (err) {
      setTurns([...next, {
        role:    'assistant',
        content: '',
        error:   err instanceof Error ? err.message : 'Request failed',
      }]);
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)]">
      <div ref={scroller} className="flex-1 overflow-y-auto pr-1">
        {turns.length === 0 ? (
          <Starters onPick={send} />
        ) : (
          <div className="space-y-4 max-w-3xl">
            {turns.map((t, i) => (
              <Bubble key={i} turn={t} />
            ))}
            {busy && <Thinking />}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-3 flex gap-2 max-w-3xl">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about your ads, leads, sales, or clients…"
          disabled={busy}
          className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="px-4 py-2 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-700 disabled:opacity-40"
        >
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </form>
    </div>
  );
}

function Starters({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="max-w-3xl">
      <h3 className="text-sm font-semibold text-slate-900 mb-2">Try a question</h3>
      <p className="text-xs text-slate-500 mb-4">
        I run read-only SQL against your data warehouse to answer. Every query I run is shown below the answer.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {STARTERS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="text-left text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 hover:border-slate-300"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] px-3 py-2 bg-brand text-white text-sm rounded-2xl rounded-br-sm whitespace-pre-wrap">
          {turn.content}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {turn.error ? (
        <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg">
          <div className="font-medium">Failed</div>
          <div className="text-xs mt-0.5 whitespace-pre-wrap">{turn.error}</div>
        </div>
      ) : (
        <div className="text-sm text-slate-900 whitespace-pre-wrap">{turn.content}</div>
      )}
      {turn.trace && turn.trace.length > 0 && <TraceList trace={turn.trace} />}
      {turn.usage && (
        <div className="text-[10px] uppercase tracking-wide text-slate-400">
          {turn.usage.hops} hop{turn.usage.hops === 1 ? '' : 's'} ·{' '}
          {turn.usage.tokens_in.toLocaleString()} in / {turn.usage.tokens_out.toLocaleString()} out
        </div>
      )}
    </div>
  );
}

function TraceList({ trace }: { trace: SqlTrace[] }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-slate-500 hover:text-slate-900 select-none">
        Show {trace.length} SQL {trace.length === 1 ? 'query' : 'queries'}
      </summary>
      <div className="mt-2 space-y-2">
        {trace.map((t, i) => (
          <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
            <pre className="bg-slate-50 px-3 py-2 text-[11px] text-slate-700 overflow-x-auto whitespace-pre-wrap">
              {t.query}
            </pre>
            <div className="px-3 py-1.5 text-[10px] border-t border-slate-200 bg-white">
              {t.error
                ? <span className="text-red-700">Error: {t.error}</span>
                : <span className="text-slate-500">{t.rowCount ?? 0} row{t.rowCount === 1 ? '' : 's'}</span>}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className="inline-block w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse" />
      <span className="inline-block w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse [animation-delay:150ms]" />
      <span className="inline-block w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse [animation-delay:300ms]" />
      <span className="ml-1">Working…</span>
    </div>
  );
}
