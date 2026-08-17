# Phase 5: Persistence, Authentication & Economy

## 1. Objective

Give the game permanence. Players create accounts, log in, and their progress persists across sessions. Kills earn coins, coins buy upgrades (weapons, shields, hull, AI tier), and loadouts are saved to a database. The AI tier upgrade is the key progression hook — it unlocks richer LLM capabilities.

---

## 2. PostgreSQL Setup

### 2.1 Installation (Self-Hosted on GCP Instance)

Running Postgres on the same machine eliminates network latency for reads and costs nothing extra.

```bash
# Install PostgreSQL 16
sudo apt install postgresql-16 postgresql-client-16

# Create database and user
sudo -u postgres psql
CREATE DATABASE skywalker;
CREATE USER skywalker_app WITH ENCRYPTED PASSWORD '<strong-password>';
GRANT ALL PRIVILEGES ON DATABASE skywalker TO skywalker_app;
\c skywalker
GRANT ALL ON SCHEMA public TO skywalker_app;
```

For development, also available via Docker:
```yaml
# docker-compose.yml (dev only)
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: skywalker
      POSTGRES_USER: skywalker_app
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### 2.2 Go Database Driver

Use `pgx` v5 with connection pooling via `pgxpool`:

```bash
go get github.com/jackc/pgx/v5
go get github.com/jackc/pgx/v5/pgxpool
```

```go
func NewDB(ctx context.Context, connStr string) (*pgxpool.Pool, error) {
    config, err := pgxpool.ParseConfig(connStr)
    if err != nil {
        return nil, err
    }
    
    config.MaxConns = 20               // enough for our use case
    config.MinConns = 5                // keep some warm
    config.MaxConnLifetime = 30 * time.Minute
    config.MaxConnIdleTime = 5 * time.Minute
    
    pool, err := pgxpool.NewWithConfig(ctx, config)
    if err != nil {
        return nil, err
    }
    
    // Verify connection
    if err := pool.Ping(ctx); err != nil {
        return nil, err
    }
    
    return pool, nil
}
```

Connection string from environment:
```
DATABASE_URL=postgres://skywalker_app:password@localhost:5432/skywalker?sslmode=disable
```

---

## 3. Database Schema

### 3.1 Full DDL

```sql
-- migrations/001_initial_schema.sql

-- Users table
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username    TEXT NOT NULL UNIQUE,
    email       TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_username ON users (username);
CREATE INDEX idx_users_email ON users (email);

-- Player profiles (1:1 with users)
CREATE TABLE profiles (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    coins       INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
    kills       INTEGER NOT NULL DEFAULT 0,
    deaths      INTEGER NOT NULL DEFAULT 0,
    ai_tier     INTEGER NOT NULL DEFAULT 1 CHECK (ai_tier BETWEEN 1 AND 5),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Player loadouts (1:1 with profiles, what they have equipped)
CREATE TABLE loadouts (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    hull_id         TEXT NOT NULL DEFAULT 'hull_basic' REFERENCES items(id),
    primary_weapon  TEXT NOT NULL DEFAULT 'wpn_laser_1' REFERENCES items(id),
    secondary_weapon TEXT REFERENCES items(id),  -- nullable (not all players have one)
    shield_id       TEXT NOT NULL DEFAULT 'shld_basic' REFERENCES items(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inventory (what items a player owns)
CREATE TABLE inventory (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     TEXT NOT NULL REFERENCES items(id),
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_id)
);

-- Item catalog (static data, seeded once)
CREATE TABLE items (
    id          TEXT PRIMARY KEY,             -- e.g. "wpn_laser_2", "hull_titan"
    name        TEXT NOT NULL,                -- display name
    category    TEXT NOT NULL,                -- "weapon", "shield", "hull", "ai_core"
    stats       JSONB NOT NULL DEFAULT '{}',  -- stats vary by category
    price       INTEGER NOT NULL CHECK (price >= 0),
    tier_required INTEGER NOT NULL DEFAULT 1, -- min AI tier to purchase
    description TEXT NOT NULL DEFAULT ''
);

-- Kill log (for analytics, leaderboards)
CREATE TABLE kill_log (
    id          BIGSERIAL PRIMARY KEY,
    killer_id   UUID NOT NULL REFERENCES users(id),
    victim_id   UUID NOT NULL REFERENCES users(id),
    killed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kill_log_killer ON kill_log (killer_id, killed_at DESC);
CREATE INDEX idx_kill_log_time ON kill_log (killed_at DESC);
```

### 3.2 Item Catalog Seed Data

```sql
-- migrations/002_seed_items.sql

-- === WEAPONS ===
INSERT INTO items (id, name, category, stats, price, tier_required, description) VALUES
-- Lasers (hitscan, low damage, fast fire rate)
('wpn_laser_1', 'Basic Laser',     'weapon', '{"type":"laser","damage":8,"cooldown":0.5,"range":200,"speed":0,"spread":2}',     0, 1, 'Standard issue laser. Reliable but weak.'),
('wpn_laser_2', 'Focused Laser',   'weapon', '{"type":"laser","damage":12,"cooldown":0.4,"range":250,"speed":0,"spread":1}',  500, 2, 'Tighter beam, more damage.'),
('wpn_laser_3', 'Phase Laser',     'weapon', '{"type":"laser","damage":18,"cooldown":0.35,"range":300,"speed":0,"spread":0.5}', 1500, 3, 'Military-grade precision laser.'),

-- Plasma (projectile, higher damage, slower)
('wpn_plasma_1', 'Plasma Blaster', 'weapon', '{"type":"plasma","damage":25,"cooldown":1.5,"range":300,"speed":250,"spread":0}', 300, 1, 'Slow but packs a punch.'),
('wpn_plasma_2', 'Heavy Plasma',   'weapon', '{"type":"plasma","damage":40,"cooldown":1.8,"range":350,"speed":300,"spread":0}', 1200, 3, 'Heavier payload, longer reach.'),

-- Railgun (hitscan, very high damage, very slow)
('wpn_railgun_1', 'Railgun',       'weapon', '{"type":"laser","damage":60,"cooldown":4.0,"range":400,"speed":0,"spread":0}',  2500, 4, 'One shot. Make it count.'),

-- === SHIELDS ===
('shld_basic',    'Basic Shield',     'shield', '{"max_shield":50,"regen":5,"delay":3}',    0, 1, 'Minimal protection.'),
('shld_regen',    'Regen Shield',     'shield', '{"max_shield":50,"regen":10,"delay":2}',  400, 2, 'Faster recharge cycle.'),
('shld_heavy',    'Heavy Shield',     'shield', '{"max_shield":100,"regen":5,"delay":3}',  800, 2, 'Double capacity, same regen.'),
('shld_advanced', 'Advanced Shield',  'shield', '{"max_shield":100,"regen":12,"delay":1.5}', 2000, 4, 'Superior protection all around.'),

-- === HULLS ===
('hull_basic',   'Scout Hull',   'hull', '{"max_health":100,"max_speed":40,"acceleration":20,"collision_radius":2}',   0, 1, 'Light and nimble.'),
('hull_medium',  'Cruiser Hull', 'hull', '{"max_health":150,"max_speed":35,"acceleration":15,"collision_radius":2.5}', 600, 2, 'Tougher but slower.'),
('hull_heavy',   'Titan Hull',   'hull', '{"max_health":250,"max_speed":25,"acceleration":10,"collision_radius":3.5}',1500, 3, 'A fortress in space.'),
('hull_stealth', 'Phantom Hull', 'hull', '{"max_health":80,"max_speed":50,"acceleration":30,"collision_radius":1.5}', 1800, 4, 'Fragile but incredibly fast.'),

-- === AI CORES ===
('ai_core_1', 'Basic Processor',    'ai_core', '{"ai_tier":1}',     0, 1, 'Limited command vocabulary.'),
('ai_core_2', 'Enhanced Processor', 'ai_core', '{"ai_tier":2}',   800, 1, 'Unlocks conditional behaviors.'),
('ai_core_3', 'Tactical Processor', 'ai_core', '{"ai_tier":3}',  2000, 1, 'Battlefield awareness enabled.'),
('ai_core_4', 'Strategic Mind',     'ai_core', '{"ai_tier":4}',  5000, 1, 'Complex multi-condition chains.'),
('ai_core_5', 'Quantum Brain',      'ai_core', '{"ai_tier":5}', 12000, 1, 'Full tactical AI. Maximum capability.');
```

### 3.3 Go Query Layer (`internal/db/queries.go`)

All queries use parameterized statements — no string concatenation ever.

```go
type Queries struct {
    pool *pgxpool.Pool
}

// GetProfile fetches a player's profile + loadout on login
func (q *Queries) GetProfile(ctx context.Context, userID uuid.UUID) (*PlayerProfile, error) {
    row := q.pool.QueryRow(ctx, `
        SELECT p.coins, p.kills, p.deaths, p.ai_tier,
               l.hull_id, l.primary_weapon, l.secondary_weapon, l.shield_id
        FROM profiles p
        JOIN loadouts l ON l.user_id = p.user_id
        WHERE p.user_id = $1
    `, userID)
    
    var profile PlayerProfile
    err := row.Scan(
        &profile.Coins, &profile.Kills, &profile.Deaths, &profile.AITier,
        &profile.HullID, &profile.PrimaryWeaponID, &profile.SecondaryWeaponID, &profile.ShieldID,
    )
    return &profile, err
}

// GetItemStats fetches the stats JSONB for an item
func (q *Queries) GetItemStats(ctx context.Context, itemID string) (json.RawMessage, error) {
    var stats json.RawMessage
    err := q.pool.QueryRow(ctx, `SELECT stats FROM items WHERE id = $1`, itemID).Scan(&stats)
    return stats, err
}

// AwardCoins atomically adds coins (called async after a kill)
func (q *Queries) AwardCoins(ctx context.Context, userID uuid.UUID, amount int) error {
    _, err := q.pool.Exec(ctx, `
        UPDATE profiles SET coins = coins + $2, updated_at = now() WHERE user_id = $1
    `, userID, amount)
    return err
}

// RecordKill logs a kill and increments kill/death counters
func (q *Queries) RecordKill(ctx context.Context, killerID, victimID uuid.UUID) error {
    tx, err := q.pool.Begin(ctx)
    if err != nil { return err }
    defer tx.Rollback(ctx)
    
    _, err = tx.Exec(ctx, `UPDATE profiles SET kills = kills + 1 WHERE user_id = $1`, killerID)
    if err != nil { return err }
    
    _, err = tx.Exec(ctx, `UPDATE profiles SET deaths = deaths + 1 WHERE user_id = $1`, victimID)
    if err != nil { return err }
    
    _, err = tx.Exec(ctx, `INSERT INTO kill_log (killer_id, victim_id) VALUES ($1, $2)`, killerID, victimID)
    if err != nil { return err }
    
    return tx.Commit(ctx)
}

// PurchaseItem validates and executes an item purchase
func (q *Queries) PurchaseItem(ctx context.Context, userID uuid.UUID, itemID string) error {
    tx, err := q.pool.Begin(ctx)
    if err != nil { return err }
    defer tx.Rollback(ctx)
    
    // Get item price (from DB, NEVER from client)
    var price int
    var tierReq int
    err = tx.QueryRow(ctx, `SELECT price, tier_required FROM items WHERE id = $1`, itemID).Scan(&price, &tierReq)
    if err != nil { return fmt.Errorf("item not found: %s", itemID) }
    
    // Get player's coins and tier
    var coins int
    var aiTier int
    err = tx.QueryRow(ctx, `SELECT coins, ai_tier FROM profiles WHERE user_id = $1 FOR UPDATE`, userID).Scan(&coins, &aiTier)
    if err != nil { return err }
    
    // Validate
    if aiTier < tierReq {
        return fmt.Errorf("requires AI tier %d, you have %d", tierReq, aiTier)
    }
    if coins < price {
        return fmt.Errorf("insufficient coins: need %d, have %d", price, coins)
    }
    
    // Check if already owned
    var exists bool
    tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM inventory WHERE user_id=$1 AND item_id=$2)`, userID, itemID).Scan(&exists)
    if exists {
        return fmt.Errorf("item already owned")
    }
    
    // Deduct coins
    _, err = tx.Exec(ctx, `UPDATE profiles SET coins = coins - $2 WHERE user_id = $1`, userID, price)
    if err != nil { return err }
    
    // Add to inventory
    _, err = tx.Exec(ctx, `INSERT INTO inventory (user_id, item_id) VALUES ($1, $2)`, userID, itemID)
    if err != nil { return err }
    
    // If it's an AI core, update the AI tier
    if strings.HasPrefix(itemID, "ai_core_") {
        var newTier int
        err = tx.QueryRow(ctx, `SELECT (stats->>'ai_tier')::int FROM items WHERE id = $1`, itemID).Scan(&newTier)
        if err == nil && newTier > aiTier {
            _, err = tx.Exec(ctx, `UPDATE profiles SET ai_tier = $2 WHERE user_id = $1`, userID, newTier)
            if err != nil { return err }
        }
    }
    
    return tx.Commit(ctx)
}

// EquipItem sets an item in the player's loadout
func (q *Queries) EquipItem(ctx context.Context, userID uuid.UUID, itemID string, slot string) error {
    // Verify ownership
    var exists bool
    q.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM inventory WHERE user_id=$1 AND item_id=$2)`, userID, itemID).Scan(&exists)
    if !exists {
        return fmt.Errorf("item not owned")
    }
    
    // Validate slot
    var column string
    switch slot {
    case "hull":             column = "hull_id"
    case "primary_weapon":   column = "primary_weapon"
    case "secondary_weapon": column = "secondary_weapon"
    case "shield":           column = "shield_id"
    default:                 return fmt.Errorf("invalid slot: %s", slot)
    }
    
    // Verify item matches slot category
    var category string
    q.pool.QueryRow(ctx, `SELECT category FROM items WHERE id = $1`, itemID).Scan(&category)
    expectedCategory := map[string]string{
        "hull": "hull", "primary_weapon": "weapon", "secondary_weapon": "weapon", "shield": "shield",
    }[slot]
    if category != expectedCategory {
        return fmt.Errorf("item category %s doesn't match slot %s", category, slot)
    }
    
    // Safe: column is from a hardcoded switch, not user input
    _, err := q.pool.Exec(ctx, 
        fmt.Sprintf(`UPDATE loadouts SET %s = $2, updated_at = now() WHERE user_id = $1`, column),
        userID, itemID)
    return err
}
```

---

## 4. Authentication

### 4.1 Registration & Login

Simple email/password authentication with JWT tokens.

```go
// internal/auth/jwt.go

type AuthService struct {
    secret []byte
    db     *Queries
}

type Claims struct {
    UserID   uuid.UUID `json:"uid"`
    Username string    `json:"usr"`
    jwt.RegisteredClaims
}

func (a *AuthService) Register(ctx context.Context, username, email, password string) (*User, error) {
    // Validate inputs
    if len(username) < 3 || len(username) > 20 { return nil, fmt.Errorf("username must be 3-20 chars") }
    if len(password) < 8 { return nil, fmt.Errorf("password must be 8+ chars") }
    
    // Hash password
    hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
    if err != nil { return nil, err }
    
    // Insert user + profile + loadout in transaction
    tx, err := a.db.pool.Begin(ctx)
    if err != nil { return nil, err }
    defer tx.Rollback(ctx)
    
    var userID uuid.UUID
    err = tx.QueryRow(ctx, `
        INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id
    `, username, email, string(hash)).Scan(&userID)
    if err != nil { return nil, fmt.Errorf("username or email already taken") }
    
    _, err = tx.Exec(ctx, `INSERT INTO profiles (user_id) VALUES ($1)`, userID)
    if err != nil { return nil, err }
    
    _, err = tx.Exec(ctx, `INSERT INTO loadouts (user_id) VALUES ($1)`, userID)
    if err != nil { return nil, err }
    
    // Give starter items
    _, err = tx.Exec(ctx, `
        INSERT INTO inventory (user_id, item_id) VALUES 
        ($1, 'wpn_laser_1'), ($1, 'shld_basic'), ($1, 'hull_basic'), ($1, 'ai_core_1')
    `, userID)
    if err != nil { return nil, err }
    
    if err := tx.Commit(ctx); err != nil { return nil, err }
    
    return &User{ID: userID, Username: username}, nil
}

func (a *AuthService) Login(ctx context.Context, email, password string) (string, error) {
    var userID uuid.UUID
    var username string
    var hash string
    
    err := a.db.pool.QueryRow(ctx, `
        SELECT id, username, password_hash FROM users WHERE email = $1
    `, email).Scan(&userID, &username, &hash)
    if err != nil { return "", fmt.Errorf("invalid credentials") }
    
    if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
        return "", fmt.Errorf("invalid credentials")
    }
    
    // Issue JWT
    claims := Claims{
        UserID:   userID,
        Username: username,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }
    
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString(a.secret)
}
```

### 4.2 WebSocket Authentication

The WebSocket upgrade requires a valid JWT. Passed as a query parameter (since WebSocket doesn't support custom headers on connection):

```go
func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
    // Extract JWT from query param
    tokenStr := r.URL.Query().Get("token")
    if tokenStr == "" {
        http.Error(w, "missing token", http.StatusUnauthorized)
        return
    }
    
    claims, err := h.auth.ValidateToken(tokenStr)
    if err != nil {
        http.Error(w, "invalid token", http.StatusUnauthorized)
        return
    }
    
    // Check if already connected (prevent duplicate sessions)
    if h.IsConnected(claims.UserID.String()) {
        http.Error(w, "already connected", http.StatusConflict)
        return
    }
    
    conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
        OriginPatterns: h.allowedOrigins,
    })
    if err != nil { return }
    
    // Create authenticated client
    client := &Client{
        ID:       claims.UserID.String(),
        Username: claims.Username,
        conn:     conn,
        send:     make(chan []byte, 256),
        hub:      h,
    }
    
    h.register <- client
}
```

### 4.3 HTTP Auth Endpoints

```go
// In main.go or a dedicated handler file
mux.HandleFunc("POST /api/register", authHandler.Register)
mux.HandleFunc("POST /api/login", authHandler.Login)
mux.HandleFunc("GET /api/profile", authMiddleware(profileHandler.Get))
mux.HandleFunc("POST /api/shop/buy", authMiddleware(shopHandler.Buy))
mux.HandleFunc("POST /api/loadout/equip", authMiddleware(loadoutHandler.Equip))
mux.HandleFunc("GET /api/shop/items", shopHandler.ListItems)
mux.HandleFunc("GET /api/leaderboard", leaderboardHandler.Get)
```

---

## 5. Async Database Writes

### 5.1 Background Writer

The game loop never blocks on DB writes. Instead, it sends events to a buffered channel processed by a background goroutine:

```go
type DBWriter struct {
    queries  *Queries
    coinCh   chan CoinAward
    killCh   chan KillRecord
}

type CoinAward struct {
    PlayerID uuid.UUID
    Amount   int
}

type KillRecord struct {
    KillerID uuid.UUID
    VictimID uuid.UUID
}

func (w *DBWriter) Start(ctx context.Context) {
    go func() {
        for {
            select {
            case <-ctx.Done():
                return
            case award := <-w.coinCh:
                if err := w.queries.AwardCoins(ctx, award.PlayerID, award.Amount); err != nil {
                    log.Error().Err(err).Str("player", award.PlayerID.String()).Msg("failed to award coins")
                }
            case kill := <-w.killCh:
                if err := w.queries.RecordKill(ctx, kill.KillerID, kill.VictimID); err != nil {
                    log.Error().Err(err).Msg("failed to record kill")
                }
            }
        }
    }()
}
```

### 5.2 Integration with Kill System

```go
// In engine.go processKill()
func (e *Engine) processKill(victim *Ship, killerID string) {
    // ... existing kill logic ...
    
    // Async DB writes (non-blocking)
    killerUUID, _ := uuid.Parse(killerID)
    victimUUID, _ := uuid.Parse(victim.ID)
    
    select {
    case e.dbWriter.coinCh <- CoinAward{PlayerID: killerUUID, Amount: 50}:
    default:
        log.Warn().Msg("coin award channel full, dropping")
    }
    
    select {
    case e.dbWriter.killCh <- KillRecord{KillerID: killerUUID, VictimID: victimUUID}:
    default:
        log.Warn().Msg("kill record channel full, dropping")
    }
}
```

---

## 6. Ship Spawning from Loadout

### 6.1 Loading Loadout on Connect

When an authenticated player connects:

```go
func (e *Engine) handleJoin(req JoinRequest) {
    // Fetch profile and loadout from DB
    profile, err := e.queries.GetProfile(context.Background(), req.UserID)
    if err != nil {
        log.Error().Err(err).Msg("failed to load profile")
        return
    }
    
    // Resolve item stats
    hullStats := e.itemCache.GetHull(profile.HullID)
    weaponStats := e.itemCache.GetWeapon(profile.PrimaryWeaponID)
    shieldStats := e.itemCache.GetShield(profile.ShieldID)
    
    // Build ship from loadout
    ship := &Ship{
        ID:              req.UserID.String(),
        Username:        req.Username,
        Position:        randomPosition(),
        MaxHealth:       hullStats.MaxHealth,
        Health:          hullStats.MaxHealth,
        MaxSpeed:        hullStats.MaxSpeed,
        Acceleration:    hullStats.Acceleration,
        CollisionRadius: hullStats.CollisionRadius,
        MaxShield:       shieldStats.MaxShield,
        Shield:          shieldStats.MaxShield,
        ShieldRegen:     shieldStats.Regen,
        ShieldDelay:     shieldStats.Delay,
        PrimaryWeapon:   buildWeapon(weaponStats),
        AITier:          profile.AITier,
        Coins:           profile.Coins,
        IsAlive:         true,
        Color:           colorForUsername(req.Username),
    }
    
    e.state.Ships[req.UserID.String()] = ship
}
```

### 6.2 Item Stats Cache

The item catalog is static. Cache it in memory at startup to avoid DB reads during gameplay:

```go
type ItemCache struct {
    hulls   map[string]HullStats
    weapons map[string]WeaponStats
    shields map[string]ShieldStats
}

func NewItemCache(ctx context.Context, queries *Queries) (*ItemCache, error) {
    cache := &ItemCache{
        hulls:   make(map[string]HullStats),
        weapons: make(map[string]WeaponStats),
        shields: make(map[string]ShieldStats),
    }
    
    rows, err := queries.pool.Query(ctx, `SELECT id, category, stats FROM items`)
    if err != nil { return nil, err }
    defer rows.Close()
    
    for rows.Next() {
        var id, category string
        var stats json.RawMessage
        rows.Scan(&id, &category, &stats)
        
        switch category {
        case "hull":
            var s HullStats
            json.Unmarshal(stats, &s)
            cache.hulls[id] = s
        case "weapon":
            var s WeaponStats
            json.Unmarshal(stats, &s)
            cache.weapons[id] = s
        case "shield":
            var s ShieldStats
            json.Unmarshal(stats, &s)
            cache.shields[id] = s
        }
    }
    
    return cache, nil
}
```

---

## 7. Economy Balance

### 7.1 Coin Rewards

| Event | Coins |
|---|---|
| Kill an enemy | 50 |
| Assist (dealt damage in last 10s) | 20 |
| Survive 5 minutes | 10 |
| First kill of session | 25 bonus |

### 7.2 Upgrade Pricing Curve

Items follow an exponential pricing curve. Early upgrades are cheap (fast hook), late upgrades require grinding (retention):

| Category | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---|---|---|---|
| Weapons | Free | 300-500 | 1200-1500 | 2500 |
| Shields | Free | 400 | 800 | 2000 |
| Hulls | Free | 600 | 1500 | 1800 |
| AI Cores | Free | 800 | 2000 | 5000 |

AI Core 5 (12,000 coins) is the aspirational end-game goal — roughly 240 kills at base rate.

### 7.3 Anti-Exploit Measures

- **Server validates everything**: Item prices come from the DB, not the client
- **`FOR UPDATE` lock on purchase**: Prevents race conditions on concurrent purchases
- **`CHECK (coins >= 0)` constraint**: Database prevents negative coin balances
- **Duplicate ownership check**: Can't buy the same item twice
- **Rate limiting on purchase API**: Max 1 purchase per 5 seconds per player

---

## 8. Client-Side UI

### 8.1 Auth Screen (`src/ui/AuthScreen.tsx`)

Simple login/register form shown before the game canvas:

```tsx
function AuthScreen({ onAuth }: { onAuth: (token: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    const endpoint = mode === 'login' ? '/api/login' : '/api/register'
    const body = mode === 'login' 
      ? { email, password }
      : { username, email, password }
    
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    
    if (!res.ok) {
      setError(await res.text())
      return
    }
    
    const { token } = await res.json()
    localStorage.setItem('token', token)
    onAuth(token)
  }

  // ... render form ...
}
```

### 8.2 Shop UI (`src/ui/Shop.tsx`)

Accessible from HUD. Shows items categorized by type, with prices, descriptions, and "Buy" / "Equip" buttons:

```tsx
function Shop() {
  const [items, setItems] = useState<Item[]>([])
  const [inventory, setInventory] = useState<Set<string>>(new Set())
  const coins = useGameStore(s => s.coins)
  
  useEffect(() => {
    fetch('/api/shop/items').then(r => r.json()).then(setItems)
    fetch('/api/profile', authHeaders()).then(r => r.json()).then(p => {
      setInventory(new Set(p.inventory))
    })
  }, [])
  
  const buy = async (itemId: string) => {
    const res = await fetch('/api/shop/buy', {
      method: 'POST',
      ...authHeaders(),
      body: JSON.stringify({ item_id: itemId }),
    })
    if (res.ok) {
      // Refresh inventory and coins
    }
  }
  
  return (
    <div className="shop-overlay">
      {['weapon', 'shield', 'hull', 'ai_core'].map(cat => (
        <div key={cat} className="shop-category">
          <h3>{cat.toUpperCase()}</h3>
          {items.filter(i => i.category === cat).map(item => (
            <ShopItem 
              key={item.id}
              item={item}
              owned={inventory.has(item.id)}
              canAfford={coins >= item.price}
              onBuy={() => buy(item.id)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
```

### 8.3 Coin Display on HUD

```tsx
function CoinDisplay() {
  const coins = useGameStore(s => s.coins)
  const [delta, setDelta] = useState(0)
  
  useEffect(() => {
    // Flash "+50" on coin gain
    if (delta > 0) {
      const timer = setTimeout(() => setDelta(0), 1500)
      return () => clearTimeout(timer)
    }
  }, [delta])
  
  return (
    <div className="coin-display">
      <span className="coin-icon">⬡</span>
      <span className="coin-count">{coins}</span>
      {delta > 0 && <span className="coin-delta">+{delta}</span>}
    </div>
  )
}
```

---

## 9. Leaderboard

```go
func (q *Queries) GetLeaderboard(ctx context.Context, limit int) ([]LeaderboardEntry, error) {
    rows, err := q.pool.Query(ctx, `
        SELECT u.username, p.kills, p.deaths, p.coins, p.ai_tier
        FROM profiles p
        JOIN users u ON u.id = p.user_id
        ORDER BY p.kills DESC
        LIMIT $1
    `, limit)
    // ... scan rows ...
}
```

---

## 10. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 5.1 | Set up PostgreSQL with migrations | Database created, all tables exist, seed data inserted |
| 5.2 | Implement pgx connection pool in Go | Server connects to DB on startup, pool configured, ping succeeds |
| 5.3 | Implement user registration | POST /api/register creates user + profile + loadout + starter inventory |
| 5.4 | Implement login with JWT | POST /api/login returns valid JWT; invalid creds return 401 |
| 5.5 | Add WebSocket authentication | WebSocket upgrade requires valid JWT; unauthenticated connections rejected |
| 5.6 | Load ship stats from loadout on connect | Ship spawns with correct HP, speed, weapon based on DB loadout |
| 5.7 | Implement item stats cache | All item stats loaded into memory at startup; no DB reads during gameplay |
| 5.8 | Implement async coin award on kill | Killing a ship awards 50 coins persisted to DB without blocking game loop |
| 5.9 | Implement kill/death tracking | kills/deaths counters increment in DB; kill_log records every kill |
| 5.10 | Implement purchase API | POST /api/shop/buy validates ownership, funds, tier; atomically deducts coins |
| 5.11 | Implement equip API | POST /api/loadout/equip validates ownership and category; updates loadout |
| 5.12 | Implement AI tier upgrade | Buying an AI core updates ai_tier; next connect uses new tier for LLM prompts |
| 5.13 | Build auth UI (login/register) | Forms work, token stored, redirects to game on success |
| 5.14 | Build shop UI | Items displayed by category, buy/equip buttons, coin balance shown |
| 5.15 | Build leaderboard | Top 20 players by kills displayed, refreshes every 30s |

---

## 11. Milestone Definition

Phase 5 is **complete** when:

> A player registers an account, logs in, and spawns with default loadout stats pulled from PostgreSQL. They kill another player and see "+50 coins" on their HUD. The coins persist after disconnecting and reconnecting (verified via `/api/profile`). They open the shop, buy a "Focused Laser" for 500 coins, equip it, and on their next respawn their ship fires the upgraded weapon (higher damage, faster fire rate). They save up and buy an "Enhanced Processor" (AI Core 2), and their prompt input now allows longer commands and their ship can execute conditional behaviors. The leaderboard shows their kill count.
