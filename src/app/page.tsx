import { ChatPanel } from "@/components/chat-panel";

export default function Home() {
  // Exactly one scrollable region on the screen: the page itself must not scroll,
  // or the transcript's own scrollbar ends up as the second one.
  return (
    <main className="relative flex min-h-0 flex-1 flex-col justify-center p-3 sm:p-6">
      {/* A single wash behind the panel, warm at the top where the masthead sits.
          Decorative, so it is hidden from the accessibility tree and never
          intercepts a click on the card above it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(75rem_40rem_at_50%_-15%,var(--accent),transparent_70%)]"
      />
      <ChatPanel />
    </main>
  );
}
