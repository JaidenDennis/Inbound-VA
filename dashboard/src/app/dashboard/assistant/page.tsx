'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { useAssistant } from '@/components/AssistantPanel';

/**
 * The assistant used to be this page. It is now a panel that opens over
 * whatever you are looking at, because navigating away from the report you
 * wanted to ask about is exactly backwards.
 *
 * The route is kept — bookmarks and old links exist — but it holds no chat UI
 * of its own. A second implementation of the conversation would drift from the
 * panel's the first time either was touched, and the panel is the one people
 * will actually use.
 *
 * Landing here opens the panel and says what happened, rather than silently
 * bouncing somewhere else.
 */
export default function AssistantPage() {
  const { setOpen } = useAssistant();

  useEffect(() => {
    setOpen(true);
  }, [setOpen]);

  return (
    <div className="max-w-2xl">
      <PageHeader
        eyebrow="Assistant"
        title="The assistant opens alongside your work"
        description="It is now a panel rather than a page, so you can read a report and ask about it at the same time."
      />

      <div className="border border-hairline bg-surface-raised px-5 py-6">
        <Sparkles className="mb-3 h-5 w-5 text-action" aria-hidden strokeWidth={1.75} />
        <p className="text-sm leading-relaxed text-text-secondary">
          It should have opened on the right. If you closed it, use the Assistant button in the
          bottom corner, or the Assistant entry in the menu — both open it wherever you are, and
          your conversation follows you between pages.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-block text-sm text-action underline decoration-action/40 underline-offset-2 transition-colors hover:decoration-action"
        >
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
