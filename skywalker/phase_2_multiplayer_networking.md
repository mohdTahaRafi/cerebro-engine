# Phase 2: Multiplayer State Synchronization

## 1. Objective

Evolve the single-entity proof-of-concept into a proper multiplayer system. Multiple players connect simultaneously, each gets a ship entity, and all clients see all ships moving in real time. The server runs a deterministic 30 TPS game loop, and clients perform frame interpolation for smooth 60 FPS rendering.

By the end of this phase: 3 browser tabs open → 3 colored cubes in each tab, each moving with basic autonomous drift, updating at 30 TPS server-side but rendering smoothly at 60 FPS client-side.

---

## 2. Server-Side: Game Loop Architecture

### 2.1 The Tick Loop (`internal/game/engine.go`)

The engine is the heart of the server. It owns the single source of truth: the `GameState`.

```
┌─────────────────────────────────────────────────┐
│                  One Tick (33ms)                  │
│                                                   │
│  1. Process Inputs (prompt results, join/leave)   │
│  2. Execute Behaviors (move entities)             │
│  3. Resolve Physics (collisions) [Phase 4]        │
│  4. Build Snapshot                                │
│  5. Broadcast Snapshot to all clients             │
│                                                   │
│  Budget: <10ms computation, rest is idle          │
└─────────────────────────────────────────────────┘
```

**Critical design rule**: The game loop runs on a **single goroutine**. No locks needed inside the tick. External inputs (new connections, prompts) are fed in via channels that the loop drains at the start of each tick.

```go
type Engine struct {
    tickRate   int
    tick       uint64
    state      *GameState
    hub        *network.Hub

    // Channels for cross-goroutine communication
    joinCh     chan JoinRequest
    leaveCh    chan string       // player ID
    promptCh   chan PromptResult // from LLM workers [Phase 3]
}

func (e *Engine) Run(ctx context.Context) {
    ticker := time.NewTicker(time.Second / time.Duration(e.tickRate))
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            e.tick++
            e.processInputs()    // drain channels
            e.updateEntities()   // apply behaviors
            e.buildAndBroadcast() // serialize + send
        }
    }
}
```

### 2.2 Game State (`internal/game/state.go`)

```go
type GameState struct {
    Ships map[string]*Ship  // keyed by player ID
}

type Ship struct {
    ID        string
    Position  Vec3
    Velocity  Vec3
    Rotation  Quaternion
    Color     [3]float32     // unique per player
    
    // Phase 3+: behavior, health, shields, weapons
}

type Vec3 struct {
    X, Y, Z float32
}

type Quaternion struct {
    X, Y, Z, W float32
}
```

### 2.3 Entity Update Logic

Phase 2 ships have simple autonomous drift to prove the system works:

```go
func (e *Engine) updateEntities() {
    for _, ship := range e.state.Ships {
        // Phase 2: basic drift (replaced by behavior system in Phase 3)
        ship.Position.X += ship.Velocity.X * e.dt
        ship.Position.Y += ship.Velocity.Y * e.dt
        ship.Position.Z += ship.Velocity.Z * e.dt
        
        // Boundary wrapping (keep ships in a 1000x1000x1000 arena)
        ship.Position.X = wrapCoord(ship.Position.X, -500, 500)
        ship.Position.Y = wrapCoord(ship.Position.Y, -500, 500)
        ship.Position.Z = wrapCoord(ship.Position.Z, -500, 500)
    }
}
```

Each ship gets a random initial velocity on spawn. This is throwaway code — Phase 3 replaces it with the behavior system.

### 2.4 Player Join / Leave

**Join flow:**
1. Client connects WebSocket → Hub creates `Client` struct → sends `JoinRequest` to `Engine.joinCh`
2. Engine drains `joinCh` at start of tick → creates new `Ship` with random position, random color, random velocity → adds to `GameState.Ships`
3. Engine sends a `Welcome` message to the new client: their assigned player ID + current full state snapshot

**Leave flow:**
1. WebSocket disconnects (read pump returns error) → Hub sends player ID to `Engine.leaveCh`
2. Engine drains `leaveCh` → removes ship from `GameState.Ships`
3. Next broadcast naturally excludes the removed ship — other clients see it disappear

```go
type JoinRequest struct {
    PlayerID string
    Client   *network.Client
}

func (e *Engine) processInputs() {
    // Drain all pending joins
    for {
        select {
        case req := <-e.joinCh:
            ship := &Ship{
                ID:       req.PlayerID,
                Position: randomPosition(),
                Velocity: randomVelocity(10), // 10 units/sec max
                Color:    randomColor(),
            }
            e.state.Ships[req.PlayerID] = ship
            e.sendWelcome(req.Client, req.PlayerID)
        default:
            goto doneJoins
        }
    }
doneJoins:

    // Drain all pending leaves
    for {
        select {
        case id := <-e.leaveCh:
            delete(e.state.Ships, id)
        default:
            return
        }
    }
}
```

---

## 3. Message Protocol

### 3.1 Message Type Enum (Extended)

```go
const (
    MsgTypeStateUpdate  uint8 = 1  // Server → Client: world state snapshot
    MsgTypeWelcome      uint8 = 2  // Server → Client: your player ID + initial state
    MsgTypePrompt       uint8 = 3  // Client → Server: behavior prompt [Phase 3]
    MsgTypeEvent        uint8 = 4  // Server → Client: kill, death, coin [Phase 4+]
    MsgTypeError        uint8 = 5  // Server → Client: error message
    MsgTypePing         uint8 = 6  // Bidirectional: keepalive
    MsgTypePong         uint8 = 7  // Bidirectional: keepalive response
)
```

### 3.2 State Update Payload

Sent 30 times per second to every connected client:

```go
type StateUpdatePayload struct {
    Tick     uint64              `msgpack:"t"`
    Entities []EntitySnapshot    `msgpack:"e"`
}

type EntitySnapshot struct {
    ID       string       `msgpack:"i"`    // player ID (truncated hash for bandwidth)
    Position [3]float32   `msgpack:"p"`    // x, y, z
    Rotation [4]float32   `msgpack:"r"`    // quaternion (x, y, z, w)
    Color    [3]float32   `msgpack:"c"`    // RGB 0-1
    // Phase 4+: health, shield, weapon state, behavior indicator
}
```

**Wire size estimate per entity**: ~60 bytes (with MessagePack overhead)
**100 entities**: ~6 KB per tick → ~180 KB/s per client → very manageable

### 3.3 Welcome Payload

Sent once when a player connects:

```go
type WelcomePayload struct {
    PlayerID string             `msgpack:"pid"`
    Tick     uint64             `msgpack:"t"`
    Entities []EntitySnapshot   `msgpack:"e"`   // full current state
}
```

### 3.4 Short Field Names

All msgpack tags use 1-3 character keys to minimize wire size. This is intentional — readability is in the Go struct names, compactness is on the wire.

---

## 4. Client-Side Interpolation

### 4.1 The Problem

Server sends state at 30 TPS. The client renders at 60 FPS. Without interpolation, entities teleport between positions every 33ms, causing jerky movement.

### 4.2 The Solution: Entity Interpolation Buffer

Each entity stores the **two most recent snapshots** from the server. The client renders at a position interpolated between them, running ~1 tick behind real-time.

```
Server ticks:     T1 ---- T2 ---- T3 ---- T4
Client renders:        ^  ^  ^  ^  ^  ^  ^
                       |  |  |  |
                       Interpolating between T1→T2
                                    Interpolating between T2→T3
```

The ~33ms delay is imperceptible to players in a prompt-driven game.

### 4.3 Implementation (`src/network/interpolation.ts`)

```typescript
interface Snapshot {
  tick: number
  position: [number, number, number]
  rotation: [number, number, number, number]
}

interface InterpolatedEntity {
  id: string
  color: [number, number, number]
  prev: Snapshot
  curr: Snapshot
}

class InterpolationBuffer {
  private entities: Map<string, InterpolatedEntity> = new Map()
  private tickDuration: number = 1000 / 30  // 33.33ms
  private lastUpdateTime: number = 0

  applyServerUpdate(payload: StateUpdatePayload) {
    this.lastUpdateTime = performance.now()
    
    for (const entity of payload.e) {
      const existing = this.entities.get(entity.i)
      if (existing) {
        // Shift current → previous, new data → current
        existing.prev = existing.curr
        existing.curr = {
          tick: payload.t,
          position: entity.p,
          rotation: entity.r,
        }
      } else {
        // New entity — snap to position (no interpolation for first frame)
        const snapshot = { tick: payload.t, position: entity.p, rotation: entity.r }
        this.entities.set(entity.i, {
          id: entity.i,
          color: entity.c,
          prev: snapshot,
          curr: snapshot,
        })
      }
    }

    // Remove entities no longer in the update
    const activeIds = new Set(payload.e.map(e => e.i))
    for (const id of this.entities.keys()) {
      if (!activeIds.has(id)) this.entities.delete(id)
    }
  }

  getInterpolatedState(): InterpolatedEntity[] {
    const elapsed = performance.now() - this.lastUpdateTime
    const t = Math.min(elapsed / this.tickDuration, 1.0) // 0..1

    return Array.from(this.entities.values()).map(entity => ({
      ...entity,
      // The actual interpolated values are computed in the render loop
      // We store `t` globally and let useFrame() do the lerp
    }))
  }
}
```

### 4.4 Lerp in the Render Loop

```tsx
// In Ship.tsx
useFrame(() => {
  if (!meshRef.current || !entity) return

  const elapsed = performance.now() - lastUpdateTime
  const t = Math.min(elapsed / TICK_DURATION, 1.0)

  // Lerp position
  meshRef.current.position.lerpVectors(
    new THREE.Vector3(...entity.prev.position),
    new THREE.Vector3(...entity.curr.position),
    t
  )

  // Slerp rotation
  const prevQuat = new THREE.Quaternion(...entity.prev.rotation)
  const currQuat = new THREE.Quaternion(...entity.curr.rotation)
  meshRef.current.quaternion.slerpQuaternions(prevQuat, currQuat, t)
})
```

---

## 5. Rendering Multiple Entities

### 5.1 Entity Collection Component

```tsx
function Entities() {
  const entities = useGameStore((s) => s.entities)

  return (
    <>
      {Object.values(entities).map((entity) => (
        <Ship key={entity.id} entity={entity} />
      ))}
    </>
  )
}
```

### 5.2 Player Identification

The `Welcome` message tells the client their own player ID. The store saves it, and the camera can auto-focus on the player's own ship:

```tsx
function CameraFollow() {
  const myShip = useGameStore((s) => {
    const myId = s.myPlayerId
    return myId ? s.entities[myId] : null
  })

  useFrame(({ camera }) => {
    if (myShip) {
      // Smoothly follow our ship's interpolated position
      const target = new THREE.Vector3(...myShip.position)
      camera.lookAt(target)
    }
  })

  return <OrbitControls target={myShip ? myShip.position : [0,0,0]} />
}
```

### 5.3 Distinct Ship Colors

Each ship gets a random color assigned server-side. This provides visual distinction before we have proper ship models.

Use a set of visually distinct, bright colors from a predefined palette (avoids near-identical colors):

```go
var shipColors = [][3]float32{
    {0.0, 1.0, 0.53},  // green
    {0.0, 0.75, 1.0},  // cyan
    {1.0, 0.3, 0.3},   // red
    {1.0, 0.85, 0.0},  // yellow
    {0.7, 0.3, 1.0},   // purple
    {1.0, 0.5, 0.0},   // orange
    {0.3, 0.5, 1.0},   // blue
    {1.0, 0.4, 0.7},   // pink
}
```

---

## 6. Connection Lifecycle & Edge Cases

### 6.1 Reconnection

The client auto-reconnects on disconnect (3s delay). On reconnection:
1. WebSocket opens → server sends new `Welcome` with a **new** player ID and ship
2. Old ship was already removed from GameState on disconnect
3. The client resets its local state and starts fresh

In Phase 5 (auth), reconnecting with a valid JWT will restore the same player identity and ship.

### 6.2 Slow Consumers

If a client's `send` channel fills up (256 messages), the Hub closes their connection. This prevents one slow client from backing up the broadcast:

```go
func (h *Hub) Broadcast(msg []byte) {
    h.mu.RLock()
    defer h.mu.RUnlock()
    
    for _, client := range h.clients {
        select {
        case client.send <- msg:
            // sent
        default:
            // channel full — kick this client
            go client.Close()
        }
    }
}
```

### 6.3 Maximum Players

Set a configurable hard cap (e.g., 200). If the server is full, reject the WebSocket upgrade with HTTP 503:

```go
func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
    if h.ClientCount() >= h.maxPlayers {
        http.Error(w, "server full", http.StatusServiceUnavailable)
        return
    }
    // ... proceed with upgrade
}
```

---

## 7. Keepalive / Heartbeat

WebSocket connections can silently die (especially on mobile, behind NAT). Implement a ping/pong heartbeat:

**Server-side** (in client write pump):
```go
// Send ping every 15 seconds
// If no pong received within 10 seconds, close connection
ticker := time.NewTicker(15 * time.Second)
for {
    select {
    case <-ticker.C:
        c.conn.Ping(ctx)
    case msg := <-c.send:
        c.conn.Write(ctx, websocket.MessageBinary, msg)
    }
}
```

**Client-side**: The browser WebSocket API handles pong frames automatically. No code needed.

---

## 8. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 2.1 | Refactor Engine to use channel-based input processing | Engine.Run() drains joinCh/leaveCh each tick, no mutex inside the loop |
| 2.2 | Implement GameState with Ship map | Ships can be added/removed. Each has position, velocity, rotation, color |
| 2.3 | Implement entity movement (random drift) | Ships move autonomously each tick with velocity and boundary wrapping |
| 2.4 | Implement player join flow (WebSocket → channel → Engine) | Connecting a WebSocket spawns a ship at random position |
| 2.5 | Implement player leave flow (disconnect → remove entity) | Closing the tab removes the ship within 1 tick |
| 2.6 | Implement Welcome message type | Client receives its player ID and full initial state on connect |
| 2.7 | Extend state update to include all entities | StateUpdate contains all ships with positions, rotations, colors |
| 2.8 | Implement client interpolation buffer | Entities move smoothly between server ticks at 60 FPS |
| 2.9 | Render all entities with distinct colors | Opening 3 tabs shows 3 colored cubes in each tab |
| 2.10 | Implement slow consumer protection | Filling the send buffer kicks the client cleanly |
| 2.11 | Implement keepalive ping/pong | Idle connections stay alive. Dead connections detected within 25s |
| 2.12 | Add player count cap | 201st connection gets HTTP 503 |

---

## 9. Milestone Definition

Phase 2 is **complete** when:

> Three browser tabs connect to the same Go server. Each tab shows all three ships (colored cubes) drifting through 3D space with random velocities. Movement is smooth at 60 FPS despite the server updating at 30 TPS (interpolation works). Closing a tab removes that ship from the other tabs within one tick. Opening a 4th tab shows 4 ships in all tabs. The server logs confirm 30 TPS tick rate is maintained with zero dropped ticks.

---

## 10. Performance Validation

At the end of Phase 2, measure and log:

| Metric | How to Measure | Target |
|---|---|---|
| Tick computation time | `time.Since()` around the tick body | <5ms for 100 entities |
| Broadcast time | `time.Since()` around `hub.Broadcast()` | <2ms for 100 clients |
| Memory per connection | `runtime.MemStats` | <50 KB per client |
| Wire size per tick | `len(serializedPayload)` | <10 KB for 100 entities |

Log these every 100 ticks during development. This establishes baselines for future optimization.
