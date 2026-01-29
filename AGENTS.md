# Satie Language - Agent Instructions

## Project Overview

Satie is a domain-specific language (DSL) for spatial audio composition in Unity. It enables composers and sound designers to write text-based scripts (`.sat` files) that describe complex audio behaviors including:

- Looping and one-shot playback with precise timing
- Spatial audio with movement and 3D positioning
- DSP effects (reverb, delay, filter, distortion, EQ)
- Parameter interpolation and automation
- Reproducible renders via seeded randomization

**Target users**: Composers, sound designers, game audio developers, and interactive media artists who want programmatic control over spatial audio without writing C# code.

**Key principle**: The package must remain self-contained with zero external dependencies beyond Unity and Steam Audio.

---

## Architecture

### Core Pipeline

```
.sat Script
    ↓
SatieParser.Parse()
    ↓
List<Statement>  (AST)
    ↓
SatieRuntime.Sync()
    ↓
SatieTrackManager  →  Tracks + AudioSources
    ↓
SatieScheduler  →  DSP-accurate event timing
    ↓
DSP Effects  →  Real-time audio processing
```

### Key Classes

| Class | Location | Purpose |
|-------|----------|---------|
| `Statement` | Runtime/Core/SatieParser.cs:9-96 | Parsed audio statement (AST node) |
| `RangeOrValue` | Runtime/Core/SatieParser.cs:98-124 | Randomizable parameter (single value or range) |
| `SatieParser` | Runtime/Core/SatieParser.cs:127+ | Regex-based script parser |
| `SatieRuntime` | Runtime/Core/SatieRuntime.cs | Main MonoBehaviour, orchestrates everything |
| `SatieScheduler` | Runtime/Core/SatieScheduler.cs | Sample-accurate event queue |
| `SatieDSPClock` | Runtime/Core/SatieDSPClock.cs | DSP time tracking (AudioSettings.dspTime) |
| `SatieTrackManager` | Runtime/Core/SatieTrackManager.cs | Manages active voices/tracks |
| `SatieTrack` | Runtime/Core/SatieTrack.cs | Single voice with sources |
| `SatieAudioEvent` | Runtime/Core/SatieAudioEvent.cs | Scheduled playback event |
| `InterpolationData` | Runtime/Core/InterpolationData.cs | goto/gobetween parameter automation |
| `SatieRandom` | Runtime/Core/SatieRandom.cs | Seeded RNG for reproducibility |

### DSP Components

| Component | Purpose |
|-----------|---------|
| `SatieDSPReverb` | Freeverb algorithm (8 comb + 4 allpass filters) |
| `SatieDSPDelay` | Stereo delay with ping-pong and feedback |
| `SatieDSPFilter` | Biquad filter (lowpass, highpass, bandpass, notch, peak) |
| `SatieDSPDistortion` | Multiple modes (softclip, hardclip, tanh, cubic, asymmetric) |
| `SatieDSPEQ` | 3-band parametric EQ |
| `SatieDSPFade` | Global fade in/out |
| `SatieDSPTailHandler` | Keeps oneshots alive for reverb/delay tails |

---

## DSL Syntax Reference

### Basic Structure

```satie
# Comments start with hash
loop "clip/path"
    volume 0.8
    pitch 1.0

oneshot "sound" every 2to5
    volume 0.5
```

### Playback Commands

| Syntax | Description |
|--------|-------------|
| `loop "clip"` | Loop audio continuously |
| `oneshot "clip"` | Play once |
| `oneshot "clip" every N` | Repeat every N seconds |
| `oneshot "clip" every NtoM` | Repeat at random interval |
| `N * loop "clip"` | Spawn N instances |

### Clip References

| Syntax | Description |
|--------|-------------|
| `"path/to/clip"` | Direct path (Resources folder) |
| `"sounds/amb000to005"` | Random clip from range (000-005) |

### Core Parameters

| Parameter | Values | Description |
|-----------|--------|-------------|
| `volume` | 0.0-1.0 or range | Amplitude |
| `pitch` | 0.1-3.0 or range | Playback speed |
| `start` | seconds | Delay before playback |
| `end` | seconds | Stop at this time |
| `duration` | seconds | Play for this duration |
| `fade_in` | seconds | Fade in time |
| `fade_out` | seconds | Fade out time |
| `end N fade M` | N=time, M=fade | End at N with M second fade |

### Flags

| Flag | Description |
|------|-------------|
| `overlap` | Allow overlapping instances |
| `persistent` | Survive script reloads |
| `mute` | Silence this track |
| `solo` | Only play solo tracks |
| `randomstart` | Start at random position in clip |

### Interpolation

Three interpolation types for parameter automation:

```satie
# goto: transition from A to B once
volume goto(0and1 in 2)           # 0 to 1 over 2 seconds
volume goto(0and1 as inquad in 2) # with easing

# gobetween: oscillate between A and B
pitch gobetween(0.8and1.2 in 1)            # forever
pitch gobetween(0.8and1.2 in 1 for 3)      # 3 cycles
pitch gobetween(0.8and1.2 as inoutquad in 2)  # with easing

# Ranges in interpolation
volume goto(0.5to0.7 and 0.9to1.0 in 2to4)  # randomized start/end/duration
```

**Easing functions**: `linear`, `inquad`, `outquad`, `inoutquad`, `incubic`, `outcubic`, `inoutcubic`, `inquart`, `outquart`, `inoutquart`, `inquint`, `outquint`, `inoutquint`, `insine`, `outsine`, `inoutsine`, `inexpo`, `outexpo`, `inoutexpo`, `incirc`, `outcirc`, `inoutcirc`, `inback`, `outback`, `inoutback`, `inelastic`, `outelastic`, `inoutelastic`, `inbounce`, `outbounce`, `inoutbounce`

### Movement & Spatial Audio

```satie
# Basic movement
move fly                    # 3D movement in 5x5x5 area
move walk                   # XZ plane only (Y=0)
move fixed                  # One-time random position

# Custom bounds
move x -10to10 y 0to5 z -10to10

# Movement speed
move fly speed 0.5          # Hz (movements per second)

# Full syntax
move x 0to10 y 2 z -5to5 speed 0.5
```

### Visuals

```satie
visual trail               # Trail renderer
visual sphere              # Primitive sphere
visual cube                # Primitive cube
visual object "path/prefab" # Custom prefab
```

### Color

```satie
color white                # Named color
color #FF0000              # Hex
color 255,100,50           # RGB

# Animated color channels
color red goto(0and255 in 2) green 100 blue 50
```

### DSP Effects

#### Reverb
```satie
reverb wet 0.5 size 0.8 damping 0.6

# With interpolation
reverb wet goto(0and0.8 in 3) size 0.9
```

| Parameter | Range | Description |
|-----------|-------|-------------|
| `wet` | 0-1 | Dry/wet mix |
| `size` | 0-1 | Room size |
| `damping` | 0-1 | High frequency absorption |

#### Delay
```satie
delay wet 0.3 time 0.5 feedback 0.7
delay wet 0.5 time 0.25 feedback 0.6 pingpong 1
```

| Parameter | Range | Description |
|-----------|-------|-------------|
| `wet` | 0-1 | Dry/wet mix |
| `time` | 0.01-2.0 | Delay time in seconds |
| `feedback` | 0-0.99 | Feedback amount |
| `pingpong` | 0/1 | Stereo ping-pong mode |
| `filter` | 20-20000 | Feedback filter cutoff Hz |

#### Filter
```satie
filter mode lowpass cutoff 1000 resonance 2 wet 1
```

| Parameter | Values | Description |
|-----------|--------|-------------|
| `mode` | lowpass, highpass, bandpass, notch, peak | Filter type |
| `cutoff` | 20-20000 | Cutoff frequency Hz |
| `resonance` | 0.1-30 | Q factor |
| `wet` | 0-1 | Dry/wet mix |

#### Distortion
```satie
distortion mode tanh drive 0.5 wet 0.8
```

| Parameter | Values | Description |
|-----------|--------|-------------|
| `mode` | softclip, hardclip, tanh, cubic, asymmetric | Algorithm |
| `drive` | 0-1 | Distortion amount |
| `wet` | 0-1 | Dry/wet mix |

#### EQ
```satie
eq low 3 mid -2 high 1
```

| Parameter | Range | Description |
|-----------|-------|-------------|
| `low` | -24 to +24 | Low shelf gain dB |
| `mid` | -24 to +24 | Mid peak gain dB |
| `high` | -24 to +24 | High shelf gain dB |

### Groups

Groups apply shared properties to multiple statements:

```satie
group ambient
    volume 0.5
    reverb wet 0.3

    loop "rain"
    loop "wind"
        volume 0.8    # Multiplies: 0.5 * 0.8 = 0.4
endgroup
```

**Inheritance rules**:
- `volume` and `pitch`: multiply with parent
- Other properties: child overrides parent

### Comment Blocks

```satie
# Single line comment

comment
    This entire block
    is ignored by the parser
endcomment
```

---

## Development Guidelines

### Adding a New DSL Feature

1. **Parser** (`SatieParser.cs`):
   - Add regex pattern or extend existing patterns
   - Parse values into `Statement` fields

2. **Statement** (`SatieParser.cs:9-96`):
   - Add field(s) to hold parsed data
   - Use `RangeOrValue` for randomizable parameters
   - Use `InterpolationData` for animated parameters

3. **Runtime** (`SatieRuntime.cs`):
   - Handle in `SpawnSource()` for per-source setup
   - Handle in `Sync()` for global behavior
   - Handle in `ScheduleDSPPlayback()` for timing

4. **DSP** (if new effect):
   - Create `SatieDSP*.cs` in `Runtime/DSP/`
   - Implement `OnAudioFilterRead()` for processing
   - Add `Initialize(SatieDSPClock, SatieRandom, Statement)`
   - Use `MovementInterpolator` for parameter automation

### Adding a New DSP Effect

Follow the pattern in existing DSP components:

```csharp
[RequireComponent(typeof(AudioSource))]
public class SatieDSPNewEffect : MonoBehaviour
{
    private SatieDSPClock clock;
    private SatieRandom random;

    // Parameters
    private float param1;
    private MovementInterpolator param1Interpolator;

    public void Initialize(SatieDSPClock clock, SatieRandom random, Statement stmt)
    {
        this.clock = clock;
        this.random = random;

        // Initialize parameters from statement
        if (stmt.newEffectParam1.isSet)
            param1 = random.Sample(stmt.newEffectParam1);

        // Setup interpolator if animated
        if (stmt.newEffectParam1Interp != null)
        {
            param1Interpolator = gameObject.AddComponent<MovementInterpolator>();
            param1Interpolator.Initialize(clock, random, stmt.newEffectParam1Interp);
        }
    }

    void Update()
    {
        if (param1Interpolator != null)
            param1 = param1Interpolator.CurrentValue;
    }

    void OnAudioFilterRead(float[] data, int channels)
    {
        // Process audio samples
        for (int i = 0; i < data.Length; i += channels)
        {
            // Apply effect to data[i] (left) and data[i+1] (right)
        }
    }
}
```

### Code Patterns to Follow

**Initialization pattern**:
```csharp
// Constructor or Awake: minimal setup
// Initialize(): receive dependencies, configure state
// Start(): begin operation (if MonoBehaviour)
// Update(): per-frame logic
```

**RangeOrValue for randomizable parameters**:
```csharp
// In Statement class
public RangeOrValue volume = new RangeOrValue();

// In parsing
stmt.volume = RangeOrValue.Parse(value);

// In runtime
float actualVolume = random.Sample(stmt.volume);
```

**Effect application via AddComponent**:
```csharp
if (stmt.reverbWet.isSet || stmt.reverbWetInterp != null)
{
    var reverb = source.gameObject.AddComponent<SatieDSPReverb>();
    reverb.Initialize(clock, random, stmt);
}
```

**Seeded random for reproducibility**:
```csharp
// Use SatieRandom, never System.Random or UnityEngine.Random directly
float value = random.Range(0f, 1f);
float sampled = random.Sample(someRangeOrValue);
```

### Testing

- **Parser tests**: Unit test regex patterns and Statement population
- **Runtime tests**: Unit test non-audio logic (scheduling, track management)
- **Manual testing**: Use Unity scenes in `Assets/Scenes/` for audio/spatial features
- **Tutorial scenes**: Test against `Samples~/Tutorial/` scenes for regression
- **Reproducibility**: Same seed should produce identical renders

---

## Constraints

- **DO NOT** add external dependencies (package must remain self-contained)
- **DO NOT** commit API keys, credentials, or secrets
- **DO NOT** use `System.Random` or `UnityEngine.Random` directly (use `SatieRandom`)
- **DO NOT** break existing `.sat` script syntax (maintain backwards compatibility)
- **Prefer** editing existing files over creating new ones
- **Follow** existing naming conventions (read codebase patterns first)
- **Maintain** sample-accurate timing (use `SatieDSPClock`, not `Time.time`)

---

## Directory Quick Reference

| Path | Purpose |
|------|---------|
| `Packages/com.satie.lang/Runtime/Core/` | Parser, runtime, scheduling, timing |
| `Packages/com.satie.lang/Runtime/DSP/` | Audio effects processing |
| `Packages/com.satie.lang/Runtime/AI/` | LLM integration (Anthropic, speech) |
| `Packages/com.satie.lang/Runtime/AudioGeneration/` | ElevenLabs integration |
| `Packages/com.satie.lang/Runtime/SpatialAudio/` | Ambisonic encoding, Steam Audio |
| `Packages/com.satie.lang/Editor/` | Custom inspectors, importers |
| `Packages/com.satie.lang/Plugins/SteamAudio/` | Steam Audio native plugins |
| `Packages/com.satie.lang/Resources/` | Default assets, presets |
| `Packages/com.satie.lang/Samples~/` | Tutorials, examples, audio library |
| `Packages/com.satie.lang/Tools~/` | VS Code extension |
| `Assets/Scenes/` | Development sandbox scenes |
| `Assets/Resources/Audio/` | Audio files for testing |

---

## Personalization

This configuration establishes technical requirements and project-specific patterns. To customize the agent's tone and communication style:

1. Create `~/.opencode/AGENTS.md` with your personal preferences
2. Examples:
   - "Be concise and direct"
   - "Explain concepts in detail with examples"
   - "Use casual language"
   - "Always suggest multiple approaches"

Your global configuration augments (doesn't replace) these project instructions.
