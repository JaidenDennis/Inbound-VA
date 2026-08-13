'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Sparkles, X, Send, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import { useSession } from '@/lib/SessionProvider';
import {
  useAssistantChat,
  CLIENT_PROMPTS,
  STAFF_PROMPTS,
  TOOL_LABELS,
} from '@/lib/useAssistantChat';

/**
 * The assistant as a panel over the page, not a page of its own.
 *
 * Navigating away from the report you are reading in order to ask a question
 * about it is exactly backwards: the thing you wanted to ask about is now
 * gone. So this opens as a column on the right, the page stays where it was
 * and stays readable, and the conversation survives moving between routes —
 * it is mounted in the dashboard layout, which Next keeps alive across
 * navigations within the segment.
 *
 * Consequences that follow from that and are worth stating:
 *   - The nav's "Assistant" entry OPENS this rather than navigating. Same
 *     control, no page change.
 *   - The thread is not cleared by navigation. Asking about Reports, moving to
 *     Calls, and asking a follow-up is a normal thing to do.
 *   - It is a sliver, not a takeover. If it covered the page it would be a
 *     page, and we would be back where we started.
 */

interface AssistantContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

/** Lets the rail (or anything else) open the panel without owning its state. */
export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) {
    throw new Error('useAssistant must be used inside <AssistantProvider>');
  }
  return ctx;
}

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const value = useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);

  return (
    <AssistantContext.Provider value={value}>
      {children}
      <AssistantPanel />
    </AssistantContext.Provider>
  );
}

function AssistantPanel() {
  const { open, setOpen } = useAssistant();
  const { isPlatform } = useSession();
  // Read from the URL rather than useClientScope: this is mounted in the
  // layout, above any page's picker, and must not require one to exist.
  const [clientId, setClientId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { turns, sending, enabled, error, send, reset } = useAssistantChat(clientId);

  // The panel outlives navigation, so the tenant it is scoped to has to follow
  // the URL rather than being captured once when it opened.
  useEffect(() => {
    const read = () =>
      setClientId(new URLSearchParams(window.location.search).get('clientId'));
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, sending]);

  const prompts = isPlatform ? STAFF_PROMPTS : CLIENT_PROMPTS;

  const submit = () => {
    const text = input;
    setInput('');
    void send(text);
  };

  return (
    <>
      {/* Launcher. Hidden while open so it cannot sit on top of the panel. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the assistant"
          className={clsx(
            'fixed bottom-5 right-5 z-30 flex items-center gap-2',
            'border border-action bg-action px-4 py-3 text-sm font-medium',
            'text-[rgb(var(--action-contrast-rgb))] shadow-cobalt-sm',
            'transition-colors duration-150 hover:bg-transparent hover:text-action',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2'
          )}
        >
          <Sparkles className="h-4 w-4 text-current" aria-hidden strokeWidth={1.75} />
          <span className="hidden sm:inline">Assistant</span>
        </button>
      )}

      {/* No scrim on desktop: the point is that the page stays readable while
          you ask about it. On a phone there is not room for both, so the panel
          takes the width and a scrim explains why the page stopped responding. */}
      {open && (
        <button
          type="button"
          aria-label="Close the assistant"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 cursor-default bg-scrim sm:hidden"
        />
      )}

      <aside
        aria-label="Assistant"
        aria-hidden={!open}
        className={clsx(
          'fixed inset-y-0 right-0 z-40 flex w-full flex-col sm:w-[26rem]',
          'border-l border-edge bg-surface-raised shadow-xl',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'pointer-events-none translate-x-full'
        )}
      >
        <header className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <Sparkles className="h-4 w-4 flex-shrink-0 text-action" aria-hidden strokeWidth={1.75} />
          <p className="flex-1 font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
            Assistant
          </p>
          {turns.length > 0 && (
            <button
              type="button"
              onClick={reset}
              aria-label="Start a new conversation"
              className="flex h-8 w-8 cursor-pointer items-center justify-center text-text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              <RotateCcw className="h-4 w-4" aria-hidden strokeWidth={1.75} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close the assistant"
            className="flex h-8 w-8 cursor-pointer items-center justify-center text-text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            <X className="h-4 w-4" aria-hidden strokeWidth={1.75} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {enabled === false ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-text">The assistant isn&apos;t switched on</p>
              <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-text-muted">
                An <code className="font-mono">ANTHROPIC_API_KEY</code> needs to be set on the API
                service.
              </p>
            </div>
          ) : turns.length === 0 ? (
            <div>
              <p className="text-sm leading-relaxed text-text-secondary">
                Ask about your calls, bookings, or how the agent is doing. The page behind stays
                open, so you can read and ask at the same time.
              </p>
              <ul className="mt-4 space-y-1.5">
                {prompts.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      onClick={() => void send(p)}
                      className="w-full cursor-pointer border border-hairline px-3 py-2.5 text-left text-xs leading-relaxed text-text-secondary transition-colors duration-150 hover:border-action hover:bg-action-50 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul className="space-y-4">
              {turns.map((turn, i) => (
                <li key={i}>
                  <p className="mb-1 font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
                    {turn.role === 'user' ? 'You' : 'Assistant'}
                  </p>
                  <div
                    className={clsx(
                      'whitespace-pre-wrap px-3 py-2.5 text-sm leading-relaxed',
                      turn.role === 'user'
                        ? 'border-l-2 border-action bg-action-50 text-text'
                        : 'border border-hairline bg-surface text-text'
                    )}
                  >
                    {turn.content}
                  </div>
                  {/* What it looked at, so an answer can be checked rather than
                      taken on trust. */}
                  {turn.consulted && turn.consulted.length > 0 && (
                    <p className="mt-1 text-2xs text-text-muted">
                      Consulted:{' '}
                      {turn.consulted.map((t) => TOOL_LABELS[t] ?? t).join(', ')}
                    </p>
                  )}
                </li>
              ))}
              {sending && (
                <li className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
                  Thinking…
                </li>
              )}
            </ul>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 border border-lamp-bad-rim bg-lamp-bad-wash px-3 py-2.5 text-xs text-lamp-bad-ink"
            >
              {error}
            </p>
          )}

          <div ref={endRef} />
        </div>

        {enabled !== false && (
          <div className="border-t border-hairline p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter is a newline. A chat box that
                  // needs a mouse click to send is a chat box people abandon.
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Ask about this page, or anything else…"
                className="min-h-[3.5rem] flex-1 resize-none border border-rule bg-surface px-3 py-2 text-sm text-text transition-colors placeholder:text-text-muted focus:border-action focus:outline-none focus:ring-2 focus:ring-action/25"
              />
              <button
                type="button"
                onClick={submit}
                disabled={sending || !input.trim()}
                aria-label="Send"
                className="flex h-[3.5rem] w-11 flex-shrink-0 cursor-pointer items-center justify-center border border-action bg-action text-[rgb(var(--action-contrast-rgb))] transition-colors duration-150 hover:bg-transparent hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:cursor-not-allowed disabled:border-rule disabled:bg-transparent disabled:text-text-muted"
              >
                <Send className="h-4 w-4 text-current" aria-hidden strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
