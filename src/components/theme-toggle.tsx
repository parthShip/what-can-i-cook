"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "system", label: "Match my device", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

type ThemeValue = (typeof OPTIONS)[number]["value"];

// Hydration is a one-way door: there is nothing to subscribe to afterwards.
const subscribeNever = () => () => {};

// What next-themes writes onto <html>. Repeated here rather than waited for,
// because the sweep below needs the new colours painted inside its callback —
// an effect that runs a tick later would be captured as the old frame.
function paint(theme: ThemeValue) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // The sweep starts from the control itself, so the group's own box is the
  // origin — no need to chase the element out of the event.
  const groupRef = useRef<HTMLDivElement>(null);
  // The stored theme is only known in the browser, so the first client render
  // has to match the server's — which means rendering `system` through hydration
  // and the real value immediately after. `useSyncExternalStore` says exactly
  // that to React (server snapshot false, client snapshot true) without an effect
  // that sets state and costs a second render on every mount.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);

  const current = (hydrated ? (theme as ThemeValue) : "system") ?? "system";

  const change = useCallback(
    (next: ThemeValue) => {
      if (next === theme) return;

      const apply = () => {
        paint(next);
        setTheme(next);
      };

      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      if (reduced || !document.startViewTransition) {
        apply();
        return;
      }

      // The light travels out from the control that was pressed, so the change
      // reads as caused rather than as a page reload.
      const box = groupRef.current?.getBoundingClientRect();
      const x = box ? box.left + box.width / 2 : innerWidth / 2;
      const y = box ? box.top + box.height / 2 : 0;
      const radius = Math.hypot(
        Math.max(x, innerWidth - x),
        Math.max(y, innerHeight - y),
      );

      const style = document.documentElement.style;
      style.setProperty("--theme-origin-x", `${x}px`);
      style.setProperty("--theme-origin-y", `${y}px`);
      style.setProperty("--theme-origin-r", `${radius}px`);

      document.startViewTransition(() => flushSync(apply));
    },
    [setTheme, theme],
  );

  return (
    <TooltipProvider>
      <ToggleGroup
        ref={groupRef}
        value={[current]}
        aria-label="Theme"
        className="flex items-center gap-0.5 rounded-full bg-muted p-0.5 ring-1 ring-foreground/5"
      >
        {OPTIONS.map(({ value, label, Icon }) => (
          <Tooltip key={value}>
            <TooltipTrigger
              render={
                <Toggle
                  value={value}
                  aria-label={label}
                  onPressedChange={(pressed) => {
                    if (pressed) change(value);
                  }}
                  className={cn(
                    "grid size-6 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors duration-200 sm:size-7",
                    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    "hover:text-foreground",
                    "data-pressed:bg-card data-pressed:text-primary data-pressed:shadow-sm",
                  )}
                />
              }
            >
              <Icon className="size-3.5" aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
    </TooltipProvider>
  );
}
