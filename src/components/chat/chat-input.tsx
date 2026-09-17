"use client";

import { useState } from "react";
import { ArrowUp, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ChatInput({
  busy,
  onSubmit,
  onStop,
}: {
  busy: boolean;
  onSubmit: (text: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const ready = value.trim().length > 0;

  function send() {
    const text = value.trim();
    if (!text || busy) return;
    onSubmit(text);
    setValue("");
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      className="shrink-0 border-t border-border bg-background/80 p-3 backdrop-blur sm:px-6 sm:py-4"
    >
      <label htmlFor="chat-input" className="sr-only">
        Your ingredients or a question about a recipe
      </label>

      {/* One object, not a field beside a button: the ring belongs to the whole
          composer, so focus reads as "you are writing" rather than "this box". */}
      <div className="flex items-center gap-2 rounded-xl border border-input bg-card py-1.5 pr-1.5 pl-3 transition-[border-color,box-shadow] duration-200 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40">
        {/* Editable while streaming so the next question can be typed. */}
        <Input
          id="chat-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="eggs, tomatoes, bread, cheddar…"
          autoComplete="off"
          className="h-9 flex-1 rounded-none border-0 bg-transparent px-0 text-base focus-visible:border-0 focus-visible:ring-0 md:text-base dark:bg-transparent"
        />

        {busy ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={onStop}
            className="size-9 shrink-0 rounded-lg"
          >
            <Square className="size-3 fill-current" aria-hidden />
            <span className="sr-only">Stop generating</span>
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!ready}
            // Grows into an affordance the moment there is something to send.
            className="size-9 shrink-0 rounded-lg transition-transform duration-200 disabled:scale-95"
          >
            <ArrowUp className="size-4" aria-hidden />
            <span className="sr-only">Send message</span>
          </Button>
        )}
      </div>
    </form>
  );
}
