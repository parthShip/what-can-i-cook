"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowDown, ChefHat, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ChatEmptyState } from "@/components/chat/chat-empty-state";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessage, messageText } from "@/components/chat/chat-message";
import { RetrievalStatus } from "@/components/chat/retrieval-status";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatMessage as ChatMessageType } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

// One transport for the module: a fresh instance per render buys nothing and makes
// every child prop unstable.
const transport = new DefaultChatTransport({ api: "/api/chat" });

// How close to the bottom still counts as "following the answer".
const FOLLOW_THRESHOLD_PX = 80;

export function ChatPanel() {
  const endRef = useRef<HTMLDivElement>(null);
  // Whether the view should follow new content. Kept in a ref so the scroll
  // listener never triggers a render.
  const followRef = useRef(true);
  // The same fact, but rendered: the button back down only exists when it is
  // useful. Updated from the listener only when it actually flips.
  const [following, setFollowing] = useState(true);

  const { messages, sendMessage, setMessages, status, error, stop } =
    useChat<ChatMessageType>({ transport });

  const busy = status === "submitted" || status === "streaming";

  // Covers the whole pre-token window, including a stream that has its sources but
  // no text yet — which is exactly the retrieve-then-generate split shown below.
  const last = messages[messages.length - 1];
  const waiting = busy && (last?.role !== "assistant" || !messageText(last).trim());
  const retrieved =
    last?.role === "assistant" ? (last.metadata?.sources?.length ?? 0) : 0;
  const retrievalDone = last?.role === "assistant" && last.metadata !== undefined;

  const viewport = () =>
    endRef.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]') ??
    null;

  // A reader who has scrolled up to re-read a recipe should stay there, so the
  // transcript only follows the stream while they are already at the bottom.
  useEffect(() => {
    const element = viewport();
    if (!element) return;

    const onScroll = () => {
      const distance =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      const next = distance < FOLLOW_THRESHOLD_PX;
      if (next !== followRef.current) {
        followRef.current = next;
        setFollowing(next);
      }
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (followRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  const scrollToLatest = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  // Stable, so a streaming token does not invalidate every memoised message below.
  const submit = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value || busy) return;
      // Sending always returns to the bottom: the person asked, so they want to
      // see the answer, wherever they had scrolled to.
      followRef.current = true;
      setFollowing(true);
      // No temperature is sent; the route derives it from this text.
      sendMessage({ text: value });
    },
    [busy, sendMessage],
  );

  // Drops the transcript only; the knowledge base is untouched. Recoverable,
  // because losing a recipe you were halfway through cooking is a bad surprise.
  const clearConversation = useCallback(() => {
    const previous = messages;
    setMessages([]);
    toast("Conversation cleared", {
      action: {
        label: "Undo",
        onClick: () => setMessages(previous),
      },
    });
  }, [messages, setMessages]);

  // `chat-shell` (globals.css) pins the three regions: the header and composer are
  // sized by their content and the transcript takes exactly what is left.
  return (
    <Card className="chat-shell mx-auto w-full max-w-3xl gap-0 rounded-2xl py-0 shadow-xl shadow-foreground/5">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-linear-to-r from-primary/12 via-accent/70 to-transparent px-4 py-3 sm:px-6 sm:py-4">
        {/* The mark is the first thing to go on a narrow screen: the same chef
            hat is already on every answer below, and the header has three
            controls to fit. The claim goes with it — the empty state states it
            in full, and truncating a promise is worse than not making it here. */}
        <div className="hidden size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/25 sm:grid">
          <ChefHat className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-lg leading-tight font-semibold tracking-tight [font-variation-settings:'SOFT'_20] sm:text-xl">
            What can I cook?
          </h1>
          <p className="hidden truncate text-sm text-muted-foreground sm:block">
            2,000 real recipes. Nothing invented.
          </p>
        </div>

        <ThemeToggle />

        <Button
          variant="ghost"
          size="sm"
          onClick={clearConversation}
          disabled={busy || messages.length === 0}
          className="h-7 gap-1.5 text-xs"
        >
          <Trash2 className="size-3.5" aria-hidden />
          <span className="sr-only sm:not-sr-only">Clear</span>
        </Button>
      </header>

      <div className="relative min-h-0">
        <ScrollArea className="h-full overscroll-contain px-3 sm:px-6">
          <div
            className={cn(
              "space-y-6 py-6",
              // An empty transcript centres itself rather than clinging to the top.
              messages.length === 0 && "flex min-h-full flex-col justify-center",
            )}
          >
            {messages.length === 0 && (
              <ChatEmptyState onSelect={submit} disabled={busy} />
            )}

            {messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                streaming={busy && index === messages.length - 1}
                showFollowUps={!busy && index === messages.length - 1}
                onSelect={submit}
                disabled={busy}
              />
            ))}

            {waiting && (
              <RetrievalStatus
                phase={retrievalDone ? "found" : "searching"}
                recipeCount={retrieved}
              />
            )}

            {error && (
              <p
                role="alert"
                className="turn-in rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/20"
              >
                {error.message?.trim() || "Something went wrong. Please try again."}
              </p>
            )}

            <div ref={endRef} />
          </div>
        </ScrollArea>

        {/* Only rendered once it has something to do, so it never covers the
            answer it is offering to take you to. */}
        {!following && messages.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={scrollToLatest}
            className="animate-in fade-in slide-in-from-bottom-2 absolute inset-x-0 bottom-3 mx-auto w-fit gap-1.5 rounded-full px-3 shadow-md ring-1 ring-foreground/10 duration-200"
          >
            <ArrowDown className="size-3.5" aria-hidden />
            Latest
          </Button>
        )}
      </div>

      <ChatInput busy={busy} onSubmit={submit} onStop={stop} />
    </Card>
  );
}
