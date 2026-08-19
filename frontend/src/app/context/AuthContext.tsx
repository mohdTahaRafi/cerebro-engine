// phase_1 §5.1 — session, capabilities, and the four-value connectivity status. Mounted
// above the router in main.tsx/App.tsx because /login needs it too.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, EndpointUnavailableError } from '../../api';
import type { AuthCapabilities, LoginRequest, SessionUser, SignupRequest } from '../../api/contracts';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'unreachable';

interface AuthState {
  user: SessionUser | null;
  status: AuthStatus;
  capabilities: AuthCapabilities | null;
  signIn: (req: LoginRequest) => Promise<void>;
  // Returns the created SessionUser, or null when the address already had an account —
  // in which case no session was established. This deliberately widens phase_1 §5.1's
  // `Promise<void>` signature: DESIGN.md §6.2 requires the server (and so the mock) to
  // respond identically whether or not the address existed, which means the *only* way
  // for the Signup screen to tell those two outcomes apart is the payload, not a thrown
  // error. A caller that only awaits the promise and ignores the return value keeps
  // working exactly as the void signature implied.
  signUp: (req: SignupRequest) => Promise<SessionUser | null>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);
  // Guards a probe in flight against a component unmount (StrictMode's double-invoke
  // in dev, or a fast navigation away) updating state after the fact. Reset to `true`
  // on every effect setup, not just cleared on cleanup — otherwise StrictMode's
  // mount→unmount→remount dev simulation leaves this permanently `false` after the
  // first simulated unmount, and every probe forever after silently no-ops.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const probe = useCallback(async () => {
    setStatus('loading');
    try {
      const [sessionRes, caps] = await Promise.all([api.auth.session(), api.auth.capabilities()]);
      if (!mountedRef.current) return;
      setUser(sessionRes.user);
      setCapabilities(caps);
      setStatus(sessionRes.user ? 'authenticated' : 'anonymous');
    } catch {
      // Phase 1 ships no real backend auth routes at all (this phase's backend changes
      // are none) — every failure here, whether a genuine network error
      // (EndpointUnavailableError with code 'network_unreachable') or the route simply
      // not existing yet (the same error class, code 'endpoint_unavailable'), means the
      // app cannot learn who is signed in. Both collapse to the same user-facing state:
      // don't show a login form that cannot possibly succeed. RequireAuth and the auth
      // screens both render <BackendUnreachable> for this status.
      if (!mountedRef.current) return;
      setUser(null);
      setCapabilities(null);
      setStatus('unreachable');
    }
  }, []);

  // Runs once at mount. Deliberately not re-run on route change — guards read this
  // context's state, they do not fetch (phase_1 §5.1).
  useEffect(() => { probe(); }, [probe]);

  const signIn = useCallback(async (req: LoginRequest) => {
    const res = await api.auth.login(req);   // throws CerebroApiError on bad credentials
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  const signUp = useCallback(async (req: SignupRequest) => {
    const res = await api.auth.signup(req);
    if (res.user) {
      setUser(res.user);
      setStatus('authenticated');
    }
    return res.user;
  }, []);

  const signOut = useCallback(async () => {
    await api.auth.logout();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value: AuthState = { user, status, capabilities, signIn, signUp, signOut, refresh: probe };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

// Re-exported for call sites that only care about "is the backend even reachable" —
// kept here rather than imported ad hoc from the api layer, so guards depend on the
// context module alone.
export { EndpointUnavailableError };
