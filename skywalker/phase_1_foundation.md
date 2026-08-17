# Phase 1: Foundation & Project Setup

## 1. Objective

Stand up the entire development skeleton: a Go game server, a React + React Three Fiber client, and a WebSocket connection between them. By the end of this phase, a player opens a browser and sees a single 3D cube floating in space, with its position driven by the Go server. This proves the full render-network-server pipeline works end to end.

**No gameplay, no multiplayer, no database.** Just the bones.

---

## 2. Go Server Setup

### 2.1 Project Initialization

```bash
cd server/
go mod init github.com/yourusername/skywalker/server
```

**Key dependencies:**

| Package | Purpose | Install |
|---|---|---|
| `github.com/coder/websocket` | WebSocket server | `go get github.com/coder/websocket` |
| `github.com/vmihailenco/msgpack/v5` | MessagePack serialization | `go get github.com/vmihailenco/msgpack/v5` |
| `github.com/rs/zerolog` | Structured logging (fast, zero-alloc) | `go get github.com/rs/zerolog` |

### 2.2 Entry Point (`cmd/skywalker/main.go`)

Responsibilities:
- Parse config from environment variables (port, allowed origins)
- Create an HTTP mux
- Register WebSocket upgrade endpoint at `/ws`
- Register a health check endpoint at `/health`
- Start HTTP server with graceful shutdown on SIGINT/SIGTERM

```go
// Pseudocode structure
func main() {
    cfg := config.Load()
    hub := network.NewHub()
    
    mux := http.NewServeMux()
    mux.HandleFunc("/ws", hub.HandleWebSocket)
    mux.HandleFunc("/health", healthHandler)
    
    srv := &http.Server{Addr: cfg.Addr, Handler: mux}
    
    // Graceful shutdown
    go func() {
        sigCh := make(chan os.Signal, 1)
        signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
        <-sigCh
        srv.Shutdown(context.Background())
    }()
    
    log.Info().Str("addr", cfg.Addr).Msg("server starting")
    srv.ListenAndServe()
}
```

### 2.3 Configuration (`internal/config/config.go`)

Environment-based config using `os.Getenv` with sensible defaults:

```go
type Config struct {
    Addr           string // ":8080"
    AllowedOrigins []string // ["http://localhost:5173"]
    TickRate       int    // 30
}
```

No config files — environment variables only. Simple, 12-factor compliant.

### 2.4 WebSocket Hub (`internal/network/hub.go`)

The hub manages all active WebSocket connections.

**Phase 1 scope** (minimal):
- `clients` map: connection ID → client
- `HandleWebSocket(w, r)`: upgrades HTTP to WebSocket, creates client, registers it
- `Broadcast(msg []byte)`: sends a message to all connected clients
- Thread-safe via a mutex or channel-based register/unregister pattern

```go
type Hub struct {
    mu      sync.RWMutex
    clients map[string]*Client
    nextID  uint64
}

func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
    conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
        OriginPatterns: h.allowedOrigins,
    })
    // ... create Client, register, start read/write pumps
}
```

### 2.5 Client Connection (`internal/network/client.go`)

Each WebSocket connection gets a `Client` struct with two goroutines:

- **Read pump**: reads messages from WebSocket, parses them (Phase 1: just log them)
- **Write pump**: reads from a buffered channel, writes to WebSocket

```go
type Client struct {
    ID     string
    conn   *websocket.Conn
    send   chan []byte    // Buffered channel for outgoing messages
    hub    *Hub
}

func (c *Client) writePump(ctx context.Context) {
    for msg := range c.send {
        c.conn.Write(ctx, websocket.MessageBinary, msg)
    }
}

func (c *Client) readPump(ctx context.Context) {
    for {
        _, data, err := c.conn.Read(ctx)
        // Phase 1: just log received data
    }
}
```

**Buffer size**: 256 messages in the `send` channel. If a client can't keep up, drop them (slow consumer protection).

### 2.6 Message Types (`internal/network/messages.go`)

Define a baseline message envelope:

```go
const (
    MsgTypeStateUpdate  uint8 = 1
    MsgTypePrompt       uint8 = 2
    MsgTypeError        uint8 = 3
)

type Envelope struct {
    Type    uint8       `msgpack:"t"`
    Payload msgpack.RawMessage `msgpack:"p"`
}

// Phase 1 payload: minimal entity state
type EntityState struct {
    ID       uint32    `msgpack:"id"`
    Position [3]float32 `msgpack:"pos"`
    Rotation [4]float32 `msgpack:"rot"` // quaternion
}

type StateUpdatePayload struct {
    Tick     uint64        `msgpack:"tick"`
    Entities []EntityState `msgpack:"entities"`
}
```

### 2.7 Minimal Game Loop (`internal/game/engine.go`)

A basic ticker that runs at 30 TPS and broadcasts a hardcoded entity position:

```go
func (e *Engine) Run(ctx context.Context) {
    ticker := time.NewTicker(time.Second / time.Duration(e.tickRate))
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            e.tick++
            // Phase 1: just broadcast a static entity
            state := StateUpdatePayload{
                Tick: e.tick,
                Entities: []EntityState{
                    {ID: 1, Position: [3]float32{0, 0, 0}, Rotation: [4]float32{0, 0, 0, 1}},
                },
            }
            data, _ := msgpack.Marshal(&Envelope{Type: MsgTypeStateUpdate, Payload: marshalPayload(state)})
            e.hub.Broadcast(data)
        }
    }
}
```

---

## 3. React + R3F Client Setup

### 3.1 Project Initialization

```bash
npm create vite@latest client -- --template react-ts
cd client/
npm install
```

**Key dependencies:**

| Package | Purpose |
|---|---|
| `three` | Three.js core |
| `@react-three/fiber` | React renderer for Three.js |
| `@react-three/drei` | Helpers (OrbitControls, Stars, etc.) |
| `@msgpack/msgpack` | MessagePack decode/encode |
| `zustand` | State management |

```bash
npm install three @react-three/fiber @react-three/drei @msgpack/msgpack zustand
npm install -D @types/three
```

### 3.2 Vite Configuration (`vite.config.ts`)

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'http://localhost:8080',
        ws: true,
      },
    },
  },
})
```

The proxy lets the client connect to `/ws` during development without CORS issues.

### 3.3 Application Entry (`src/App.tsx`)

```tsx
function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Canvas camera={{ position: [0, 5, 10], fov: 75 }}>
        <Scene />
      </Canvas>
      {/* HUD overlay will go here in later phases */}
    </div>
  )
}
```

### 3.4 3D Scene (`src/components/Scene.tsx`)

Phase 1 scene setup:

- **Lighting**: One ambient light + one directional light
- **Background**: `<Stars>` from drei (procedural starfield)
- **Camera**: `<OrbitControls>` — player can orbit/zoom freely (since there's no direct ship control, free camera is the right UX)
- **Entity**: A `<Ship>` component that reads position from the game store

```tsx
function Scene() {
  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <Stars radius={300} depth={60} count={5000} factor={4} fade />
      <OrbitControls />
      <Ship />
      <gridHelper args={[100, 100, '#1a1a2e', '#1a1a2e']} />
    </>
  )
}
```

### 3.5 Ship Component (`src/components/Ship.tsx`)

Phase 1: a simple colored box. Later replaced with a GLTF model.

```tsx
function Ship() {
  const meshRef = useRef<THREE.Mesh>(null)
  const position = useGameStore((s) => s.entities[0]?.position ?? [0, 0, 0])

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.set(...position)
    }
  })

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1, 0.5, 2]} />
      <meshStandardMaterial color="#00ff88" emissive="#00ff88" emissiveIntensity={0.3} />
    </mesh>
  )
}
```

### 3.6 WebSocket Client (`src/network/socket.ts`)

Manages the WebSocket lifecycle:

```typescript
class GameSocket {
  private ws: WebSocket | null = null
  private url: string

  constructor(url: string) {
    this.url = url
  }

  connect() {
    this.ws = new WebSocket(this.url)
    this.ws.binaryType = 'arraybuffer'

    this.ws.onopen = () => console.log('[WS] Connected')

    this.ws.onmessage = (event) => {
      const envelope = decode(new Uint8Array(event.data)) as Envelope
      this.handleMessage(envelope)
    }

    this.ws.onclose = () => {
      console.log('[WS] Disconnected, reconnecting in 3s...')
      setTimeout(() => this.connect(), 3000)
    }
  }

  private handleMessage(envelope: Envelope) {
    switch (envelope.t) {
      case MsgType.StateUpdate:
        useGameStore.getState().applyStateUpdate(envelope.p)
        break
    }
  }

  send(data: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data)
    }
  }
}
```

**Important**: `binaryType = 'arraybuffer'` is required for MessagePack binary frames.

### 3.7 Game Store (`src/store/gameStore.ts`)

Zustand store for entity state:

```typescript
interface Entity {
  id: number
  position: [number, number, number]
  rotation: [number, number, number, number]
}

interface GameState {
  entities: Record<number, Entity>
  currentTick: number
  applyStateUpdate: (payload: StateUpdatePayload) => void
}

const useGameStore = create<GameState>((set) => ({
  entities: {},
  currentTick: 0,
  applyStateUpdate: (payload) => {
    const entities: Record<number, Entity> = {}
    for (const e of payload.entities) {
      entities[e.id] = { id: e.id, position: e.pos, rotation: e.rot }
    }
    set({ entities, currentTick: payload.tick })
  },
}))
```

---

## 4. Development Workflow

### 4.1 Running Locally

**Terminal 1 — Go server:**
```bash
cd server/
go run ./cmd/skywalker/
# Starts on :8080
```

**Terminal 2 — React client:**
```bash
cd client/
npm run dev
# Starts on :5173, proxies /ws to :8080
```

### 4.2 Hot Reload

- **Client**: Vite HMR — instant updates on save
- **Server**: Use `air` for Go hot reload during development
  ```bash
  go install github.com/air-verse/air@latest
  cd server/ && air
  ```

### 4.3 Makefile (Optional)

```makefile
.PHONY: dev-server dev-client dev

dev-server:
	cd server && air

dev-client:
	cd client && npm run dev

dev:
	make -j2 dev-server dev-client
```

---

## 5. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 1.1 | Initialize Go module with dependencies | `go build ./...` succeeds with zero errors |
| 1.2 | Implement Config loading | Server reads `PORT`, `ALLOWED_ORIGINS` from env; falls back to defaults |
| 1.3 | Implement WebSocket Hub + Client | Browser connects to `ws://localhost:8080/ws` without errors. Server logs connection |
| 1.4 | Implement message envelope + MessagePack encoding | Server can serialize an `Envelope{Type: StateUpdate}` and client can decode it |
| 1.5 | Implement minimal game loop (30 TPS ticker) | Server broadcasts a static entity position 30 times per second |
| 1.6 | Scaffold React + R3F client | `npm run dev` shows a black canvas with stars and a grid |
| 1.7 | Implement WebSocket client with reconnect | Client connects to `/ws`, handles disconnects with 3s retry |
| 1.8 | Implement Zustand game store | Store receives decoded state updates and stores entity data |
| 1.9 | Render entity from server state | A green box appears at the position specified by the server |
| 1.10 | Verify full pipeline | Change the hardcoded position in Go → restart server → box moves to new position in browser |

---

## 6. Milestone Definition

Phase 1 is **complete** when:

> A developer runs the Go server and React client locally. Opening `http://localhost:5173` in a browser displays a 3D starfield scene with a green box at coordinates `(0, 0, 0)`. The box's position is determined entirely by the Go server and transmitted over a WebSocket using MessagePack-encoded binary frames at 30 TPS. The browser console shows no errors. Disconnecting and reconnecting the WebSocket works within 3 seconds.

---

## 7. Files to Create

```
server/
├── cmd/skywalker/main.go
├── internal/
│   ├── config/config.go
│   ├── game/engine.go
│   └── network/
│       ├── hub.go
│       ├── client.go
│       └── messages.go
├── go.mod
└── go.sum

client/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── Game.tsx
│   │   ├── Scene.tsx
│   │   └── Ship.tsx
│   ├── network/
│   │   └── socket.ts
│   ├── store/
│   │   └── gameStore.ts
│   └── types/
│       └── index.ts
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 8. Estimated Complexity

- **Go server**: ~300 lines of code
- **React client**: ~200 lines of code
- **Total new files**: ~12
- **External dependencies**: 6 (3 Go, 3 npm)

This phase is intentionally minimal. It exists to validate the pipeline and establish project structure. No shortcuts — clean code from the start because every subsequent phase builds on these foundations.
