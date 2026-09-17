"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

// react-markdown hands every component the AST node it came from. That is useful for
// nothing here and must not reach the DOM, so it is stripped before the props spread.
function clean<P extends { node?: unknown }>(props: P): Omit<P, "node"> {
  const rest = { ...props };
  delete rest.node;
  return rest;
}

// One component map for every answer, so a heading looks the same wherever it lands.
// Headings inside an answer are the assistant organising its own reply, so they
// stay in the interface voice. Only quoted cookbook content goes serif.
const HEADING = "mt-5 mb-1.5 text-base font-semibold break-words first:mt-0";

const components: Components = {
  h1: (props) => <h3 className={HEADING} {...clean(props)} />,
  h2: (props) => <h3 className={HEADING} {...clean(props)} />,
  h3: (props) => <h4 className={HEADING} {...clean(props)} />,
  h4: (props) => (
    <h5 className="mt-4 mb-1 text-sm font-semibold first:mt-0" {...clean(props)} />
  ),
  p: (props) => <p className="my-2 first:mt-0 last:mb-0" {...clean(props)} />,
  ul: (props) => (
    <ul
      className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground"
      {...clean(props)}
    />
  ),
  ol: (props) => (
    <ol
      className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground"
      {...clean(props)}
    />
  ),
  li: (props) => <li className="pl-0.5" {...clean(props)} />,
  strong: (props) => <strong className="font-semibold" {...clean(props)} />,
  a: (props) => (
    <a
      className="font-medium underline underline-offset-2 transition-colors hover:text-primary"
      target="_blank"
      rel="noopener noreferrer"
      {...clean(props)}
    />
  ),
  blockquote: (props) => (
    <blockquote
      className="my-3 border-l-2 border-primary/40 pl-3 italic text-muted-foreground"
      {...clean(props)}
    />
  ),
  hr: (props) => <hr className="my-4 border-border" {...clean(props)} />,
  // The only element allowed to scroll sideways.
  table: (props) => (
    <div className="my-3 overflow-x-auto rounded-lg ring-1 ring-border">
      <table
        className="w-full min-w-[28rem] border-collapse text-sm"
        {...clean(props)}
      />
    </div>
  ),
  thead: (props) => <thead className="bg-muted/70" {...clean(props)} />,
  tr: (props) => (
    <tr className="border-t border-border first:border-t-0" {...clean(props)} />
  ),
  th: (props) => <th className="px-3 py-2 text-left font-medium" {...clean(props)} />,
  td: (props) => <td className="px-3 py-2 align-top" {...clean(props)} />,
  code: ({ className, ...props }) => (
    <code
      className={cn(
        "rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]",
        className,
      )}
      {...clean(props)}
    />
  ),
  pre: (props) => (
    <pre
      className="my-3 overflow-x-auto rounded-lg bg-foreground/5 p-3 text-xs [&>code]:bg-transparent [&>code]:p-0"
      {...clean(props)}
    />
  ),
};

function MarkdownImpl({ children }: { children: string }) {
  return (
    <div className="text-[0.95rem] leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

// A streaming answer re-renders the whole transcript on every token; memo keeps the
// markdown of the older messages from being re-parsed each time.
export const Markdown = memo(MarkdownImpl);
