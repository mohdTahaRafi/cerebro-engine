// phase_4 §3.3, §4.8 — the explicit labeled rule the RerankMatrix draws beneath the
// survivors. Carries its own value rather than being an unlabeled divider: the number is
// what turns "some rows are struck through" into "these specifically scored below 0.15."
export function RelevanceFloorRule({ floor }: { floor: number }) {
  const label = floor < 0.001 ? floor.toExponential(1) : floor.toFixed(2);
  return (
    <div className="my-1 flex items-center gap-2" role="separator" aria-label={`Relevance floor ${label}`}>
      <div className="h-px flex-1 bg-line-strong" />
      <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-graphite">
        relevance floor {label}
      </span>
      <div className="h-px flex-1 bg-line-strong" />
    </div>
  );
}
