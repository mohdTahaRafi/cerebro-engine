// In-memory user table for the dev-only auth mock (phase_1 §4.4). Reset on every full
// page reload — module state, not persisted storage — which is the correct behavior for
// a mock standing in for a real session cookie the browser doesn't actually hold here.
import type { SessionUser } from '../../contracts';

interface MockUser extends SessionUser {
  password: string;
}

let users: MockUser[] = [
  {
    id: 'user_demo',
    email: 'demo@cerebro.dev',
    emailVerified: true,
    name: 'Aarav Rao',
    avatarUrl: null,
    role: 'admin',
    identities: ['local'],
    phone: null,
    phoneVerified: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    password: 'DemoPassword123',
  },
];

let nextId = 1;

export function findByEmail(email: string): MockUser | undefined {
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export function createUser(email: string, password: string, name: string | null): MockUser {
  const user: MockUser = {
    id: `user_${nextId++}`,
    email,
    emailVerified: false,
    name: name ?? null,
    avatarUrl: null,
    role: 'user',
    identities: ['local'],
    phone: null,
    phoneVerified: false,
    createdAt: new Date().toISOString(),
    password,
  };
  users = [...users, user];
  return user;
}

export function setPassword(email: string, password: string): void {
  users = users.map((u) => (u.email.toLowerCase() === email.toLowerCase() ? { ...u, password } : u));
}

export function toSessionUser(user: MockUser): SessionUser {
  const { password: _password, ...rest } = user;
  return rest;
}
