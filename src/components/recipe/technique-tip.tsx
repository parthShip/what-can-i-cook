// Only rendered when the source actually recorded a tip.
export function TechniqueTip({ tip }: { tip?: string }) {
  if (!tip?.trim()) return null;

  return (
    <aside className="rounded-lg bg-tip-surface p-3 ring-1 ring-tip/20">
      <h4 className="mb-1 font-serif text-sm font-semibold text-tip">
        <span aria-hidden>💡</span> Technique tip
      </h4>
      <p className="text-sm leading-relaxed">{tip}</p>
    </aside>
  );
}
