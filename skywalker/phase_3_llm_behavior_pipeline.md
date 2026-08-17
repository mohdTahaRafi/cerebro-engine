# Phase 3: LLM Behavior Pipeline

## 1. Objective

Replace the random drift from Phase 2 with the game's core mechanic: **prompt-driven AI behavior**. A player types a natural language command, the server sends it to a locally-hosted LLM on the TPU, the LLM returns structured JSON describing ship behaviors, and the game loop executes those behaviors every tick until a new prompt overrides them.

By the end of this phase: a player types "orbit the nearest enemy slowly" → their ship begins orbiting the closest other ship. Another player types "chase the green ship" → their ship pursues.

---

## 2. LLM Serving Infrastructure

### 2.1 JetStream on TPU

JetStream is Google's optimized inference engine for TPUs. It supports continuous batching (multiple requests share TPU cycles efficiently) and PagedAttention (memory-efficient KV cache).

**Setup on GCP TPU instance:**

```bash
# Clone JetStream
git clone https://github.com/google/JetStream.git
cd JetStream

# Install with TPU support
pip install -e ".[tpu]"

# Download model weights (Gemma 2 9B as primary)
# Use Hugging Face or Google Cloud Storage
# Convert to JetStream-compatible format if needed
python -m jetstream.tools.convert_weights \
    --model_name=gemma2-9b \
    --input_path=/path/to/weights \
    --output_path=/path/to/jetstream_weights

# Start serving
python -m jetstream.entrypoints.http.api_server \
    --model_name=gemma2-9b \
    --tokenizer_path=/path/to/tokenizer \
    --checkpoint_path=/path/to/jetstream_weights \
    --port=8000 \
    --max_batch_size=32 \
    --max_cache_length=2048
```

**Key config parameters:**
- `max_batch_size=32`: Up to 32 concurrent requests batched on TPU. At 30s cooldown with 200 players, peak is ~7 req/s — well within budget
- `max_cache_length=2048`: Sufficient for our small prompts. Keep low to maximize batch capacity

**Alternative: vLLM with TPU (backup option):**
```bash
pip install vllm[tpu]
python -m vllm.entrypoints.openai.api_server \
    --model google/gemma-2-9b-it \
    --device tpu \
    --port 8000
```

vLLM exposes an OpenAI-compatible API, which is slightly easier to integrate but less TPU-optimized than JetStream.

### 2.2 Model Selection

| Model | Parameters | Pros | Cons | Recommendation |
|---|---|---|---|---|
| **Gemma 2 9B-IT** | 9B | Google-native TPU optimization, instruction-tuned, excellent JSON output | Larger = slower per request | **Primary model** |
| **Gemma 2 2B-IT** | 2B | Extremely fast, low resource | May struggle with complex conditionals | **Fallback** for high-load periods |
| Llama 3.1 8B | 8B | Strong general capability | Not Google-native, slightly worse TPU perf | Good alternative |
| Mistral 7B | 7B | Good at structured output | Same as Llama | Good alternative |

**Start with Gemma 2 9B-IT.** If latency is too high under load, drop to 2B for basic tier players and keep 9B for high-tier players — this naturally aligns with the AI Processor progression system.

### 2.3 Health Monitoring

The Go server should probe the LLM endpoint on startup and periodically:

```go
func (c *LLMClient) HealthCheck() error {
    resp, err := c.httpClient.Get(c.baseURL + "/health")
    if err != nil || resp.StatusCode != 200 {
        return fmt.Errorf("LLM service unhealthy: %v", err)
    }
    return nil
}
```

If the LLM is down, prompts queue up and ships keep their last behavior. No crash, no degraded gameplay.

---

## 3. Behavior Primitive System

### 3.1 Design Philosophy

The LLM does NOT generate code. It maps natural language to a **fixed vocabulary of behavior primitives** with parameters. The Go server validates the JSON schema strictly, then a deterministic executor runs the behaviors each tick.

This is safer, faster, and more reliable than executing LLM-generated code.

### 3.2 Complete Behavior Vocabulary

#### Movement Primitives

| Primitive | Parameters | Description |
|---|---|---|
| `idle` | — | Hold current position (velocity → 0) |
| `move_to` | `target: {x, y, z}` | Move toward absolute coordinates |
| `orbit` | `target: TargetSelector, radius: float, speed: float` | Circle a target at given distance |
| `chase` | `target: TargetSelector, speed: float` | Move directly toward a target |
| `flee` | `target: TargetSelector, speed: float` | Move directly away from a target |
| `patrol` | `waypoints: [{x,y,z}, ...], speed: float` | Cycle through waypoint list |
| `strafe` | `target: TargetSelector, direction: "left"\|"right", speed: float` | Circle-strafe around a target |
| `wander` | `radius: float, speed: float` | Random wandering within radius of current position |

#### Combat Primitives

| Primitive | Parameters | Description |
|---|---|---|
| `fire_at` | `target: TargetSelector, weapon: "primary"\|"secondary"` | Fire specified weapon at target |
| `hold_fire` | — | Stop all weapons |

#### Defense Primitives

| Primitive | Parameters | Description |
|---|---|---|
| `shield_front` | — | Focus shield energy forward |
| `shield_balanced` | — | Even shield distribution (default) |
| `shield_rear` | — | Focus shield energy behind |

#### Target Selectors

The LLM chooses targets using string selectors that the server resolves each tick:

| Selector | Resolves To |
|---|---|
| `"nearest_enemy"` | Closest ship by distance |
| `"weakest_enemy"` | Ship with lowest current HP |
| `"strongest_enemy"` | Ship with highest current HP |
| `"nearest_threat"` | Closest ship that's targeting you |
| `"lowest_shield"` | Ship with lowest shield percentage |
| `"random_enemy"` | Random ship |
| `"player:username"` | Specific player by name |

### 3.3 Behavior JSON Schema

The LLM outputs a `BehaviorSet` — a primary behavior plus optional conditional fallbacks:

```json
{
  "primary": {
    "movement": "orbit",
    "movement_params": {
      "target": "nearest_enemy",
      "radius": 150,
      "speed": 30
    },
    "combat": "fire_at",
    "combat_params": {
      "target": "nearest_enemy",
      "weapon": "primary"
    },
    "defense": "shield_balanced"
  },
  "conditionals": [
    {
      "condition": "self.health_pct < 30",
      "movement": "flee",
      "movement_params": {
        "target": "nearest_enemy",
        "speed": 50
      },
      "combat": "hold_fire",
      "defense": "shield_rear"
    }
  ]
}
```

**`conditionals`** are checked every tick in order. The first matching condition overrides the primary block. If no conditionals match, primary runs.

### 3.4 Condition Expressions

Simple boolean expressions that the server evaluates. No arbitrary code — a small hand-written evaluator handles these:

| Expression | Meaning |
|---|---|
| `self.health_pct < 30` | My health is below 30% |
| `self.shield_pct < 20` | My shields are below 20% |
| `self.shield_pct == 0` | Shields are down |
| `target.distance < 100` | Target is within 100 units |
| `target.distance > 300` | Target is far away |
| `target.health_pct < 20` | Target is nearly dead |
| `enemy_count > 3` | More than 3 enemies nearby |
| `under_fire` | Currently taking damage |

The evaluator is a simple tokenizer + comparator — NOT a scripting engine. It handles: `field op value` where `op` is `<`, `>`, `<=`, `>=`, `==`. Compound conditions (`&&`, `||`) are a Phase 5 AI tier unlock.

```go
type Condition struct {
    Field    string  // "self.health_pct", "target.distance", etc.
    Operator string  // "<", ">", "=="
    Value    float64
}

func (c *Condition) Evaluate(ctx *ShipContext) bool {
    actual := ctx.Resolve(c.Field)
    switch c.Operator {
    case "<":  return actual < c.Value
    case ">":  return actual > c.Value
    case "<=": return actual <= c.Value
    case ">=": return actual >= c.Value
    case "==": return actual == c.Value
    default:   return false
    }
}
```

---

## 4. Prompt Pipeline

### 4.1 End-to-End Flow

```
Player types prompt
        │
        ▼
[Client] ──WebSocket──► [Go Server]
                              │
                    1. Validate cooldown (30s)
                    2. Validate prompt length (AI tier limit)
                    3. Build LLM request context
                              │
                              ▼
                    [LLM Request Queue]
                        (buffered chan)
                              │
                    ┌─────────▼──────────┐
                    │  LLM Worker Pool    │
                    │  (N goroutines)     │
                    │                     │
                    │  Build system prompt │
                    │  + player context   │
                    │  + few-shot examples│
                    │       │             │
                    │       ▼             │
                    │  HTTP POST to       │
                    │  JetStream          │
                    │       │             │
                    │       ▼             │
                    │  Parse JSON response│
                    │  Validate schema    │
                    │       │             │
                    │       ▼             │
                    │  Send BehaviorSet   │
                    │  to Engine.promptCh │
                    └─────────────────────┘
                              │
                    Engine picks up on next tick
                              │
                    Ship.Behavior = new BehaviorSet
```

### 4.2 Cooldown Enforcement

```go
type CooldownTracker struct {
    mu        sync.RWMutex
    lastPrompt map[string]time.Time  // playerID → last prompt time
    cooldown   time.Duration         // 30 seconds
}

func (ct *CooldownTracker) CanSubmit(playerID string) (bool, time.Duration) {
    ct.mu.RLock()
    defer ct.mu.RUnlock()
    
    last, exists := ct.lastPrompt[playerID]
    if !exists {
        return true, 0
    }
    
    elapsed := time.Since(last)
    if elapsed >= ct.cooldown {
        return true, 0
    }
    return false, ct.cooldown - elapsed  // remaining time
}
```

**Cooldown is enforced server-side only.** The client shows a timer for UX but the server is the authority. If a client sends a prompt too early, the server responds with an error message containing the remaining cooldown time.

### 4.3 LLM Request Queue

```go
type LLMQueue struct {
    requests chan LLMRequest
    workers  int
}

type LLMRequest struct {
    PlayerID   string
    PromptText string
    ShipState  ShipContext   // current stats, nearby enemies
    AITier     int           // determines context richness
    ResultCh   chan<- PromptResult
}

type PromptResult struct {
    PlayerID string
    Behavior *BehaviorSet
    Error    error
}

func (q *LLMQueue) Start(ctx context.Context, client *LLMClient) {
    for i := 0; i < q.workers; i++ {
        go func() {
            for req := range q.requests {
                behavior, err := client.ProcessPrompt(ctx, req)
                req.ResultCh <- PromptResult{
                    PlayerID: req.PlayerID,
                    Behavior: behavior,
                    Error:    err,
                }
            }
        }()
    }
}
```

**Worker count**: Start with 4 workers. Each worker blocks on the HTTP call to JetStream (~0.5-2s). With continuous batching on the TPU, 4 concurrent requests are batched efficiently. Increase if queue depth grows.

### 4.4 System Prompt Design

The system prompt is the most critical piece. It must be:
- Clear and unambiguous
- Contain the behavior vocabulary
- Include few-shot examples
- Adapt based on AI tier

```
SYSTEM PROMPT (Template):

You are a spaceship AI translator. Convert the captain's natural language order into a JSON behavior command.

## Available Behaviors
Movement: idle, move_to, orbit, chase, flee, patrol, strafe, wander
Combat: fire_at, hold_fire
Defense: shield_front, shield_balanced, shield_rear

## Available Targets
nearest_enemy, weakest_enemy, strongest_enemy, nearest_threat, lowest_shield, random_enemy, player:<name>

## Ship Status
Health: {health_pct}% | Shield: {shield_pct}%
Position: ({x}, {y}, {z})
Weapon: {weapon_type} (Damage: {damage}, Cooldown: {cooldown}s)

{IF AI_TIER >= 3}
## Nearby Ships
{for each nearby ship}
- {name}: Distance {dist}, Health {hp}%, Shield {sp}%, Heading {dir}
{end for}
{END IF}

## Output Format
Respond with ONLY valid JSON matching this schema:
{
  "primary": {
    "movement": "<behavior>",
    "movement_params": { ... },
    "combat": "<behavior>",
    "combat_params": { ... },
    "defense": "<behavior>"
  }
  {IF AI_TIER >= 2}
  , "conditionals": [
    {
      "condition": "<field> <op> <value>",
      "movement": "...", "movement_params": {...},
      "combat": "...", "defense": "..."
    }
  ]
  {END IF}
}

## Examples

Captain: "orbit the nearest enemy and fire"
Response:
{"primary":{"movement":"orbit","movement_params":{"target":"nearest_enemy","radius":150,"speed":30},"combat":"fire_at","combat_params":{"target":"nearest_enemy","weapon":"primary"},"defense":"shield_balanced"}}

Captain: "run away from everyone"
Response:
{"primary":{"movement":"flee","movement_params":{"target":"nearest_enemy","speed":50},"combat":"hold_fire","defense":"shield_rear"}}

Captain: "aggressively chase the weakest ship and hit it hard, but run if I'm low on health"
Response:
{"primary":{"movement":"chase","movement_params":{"target":"weakest_enemy","speed":50},"combat":"fire_at","combat_params":{"target":"weakest_enemy","weapon":"primary"},"defense":"shield_front"},"conditionals":[{"condition":"self.health_pct < 25","movement":"flee","movement_params":{"target":"nearest_enemy","speed":50},"combat":"hold_fire","defense":"shield_rear"}]}

Now translate the captain's order:
Captain: "{player_prompt}"
Response:
```

### 4.5 AI Tier Restrictions

The system prompt is dynamically built based on the player's AI tier:

| AI Tier | Max Prompt Length | Conditionals | Nearby Ship Info | Compound Conditions | Notes |
|---|---|---|---|---|---|
| 1 | 80 chars | 0 | No | No | Primary block only |
| 2 | 150 chars | 1 | No | No | One fallback condition |
| 3 | 250 chars | 2 | Yes (3 nearest) | No | Battlefield awareness |
| 4 | 400 chars | 3 | Yes (5 nearest) | Yes (`&&`) | Complex strategies |
| 5 | 600 chars | 5 | Yes (all visible) | Yes (`&&`, `||`) | Full tactical depth |

```go
func BuildSystemPrompt(tier int, shipCtx ShipContext, enemies []EnemyInfo) string {
    prompt := baseSystemPrompt
    
    // Add ship status (all tiers)
    prompt += formatShipStatus(shipCtx)
    
    // Add nearby enemies (tier 3+)
    if tier >= 3 {
        maxEnemies := map[int]int{3: 3, 4: 5, 5: 999}[tier]
        prompt += formatNearbyEnemies(enemies, maxEnemies)
    }
    
    // Add conditional examples (tier 2+)
    if tier >= 2 {
        prompt += conditionalExamples
    }
    
    return prompt
}
```

This directly ties progression to TPU compute:
- Tier 1 prompts: ~300 input tokens, ~50 output tokens → fast, cheap
- Tier 5 prompts: ~800 input tokens, ~150 output tokens → richer but earned

---

## 5. Behavior Executor

### 5.1 Integration with Game Loop

```go
func (e *Engine) updateEntities() {
    for _, ship := range e.state.Ships {
        if ship.Behavior == nil {
            continue // no behavior set yet, ship idles
        }
        
        // Check conditionals first
        activeBehavior := ship.Behavior.Primary
        for _, cond := range ship.Behavior.Conditionals {
            if cond.Condition.Evaluate(ship.Context()) {
                activeBehavior = cond.BehaviorBlock
                break // first matching conditional wins
            }
        }
        
        // Execute movement
        e.executeMovement(ship, activeBehavior)
        
        // Execute combat [Phase 4]
        // e.executeCombat(ship, activeBehavior)
        
        // Execute defense [Phase 4]
        // e.executeDefense(ship, activeBehavior)
    }
}
```

### 5.2 Movement Execution

```go
func (e *Engine) executeMovement(ship *Ship, behavior *BehaviorBlock) {
    switch behavior.Movement {
    case "idle":
        // Decelerate toward zero velocity
        ship.Velocity = ship.Velocity.MoveToward(Vec3{}, ship.Deceleration * e.dt)
        
    case "chase":
        target := e.resolveTarget(ship, behavior.MovementParams.Target)
        if target != nil {
            dir := target.Position.Sub(ship.Position).Normalize()
            speed := clamp(behavior.MovementParams.Speed, 0, ship.MaxSpeed)
            ship.Velocity = dir.Scale(speed)
            ship.Rotation = quatLookAt(dir)
        }
        
    case "flee":
        target := e.resolveTarget(ship, behavior.MovementParams.Target)
        if target != nil {
            dir := ship.Position.Sub(target.Position).Normalize()
            speed := clamp(behavior.MovementParams.Speed, 0, ship.MaxSpeed)
            ship.Velocity = dir.Scale(speed)
            ship.Rotation = quatLookAt(dir)
        }
        
    case "orbit":
        target := e.resolveTarget(ship, behavior.MovementParams.Target)
        if target != nil {
            radius := clamp(behavior.MovementParams.Radius, 50, 500)
            speed := clamp(behavior.MovementParams.Speed, 0, ship.MaxSpeed)
            
            toTarget := target.Position.Sub(ship.Position)
            dist := toTarget.Length()
            
            if dist < radius - 10 {
                // Too close, move outward
                ship.Velocity = toTarget.Normalize().Scale(-speed * 0.5)
            } else if dist > radius + 10 {
                // Too far, move inward
                ship.Velocity = toTarget.Normalize().Scale(speed * 0.5)
            } else {
                // At right distance, orbit tangentially
                tangent := Vec3{-toTarget.Z, 0, toTarget.X}.Normalize()
                ship.Velocity = tangent.Scale(speed)
            }
            ship.Rotation = quatLookAt(target.Position.Sub(ship.Position))
        }
        
    case "wander":
        // Gentle randomized steering
        if ship.WanderTimer <= 0 {
            ship.WanderDir = randomDirection()
            ship.WanderTimer = 2.0 + rand.Float32()*3.0 // new direction every 2-5 sec
        }
        ship.WanderTimer -= e.dt
        speed := clamp(behavior.MovementParams.Speed, 0, ship.MaxSpeed * 0.5)
        ship.Velocity = ship.WanderDir.Scale(speed)
        ship.Rotation = quatLookAt(ship.WanderDir)
        
    case "patrol":
        // Cycle through waypoints
        if len(behavior.MovementParams.Waypoints) == 0 {
            break
        }
        wp := behavior.MovementParams.Waypoints[ship.PatrolIndex % len(behavior.MovementParams.Waypoints)]
        target := Vec3{wp[0], wp[1], wp[2]}
        dist := target.Sub(ship.Position).Length()
        if dist < 10 {
            ship.PatrolIndex++
        }
        dir := target.Sub(ship.Position).Normalize()
        speed := clamp(behavior.MovementParams.Speed, 0, ship.MaxSpeed)
        ship.Velocity = dir.Scale(speed)
        ship.Rotation = quatLookAt(dir)
        
    case "strafe":
        target := e.resolveTarget(ship, behavior.MovementParams.Target)
        if target != nil {
            toTarget := target.Position.Sub(ship.Position)
            speed := clamp(behavior.MovementParams.Speed, 0, ship.MaxSpeed)
            
            // Maintain distance while circling
            var tangent Vec3
            if behavior.MovementParams.Direction == "left" {
                tangent = Vec3{-toTarget.Z, 0, toTarget.X}.Normalize()
            } else {
                tangent = Vec3{toTarget.Z, 0, -toTarget.X}.Normalize()
            }
            ship.Velocity = tangent.Scale(speed)
            ship.Rotation = quatLookAt(toTarget)
        }
    }
    
    // Apply velocity to position
    ship.Position = ship.Position.Add(ship.Velocity.Scale(e.dt))
}
```

### 5.3 Target Resolution

```go
func (e *Engine) resolveTarget(ship *Ship, selector string) *Ship {
    if strings.HasPrefix(selector, "player:") {
        name := strings.TrimPrefix(selector, "player:")
        for _, s := range e.state.Ships {
            if s.Username == name && s.ID != ship.ID {
                return s
            }
        }
        return nil
    }
    
    var best *Ship
    var bestScore float64
    
    for _, s := range e.state.Ships {
        if s.ID == ship.ID { continue }  // skip self
        
        switch selector {
        case "nearest_enemy":
            dist := ship.Position.DistTo(s.Position)
            if best == nil || dist < bestScore {
                best = s
                bestScore = dist
            }
        case "weakest_enemy":
            if best == nil || s.HealthPct() < bestScore {
                best = s
                bestScore = s.HealthPct()
            }
        case "strongest_enemy":
            if best == nil || s.HealthPct() > bestScore {
                best = s
                bestScore = s.HealthPct()
            }
        case "lowest_shield":
            if best == nil || s.ShieldPct() < bestScore {
                best = s
                bestScore = s.ShieldPct()
            }
        case "random_enemy":
            // Select with 1/N probability (reservoir sampling)
            // Simplified: just pick randomly
            return e.randomEnemy(ship)
        }
    }
    return best
}
```

---

## 6. JSON Response Parsing & Validation

### 6.1 Strict Schema Validation

The LLM output must be validated before applying to the ship. Invalid output = keep previous behavior.

```go
func ParseBehaviorJSON(raw string) (*BehaviorSet, error) {
    // Step 1: Try to extract JSON from the response
    // LLMs sometimes wrap JSON in markdown code fences
    jsonStr := extractJSON(raw)
    
    // Step 2: Unmarshal into struct
    var bs BehaviorSet
    if err := json.Unmarshal([]byte(jsonStr), &bs); err != nil {
        return nil, fmt.Errorf("invalid JSON: %w", err)
    }
    
    // Step 3: Validate primary block exists
    if bs.Primary.Movement == "" {
        return nil, fmt.Errorf("missing primary.movement")
    }
    
    // Step 4: Validate all fields against allowed values
    if !isValidMovement(bs.Primary.Movement) {
        return nil, fmt.Errorf("unknown movement: %s", bs.Primary.Movement)
    }
    if bs.Primary.Combat != "" && !isValidCombat(bs.Primary.Combat) {
        return nil, fmt.Errorf("unknown combat: %s", bs.Primary.Combat)
    }
    
    // Step 5: Validate target selectors
    if bs.Primary.MovementParams.Target != "" {
        if !isValidTarget(bs.Primary.MovementParams.Target) {
            return nil, fmt.Errorf("unknown target: %s", bs.Primary.MovementParams.Target)
        }
    }
    
    // Step 6: Clamp numeric parameters to safe ranges
    bs.Primary.MovementParams.Speed = clamp(bs.Primary.MovementParams.Speed, 0, 100)
    bs.Primary.MovementParams.Radius = clamp(bs.Primary.MovementParams.Radius, 30, 500)
    
    // Step 7: Validate conditions (if any)
    for i, cond := range bs.Conditionals {
        if err := validateCondition(cond.ConditionStr); err != nil {
            return nil, fmt.Errorf("conditional[%d]: %w", i, err)
        }
        parsedCond, _ := parseCondition(cond.ConditionStr)
        bs.Conditionals[i].Condition = parsedCond
    }
    
    return &bs, nil
}

func extractJSON(s string) string {
    // Strip markdown code fences if present
    s = strings.TrimSpace(s)
    if idx := strings.Index(s, "```json"); idx != -1 {
        s = s[idx+7:]
        if end := strings.Index(s, "```"); end != -1 {
            s = s[:end]
        }
    } else if idx := strings.Index(s, "```"); idx != -1 {
        s = s[idx+3:]
        if end := strings.Index(s, "```"); end != -1 {
            s = s[:end]
        }
    }
    
    // Find first { and last }
    start := strings.Index(s, "{")
    end := strings.LastIndex(s, "}")
    if start != -1 && end != -1 && end > start {
        return s[start : end+1]
    }
    return s
}
```

### 6.2 Fallback Strategy

If the LLM returns garbage or the response fails validation:
1. Log the error with the raw response for debugging
2. Send an error message to the client: "AI processor failed to interpret that command. Try rephrasing."
3. Ship keeps its previous behavior
4. **Do not** refund the cooldown — the player spent their prompt, they get feedback to rephrase

---

## 7. Client-Side Prompt UI

### 7.1 Prompt Input Component (`src/ui/PromptInput.tsx`)

```tsx
function PromptInput() {
  const [prompt, setPrompt] = useState('')
  const [cooldownRemaining, setCooldownRemaining] = useState(0)
  const maxLength = useGameStore(s => s.promptMaxLength) // from AI tier

  const handleSubmit = () => {
    if (cooldownRemaining > 0 || prompt.trim() === '') return
    
    socket.sendPrompt(prompt.trim())
    setPrompt('')
    setCooldownRemaining(30)
  }

  // Countdown timer
  useEffect(() => {
    if (cooldownRemaining <= 0) return
    const timer = setInterval(() => {
      setCooldownRemaining(prev => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldownRemaining])

  return (
    <div className="prompt-input-container">
      <input
        type="text"
        value={prompt}
        onChange={e => setPrompt(e.target.value.slice(0, maxLength))}
        placeholder={cooldownRemaining > 0
          ? `Cooldown: ${cooldownRemaining}s`
          : "Command your ship..."}
        disabled={cooldownRemaining > 0}
        onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        maxLength={maxLength}
      />
      <span className="char-count">{prompt.length}/{maxLength}</span>
      <button onClick={handleSubmit} disabled={cooldownRemaining > 0}>
        Execute
      </button>
    </div>
  )
}
```

### 7.2 Behavior Indicator

Show the player what behavior their ship is currently executing:

```tsx
function BehaviorIndicator() {
  const behavior = useGameStore(s => s.currentBehavior)
  
  if (!behavior) return <div className="behavior">No orders given</div>
  
  return (
    <div className="behavior">
      <span>Movement: {behavior.movement}</span>
      <span>Combat: {behavior.combat || 'hold_fire'}</span>
      <span>Defense: {behavior.defense || 'balanced'}</span>
    </div>
  )
}
```

---

## 8. Go-Side Data Structures

### 8.1 Complete Behavior Types

```go
type BehaviorSet struct {
    Primary      BehaviorBlock   `json:"primary"`
    Conditionals []ConditionalBlock `json:"conditionals,omitempty"`
}

type BehaviorBlock struct {
    Movement       string          `json:"movement"`
    MovementParams MovementParams  `json:"movement_params,omitempty"`
    Combat         string          `json:"combat,omitempty"`
    CombatParams   CombatParams    `json:"combat_params,omitempty"`
    Defense        string          `json:"defense,omitempty"`
}

type MovementParams struct {
    Target    string       `json:"target,omitempty"`
    Speed     float32      `json:"speed,omitempty"`
    Radius    float32      `json:"radius,omitempty"`
    Direction string       `json:"direction,omitempty"` // "left" or "right"
    Waypoints [][3]float32 `json:"waypoints,omitempty"`
}

type CombatParams struct {
    Target string `json:"target,omitempty"`
    Weapon string `json:"weapon,omitempty"` // "primary" or "secondary"
}

type ConditionalBlock struct {
    ConditionStr  string        `json:"condition"`
    Condition     *Condition    `json:"-"` // parsed at validation time
    BehaviorBlock               // embedded
}
```

### 8.2 LLM Client

```go
type LLMClient struct {
    baseURL    string
    httpClient *http.Client
}

func (c *LLMClient) ProcessPrompt(ctx context.Context, req LLMRequest) (*BehaviorSet, error) {
    systemPrompt := BuildSystemPrompt(req.AITier, req.ShipState, req.NearbyEnemies)
    
    payload := map[string]interface{}{
        "prompt":      systemPrompt + "\nCaptain: \"" + req.PromptText + "\"\nResponse:\n",
        "max_tokens":  150,
        "temperature": 0.1,  // Low temp for deterministic JSON output
    }
    
    body, _ := json.Marshal(payload)
    httpReq, _ := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/generate", bytes.NewReader(body))
    httpReq.Header.Set("Content-Type", "application/json")
    
    resp, err := c.httpClient.Do(httpReq)
    if err != nil {
        return nil, fmt.Errorf("LLM request failed: %w", err)
    }
    defer resp.Body.Close()
    
    var result struct {
        Text string `json:"text"`
    }
    json.NewDecoder(resp.Body).Decode(&result)
    
    return ParseBehaviorJSON(result.Text)
}
```

**Temperature 0.1**: We want deterministic, consistent JSON — not creative prose. Low temperature reduces hallucination and formatting randomness.

---

## 9. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 3.1 | Set up JetStream on TPU with Gemma 2 | `curl http://localhost:8000/generate` returns a valid response |
| 3.2 | Implement LLM HTTP client in Go | Go can send a prompt and receive text response from JetStream |
| 3.3 | Define behavior primitive Go types | All structs compile, JSON tags match schema |
| 3.4 | Build system prompt template | Generate system prompt with ship context and examples; manually verify LLM returns valid JSON |
| 3.5 | Implement JSON response parser + validator | Valid JSON → BehaviorSet; invalid JSON → error; code-fenced JSON → extracted correctly |
| 3.6 | Implement behavior executor for all movement types | idle, chase, flee, orbit, wander, strafe, patrol all produce correct velocity changes |
| 3.7 | Implement target resolver | All selectors (nearest, weakest, strongest, etc.) resolve to correct ship |
| 3.8 | Implement condition evaluator | `self.health_pct < 30` evaluates correctly against live ship state |
| 3.9 | Implement prompt cooldown tracker | Second prompt within 30s returns error with remaining time |
| 3.10 | Implement LLM request queue + worker pool | Prompts queue up, workers process concurrently, results apply next tick |
| 3.11 | Wire prompt submission through WebSocket | Client sends prompt → server validates → queues → applies behavior |
| 3.12 | Build PromptInput UI component | Input with char counter, cooldown timer, submit on Enter |
| 3.13 | Build BehaviorIndicator UI component | Shows current behavior primitives on the HUD |
| 3.14 | End-to-end test: prompt → behavior | Type "chase nearest enemy" → ship begins moving toward closest ship |

---

## 10. Milestone Definition

Phase 3 is **complete** when:

> Two browser tabs connect. Player A types "orbit the nearest enemy and fire." Their ship begins circling Player B's ship. Player B types "flee from the nearest enemy at full speed." Their ship starts moving away from Player A. The LLM processes prompts within 2 seconds. Submitting a second prompt within 30 seconds returns "Cooldown: Xs remaining." The prompt input shows a character limit based on AI tier (hardcoded to Tier 1 for now). Invalid prompts keep the previous behavior and show an error toast.
