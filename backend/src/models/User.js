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

  // E.164, e.g. +14155550137. Only present when the user opted into SMS OTP.
  phone:         { type: String, default: null },
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
// every identity has both fields — but the index must be on the array path so Mongo
// indexes each subdocument.
UserSchema.index({ 'identities.provider': 1, 'identities.providerId': 1 }, { unique: true });
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });

export const User = mongoose.model('User', UserSchema);
