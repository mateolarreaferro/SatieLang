# Satie: A Creativity Support Tool for Authoring Spatial Generative Audio
### NIME 2025 Presentation (~10 minutes)

---

## Slide 1: Title
**Satie: A Creativity Support Tool for Authoring Spatial Generative Audio**

Mateo Larrea (Stanford University), Yuhao Zhang (Google), Richard Boulanger (Berklee College of Music), Jerry Chen (Webb)

NIME 2025

---

## Slide 2: The Problem (~1 min)
**The gap between creative intent and implementation**

Sound designers working in games, VR, and immersive media know *what* they want:
- "Five different birds, randomly triggered, flying around in 3D space"
- "A wind layer that fades in over 5 seconds"
- "Rain with reverb and a lowpass filter sweep"

But implementing this requires:
- Coroutines, audio source pooling, Perlin noise functions
- Trail renderers, fade logic, DSP configuration
- Hundreds of lines of C# code

**Result:** Designers delegate to programmers. Friction, delays, loss of creative control.

*Speaker notes: Open with the forest example. "Imagine you want to create a forest ambience. You know exactly what it should sound like. But to make it happen in Unity, you need to write this..." Show the C# code briefly. "That's over 140 lines. Now look at this..." Transition to next slide.*

---

## Slide 3: Satie in 7 Lines (~1 min)
**The same forest soundscape in Satie:**

```
5 * oneshot gen bird chirping every 2to10
    volume 0.1to0.5
    pitch 0.5to1.1
    fade 5
    move fly
    visual trail
    end 60
```

| Requirement | DSL keyword |
|---|---|
| Five different bird sounds | `5 * oneshot gen` |
| Stochastic intervals (2-10s) | `every 2to10` |
| Varying pitch and volume | `pitch`, `volume` + ranges |
| 3D Perlin-noise movement | `move fly` |
| Trajectory visualization | `visual trail` |
| Fade in over 5s | `fade 5` |
| Stop after 60s | `end 60` |

**7 lines. Every keyword is a word sound designers already know.**

*Speaker notes: Walk through each line. "5 star oneshot gen bird chirping every 2 to 10. That's: create 5 instances, each a one-shot, generate the audio from the prompt 'bird chirping', retrigger every 2 to 10 seconds. Volume, pitch, fade, move, visual, end. That's it. The gen keyword generates 5 unique bird sounds via AI, so each instance sounds different."*

---

## Slide 4: What is Satie? (~1 min)
**A creativity support tool with two core components:**

1. **An audio-first DSL** whose keywords mirror sound-designer vocabulary
   - `volume`, `pitch`, `fade`, `reverb`, `delay`, `filter`
   - `loop`, `oneshot`, `move fly`, `visual trail`
   - Plain text, line-oriented, version-control friendly

2. **A human-in-the-loop workflow** where AI assistance is inspectable and editable
   - Write code directly, prompt in natural language, or speak via microphone
   - All three modes produce the same artifact: readable Satie code
   - Every AI-generated element can be understood and modified by hand

**Design goal: preserve human agency, even when using generative AI.**

*Speaker notes: "Satie has two parts. First, a domain-specific language that uses the vocabulary sound designers already know from DAWs. Second, a workflow where AI is a tool, not a replacement. Whether you write code, type a prompt, or speak into a microphone, you always get readable Satie code that you can inspect and edit."*

---

## Slide 5: Language Design (~1.5 min)
**Core syntax concepts**

**Playback types:**
```
loop ambient/forest          # Plays continuously
oneshot click every 2to5     # Triggers every 2-5 seconds
5 * oneshot gen bird chirping every 3to8   # 5 unique generated instances
```

**Ranges = per-event randomization:**
```
volume 0.1to0.5    # Each trigger gets a random volume
pitch 0.8to1.2     # Each trigger gets a random pitch
```

**Interpolation:**
```
volume goto(0and1 in 5)              # Fade 0 to 1 over 5 seconds
pitch gobetween(0.5and2.0 in 3)     # Oscillate continuously
```

**Spatial motion:**
```
move fly                  # 3D Perlin noise
move walk                 # Ground plane (Y=0)
move x -10to10 z -5to5   # Custom bounds
```

**Groups, DSP effects, visual debugging, inline audio generation...**

*Speaker notes: "The language is intentionally minimal. Two playback types: loop and oneshot. Ranges for randomization, just use 'to'. Interpolation for animation. Spatial motion with Perlin noise. And everything composes freely: you can put DSP effects on a generated sound that's flying through 3D space inside a group with an animated fade-in."*

---

## Slide 6: The `gen` Keyword (~1 min)
**Inline audio generation from text prompts**

```
loop gen fire with crackles
    volume 0.8

5 * oneshot gen whale call every 10to15
    volume 0.6to1
    move fly
    visual trail
```

**How it works:**
- Runtime checks if a cached WAV already exists
- If not, calls the ElevenLabs API asynchronously
- Saves the WAV, starts playback when ready
- Non-generated tracks play immediately (no blocking)
- `5 *` + `gen` = 5 unique audio variants from the same prompt

**Key point:** `gen` composes with everything else. Volume, pitch, movement, effects, groups, multipliers all work as expected.

*Speaker notes: "The gen keyword is where audio generation meets the DSL. You write 'loop gen fire with crackles' and the runtime generates a WAV from that text prompt, caches it, and plays it like any normal clip. When you combine gen with a multiplier, like '5 star oneshot gen whale call', you get 5 different whale sounds, not 5 copies of the same one. And the generated sounds work with every other feature: movement, effects, groups, everything."*

---

## Slide 7: Live Demo / Underwater Scene (~1.5 min)
**Demo: underwater.sat**

```
group underwater
volume goto(0and1 as inquad in 5)
    loop gen underwater calm ambience
        volume 0.5
        reverb wet 0.2
    5 * oneshot gen bubbling note every 1to10
        volume 0.1to0.3
        pitch 0.7to2
        move walk speed 2to3
        visual sphere
    5 * oneshot gen whale call every 10to15
        volume 0.6to1
        move x -10to10 y -10to10 z -5to5 speed 0.5to2
        visual trail
        color blue
    3 * oneshot gen dolphin click every 10to20
        volume 0.2to0.3
        pitch 0.8to1.5
        move y 5to15 speed 1to3
    oneshot gen deep ocean rumble every 15to25
        volume 0.2
    2 * oneshot gen water splash every 5to12
        volume 0.01to0.1
        pitch 0.8to1.2
        move y 10to11
```

**30 lines. 6 sound types. 17 independent instances. Group fade-in. Reverb. Walk/fly/axis movement. Visual trails and spheres. Color. All generated audio.**

*Speaker notes: If possible, play a live demo in Unity showing the scene running with visual trails. Otherwise, show a screen recording. Point out the visual trails, the spheres, the group fade-in. "This is 30 lines. The equivalent C# is 141 lines, and that's with the LLM explicitly trying to minimize code length."*

---

## Slide 8: Human-AI Co-Creation (~1 min)
**Three interaction modes, one artifact**

1. **Direct code** - Write .sat scripts in any editor (VS Code extension available)
2. **Natural language** - "Make a quiet forest with flying birds around me"
3. **Voice** - Speak into microphone (Whisper transcription)

**All three produce readable Satie code.**

**Multi-agent architecture:**
- **Orchestrator** (Claude Sonnet): Generates Satie code from prompts
- **SyntaxValidator** (Haiku): Validates DSL syntax in parallel
- **LibraryChecker** (Haiku): Scans audio library; if samples are missing, orchestrator uses `gen` automatically
- **CompilationVerifier** (Haiku): Parses output, self-corrects errors

*Speaker notes: "You can interact with Satie three ways, and they all produce the same thing: readable Satie code. The AI pipeline uses a multi-agent architecture. The orchestrator generates the code, while specialist agents validate syntax, check the audio library, and verify compilation, all in parallel. If the library checker finds that a requested sound doesn't exist, the orchestrator automatically uses the gen keyword to generate it."*

---

## Slide 9: Targeted Editing (~1 min)
**The key advantage of DSL as intermediate representation**

**The problem with LLM-generated C#:**
- Designer can't read it
- Editing one thing might break something else
- Regenerating risks losing previous work

**Satie's solution: the DSL is the interface**

```
5 * oneshot gen bird chirping every 2to10
    volume 0.1to0.5       <-- change this to 0.3to0.8
    pitch 0.5to1.1
    move fly
```

- Each sound = an independent block of plain text
- Change the birds without touching the wind
- Change the volume without touching the pitch
- The LLM generates Satie, not C#; designers can always read and edit the result

**Analogy:** Like editing one layer in Photoshop vs. regenerating the entire image.

*Speaker notes: "This is the core design insight. When an LLM generates C# directly, it's a black box. You can't easily find the bird volume buried in a coroutine. With Satie, every property is one line. You change 'volume 0.1to0.5' to 'volume 0.3to0.8' and you know exactly what will happen. Nothing else changes. It's like editing one layer in Photoshop rather than regenerating the whole image."*

---

## Slide 10: Evaluation (~1 min)
**Lines of code: Satie vs. LLM-generated C#**

| Scene | Satie | C# (minimized) | Ratio |
|---|---|---|---|
| Underwater | 30 | 141 | 4.7x |
| Enchanted Forest | 36 | 173 | 4.8x |
| City Street | 32 | 165 | 5.2x |

**Average: ~5x shorter, even when the LLM is told to minimize C# length.**

This isn't about typing less. It's about:
- **Readability**: Sound designers can understand Satie; most can't read C#
- **Editability**: One-line changes vs. hunting through coroutines
- **Composability**: Every feature works with every other feature
- **The gap is structural**: Coroutine scheduling, audio pooling, Perlin noise, fade logic, trail renderers are all first-class primitives in Satie

*Speaker notes: "We compared all three scenes. Both the Satie scripts and the C# were generated by Claude with identical requirements. The C# was explicitly told to minimize length. Satie is still about 5 times shorter. But the real point isn't the line count, it's the readability. A sound designer can read and edit the Satie version. The C# version requires understanding coroutines, component systems, and object-oriented programming."*

---

## Slide 11: Architecture Overview (~30 sec)
**System components**

```
Input (code / NL / voice)
    |
    v
Parser (regex-based, line-by-line)
    |  - gen preprocessing
    |  - group property inheritance
    |  - RangeOrValue / InterpolationData
    v
Statement objects
    |
    v
Runtime (SatieRuntime)
    |  - Track management
    |  - Sample-accurate DSP scheduler (dspTime)
    |  - Async audio generation
    v
Unity Audio + Steam Audio spatialization
```

**Key architectural property:** Interpreted, not compiled. Change the script while playing; hear the result immediately.

*Speaker notes: Keep this brief. "The architecture is straightforward. A regex parser turns .sat scripts into statement objects. The runtime interprets them in real time. Because it's interpreted, you can edit the script while it's playing and hear changes immediately. Steam Audio handles spatial rendering."*

---

## Slide 12: Conclusion & Future Work (~30 sec)
**Satie: preserving human agency in spatial audio design**

- An audio-first DSL with sound-designer vocabulary
- AI as a tool, not a replacement: inspectable, editable output
- Inline audio generation that composes with the full language
- ~5x more concise than minimized C#
- Open source: github.com/mateolarreaferro/SatieLang

**Future directions:**
- Standalone platform (beyond Unity): macOS, Windows, web
- VST/AU plugins for DAW integration
- Seeded randomness for reproducible renders
- Controlled user studies

**Named after Erik Satie, who coined *musique d'ameublement* (furniture music, 1917): music intended to blend into the environment rather than demand active attention.**

*Speaker notes: "Satie shows that combining an audio-first DSL with a human-in-the-loop workflow can lower the implementation barrier for spatial audio while keeping designers in control. It's open source, it runs in Unity, and we're working toward a standalone platform. The name honors Erik Satie, who in 1917 imagined music that blends into the environment, which is essentially what spatial generative audio does. Thank you."*

---

## Timing Guide

| Slide | Topic | Duration |
|---|---|---|
| 1 | Title | 15 sec |
| 2 | The Problem | 1 min |
| 3 | Satie in 7 Lines | 1 min |
| 4 | What is Satie? | 1 min |
| 5 | Language Design | 1.5 min |
| 6 | The `gen` Keyword | 1 min |
| 7 | Live Demo / Underwater | 1.5 min |
| 8 | Human-AI Co-Creation | 1 min |
| 9 | Targeted Editing | 1 min |
| 10 | Evaluation | 1 min |
| 11 | Architecture | 30 sec |
| 12 | Conclusion | 30 sec |
| **Total** | | **~10 min** |

---

## Suggested Visuals

- **Slide 2:** Split screen: designer's intent (simple bullet points) vs. C# wall of code
- **Slide 3:** The 7-line Satie script with syntax highlighting, requirements table alongside
- **Slide 5:** Code examples with syntax highlighting (blue=keywords, purple=properties, teal=modifiers)
- **Slide 7:** Unity screenshot or screen recording with visual trails showing bird/whale trajectories
- **Slide 8:** Diagram showing three input modes converging on Satie code, multi-agent pipeline
- **Slide 9:** Side-by-side: editing one line in Satie vs. finding the equivalent in C#
- **Slide 10:** Bar chart of LOC comparison
- **Slide 11:** Simple architecture diagram (boxes and arrows)
