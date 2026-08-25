// phase_1 §6 intro — the split-screen shell shared by /login, /signup,
// /forgot-password and /reset-password: a left hero column (product mark + tagline at
// the page level, a two-line headline with its second line in --signal, one supporting
// paragraph, four feature rows, a footer) and a right column holding the auth card,
// vertically centered, on the page-level AtmosphericBackground. No UserMenu, no avatar —
// these are public, signed-out routes.
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Waypoints } from 'lucide-react';
import { AtmosphericBackground } from '../design/AtmosphericBackground';
import { ThemeToggle } from '../design/ThemeToggle';

export interface AuthFeatureRow {
  icon: LucideIcon;
  title: string;
  description: string;
}

interface AuthHeaderProps {
  /** Reciprocal nav link ("Already have an account? Sign in", "Back to sign in", …).
   *  Omit both to fall back to a static "Contact" link instead — the login screen's
   *  own reciprocal link already lives at the foot of its card, so the header would
   *  otherwise show the same link twice (DESIGN.md §6.1). */
  headerLinkLabel?: string;
  headerLinkTo?: string;
}

/** The logo + reciprocal-link + ThemeToggle strip shared by every auth route
 *  (/login, /signup, /forgot-password, /reset-password) — pulled out of AuthShell so
 *  /reset-password, whose card-dominant composition doesn't fit AuthShell's
 *  hero+card grid, can still render byte-identical header markup instead of a
 *  hand-rolled copy (DESIGN.md §"Header" / phase_1 §6 reuse requirement). */
export function AuthHeader({ headerLinkLabel, headerLinkTo }: AuthHeaderProps) {
  const hasHeaderLink = headerLinkLabel && headerLinkTo;

  return (
    // flex-wrap: below ~420px the reciprocal link + theme control no longer fit beside
    // the wordmark on one row; without it they'd push past the viewport edge and force
    // a horizontal scrollbar (a bug independent of the desktop no-scroll fix, caught
    // while testing it).
    <header className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-8 py-4 sm:px-10">
      <div className="flex items-center gap-3">
        <Waypoints className="size-12 shrink-0 text-signal" aria-hidden="true" strokeWidth={1.75} aria-label="Cerebro" />
        <div className="flex flex-col leading-none">
          <span className="text-[27px] font-bold tracking-wide text-ink">CEREBRO</span>
          <span className="mt-1 text-[15px] text-ink-secondary">Grounded answers. Full context.</span>
        </div>
      </div>
      <div className="flex items-center gap-5">
        {hasHeaderLink ? (
          <Link to={headerLinkTo!} className="text-base font-medium text-ink-secondary outline-none hover:text-signal focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm">
            {headerLinkLabel}
          </Link>
        ) : (
          <a href="mailto:support@cerebro.dev" className="text-base font-medium text-ink-secondary outline-none hover:text-signal focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm">
            Contact
          </a>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}

/** The copyright + legal-links strip shared by every auth route — see AuthHeader for
 *  why this is pulled out rather than duplicated. Privacy/Terms/Security have no
 *  routes yet — plain text, not dead links, until those pages exist (DESIGN.md §6.1
 *  footer). */
export function AuthFooter() {
  return (
    <div className="mt-[clamp(0.5rem,1.5vh,1rem)] hidden shrink-0 items-center justify-between text-[13px] text-graphite lg:flex">
      <span>© {new Date().getFullYear()} Cerebro. All rights reserved.</span>
      <div className="flex items-center gap-2">
        <span>Privacy</span>
        <span aria-hidden="true">•</span>
        <span>Terms</span>
        <span aria-hidden="true">•</span>
        <span>Security</span>
      </div>
    </div>
  );
}

interface AuthShellProps {
  headline: [string, string];
  supportingText: string;
  features: AuthFeatureRow[];
  headerLinkLabel?: string;
  headerLinkTo?: string;
  children: ReactNode;
}

export function AuthShell({ headline, supportingText, features, headerLinkLabel, headerLinkTo, children }: AuthShellProps) {
  return (
    // lg:h-screen + lg:overflow-hidden: the desktop auth viewport never scrolls (§1/§8 of
    // the no-scroll pass) — below lg the page reverts to ordinary min-h-screen document
    // flow, since a fixed-height page is what forces content off-screen on narrow/short
    // viewports, and mobile is explicitly allowed to scroll (§10).
    <div className="relative flex min-h-screen flex-col bg-surface lg:h-screen lg:overflow-hidden">
      <AtmosphericBackground />
      <AuthHeader headerLinkLabel={headerLinkLabel} headerLinkTo={headerLinkTo} />

      {/* lg:min-h-0 overrides flexbox's default min-height:auto on a flex child, which
          otherwise refuses to shrink below its content size and defeats the parent's
          overflow:hidden — this is what lets the row below actually compress instead of
          just getting clipped. */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1480px] flex-1 flex-col px-8 pb-6 sm:px-10 lg:min-h-0 lg:px-20 lg:pb-8">
        <div className="flex w-full flex-1 flex-col gap-16 lg:min-h-0 lg:flex-row lg:items-stretch lg:justify-between lg:gap-10">
          <div className="flex w-full max-w-2xl flex-col justify-center gap-8 lg:w-[49%]">
            <div className="flex flex-col gap-4">
              <h1 className="text-[40px] font-bold leading-[1.1] tracking-tight text-ink xl:text-[52px] xl:leading-[1.08]">
                {headline[0]}
                <br />
                <span className="text-signal">{headline[1]}</span>
              </h1>
              <p className="max-w-[520px] text-[17px] leading-[1.55] text-ink-secondary">{supportingText}</p>
            </div>

            <div className="flex flex-col gap-5">
              {features.map((f) => (
                <div key={f.title} className="flex items-start gap-4">
                  <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-signal-soft">
                    <f.icon className="size-6 text-signal" aria-hidden="true" strokeWidth={1.75} />
                  </div>
                  <div className="pt-1.5">
                    <div className="text-[15px] font-bold text-ink">{f.title}</div>
                    <div className="text-[14px] leading-snug text-graphite">{f.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex w-full items-start justify-center lg:w-auto lg:shrink-0 lg:self-center lg:justify-end">
            {children}
          </div>
        </div>

        <AuthFooter />
      </div>
    </div>
  );
}
