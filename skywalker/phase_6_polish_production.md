# Phase 6: Visual Polish, UI & Production Deployment

## 1. Objective

Transform the functional game into a visually compelling, production-ready experience. Replace placeholder cubes with 3D ship models, add particle effects and post-processing, build a polished UI, configure deployment on GCP, and set up monitoring. This is the launch phase.

---

## 2. 3D Ship Models & Assets

### 2.1 Asset Strategy — RESOLVED

We have the **Quaternius Ultimate Spaceship Pack (May 2021)** in the repo at:
`Ultimate Spaceships - May 2021-20260410T165450Z-3-001/Ultimate Spaceships - May 2021/`

**11 ship models** available, each with glTF + FBX + OBJ + Blend source, and 5 color texture variants (Blue, Green, Orange, Purple, Red):

| Ship | glTF Size | Style Notes |
|---|---|---|
| **Striker** | 2.6 MB | Smallest, agile fighter — ideal default/starter hull |
| **Dispatcher** | 3.0 MB | Utility frame — good for support class |
| **Insurgent** | 3.1 MB | Asymmetric, menacing — raider/pirate class |
| **Bob** | 3.5 MB | Compact, rounded — light cruiser |
| **Executioner** | 4.1 MB | Heavy angular — assault class |
| **Imperial** | 4.3 MB | Large capital-style — heavy tank |
| **Omen** | 4.2 MB | Sleek, dark — stealth class |
| **Pancake** | 4.5 MB | Flat saucer — drone carrier |
| **Challenger** | 4.5 MB | Multi-engine — medium cruiser |
| **Zenith** | 4.4 MB | Tall, imposing — command ship |
| **Spitfire** | 4.5 MB | Aggressive wide-body — gunship |

**Format notes:**
- glTF 2.0, exported via Khronos Blender I/O v1.5.17
- Textures are external PNG files (not embedded), one material with `baseColorTexture`
- Non-metallic PBR (`metallicFactor: 0`)
- Must be converted to `.glb` (single binary) for production to bundle geometry + textures into one file
- The 5 color variants per ship map perfectly to team colors or player customization tiers

### 2.2 Asset Build Pipeline (glTF → GLB Conversion)

The source `.gltf` files reference external PNG textures via relative paths. For web delivery this means N+1 HTTP requests per model (geometry + each texture). Convert to `.glb` which packs everything into a single binary.

**Tool:** `gltf-pipeline` (Cesium, npm package)

```bash
npm install -D gltf-pipeline
```

**Build script** (`client/scripts/convert-models.sh`):

```bash
#!/usr/bin/env bash
set -euo pipefail

SRC_ROOT="Ultimate Spaceships - May 2021-20260410T165450Z-3-001/Ultimate Spaceships - May 2021"
OUT_DIR="client/public/models/ships"
TEX_DIR="client/public/models/ships/textures"

mkdir -p "$OUT_DIR" "$TEX_DIR"

SHIPS=(Bob Challenger Dispatcher Executioner Imperial Insurgent Omen Pancake Spitfire Striker Zenith)
COLORS=(Blue Green Orange Purple Red)

for ship in "${SHIPS[@]}"; do
  echo "Converting $ship → GLB..."
  npx gltf-pipeline -i "$SRC_ROOT/$ship/glTF/$ship.gltf" -o "$OUT_DIR/$ship.glb" --binary
  # Copy color variant textures for runtime swapping
  for color in "${COLORS[@]}"; do
    cp "$SRC_ROOT/$ship/Textures/${ship}_${color}.png" "$TEX_DIR/"
  done
done

echo "Done. $(ls "$OUT_DIR"/*.glb | wc -l) GLB models + $(ls "$TEX_DIR"/*.png | wc -l) textures."
```

**When to run:** Once during initial setup, and again if source models are updated. Not part of `vite build` — the GLB outputs are committed to `client/public/models/`.

### 2.3 Ship Models by Hull Type

Map hull IDs to distinct model files:

```typescript
const HULL_MODELS: Record<string, string> = {
  'hull_starter':  '/models/ships/Striker.glb',
  'hull_light':    '/models/ships/Bob.glb',
  'hull_medium':   '/models/ships/Challenger.glb',
  'hull_assault':  '/models/ships/Executioner.glb',
  'hull_heavy':    '/models/ships/Imperial.glb',
  'hull_stealth':  '/models/ships/Omen.glb',
  'hull_raider':   '/models/ships/Insurgent.glb',
  'hull_support':  '/models/ships/Dispatcher.glb',
  'hull_carrier':  '/models/ships/Pancake.glb',
  'hull_gunship':  '/models/ships/Spitfire.glb',
  'hull_command':  '/models/ships/Zenith.glb',
}
```

**Color variants** are applied by swapping the texture at runtime rather than loading separate models:

```typescript
const SHIP_COLORS = ['Blue', 'Green', 'Orange', 'Purple', 'Red'] as const;
// Texture path: /models/ships/textures/{ShipName}_{Color}.png
```

### 2.4 GLTF Loading in R3F

Use drei's `useGLTF` with preloading:

```tsx
import { useGLTF } from '@react-three/drei'

function ShipModel({ hullId, ...props }: { hullId: string }) {
  const modelPath = HULL_MODELS[hullId] ?? HULL_MODELS['hull_starter']
  const { scene } = useGLTF(modelPath)
  
  return <primitive object={scene.clone()} {...props} />
}

// Preload all models on app init
Object.values(HULL_MODELS).forEach(path => useGLTF.preload(path))
```

### 2.5 Ship Customization Visuals

Color tinting per player using the hull material:

```tsx
useEffect(() => {
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = child.material.clone()
      child.material.color.setRGB(...entity.color)
      child.material.emissive.setRGB(...entity.color)
      child.material.emissiveIntensity = 0.15
    }
  })
}, [entity.color])
```

---

## 3. Visual Effects (VFX)

### 3.1 Engine Exhaust Trail

Particles emitting from behind the ship, scaled by velocity:

```tsx
function EngineTrail({ position, velocity }: { position: Vec3, velocity: Vec3 }) {
  const trailRef = useRef<THREE.Points>(null)
  const particles = useMemo(() => new Float32Array(100 * 3), []) // 100 particle ring buffer
  const writeIndex = useRef(0)

  useFrame(() => {
    // Add new particle at ship's rear
    const i = writeIndex.current % 100
    particles[i * 3] = position[0]
    particles[i * 3 + 1] = position[1]
    particles[i * 3 + 2] = position[2]
    writeIndex.current++
    
    if (trailRef.current) {
      trailRef.current.geometry.attributes.position.needsUpdate = true
    }
  })

  const speed = Math.sqrt(velocity[0]**2 + velocity[1]**2 + velocity[2]**2)
  if (speed < 2) return null  // no trail when nearly stationary

  return (
    <points ref={trailRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={particles} count={100} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.3} color="#00aaff" transparent opacity={0.5} sizeAttenuation />
    </points>
  )
}
```

### 3.2 Laser Beam (Improved)

Replace the Phase 4 cylinder with a proper beam using additive blending and glow:

```tsx
function LaserBeam({ from, to, color = '#ff3333' }: LaserProps) {
  const [opacity, setOpacity] = useState(1)
  
  useFrame((_, delta) => {
    setOpacity(prev => Math.max(0, prev - delta * 6))
  })
  
  if (opacity <= 0) return null
  
  const start = new THREE.Vector3(...from)
  const end = new THREE.Vector3(...to)
  
  return (
    <Line
      points={[start, end]}
      color={color}
      lineWidth={3}
      transparent
      opacity={opacity}
      blending={THREE.AdditiveBlending}
      depthWrite={false}
    />
  )
}
```

### 3.3 Shield Hit Flash

When shields absorb damage, briefly flash a transparent sphere around the ship:

```tsx
function ShieldEffect({ active }: { active: boolean }) {
  const [flash, setFlash] = useState(0)
  
  useEffect(() => {
    if (active) setFlash(1)
  }, [active])
  
  useFrame((_, delta) => {
    if (flash > 0) setFlash(prev => Math.max(0, prev - delta * 4))
  })
  
  if (flash <= 0) return null
  
  return (
    <mesh>
      <sphereGeometry args={[3, 16, 16]} />
      <meshBasicMaterial
        color="#4488ff"
        transparent
        opacity={flash * 0.4}
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  )
}
```

### 3.4 Explosion (Improved)

Use `@react-three/drei`'s `Sparkles` or a custom instanced particle system:

```tsx
function Explosion({ position, onComplete }: ExplosionProps) {
  const [life, setLife] = useState(1)
  const groupRef = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    setLife(prev => {
      const next = prev - delta * 0.4 // ~2.5 second explosion
      if (next <= 0) onComplete?.()
      return Math.max(0, next)
    })
  })

  return (
    <group ref={groupRef} position={position}>
      {/* Core flash */}
      <pointLight intensity={life * 50} color="#ff6600" distance={30} />
      
      {/* Expanding debris ring */}
      <Sparkles
        count={40}
        scale={life < 0.8 ? (1 - life) * 20 : 4}
        size={2}
        speed={0.3}
        color="#ff8800"
        opacity={life}
      />
      
      {/* Shockwave ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]} scale={(1 - life) * 15}>
        <ringGeometry args={[0.8, 1, 32]} />
        <meshBasicMaterial
          color="#ff4400"
          transparent
          opacity={life * 0.6}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  )
}
```

### 3.5 Post-Processing

Add bloom and tone mapping for a space game aesthetic:

```tsx
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing'

function Effects() {
  return (
    <EffectComposer>
      <Bloom
        luminanceThreshold={0.6}
        luminanceSmoothing={0.3}
        intensity={0.8}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
```

Bloom makes lasers, explosions, and engine trails glow naturally.

---

## 4. Environment

### 4.1 Skybox

A procedural starfield using drei's `<Stars>` plus a static space skybox texture:

```tsx
function Environment() {
  return (
    <>
      <Stars radius={500} depth={80} count={8000} factor={5} fade speed={0.5} />
      <ambientLight intensity={0.15} />
      <directionalLight position={[100, 50, 50]} intensity={1.2} />
      
      {/* Optional: subtle nebula planes in the far background */}
      <mesh position={[0, 0, -400]} rotation={[0, 0, Math.random()]}>
        <planeGeometry args={[800, 800]} />
        <meshBasicMaterial
          map={nebulaTexture}
          transparent
          opacity={0.15}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </>
  )
}
```

### 4.2 Arena Boundaries

Subtle visual boundary so players know the playable area:

```tsx
function ArenaBoundary() {
  return (
    <mesh>
      <boxGeometry args={[1000, 1000, 1000]} />
      <meshBasicMaterial
        color="#1a1a3e"
        wireframe
        transparent
        opacity={0.08}
        side={THREE.BackSide}
      />
    </mesh>
  )
}
```

---

## 5. UI/HUD Design

### 5.1 HUD Layout

```
┌─────────────────────────────────────────────────────────┐
│  ⬡ 1,250                                  Kill Feed    │
│                                          Player A ⚔ B  │
│                                          Player C ⚔ D  │
│                                                         │
│                                                         │
│                    [3D GAME CANVAS]                      │
│                                                         │
│                                                         │
│ AI Tier: 3                                              │
│ ███████░░░ HP 70%         [Leaderboard] [Shop]         │
│ █████░░░░ Shield 50%                                    │
│                                                         │
│ ┌─ Command your ship... ──────────────────────────┐    │
│ │  ▏                                      120/250 │    │
│ └──────────────────────────────── [Execute] (15s) ┘    │
└─────────────────────────────────────────────────────────┘
```

### 5.2 CSS Design Tokens

```css
:root {
  --color-bg: rgba(10, 10, 30, 0.85);
  --color-primary: #00ff88;
  --color-danger: #ff3344;
  --color-shield: #4488ff;
  --color-gold: #ffd700;
  --color-text: #e0e0ff;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-ui: 'Inter', system-ui, sans-serif;
  --border-glow: 0 0 10px rgba(0, 255, 136, 0.3);
}
```

Sci-fi aesthetic: dark semi-transparent panels, green accent colors, glowing borders, monospace fonts for values.

### 5.3 Responsive Considerations

- Desktop: Full layout as shown above
- Tablet: Stack prompt input below canvas, smaller kill feed
- Mobile: Simplified HUD, larger touch targets for prompt input

Use CSS media queries. The 3D canvas adapts via R3F's automatic resize.

---

## 6. Audio (Optional but High Impact)

### 6.1 Sound Effects

Use Howler.js for web audio:

```bash
npm install howler
```

| Sound | Trigger | Notes |
|---|---|---|
| Laser fire | `EventLaserHit/Miss` | Short zap, positional audio based on distance |
| Plasma fire | `EventProjectileSpawn` | Deeper whomp |
| Shield hit | Damage absorbed by shield | Electrical crackle |
| Hull hit | Damage to HP | Metallic thud |
| Explosion | `EventKill` | Satisfying boom |
| Coin earned | Coin award notification | Subtle cha-ching |
| Prompt accepted | Behavior change applied | Soft confirmation beep |
| Ambient | Always | Low space hum, subtle |

Free sound effects: Freesound.org (CC0), Kenney Audio assets

### 6.2 Spatial Audio

```typescript
import { Howl, Howler } from 'howler'

function playPositionalSound(soundId: string, worldPos: Vec3, listenerPos: Vec3) {
  const distance = vec3Distance(worldPos, listenerPos)
  const maxDist = 300
  const volume = Math.max(0, 1 - distance / maxDist)
  
  if (volume > 0.05) {
    sounds[soundId].volume(volume)
    sounds[soundId].play()
  }
}
```

---

## 7. Deployment Architecture

### 7.1 GCP Instance Layout

Everything runs on one GCP instance (cost-effective):

```
┌──────────────────────────────────────────────────┐
│              GCP VM (e.g., n2-standard-8)         │
│                                                    │
│  ┌──────────┐  ┌───────────┐  ┌───────────────┐  │
│  │  Caddy    │  │ Go Server │  │  PostgreSQL   │  │
│  │  :443     │──│ :8080     │  │  :5432        │  │
│  │  (HTTPS + │  │           │  │               │  │
│  │   WS      │  │           │  │               │  │
│  │   proxy)  │  │           │──│               │  │
│  └──────────┘  └─────┬─────┘  └───────────────┘  │
│       │               │                            │
│       │          ┌────▼───────────────────────┐    │
│       │          │  JetStream (TPU runtime)    │    │
│       │          │  :9000                      │    │
│       │          │  Gemma 2 9B                 │    │
│  ┌────▼──────┐   └────────────────────────────┘    │
│  │ Static    │                                      │
│  │ Files     │   React build output served by      │
│  │ /dist/    │   Caddy at /                        │
│  └───────────┘                                      │
└──────────────────────────────────────────────────────┘
```

### 7.2 Caddy Configuration

```Caddyfile
skywalker.example.com {
    # Serve React SPA
    root * /opt/skywalker/client/dist
    file_server
    try_files {path} /index.html
    
    # Proxy WebSocket
    handle /ws {
        reverse_proxy localhost:8080
    }
    
    # Proxy API
    handle /api/* {
        reverse_proxy localhost:8080
    }
    
    # Security headers
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        Content-Security-Policy "default-src 'self'; connect-src 'self' wss://skywalker.example.com; style-src 'self' 'unsafe-inline'; script-src 'self'"
    }
    
    # Compression
    encode gzip
}
```

Caddy handles HTTPS automatically via Let's Encrypt. Zero config TLS.

### 7.3 Systemd Services

**Go server:**
```ini
# /etc/systemd/system/skywalker.service
[Unit]
Description=SkyWalker Game Server
After=network.target postgresql.service

[Service]
Type=simple
User=skywalker
WorkingDirectory=/opt/skywalker/server
ExecStart=/opt/skywalker/server/skywalker
Environment=PORT=8080
Environment=DATABASE_URL=postgres://skywalker_app:password@localhost:5432/skywalker
Environment=JWT_SECRET=<generated-secret>
Environment=LLM_URL=http://localhost:9000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 7.4 Build & Deploy Script

```bash
#!/bin/bash
# scripts/deploy.sh

set -euo pipefail

echo "=== Building client ==="
cd client
npm ci
npm run build

echo "=== Building server ==="
cd ../server
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o skywalker ./cmd/skywalker/

echo "=== Deploying ==="
rsync -avz --delete client/dist/ user@server:/opt/skywalker/client/dist/
rsync -avz server/skywalker user@server:/opt/skywalker/server/

echo "=== Restarting ==="
ssh user@server "sudo systemctl restart skywalker"

echo "=== Done ==="
```

---

## 8. Monitoring & Observability

### 8.1 Structured Logging (Already Set Up)

zerolog outputs JSON logs. Pipe to a log file and optionally to a log aggregator:

```go
log.Info().
    Int("players", hub.ClientCount()).
    Int64("tick", engine.tick).
    Dur("tick_time", tickDuration).
    Msg("tick")
```

### 8.2 Metrics Endpoint

Expose a `/metrics` endpoint for Prometheus (optional) or a simple JSON health dashboard:

```go
mux.HandleFunc("/debug/stats", func(w http.ResponseWriter, r *http.Request) {
    stats := map[string]interface{}{
        "players_online":    hub.ClientCount(),
        "tick":              engine.tick,
        "avg_tick_ms":       engine.avgTickTime.Milliseconds(),
        "projectiles":       len(engine.state.Projectiles),
        "llm_queue_depth":   len(llmQueue.requests),
        "db_pool_stats":     pool.Stat(),
        "uptime_seconds":    time.Since(startTime).Seconds(),
    }
    json.NewEncoder(w).Encode(stats)
})
```

### 8.3 Key Alerts

Set up basic monitoring (even just a cron job that curls `/debug/stats`):

| Metric | Alert Threshold | Action |
|---|---|---|
| `avg_tick_ms` | >25ms (75% of budget) | Profile game loop, optimize |
| `players_online` | >80% capacity | Consider scaling |
| `llm_queue_depth` | >20 | LLM serving bottleneck |
| `db_pool_stats.TotalConns` | Near max (20) | Increase pool or optimize queries |
| Process crash | systemd restart count >3 in 5min | Investigate logs |

### 8.4 Error Tracking

Log all errors with context. For production, consider Sentry (free tier: 5K events/month):

```bash
go get github.com/getsentry/sentry-go
```

---

## 9. Security Hardening

### 9.1 Checklist

| Item | Implementation |
|---|---|
| HTTPS everywhere | Caddy auto-TLS |
| Rate limiting | Per-IP connection limit in Caddy; per-player prompt cooldown in Go |
| Input sanitization | Prompt length capped by AI tier; username 3-20 chars alphanumeric |
| SQL injection | All queries parameterized via pgx |
| XSS | React auto-escapes; CSP header blocks inline scripts |
| CSRF | Not applicable (JWT auth, no cookies for state-changing ops) |
| Password security | bcrypt with default cost (10 rounds) |
| JWT security | HS256 with strong secret. 24h expiry. No sensitive data in claims |
| WebSocket abuse | Max message size (1KB for prompts). Connection cap. Slow consumer kick |
| Economy exploits | Server-side validation of all purchases. DB constraints on coin balance |
| Prompt injection | LLM output validated against strict JSON schema. No code execution |

### 9.2 Firewall

```bash
# Only expose HTTP/HTTPS. Everything else is internal.
sudo ufw default deny incoming
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (Caddy redirects to HTTPS)
sudo ufw allow 443/tcp   # HTTPS + WSS
sudo ufw enable
```

PostgreSQL, JetStream, and the Go server all listen on localhost only.

---

## 10. Performance Optimization Checklist

| Area | Optimization | Phase |
|---|---|---|
| Network | MessagePack binary encoding | Done (Phase 1) |
| Network | Delta compression (only send changed entities) | Phase 6 if needed |
| Rendering | Instanced meshes for projectiles | Phase 6 |
| Rendering | LOD for distant ships | Phase 6 if needed |
| Rendering | Object pooling for particles | Phase 6 |
| Server | Spatial grid for collision | Done (Phase 4) |
| Server | Slice pre-allocation in hot path | Phase 6 |
| Server | `sync.Pool` for temporary allocations | Phase 6 if profiling shows GC pressure |
| LLM | Model quantization (int8) for faster inference | Phase 6 if latency too high |
| LLM | Gemma 2B for low-tier players, 9B for high-tier | Phase 6 |
| DB | Read-through cache for profiles | Phase 6 if DB becomes bottleneck |

---

## 11. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 6.1 | Import and integrate 3D ship models (1 per hull type) | 4 distinct ship models render correctly, assigned by hull ID |
| 6.2 | Implement per-player ship coloring | Each player's ship is tinted their unique color |
| 6.3 | Add engine exhaust trail particles | Moving ships leave a fading particle trail |
| 6.4 | Improve laser beam VFX (additive glow) | Lasers glow and fade smoothly |
| 6.5 | Implement shield hit flash effect | Shield absorbing damage shows a brief blue sphere flash |
| 6.6 | Implement explosion VFX (particles + shockwave + light) | Ship death produces a satisfying multi-element explosion |
| 6.7 | Add post-processing (bloom + tone mapping) | Scene has subtle glow on emissive elements |
| 6.8 | Build space environment (stars, lighting, nebula, boundary) | Visually appealing space backdrop |
| 6.9 | Polish HUD (health, shield, coins, AI tier, behavior) | All info visible, sci-fi themed, responsive |
| 6.10 | Add SFX (laser, explosion, shield hit, coins) | Key game events produce audio feedback |
| 6.11 | Configure Caddy reverse proxy with HTTPS | Site accessible via HTTPS, WebSocket works through proxy |
| 6.12 | Create systemd service for Go server | Server auto-starts, auto-restarts on crash |
| 6.13 | Build deploy script | Single command builds client + server and deploys to GCP |
| 6.14 | Set up monitoring endpoint | `/debug/stats` returns player count, tick time, queue depth |
| 6.15 | Security hardening pass | Firewall rules, CSP headers, rate limits all configured |
| 6.16 | Load test with 50 concurrent players | 30 TPS maintained, tick time <15ms, no crashes |

---

## 12. Milestone Definition

Phase 6 is **complete** when:

> The game is deployed at `https://skywalker.example.com` with automatic HTTPS. Players see 3D ship models (not cubes) flying through a star-filled space environment. Lasers glow, explosions burst with particles and light, shields flash blue on impact, and engines leave trails. The UI is clean and readable with a sci-fi aesthetic. Sound effects accompany key events. The server runs continuously via systemd with automatic restarts. A load test with 50 simulated players maintains 30 TPS with <15ms tick time. The monitoring endpoint confirms system health. The game is ready for public access.

---

## 13. Future Considerations (Post-Launch)

These are NOT part of the current scope but worth noting for the roadmap:

- **Spatial sharding**: Split the world into regions managed by separate goroutines for 1000+ players
- **Team/faction system**: Group players, shared objectives
- **Matchmaking zones**: Separate areas by player level/gear to prevent stomping
- **Spectator mode**: Watch battles without participating
- **Replay system**: Record and playback battles
- **Mobile optimization**: Touch-friendly UI, reduced VFX
- **Custom ship skins**: Cosmetic monetization (non-pay-to-win)
- **Tournament mode**: Scheduled competitive events with prizes
- **API for bots**: Allow programmatic players for testing or content
