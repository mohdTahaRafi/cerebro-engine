// The shell for /privacy and /terms: the auth routes' header (logo, "Sign in", theme
// toggle) over a single readable column. Public and signed-out like the auth pages, and
// unlike them it scrolls — a legal page is long-form text, not a card that must fit one
// viewport. Google's OAuth consent screen links here, so it must render for anyone.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AtmosphericBackground } from '../../components/design/AtmosphericBackground';
import { AuthHeader } from '../../components/auth/AuthShell';
import { CONTACT_EMAIL, LEGAL_EFFECTIVE_DATE } from '../../lib/legal';

interface LegalPageProps {
  title: string;
  children: ReactNode;
}

export function LegalPage({ title, children }: LegalPageProps) {
  return (
    <div className="relative min-h-screen bg-surface">
      <AtmosphericBackground />
      <AuthHeader headerLinkLabel="Sign in" headerLinkTo="/login" />
      <main className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-20 pt-8 sm:px-10">
        <h1 className="text-[36px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm text-graphite">Effective {LEGAL_EFFECTIVE_DATE}</p>
        <div className="mt-10 flex flex-col gap-10 text-[16px] leading-[1.65] text-ink-secondary">
          {children}
        </div>
        <footer className="mt-16 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-strong pt-6 text-[13px] text-graphite">
          <span>© {new Date().getFullYear()} Cerebro</span>
          <span aria-hidden="true">•</span>
          <Link to="/privacy" className="hover:text-signal">Privacy</Link>
          <span aria-hidden="true">•</span>
          <Link to="/terms" className="hover:text-signal">Terms</Link>
          <span aria-hidden="true">•</span>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-signal">{CONTACT_EMAIL}</a>
        </footer>
      </main>
    </div>
  );
}

/** A numbered section: heading plus body. Bodies are plain <p>/<ul> children. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[20px] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** A bulleted list styled for the legal column. */
export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-6 marker:text-graphite">{children}</ul>;
}

export function ContactLink() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-signal hover:underline">
      {CONTACT_EMAIL}
    </a>
  );
}
