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

interface AuthShellProps {
  headline: [string, string];
  supportingText: string;
  features: AuthFeatureRow[];
  headerLinkLabel: string;
  headerLinkTo: string;
  children: ReactNode;
}

export function AuthShell({ headline, supportingText, features, headerLinkLabel, headerLinkTo, children }: AuthShellProps) {
  return (
    <div className="relative flex min-h-screen flex-col bg-surface">
      <AtmosphericBackground />

      <header className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-ink">
          <Waypoints className="size-4 text-signal" aria-hidden="true" />
          Cerebro
        </div>
        <div className="flex items-center gap-4">
          <Link to={headerLinkTo} className="text-sm font-medium text-ink-secondary outline-none hover:text-signal focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm">
            {headerLinkLabel}
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-12 px-6 pb-16 sm:px-10 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="flex w-full max-w-xl flex-col gap-8 lg:w-[48%]">
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-bold leading-tight text-ink sm:text-[1.875rem]">
              {headline[0]}
              <br />
              <span className="text-signal">{headline[1]}</span>
            </h1>
            <p className="max-w-md text-base text-ink-secondary">{supportingText}</p>
          </div>

          <div className="flex flex-col gap-5">
            {features.map((f) => (
              <div key={f.title} className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-signal-soft">
                  <f.icon className="size-4 text-signal" aria-hidden="true" />
                </div>
                <div>
                  <div className="text-sm font-medium text-ink">{f.title}</div>
                  <div className="text-sm text-graphite">{f.description}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden text-xs text-graphite lg:block">
            © {new Date().getFullYear()} Cerebro. All rights reserved. &nbsp;·&nbsp; Privacy · Terms · Security
          </div>
        </div>

        <div className="flex w-full max-w-[420px] items-center justify-center lg:w-[52%]">
          {children}
        </div>
      </div>
    </div>
  );
}
