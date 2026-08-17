# Phase 4: Combat System & Physics

## 1. Objective

Turn the behavior-driven movement demo into an actual game. Add weapons, projectiles, shields, health, collision detection, damage, death, and respawn. By the end of this phase, ships fight autonomously based on their prompt-driven behaviors and can destroy each other.

---

## 2. Physics Model

### 2.1 Coordinate System & Units

| Dimension | Range | Unit |
|---|---|---|
| World space | -500 to +500 on each axis | 1 unit ≈ 1 meter |
| Speed | 0-100 units/sec | Ship max speed varies by hull type |
| Acceleration | 0-50 units/sec² | Ships don't change speed instantly |
| Projectile speed | 200-400 units/sec | Much faster than ships |
| Weapon range | 50-400 units | Varies by weapon type |

### 2.2 Movement Physics (Upgrade from Phase 2)

Phase 2 had instant velocity changes. Phase 4 introduces **acceleration-based movement** for more realistic feel:

```go
func (e *Engine) applyMovement(ship *Ship) {
    // desiredVelocity is set by behavior executor
    // Ship accelerates toward it over time
    
    diff := ship.DesiredVelocity.Sub(ship.Velocity)
    if diff.Length() < 0.1 {
        ship.Velocity = ship.DesiredVelocity
    } else {
        accel := diff.Normalize().Scale(ship.Acceleration * e.dt)
        if accel.Length() > diff.Length() {
            ship.Velocity = ship.DesiredVelocity
        } else {
            ship.Velocity = ship.Velocity.Add(accel)
        }
    }
    
    // Clamp to max speed
    if ship.Velocity.Length() > ship.MaxSpeed {
        ship.Velocity = ship.Velocity.Normalize().Scale(ship.MaxSpeed)
    }
    
    // Update position
    ship.Position = ship.Position.Add(ship.Velocity.Scale(e.dt))
    
    // Update rotation to face velocity direction (if moving)
    if ship.Velocity.Length() > 1.0 {
        ship.Rotation = quatLookAt(ship.Velocity.Normalize())
    }
}
```

### 2.3 Spatial Partitioning (Grid Hash)

For efficient collision detection and target resolution. At 100+ entities, O(n²) brute force starts to hurt.

```go
const CellSize = 100 // units

type SpatialGrid struct {
    cells map[CellKey][]*Ship
}

type CellKey struct {
    X, Y, Z int32
}

func (g *SpatialGrid) Rebuild(ships map[string]*Ship) {
    // Clear all cells
    for k := range g.cells {
        delete(g.cells, k)
    }
    
    // Insert all ships
    for _, ship := range ships {
        key := CellKey{
            X: int32(math.Floor(float64(ship.Position.X) / CellSize)),
            Y: int32(math.Floor(float64(ship.Position.Y) / CellSize)),
            Z: int32(math.Floor(float64(ship.Position.Z) / CellSize)),
        }
        g.cells[key] = append(g.cells[key], ship)
    }
}

func (g *SpatialGrid) GetNearby(pos Vec3, radius float32) []*Ship {
    minCell := CellKey{
        X: int32(math.Floor(float64(pos.X-radius) / CellSize)),
        Y: int32(math.Floor(float64(pos.Y-radius) / CellSize)),
        Z: int32(math.Floor(float64(pos.Z-radius) / CellSize)),
    }
    maxCell := CellKey{
        X: int32(math.Floor(float64(pos.X+radius) / CellSize)),
        Y: int32(math.Floor(float64(pos.Y+radius) / CellSize)),
        Z: int32(math.Floor(float64(pos.Z+radius) / CellSize)),
    }
    
    var result []*Ship
    for x := minCell.X; x <= maxCell.X; x++ {
        for y := minCell.Y; y <= maxCell.Y; y++ {
            for z := minCell.Z; z <= maxCell.Z; z++ {
                result = append(result, g.cells[CellKey{x, y, z}]...)
            }
        }
    }
    return result
}
```

Rebuild the grid once per tick (it's cheap — just a map clear + N insertions).

---

## 3. Ship Stats & Components

### 3.1 Ship Struct (Extended)

```go
type Ship struct {
    // Identity
    ID       string
    Username string
    Color    [3]float32
    
    // Physics
    Position     Vec3
    Velocity     Vec3
    DesiredVelocity Vec3
    Rotation     Quaternion
    MaxSpeed     float32  // units/sec (based on hull)
    Acceleration float32  // units/sec² (based on hull)
    
    // Combat
    Health       float32
    MaxHealth    float32
    Shield       float32
    MaxShield    float32
    ShieldRegen  float32  // per second
    ShieldDelay  float32  // seconds after last hit before regen starts
    ShieldTimer  float32  // countdown to regen
    
    // Weapons
    PrimaryWeapon   Weapon
    SecondaryWeapon *Weapon // nil if not equipped
    
    // Behavior (from LLM)
    Behavior        *BehaviorSet
    
    // State
    IsAlive         bool
    RespawnTimer    float32 // countdown when dead
    
    // Internal (not sent to client)
    LastDamagedBy   string  // player ID of last attacker (for kill credit)
    WanderDir       Vec3
    WanderTimer     float32
    PatrolIndex     int
    
    // Collision
    CollisionRadius float32 // bounding sphere
}
```

### 3.2 Weapon Types

```go
type Weapon struct {
    Type       string  // "laser", "plasma", "railgun"
    Damage     float32
    Cooldown   float32 // seconds between shots
    CoolTimer  float32 // current cooldown countdown
    Range      float32 // max effective range
    Speed      float32 // projectile speed (0 = hitscan)
    Spread     float32 // accuracy cone in degrees (0 = perfect)
}

// Default starter weapons
var StarterLaser = Weapon{
    Type:     "laser",
    Damage:   8,
    Cooldown: 0.5,
    Range:    200,
    Speed:    0,       // hitscan (instant hit)
    Spread:   2,       // slight inaccuracy
}

var StarterPlasma = Weapon{
    Type:     "plasma",
    Damage:   25,
    Cooldown: 1.5,
    Range:    300,
    Speed:    250,     // projectile
    Spread:   0,       // perfect accuracy but must lead target
}
```

### 3.3 Default Ship Stats

```go
func NewDefaultShip(id, username string) *Ship {
    return &Ship{
        ID:              id,
        Username:        username,
        MaxHealth:       100,
        Health:          100,
        MaxShield:       50,
        Shield:          50,
        ShieldRegen:     5.0,   // 5 shield/sec
        ShieldDelay:     3.0,   // 3 sec after hit
        MaxSpeed:        40,
        Acceleration:    20,
        PrimaryWeapon:   StarterLaser,
        IsAlive:         true,
        CollisionRadius: 2.0,
    }
}
```

---

## 4. Weapon & Damage System

### 4.1 Combat Execution in Game Loop

```go
func (e *Engine) executeCombat(ship *Ship, behavior *BehaviorBlock) {
    // Tick down weapon cooldowns
    ship.PrimaryWeapon.CoolTimer -= e.dt
    if ship.SecondaryWeapon != nil {
        ship.SecondaryWeapon.CoolTimer -= e.dt
    }
    
    if behavior.Combat == "hold_fire" || behavior.Combat == "" {
        return
    }
    
    // Resolve target
    target := e.resolveTarget(ship, behavior.CombatParams.Target)
    if target == nil || !target.IsAlive {
        return
    }
    
    // Select weapon
    weapon := &ship.PrimaryWeapon
    if behavior.CombatParams.Weapon == "secondary" && ship.SecondaryWeapon != nil {
        weapon = ship.SecondaryWeapon
    }
    
    // Check cooldown
    if weapon.CoolTimer > 0 {
        return
    }
    
    // Check range
    dist := ship.Position.DistTo(target.Position)
    if dist > weapon.Range {
        return
    }
    
    // Fire!
    weapon.CoolTimer = weapon.Cooldown
    
    if weapon.Speed == 0 {
        // Hitscan weapon (laser) — instant hit check
        e.processHitscan(ship, target, weapon)
    } else {
        // Projectile weapon — spawn projectile entity
        e.spawnProjectile(ship, target, weapon)
    }
}
```

### 4.2 Hitscan Weapons (Lasers)

Instant raycast from ship to target. Apply accuracy spread.

```go
func (e *Engine) processHitscan(shooter, target *Ship, weapon *Weapon) {
    dir := target.Position.Sub(shooter.Position).Normalize()
    
    // Apply spread (random cone deviation)
    if weapon.Spread > 0 {
        dir = applySpread(dir, weapon.Spread)
    }
    
    // Ray-sphere intersection test
    if rayHitsSphere(shooter.Position, dir, target.Position, target.CollisionRadius) {
        e.applyDamage(target, weapon.Damage, shooter.ID)
        
        // Create visual event for clients
        e.addEvent(Event{
            Type: EventLaserHit,
            Data: LaserHitEvent{
                From:   shooter.Position,
                To:     target.Position,
                Hit:    true,
            },
        })
    } else {
        // Miss — still show the laser visually
        endPoint := shooter.Position.Add(dir.Scale(weapon.Range))
        e.addEvent(Event{
            Type: EventLaserMiss,
            Data: LaserHitEvent{
                From: shooter.Position,
                To:   endPoint,
                Hit:  false,
            },
        })
    }
}
```

### 4.3 Projectile Weapons (Plasma)

Projectiles are entities that update each tick and check for collisions.

```go
type Projectile struct {
    ID        uint64
    OwnerID   string    // who fired it (for kill credit + no self-hit)
    Position  Vec3
    Velocity  Vec3
    Damage    float32
    Lifetime  float32   // seconds remaining
    Radius    float32   // collision sphere
}

func (e *Engine) spawnProjectile(shooter *Ship, target *Ship, weapon *Weapon) {
    dir := target.Position.Sub(shooter.Position).Normalize()
    
    e.state.Projectiles = append(e.state.Projectiles, Projectile{
        ID:       e.nextProjectileID(),
        OwnerID:  shooter.ID,
        Position: shooter.Position.Add(dir.Scale(shooter.CollisionRadius + 1)), // spawn just outside ship
        Velocity: dir.Scale(weapon.Speed),
        Damage:   weapon.Damage,
        Lifetime: weapon.Range / weapon.Speed, // live long enough to reach max range
        Radius:   0.5,
    })
}

func (e *Engine) updateProjectiles() {
    alive := e.state.Projectiles[:0] // reuse slice
    
    for i := range e.state.Projectiles {
        p := &e.state.Projectiles[i]
        p.Lifetime -= e.dt
        if p.Lifetime <= 0 {
            continue // expired, remove
        }
        
        // Move
        p.Position = p.Position.Add(p.Velocity.Scale(e.dt))
        
        // Check collision with all ships in nearby cells
        nearby := e.grid.GetNearby(p.Position, p.Radius+10)
        hit := false
        for _, ship := range nearby {
            if ship.ID == p.OwnerID || !ship.IsAlive {
                continue
            }
            if spheresOverlap(p.Position, p.Radius, ship.Position, ship.CollisionRadius) {
                e.applyDamage(ship, p.Damage, p.OwnerID)
                e.addEvent(Event{
                    Type: EventProjectileHit,
                    Data: ProjectileHitEvent{Position: p.Position, TargetID: ship.ID},
                })
                hit = true
                break
            }
        }
        
        if !hit {
            alive = append(alive, *p)
        }
    }
    
    e.state.Projectiles = alive
}
```

### 4.4 Damage Application

Damage hits shields first, then hull:

```go
func (e *Engine) applyDamage(target *Ship, damage float32, attackerID string) {
    target.LastDamagedBy = attackerID
    target.ShieldTimer = target.ShieldDelay // reset shield regen
    
    if target.Shield > 0 {
        absorbed := min(damage, target.Shield)
        target.Shield -= absorbed
        damage -= absorbed
        
        if damage <= 0 {
            return // fully absorbed by shield
        }
    }
    
    // Remaining damage hits hull
    target.Health -= damage
    
    if target.Health <= 0 {
        target.Health = 0
        e.processKill(target, attackerID)
    }
}
```

---

## 5. Shield Mechanics

### 5.1 Shield Regeneration

Shields regenerate passively but are paused when taking damage:

```go
func (e *Engine) updateShields(ship *Ship) {
    if !ship.IsAlive { return }
    
    // Count down the delay timer
    if ship.ShieldTimer > 0 {
        ship.ShieldTimer -= e.dt
        return // no regen while timer active
    }
    
    // Regenerate shields
    if ship.Shield < ship.MaxShield {
        ship.Shield = min(ship.Shield + ship.ShieldRegen*e.dt, ship.MaxShield)
    }
}
```

### 5.2 Shield Direction (Defense Behavior)

The defense behavior affects how damage is distributed:

```go
func (e *Engine) getShieldMultiplier(target *Ship, attackDir Vec3) float32 {
    // attackDir: normalized direction from attacker to target
    facing := target.Rotation.Forward()
    dot := facing.Dot(attackDir)
    
    switch target.CurrentDefense {
    case "shield_front":
        // Front attacks get 1.5x shield absorption, rear gets 0.5x
        if dot > 0 { return 1.5 } // attacker is in front
        return 0.5
    case "shield_rear":
        if dot < 0 { return 1.5 } // attacker is behind
        return 0.5
    case "shield_balanced":
        return 1.0
    default:
        return 1.0
    }
}
```

---

## 6. Death & Respawn

### 6.1 Kill Processing

```go
func (e *Engine) processKill(victim *Ship, killerID string) {
    victim.IsAlive = false
    victim.Velocity = Vec3{}
    victim.RespawnTimer = 5.0 // 5 second respawn
    
    // Broadcast kill event
    e.addEvent(Event{
        Type: EventKill,
        Data: KillEvent{
            KillerID:   killerID,
            VictimID:   victim.ID,
            KillerName: e.state.Ships[killerID].Username,
            VictimName: victim.Username,
            Position:   victim.Position,
        },
    })
    
    // Phase 5: award coins to killer asynchronously
    // e.coinAwardCh <- CoinAward{PlayerID: killerID, Amount: 50}
}
```

### 6.2 Respawn Logic

```go
func (e *Engine) updateRespawns() {
    for _, ship := range e.state.Ships {
        if ship.IsAlive { continue }
        
        ship.RespawnTimer -= e.dt
        if ship.RespawnTimer <= 0 {
            // Respawn at random position, full health/shield
            ship.Position = randomPosition()
            ship.Velocity = Vec3{}
            ship.Health = ship.MaxHealth
            ship.Shield = ship.MaxShield
            ship.IsAlive = true
            ship.ShieldTimer = 0
            ship.Behavior = nil // clear behavior on respawn
            ship.PrimaryWeapon.CoolTimer = 0
            
            e.addEvent(Event{
                Type: EventRespawn,
                Data: RespawnEvent{PlayerID: ship.ID, Position: ship.Position},
            })
        }
    }
}
```

### 6.3 Dead Ship Handling

Dead ships are **not** removed from the state. They remain with `IsAlive=false` so:
- The client can render a wreck / explosion at their last position
- The respawn timer runs server-side
- The player stays connected and can see the world while dead

---

## 7. Updated Game Loop

```go
func (e *Engine) runTick() {
    e.processInputs()      // joins, leaves, prompt results
    
    // Rebuild spatial grid
    e.grid.Rebuild(e.state.Ships)
    
    // Update living ships
    for _, ship := range e.state.Ships {
        if !ship.IsAlive { continue }
        
        // Execute behavior
        activeBehavior := e.resolveActiveBehavior(ship)
        if activeBehavior != nil {
            e.executeMovement(ship, activeBehavior)
            e.executeCombat(ship, activeBehavior)
        }
        
        // Apply physics
        e.applyMovement(ship)
        
        // Regenerate shields
        e.updateShields(ship)
    }
    
    // Update projectiles (move + collision)
    e.updateProjectiles()
    
    // Handle respawns
    e.updateRespawns()
    
    // Broadcast state + events
    e.buildAndBroadcast()
}
```

---

## 8. State Update Extension

### 8.1 Extended Entity Snapshot

```go
type EntitySnapshot struct {
    ID       string       `msgpack:"i"`
    Position [3]float32   `msgpack:"p"`
    Rotation [4]float32   `msgpack:"r"`
    Color    [3]float32   `msgpack:"c"`
    Health   float32      `msgpack:"h"`    // NEW
    MaxHP    float32      `msgpack:"mh"`   // NEW
    Shield   float32      `msgpack:"s"`    // NEW
    MaxShld  float32      `msgpack:"ms"`   // NEW
    IsAlive  bool         `msgpack:"a"`    // NEW
    Behavior string       `msgpack:"b"`    // NEW: active movement name for UI
}
```

### 8.2 Event Messages

Events are sent alongside state updates but are one-shot (not repeated):

```go
type EventPayload struct {
    Tick   uint64  `msgpack:"t"`
    Events []Event `msgpack:"e"`
}

type Event struct {
    Type uint8       `msgpack:"t"`
    Data interface{} `msgpack:"d"`
}

const (
    EventLaserHit      uint8 = 1
    EventLaserMiss     uint8 = 2
    EventProjectileHit uint8 = 3
    EventKill          uint8 = 4
    EventRespawn       uint8 = 5
    EventExplosion     uint8 = 6
)
```

Events fire client-side visual effects (laser beams, explosions, hit markers) without polluting the state snapshot.

---

## 9. Client-Side Combat Rendering

### 9.1 Health & Shield Bars

Floating bars above each ship (billboarded toward camera):

```tsx
function ShipHealthBar({ entity }: { entity: Entity }) {
  if (!entity.isAlive) return null
  
  return (
    <Billboard position={[0, 3, 0]}>  {/* offset above ship */}
      {/* Shield bar (blue) */}
      <mesh position={[0, 0.3, 0]}>
        <planeGeometry args={[entity.shield / entity.maxShield * 3, 0.15]} />
        <meshBasicMaterial color="#4488ff" />
      </mesh>
      {/* Health bar (green→red gradient) */}
      <mesh>
        <planeGeometry args={[entity.health / entity.maxHealth * 3, 0.2]} />
        <meshBasicMaterial color={entity.health / entity.maxHealth > 0.3 ? '#00ff44' : '#ff3333'} />
      </mesh>
    </Billboard>
  )
}
```

### 9.2 Laser Beam Effect

When a `LaserHit` event arrives, render a thin cylinder between two points that fades over ~0.2s:

```tsx
function LaserBeam({ from, to, hit }: LaserEvent) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [opacity, setOpacity] = useState(1)
  
  useFrame((_, delta) => {
    setOpacity(prev => Math.max(0, prev - delta * 5)) // fade over ~0.2s
  })
  
  if (opacity <= 0) return null
  
  const midpoint = new THREE.Vector3(...from).lerp(new THREE.Vector3(...to), 0.5)
  const length = new THREE.Vector3(...from).distanceTo(new THREE.Vector3(...to))
  
  return (
    <mesh ref={meshRef} position={midpoint} lookAt={new THREE.Vector3(...to)}>
      <cylinderGeometry args={[0.05, 0.05, length, 4]} />
      <meshBasicMaterial 
        color={hit ? '#ff3333' : '#ff8800'} 
        transparent 
        opacity={opacity} 
      />
    </mesh>
  )
}
```

### 9.3 Explosion Effect

On kill, spawn a particle burst at the death position:

```tsx
function Explosion({ position }: { position: [number, number, number] }) {
  const pointsRef = useRef<THREE.Points>(null)
  const [life, setLife] = useState(1)
  
  // 50 particles with random velocities
  const particles = useMemo(() => {
    const pos = new Float32Array(50 * 3)
    for (let i = 0; i < 50; i++) {
      pos[i*3] = position[0]
      pos[i*3+1] = position[1]
      pos[i*3+2] = position[2]
    }
    return pos
  }, [])
  
  useFrame((_, delta) => {
    setLife(prev => prev - delta * 0.5) // 2 second explosion
    // Expand particles outward each frame
  })
  
  if (life <= 0) return null
  
  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={particles} count={50} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.5} color="#ff6600" transparent opacity={life} />
    </points>
  )
}
```

### 9.4 Kill Feed

A scrolling list of recent kills displayed in the top-right:

```tsx
function KillFeed() {
  const kills = useGameStore(s => s.recentKills) // last 5
  
  return (
    <div className="kill-feed">
      {kills.map((kill, i) => (
        <div key={i} className="kill-entry">
          <span className="killer">{kill.killerName}</span>
          <span className="icon">⚔</span>
          <span className="victim">{kill.victimName}</span>
        </div>
      ))}
    </div>
  )
}
```

---

## 10. Collision Math Utilities

```go
// Sphere-sphere overlap
func spheresOverlap(p1 Vec3, r1 float32, p2 Vec3, r2 float32) bool {
    dx := p1.X - p2.X
    dy := p1.Y - p2.Y
    dz := p1.Z - p2.Z
    distSq := dx*dx + dy*dy + dz*dz
    radSum := r1 + r2
    return distSq <= radSum*radSum
}

// Ray-sphere intersection (for hitscan weapons)
func rayHitsSphere(origin, dir Vec3, center Vec3, radius float32) bool {
    oc := origin.Sub(center)
    a := dir.Dot(dir)
    b := 2.0 * oc.Dot(dir)
    c := oc.Dot(oc) - radius*radius
    discriminant := b*b - 4*a*c
    return discriminant >= 0
}

// Random spread within a cone
func applySpread(dir Vec3, spreadDeg float32) Vec3 {
    spreadRad := spreadDeg * math.Pi / 180
    theta := rand.Float32() * 2 * math.Pi
    phi := rand.Float32() * spreadRad
    
    // Create orthonormal basis from dir
    up := Vec3{0, 1, 0}
    if math.Abs(float64(dir.Y)) > 0.99 { up = Vec3{1, 0, 0} }
    right := dir.Cross(up).Normalize()
    up = right.Cross(dir).Normalize()
    
    // Offset within cone
    offset := right.Scale(float32(math.Sin(float64(phi))*math.Cos(float64(theta)))).
        Add(up.Scale(float32(math.Sin(float64(phi))*math.Sin(float64(theta)))))
    
    return dir.Add(offset).Normalize()
}
```

---

## 11. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 4.1 | Add acceleration-based movement | Ships smoothly accelerate/decelerate instead of snapping to velocity |
| 4.2 | Implement spatial grid | Nearby query returns correct ships; grid rebuilds each tick |
| 4.3 | Add ship combat stats | Ship struct has health, shield, weapon fields with defaults |
| 4.4 | Implement weapon cooldown system | Weapons fire at correct rate, cooldown ticks down per frame |
| 4.5 | Implement hitscan weapon (laser) | Ray-sphere intersection detects hits; damage applied correctly |
| 4.6 | Implement projectile weapon (plasma) | Projectiles spawn, move, collide with ships, despawn after range |
| 4.7 | Implement shield system | Shields absorb damage first, regen after delay, direction affects multiplier |
| 4.8 | Implement damage → death flow | Health reaches 0 → ship marked dead → kill event broadcast |
| 4.9 | Implement respawn system | Dead ship respawns at random position after 5s with full stats |
| 4.10 | Add combat fields to state snapshot | Clients receive health, shield, alive status, behavior indicator |
| 4.11 | Implement event system (laser, explosion, kill) | Events sent as one-shot messages alongside state updates |
| 4.12 | Render health/shield bars on client | Floating bars above ships, color-coded, billboarded |
| 4.13 | Render laser beam effect | Thin beam from shooter to target, fades over 0.2s |
| 4.14 | Render explosion on death | Particle burst at death position, fades over 2s |
| 4.15 | Implement kill feed UI | Last 5 kills shown in top-right, auto-scrolling |

---

## 12. Milestone Definition

Phase 4 is **complete** when:

> Two players connect. Player A prompts "chase and shoot the nearest enemy." Player B prompts "orbit and fire at nearest enemy." Both ships maneuver and fire at each other. Lasers are visible as brief beams. Shields deplete, then health drops. When one ship reaches 0 HP, it explodes (particle effect), a kill feed entry appears, and the dead ship respawns 5 seconds later at a random location with full stats. The surviving player's behavior continues uninterrupted.
