// phase_1 §6 intro / DESIGN.md §6.1 — a page-level (never card-level) treatment: a very
// low-opacity radial wash plus a faint network/dot pattern, concentrated toward the
// lower-left and fading toward the edges. It sits behind all content, never touches text
// contrast, and is the one deliberate exception to the "no gradient heroes" rule — auth
// routes only, rendered once by AuthShell, never re-rendered inside the card.
export function AtmosphericBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 900px 700px at 10% 90%, var(--signal-soft) 0%, transparent 70%)',
        }}
      />
      <svg className="absolute inset-0 h-full w-full opacity-[0.07]">
        <defs>
          <pattern id="atmospheric-network" width="140" height="140" patternUnits="userSpaceOnUse">
            <circle cx="20" cy="24" r="1.5" fill="var(--signal)" />
            <circle cx="104" cy="58" r="1.5" fill="var(--signal)" />
            <circle cx="58" cy="112" r="1.5" fill="var(--signal)" />
            <line x1="20" y1="24" x2="104" y2="58" stroke="var(--signal)" strokeWidth="0.5" />
            <line x1="104" y1="58" x2="58" y2="112" stroke="var(--signal)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#atmospheric-network)" />
      </svg>
    </div>
  );
}
