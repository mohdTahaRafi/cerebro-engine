// phase_1 §6.1 — the left column's four feature rows. Product-level set for /login and
// /signup; a reset-specific set for /forgot-password and /reset-password, since
// "explore your data in 3D" is not a relevant claim to make to someone who can't sign in
// (DESIGN.md §6.3). The set of four is fixed; the order is not load-bearing.
import { BookMarked, Compass, Eye, Lock, LifeBuoy, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import type { AuthFeatureRow } from './AuthShell';

export const PRODUCT_FEATURE_ROWS: AuthFeatureRow[] = [
  { icon: BookMarked, title: 'Cited answers', description: 'Every answer is linked to the exact source.' },
  { icon: Eye, title: 'Full transparency', description: 'Inspect retrieval, rankings, prompts, and model behavior.' },
  { icon: Compass, title: 'Explore your data', description: 'Visualize document embeddings in interactive 3D.' },
  { icon: ShieldCheck, title: 'Private & secure', description: 'Your data stays isolated and encrypted.' },
];

export const RESET_FEATURE_ROWS: AuthFeatureRow[] = [
  { icon: Lock, title: 'Secure recovery', description: 'Password reset links expire for your protection.' },
  { icon: ShieldCheck, title: 'Private by design', description: 'Your data stays isolated and encrypted.' },
  { icon: SlidersHorizontal, title: "You're in control", description: 'Reset your password quickly and get back to your work.' },
  { icon: LifeBuoy, title: 'Need help?', description: 'Contact our support team if you run into any issues.' },
];
