# Satie Language

A domain-specific language for spatial audio composition in Unity.

## Installation

Install via Unity Package Manager using a git URL:

```
https://github.com/<owner>/SatieLang.git?path=Packages/com.satie.lang
```

Or add directly to `Packages/manifest.json`:

```json
{
    "dependencies": {
        "com.satie.lang": "https://github.com/<owner>/SatieLang.git?path=Packages/com.satie.lang"
    }
}
```

**Requires Unity 6000.1 or later.**

## Setup

### API Keys

AI-powered features require API keys. Copy `APIKeys.cs.example` to `APIKeys.cs` (gitignored) and fill in your keys:

```csharp
public static class APIKeys
{
    public const string ANTHROPIC = "sk-ant-api03-...";   // AI code generation
    public const string OPENAI = "sk-proj-...";           // Speech input
    public const string ELEVENLABS = "sk_...";            // Audio generation
    public const string GOOGLE = "";                      // Optional
}
```

### Audio Library

The built-in audio files are distributed as an importable sample. To use `Resources.Load` audio paths in your `.sat` scripts:

1. Open **Window > Package Manager**
2. Find **Satie Language**
3. Expand **Samples** and import **Audio Library**

This copies audio files into your project's `Assets/Samples/` folder where `Resources.Load` can find them.

## Samples

Import via Package Manager:

- **Tutorial** - 8 step-by-step lessons covering Satie fundamentals
- **Example Scripts** - Effects, compositions, and radio play examples
- **Audio Library** - Built-in sound library (~400 files)

## Tools

Located in `Tools~/` (ignored by Unity):

- **VSCodeExtension/** - Syntax highlighting for `.sat` files
