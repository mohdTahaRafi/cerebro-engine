// phase_4 §5.1 — point counts for cerebro_chunks and cerebro_pages, real today (`/api/health`).
import { Fragment } from 'react';

export function CollectionPanel({ collections }: { collections: Record<string, number> | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-graphite">Collections</h2>
      {collections ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {Object.entries(collections).map(([name, count]) => (
            <Fragment key={name}>
              <span className="truncate text-graphite">{name}</span>
              <span className="text-right font-medium tabular-nums text-ink">{count.toLocaleString()}</span>
            </Fragment>
          ))}
        </div>
      ) : (
        <p className="text-xs italic text-graphite">unavailable</p>
      )}
    </div>
  );
}
