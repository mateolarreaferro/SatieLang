# Satie Syntax Highlighting for VS Code

Syntax highlighting extension for Satie (.sat) script files in Visual Studio Code.

## Installation

### Method 1: Install from VSIX (Recommended)

1. Download the `satie-syntax-0.1.0.vsix` file from this repository
2. Open VS Code
3. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
4. Type "Extensions: Install from VSIX..." and select it
5. Browse to the downloaded `.vsix` file and select it
6. Reload VS Code when prompted

### Method 2: Command Line Installation

```bash
code --install-extension path/to/satie-syntax-0.1.0.vsix
```

## Features

- Syntax highlighting for Satie `.sat` files
- Support for:
  - Groups and statements (loop, oneshot)
  - Properties (volume, pitch, fade_in, etc.)
  - Interpolation functions (interpolate, goto, gobetween)
  - Movement types (walk, fly, pos)
  - Visual effects (trail, sphere, cube, etc.)
  - Comments
  - String literals
  - Numeric values and ranges

## Supported File Extensions

- `.sat`
- `.satie`

## Development

To modify the syntax highlighting:

1. Edit `syntaxes/satie.tmLanguage.json` for grammar rules
2. Edit `language-configuration.json` for brackets and comments
3. Rebuild the VSIX file:
   ```bash
   cd SatieSyntaxVSCode
   zip -r satie-syntax-0.1.0.vsix extension -x "*.DS_Store"
   ```

## License

MIT