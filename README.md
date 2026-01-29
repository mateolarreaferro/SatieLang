# SatieLang

SatieLang is a Domain Specific Language (DSL) for generative and event-based audio scripting in Unity. Define complex audio behaviors with simple, declarative syntax.

## Installation

**Requires Unity 6000.1 or later.**

Install via the Unity Package Manager using a git URL:

```
https://github.com/mateolarreaferro/SatieLang.git?path=Packages/com.satie.lang
```

Or add directly to your project's `Packages/manifest.json`:

```json
{
    "dependencies": {
        "com.satie.lang": "https://github.com/mateolarreaferro/SatieLang.git?path=Packages/com.satie.lang"
    }
}
```

### What you get

- **Runtime** — Satie DSL parser, scheduler, track manager, DSP effects (EQ, delay, distortion, reverb, filter), spatial audio with Steam Audio
- **Editor tools** — Custom inspectors, `.sat` file importer, right-click "Create > Satie Script" menu
- **Steam Audio** — Bundled inside the package, no separate install needed

### After installing

1. **Import the Audio Library** — Open **Window > Package Manager**, find **Satie Language**, expand **Samples**, and import **Audio Library**. This is required for `Resources.Load` audio paths in `.sat` scripts.
2. **Set up API keys** (optional, for AI features) — Copy `APIKeys.cs.example` to `APIKeys.cs` in your Assets folder and fill in your keys:

```csharp
namespace Satie
{
    public static class APIKeys
    {
        public const string ANTHROPIC = "sk-ant-api03-...";   // AI code generation
        public const string OPENAI = "sk-proj-...";           // Speech input
        public const string ELEVENLABS = "sk_...";            // Audio generation
        public const string GOOGLE = "";                      // Optional
    }
}
```

Get your keys from:
- Anthropic: [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- ElevenLabs: [elevenlabs.io/api](https://elevenlabs.io/api)

Alternatively, set environment variables (these take priority over the file):
```bash
export SATIE_API_KEY_ANTHROPIC="sk-ant-..."
export SATIE_API_KEY_OPENAI="sk-proj-..."
export SATIE_API_KEY_ELEVENLABS="sk_..."
```

3. **Import samples** (optional) — In the Package Manager under **Satie Language > Samples**:
   - **Tutorial** — 8 step-by-step lessons with scenes and scripts
   - **Example Scripts** — Effects, compositions, and radio play demos

### Quick start

1. Right-click in the Project window and select **Create > Satie Script (.sat)**
2. Create an empty GameObject in your scene
3. Add the **SatieRuntime** component
4. Assign your `.sat` script to the **Script File** field
5. Press Play

## Basic Syntax

### Playback Types
```satie
# One-shot sound (plays once)
oneshot "explosion"
    volume 0.9

# Looping sound (plays continuously)
loop "ambient"
    volume 0.5
```

### Randomization
Use `to` to create ranges:
```satie
loop "footsteps" every 0.5to1.5
    volume 0.6to0.9        # Random volume
    pitch 0.9to1.1         # Random pitch
```

### Interpolation
Animate parameters over time:
```satie
loop "engine"
    volume goto(0and0.8 as inquad in 2)           # Fade in
    pitch gobetween(0.5and2.0 as linear in 3)     # Oscillate
```

Easing functions: `linear`, `inquad`, `outquad`, `inoutquad`, `incubic`, `outcubic`, `inoutcubic`

### Multiple Instances
```satie
5 * loop "bird_chirp"
    volume 0.3to0.6
    pitch 0.8to1.3
```

### Timing and Fading
```satie
loop "ambient"
    start 2.0                          # Delay start
    volume goto(0and0.8 in 2)          # Fade in over 2 seconds
    end 10 fade 2                      # End at 10s with 2s fade out
```

### Groups
Apply properties to multiple sounds:
```satie
group background
    volume 0.5

    loop "layer1"
        volume goto(0and0.5 in 1)

    loop "layer2"
        volume goto(0and0.5 in 2)
endgroup
```

### 3D Audio
```satie
loop "flying_sound"
    move fly speed 1                    # Random 3D movement
    visual trail                        # Visual effect

oneshot "static_sound"
    move x 10 y 5 z -10                 # Fixed position
```

### Comments
```satie
# This is a comment
loop "music"  # Inline comment
    volume 0.5
```

## Quick Reference

| Feature | Example |
|---------|---------|
| Loop | `loop "ambient"` |
| One-shot | `oneshot "click"` |
| Repeat | `oneshot "beep" every 2to5` |
| Volume | `volume 0.8` or `volume 0.5to1.0` |
| Pitch | `pitch 0.9to1.1` |
| Start delay | `start 2.0` |
| End with fade | `end 10 fade 2` |
| Fade in | `volume goto(0and0.8 in 2)` |
| Interpolate | `goto(0and1 as inquad in 2)` |
| Oscillate | `gobetween(0.5and2 as linear in 3)` |
| Multiple | `3 * loop "rain"` |
| Group | `group intro` |

## Tools

Located in the package's `Tools~/` directory (ignored by Unity, usable outside the editor):

- **VSCodeExtension/** — Syntax highlighting for `.sat` files

## Development

This repository is a full Unity project for developing the Satie Language package. The package source lives at `Packages/com.satie.lang/` and is automatically loaded as an embedded package when you open the project.

Dev scenes are in `Assets/Scenes/` (Sandbox, Monks, Soundscape).

### AI-assisted development

This project is configured for [OpenCode](https://opencode.ai), an AI coding assistant. To set it up:

1. **Install OpenCode**
   ```bash
   curl -fsSL https://opencode.ai/install | bash
   ```

2. **Set your Anthropic API key**
   ```bash
   # Add to ~/.zshrc or ~/.bashrc
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

3. **Run from the project root**
   ```bash
   opencode
   ```

The project includes `opencode.json` (configuration) and `AGENTS.md` (codebase instructions) so the assistant understands the DSL syntax, architecture, and development patterns.
