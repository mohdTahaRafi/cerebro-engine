# SkyWalker — System Architecture & Technical Design

## 1. Vision

SkyWalker is a persistent, web-based 3D multiplayer game set in open space. Players command AI-driven spaceships not through direct input, but by writing natural language prompts that an LLM translates into structured behaviors. Ships act autonomously between prompts. Players earn currency by destroying opponents and spend it on hardware upgrades (weapons, shields, hull) and — critically — **AI Processor tiers** that unlock deeper LLM capabilities, creating a progression system that organically balances server-side compute load.

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        GCP Instance                               │
│                                                                    │
│  ┌───────────────────┐    gRPC/HTTP     ┌──────────────────────┐  │
│  │    Go Game Server  │◄──────────────►│  JetStream (TPU)      │  │
│  │                    │                 │  Gemma 2 9B / 2B      │  │
│  │  ┌──────────────┐ │                 │  Continuous Batching   │  │
│  │  │ Game Engine   │ │                 └──────────────────────┘  │
│  │  │ 30 TPS Loop   │ │                                           │
│  │  └──────────────┘ │    pgx pool      ┌──────────────────────┐  │
│  │  ┌──────────────┐ │◄──────────────►│  PostgreSQL            │  │
│  │  │ WebSocket Hub │ │                 │  (self-hosted)         │  │
│  │  └──────┬───────┘ │                 └──────────────────────┘  │
│  │         │          │                                           │
│  │  ┌──────────────┐ │                                           │
│  │  │ LLM Request  │ │                                           │
│  │  │ Queue         │ │                                           │
│  │  └──────────────┘ │                                           │
│  └─────────┬─────────┘                                           │
│            │ WebSocket (wss://)                                   │
└────────────┼─────────────────────────────────────────────────────┘
             │
     ┌───────▼────────┐
     │   Browser       │
     │   React + R3F   │
     │   Three.js      │
     │   (Renderer)    │
     └────────────────┘
```

### Data Flow Summary

1. **Player opens browser** → Loads React SPA → Authenticates (JWT) → Opens WebSocket to Go server
2. **Go server** → Fetches player profile from Postgres → Spawns ship entity in GameState → Starts streaming state updates at 30 TPS
3. **Player types a prompt** → Sent over WebSocket → Go server validates cooldown → Enqueues LLM request
4. **LLM worker** → Dequeues request → Builds context (ship stats, nearby enemies, AI tier limits) → Calls JetStream gRPC → Receives structured JSON behavior → Writes to ship's behavior slot
5. **Game loop** → Every 33ms: reads each ship's behavior → Computes movement/combat → Resolves collisions → Updates state → Serializes delta → Broadcasts via WebSocket
6. **Client** → Receives state update → Interpolates between frames → Renders at 60 FPS
7. **On kill** → Go spawns async goroutine → `UPDATE coins` in Postgres → Broadcasts event

---

## 3. Tech Stack

| Layer | Choice | Justification |
|---|---|---|
| **Frontend Framework** | React 19 + TypeScript | Component model for UI (HUD, shop, auth). TypeScript for type safety across protocol types |
| **3D Rendering** | React Three Fiber (R3F) + drei | Declarative Three.js. drei provides OrbitControls, instanced meshes, shaders, post-processing. Best web 3D ecosystem |
| **Client State** | Zustand | Minimal boilerplate, works natively with R3F's render loop, no context re-render issues |
| **Build Tool** | Vite | Fast HMR, native ESM, excellent TypeScript support |
| **Game Server** | Go 1.22+ | Goroutines for per-connection concurrency, excellent performance for tight game loops, strong standard library |
| **WebSocket** | `github.com/coder/websocket` | Maintained fork of nhooyr/websocket. Context-aware, supports compression, cleaner API than gorilla |
| **Serialization** | MessagePack (`vmihailenco/msgpack` / `@msgpack/msgpack`) | ~30% smaller than JSON, fast encode/decode, schema-less (easier iteration than protobuf), good enough for <500 players |
| **LLM Serving** | JetStream on TPU | Google's native TPU inference server. Continuous batching, PagedAttention, gRPC API. Best throughput on TPU hardware |
| **LLM Model** | Gemma 2 9B (primary) / Gemma 2 2B (fallback) | Google-native = best TPU optimization. 9B handles complex behavior mapping. 2B as fast fallback for high load |
| **Database** | PostgreSQL 16 (self-hosted on GCP) | Zero additional cost vs managed services. Rock-solid. Use `pgx` driver with connection pooling |
| **Auth** | JWT (issued by Go server) | Simple, stateless, no external dependency. Tokens stored in httpOnly cookie or localStorage |
| **Reverse Proxy** | Caddy | Automatic HTTPS via Let's Encrypt, WebSocket proxying, simpler config than nginx |

### Why NOT These Alternatives

| Rejected | Reason |
|---|---|
| Unity/Unreal WebGL | Massive bundle sizes (50-200MB), poor mobile support, overkill for this art style |
| Socket.io | Unnecessary abstraction layer, polling fallback adds complexity, Go support is weak |
| Colyseus / Geckos.js | Node.js-based, less control over game loop timing, worse performance than Go at scale |
| Protobuf | Schema rigidity slows iteration in early phases. MessagePack easier to evolve. Can migrate later if needed |
| External LLM API (OpenAI, etc.) | Per-token cost at scale is prohibitive. You own a TPU — self-hosting is ~free after hardware |
| Supabase (managed) | Extra cost, latency to external service. Self-hosted Postgres on the same machine = 0ms network overhead |
| MongoDB | Relational data (users → profiles → loadouts → items) fits Postgres perfectly. No need for document store |

---

## 4. Project Directory Structure

```
SkyWalker/
├── server/                          # Go game server
│   ├── cmd/
│   │   └── skywalker/
│   │       └── main.go              # Entry point, wires everything together
│   ├── internal/
│   │   ├── config/
│   │   │   └── config.go            # Env vars, configuration loading
│   │   ├── game/
│   │   │   ├── engine.go            # Main 30 TPS game loop
│   │   │   ├── state.go             # GameState: thread-safe entity store
│   │   │   ├── entity.go            # Ship, Projectile structs
│   │   │   ├── physics.go           # Movement, acceleration, spatial hash
│   │   │   ├── combat.go            # Weapons, damage calc, death events
│   │   │   └── behavior.go          # Behavior executor (reads JSON, drives entity)
│   │   ├── network/
│   │   │   ├── hub.go               # Connection registry, broadcast fan-out
│   │   │   ├── client.go            # Per-player WebSocket read/write pumps
│   │   │   └── messages.go          # Message type definitions & codec
│   │   ├── llm/
│   │   │   ├── client.go            # gRPC/HTTP client to JetStream
│   │   │   ├── prompt.go            # System prompt builder (per AI tier)
│   │   │   ├── parser.go            # JSON schema validator + behavior parser
│   │   │   └── queue.go             # Buffered channel work queue
│   │   ├── db/
│   │   │   ├── postgres.go          # pgx connection pool
│   │   │   └── queries.go           # SQL queries (profiles, inventory, items)
│   │   └── auth/
│   │       ├── jwt.go               # Token issue/verify
│   │       └── middleware.go         # HTTP middleware for protected routes
│   ├── migrations/                  # SQL migration files
│   ├── go.mod
│   └── go.sum
│
├── client/                          # React + R3F frontend
│   ├── public/
│   │   └── models/                  # GLTF ship models (converted from Quaternius pack), skybox textures
│   ├── src/
│   │   ├── main.tsx                 # ReactDOM entry
│   │   ├── App.tsx                  # Router, auth gate, layout
│   │   ├── components/
│   │   │   ├── Game.tsx             # R3F <Canvas> wrapper
│   │   │   ├── Scene.tsx            # Lighting, skybox, camera setup
│   │   │   ├── Ship.tsx             # Ship mesh + interpolation logic
│   │   │   ├── Projectile.tsx       # Laser/plasma bolt rendering
│   │   │   ├── Explosion.tsx        # Death explosion particles
│   │   │   └── Starfield.tsx        # Procedural background stars
│   │   ├── ui/
│   │   │   ├── HUD.tsx              # Health bar, shield bar, coins, kill feed
│   │   │   ├── PromptInput.tsx      # Command input + cooldown timer
│   │   │   ├── Shop.tsx             # Upgrade purchase UI
│   │   │   ├── Leaderboard.tsx      # Live scoreboard
│   │   │   └── AuthScreen.tsx       # Login / Register forms
│   │   ├── network/
│   │   │   ├── socket.ts            # WebSocket lifecycle management
│   │   │   ├── protocol.ts          # MessagePack encode/decode helpers
│   │   │   └── interpolation.ts     # Lerp/slerp between server snapshots
│   │   ├── store/
│   │   │   ├── gameStore.ts         # Entity state, snapshots (Zustand)
│   │   │   ├── uiStore.ts           # HUD state, prompt cooldown
│   │   │   └── authStore.ts         # JWT, user info
│   │   └── types/
│   │       └── index.ts             # Shared TypeScript type definitions
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── docs/
│   └── planning/                    # These planning documents
├── scripts/                         # Deployment, DB setup scripts
├── docker-compose.yml               # Local dev: Postgres + Go server
└── README.md
```

---

## 5. Key Design Decisions

### 5.1 Server-Authoritative, Client-as-Renderer

The server owns **all** game state. Clients send only two things:
1. Prompt text (rate-limited by cooldown)
2. Authentication tokens

Clients receive serialized snapshots and render them. There is no client-side prediction because there is no direct input — the ship acts on its own between prompts. This eliminates entire categories of netcode complexity (reconciliation, rollback, input buffering).

### 5.2 Structured Behavior Output (Not Free-Form Code)

The LLM does **not** generate executable code. It maps natural language to a fixed vocabulary of ~25 behavior primitives with parameters. The server validates the JSON schema before applying it. This is:
- **Secure**: no code injection possible
- **Deterministic**: same behavior JSON = identical execution every tick
- **Fast**: tiny output token count (~50-80 tokens) = fast inference
- **Reliable**: small models (2B-9B) handle structured mapping well

### 5.3 Single Continuous World (Not Instanced Arenas)

One shared universe for all players. Simpler architecture, more emergent gameplay, stronger social dynamics. Spatial partitioning (grid hash) handles physics scaling. If player count exceeds single-server capacity (~500-1000), we shard by spatial region later — but that's a Phase 7+ concern.

### 5.4 Async Database Writes

Reads happen synchronously at login (fetch loadout). All writes (coin awards, kill tracking) happen asynchronously via a background goroutine with a buffered channel. The game loop never blocks on I/O.

### 5.5 AI Tier as Compute Balancer

New players (Tier 1) get short prompts, basic vocabulary, minimal context → cheap LLM calls. Veterans (Tier 5) get full vocabulary, conditional chains, battlefield awareness → richer calls but they earned it. This naturally distributes TPU load and creates meaningful progression.

---

## 6. Performance Budget

| Metric | Target | Rationale |
|---|---|---|
| Server tick rate | 30 TPS (33ms/tick) | Sufficient for space combat. Not twitch gameplay |
| Client frame rate | 60 FPS | Standard for web 3D |
| WebSocket message size | <5 KB per tick per client | 100 entities × ~40 bytes + overhead |
| Client bundle size | <2 MB (gzipped) | Fast initial load. Ship models loaded lazily |
| LLM response latency | <2 seconds | Acceptable since it's async. Ship keeps prior behavior while waiting |
| Prompt cooldown | 30 seconds | Rate limits TPU usage. 100 players = ~3.3 req/s to LLM |
| Max concurrent players | 200-500 (Phase 1 target) | Single Go server can handle this comfortably |
| DB write latency | Non-blocking | Async goroutine, doesn't affect game loop |

---

## 7. Security Model

| Concern | Mitigation |
|---|---|
| **Prompt injection** | LLM output is validated against a strict JSON schema. Invalid output = ship keeps previous behavior. LLM never executes code |
| **Client tampering** | Server-authoritative. Client sends only prompts and auth tokens. All game state computed server-side |
| **Economy exploits** | All coin awards and purchases validated on server. Prices checked against DB catalog, not client claims |
| **WebSocket abuse** | Rate limiting per connection. Max message size. Cooldown enforced server-side per player ID |
| **Auth** | JWT with short expiry (1h) + refresh tokens. Passwords hashed with bcrypt. HTTPS enforced via Caddy |
| **SQL injection** | All queries use parameterized statements via `pgx`. No string concatenation |
| **DoS** | Connection limits per IP. Prompt length limits. WebSocket compression to reduce bandwidth abuse surface |

---

## 8. Phase Roadmap Summary

| Phase | Title | Outcome |
|---|---|---|
| **1** | Foundation & Project Setup | Go server + React/R3F client connected via WebSocket. One cube rendered in 3D space |
| **2** | Multiplayer State Sync | Multiple players in shared world, 30 TPS loop, client interpolation, MessagePack protocol |
| **3** | LLM Behavior Pipeline | TPU serving Gemma 2, prompt→behavior JSON→ship movement, cooldown system |
| **4** | Combat & Physics | Weapons, projectiles, shields, HP, collision detection, death, respawn |
| **5** | Persistence, Auth & Economy | PostgreSQL, JWT auth, player profiles, coins, upgrades, AI tiers, shop |
| **6** | Visual Polish & Production | 3D models, VFX, UI/HUD, audio, deployment, monitoring, launch |

Each phase builds on the previous and produces a demonstrable milestone. See individual phase documents for detailed task breakdowns.