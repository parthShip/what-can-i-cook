"use client";

import { memo, useMemo } from "react";
import { ChefHat } from "lucide-react";

import { Markdown } from "@/components/chat/markdown";
import { NoMatchNotice } from "@/components/chat/no-match-notice";
import { RetrievalSources } from "@/components/chat/retrieval-sources";
import { SuggestedQuestions } from "@/components/chat/suggested-questions";
import { RecipeCard } from "@/components/recipe/recipe-card";
import { RecipeComparisonTable } from "@/components/recipe/recipe-comparison-table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { ChatMessage as ChatMessageType } from "@/lib/chat-types";
import { followUpsFor, isRefusal, mentionedSources } from "@/lib/recipe-display";
import { cn } from "@/lib/utils";

// The message's text parts joined into one markdown string.
export function messageText(message: ChatMessageType): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function ChatMessageImpl({
  message,
  streaming,
  showFollowUps,
  onSelect,
  disabled,
}: {
  message: ChatMessageType;
  // Tokens are still arriving into this message.
  streaming: boolean;
  // Only the newest finished answer offers next questions.
  showFollowUps: boolean;
  onSelect: (text: string) => void;
  disabled?: boolean;
}) {
  const isUser = message.role === "user";
  // Metadata lands before the first token, so a message can have sources and no text.
  const text = messageText(message);
  // Kept stable: the fallback `[]` would otherwise be a new array on every token.
  const sources = useMemo(() => message.metadata?.sources ?? [], [message.metadata]);

  const refused = isRefusal(text);
  // Which retrieved recipes the answer actually recommends. The names are read from
  // the answer; every field on the card below still comes from the retrieved row.
  // Recomputed per token while streaming, so it stays cheap and memo-stable after.
  const recommended = useMemo(
    () => (refused ? [] : mentionedSources(text, sources)),
    [refused, text, sources],
  );
  const followUps = useMemo(() => followUpsFor(recommended), [recommended]);

  return (
    // Mounting is the only time this runs: a token arriving re-renders the
    // message but does not remount it, so the entrance never replays mid-answer.
    <div className={cn("turn-in flex gap-0 sm:gap-3", isUser && "flex-row-reverse")}>
      {/* Hidden on phones: a 44px gutter is a sixth of the screen, and the
          recipe cards need it more than the transcript needs a second cue —
          the user's turn is already right-aligned and on its own ground. */}
      <Avatar className="hidden size-8 shrink-0 sm:flex">
        <AvatarFallback
          className={cn(
            "text-xs",
            isUser
              ? "bg-secondary text-secondary-foreground"
              : "bg-primary text-primary-foreground",
          )}
        >
          {isUser ? "You" : <ChefHat className="size-4" aria-hidden />}
        </AvatarFallback>
      </Avatar>

      {/* The assistant takes the full column: cards and tables need the width. */}
      <div className={cn("min-w-0 space-y-3", isUser ? "max-w-[85%]" : "flex-1")}>
        {isUser ? (
          text.trim() && (
            <div className="rounded-2xl rounded-tr-sm bg-secondary px-4 py-3 text-base leading-relaxed break-words text-secondary-foreground">
              {text}
            </div>
          )
        ) : (
          <>
            {!refused && sources.length > 0 && (
              <RetrievalSources sources={sources} />
            )}

            {refused ? (
              <NoMatchNotice onSelect={onSelect} disabled={disabled} />
            ) : (
              text.trim() && (
                <div
                  className={cn(
                    "rounded-2xl rounded-tl-sm bg-muted px-4 py-3",
                    // A caret on the last line, so a paused stream still looks
                    // like it is being written rather than finished and truncated.
                    streaming && "[&>div>p:last-child]:token-caret",
                  )}
                >
                  <Markdown>{text}</Markdown>
                </div>
              )
            )}

            {recommended.length >= 2 && (
              <RecipeComparisonTable sources={recommended} />
            )}

            {recommended.length > 0 && (
              <div className="space-y-3">
                {recommended.map((source) => (
                  <RecipeCard key={source.slug} source={source} />
                ))}
              </div>
            )}

            {showFollowUps && !refused && (
              <SuggestedQuestions
                followUps={followUps}
                onSelect={onSelect}
                disabled={disabled}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Only the streaming message changes between tokens; the rest of the transcript,
// cards and all, should not re-render with it.
export const ChatMessage = memo(ChatMessageImpl);
