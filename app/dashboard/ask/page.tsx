import PageShell from '@/components/page-shell';
import EmptyState from '@/components/empty-state';
import { resolveRange } from '@/lib/date-range';
import { envStatus } from '@/lib/env';
import AskChat from './chat';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function AskPage() {
  const range = resolveRange({});
  const { aiChat } = envStatus();

  return (
    <PageShell
      current="/dashboard/ask"
      title="Ask AI"
      subtitle="Natural-language Q&A across ads, leads, sales, and clients"
      range={range}
      showDatePicker={false}
    >
      {aiChat ? (
        <AskChat />
      ) : (
        <EmptyState
          title="OpenRouter API key not set"
          description="Add OPENROUTER_API_KEY to your environment to enable chat. Optional: OPENROUTER_MODEL (defaults to anthropic/claude-sonnet-4.5)."
        />
      )}
    </PageShell>
  );
}
