import mongoose from 'mongoose';

// One federated or local identity. A user may hold several; the pair
// (provider, providerId) is globally unique, enforced by the index below.
const IdentitySchema = new mongoose.Schema({
  provider:      { type: String, required: true, enum: ['google', 'github', 'local'] },
  // For OAuth: the provider's stable subject id (Google `sub`, GitHub numeric `id`).
  // For 'local': the user's own _id as a string, so the tuple stays uniformly shaped
  // and the unique index does not need a partial filter.
  providerId:    { type: String, required: true },
  // What the provider ASSERTED at link time. Kept separately from User.email because a
  // user can change their Cerebro email; this records what the provider said, which is
  // what the linking rule (§6) is allowed to trust.
  providerEmail: { type: String, default: null },
  emailVerified: { type: Boolean, default: false },
  linkedAt:      { type: Date, default: Date.now },
}, { _id: false });

const UserSchema = new mongoose.Schema({
  // Always stored lowercase and trimmed. Case-insensitive uniqueness is enforced by
  // normalizing on write, NOT by a collation index — a collation index makes every
  // query against this field require the same collation, which is a footgun waiting
  // for the first contributor who writes User.findOne({ email }) without it.
  email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  emailVerified: { type: Boolean, default: false },

  // Null for an OAuth-only account. A null hash must NEVER be treated as "any password
  // matches" — verifyPassword() (§4.2) returns false on null before touching argon2.
  passwordHash:  { type: String, default: null },
  // Bumped on every password change and on "sign out everywhere". Sessions carry the
  // value they were minted with; a mismatch invalidates the session at load time (§5.4).
  credentialVersion: { type: Number, default: 0 },

  name:          { type: String, default: null, maxlength: 120 },
  avatarUrl:     { type: String, default: null },

  // E.164, e.g. +14155550137. Only present when the user opted into SMS OTP. NO
  // `default: null` — Mongoose writes an explicit default into the document at creation,
  // and the sparse unique index below only excludes documents where the field is truly
  // ABSENT from the BSON, not present-with-value-null. `default: null` here made every
  // phone-less user collide on the same indexed null, so the second signup with no phone
  // failed with a duplicate-key error on `phone_1` — verified live during this phase's
  // implementation. Leaving no default keeps the path genuinely unset until a user
  // supplies one.
  phone:         { type: String },
  phoneVerified: { type: Boolean, default: false },

  role:          { type: String, enum: ['user', 'admin'], default: 'user', index: true },

  identities:    { type: [IdentitySchema], default: [] },

  lastLoginAt:   { type: Date, default: null },
  // Set when a login attempt is refused for reasons the user must resolve out of band
  // (currently only 'suspended'); reserved so the login path has a place to branch that
  // is not "delete the user".
  status:        { type: String, enum: ['active', 'suspended'], default: 'active' },
}, { timestamps: true });

// A single provider account can back exactly one Cerebro user. Sparse is wrong here —
// every identity SUBDOCUMENT has both fields — but the index must be on the array path
// so Mongo indexes each subdocument. `partialFilterExpression` guards a different case
// sparse wouldn't catch: no production code path ever persists a User with a genuinely
// EMPTY `identities` array (signup always pushes a `local` identity before saving;
// linking.js's two "create a new user" branches both include one too), but if it ever
// happened, Mongo indexes an empty array's dotted path as a single {provider: null,
// providerId: null} entry — a NON-sparse unique index then lets only the FIRST such user
// exist at all, and every second one fails to save with a duplicate-key error on this
// index. Verified live while writing this phase's tests. The filter restricts the index
// to documents that actually have at least one identity, matching what "a single
// provider account backs exactly one user" is actually supposed to mean.
UserSchema.index(
  { 'identities.provider': 1, 'identities.providerId': 1 },
  { unique: true, partialFilterExpression: { 'identities.0': { $exists: true } } },
);
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });

export const User = mongoose.model('User', UserSchema);
