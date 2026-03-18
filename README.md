# A11y PR Review Action

A GitHub Action that automatically reviews pull requests for accessibility (WCAG 2.1/2.2) issues using LLM analysis (Gemini or Ollama).

## Features

- **WCAG Compliance**: Analyzes code for WCAG 2.1 and WCAG 2.2 Level A/AA violations
- **Dual LLM Backend**: Supports Google Gemini API and self-hosted Ollama
- **Smart Feedback**:
  - 🔴 **CRITICAL** & 🟠 **IMPORTANT** → Posted as **inline review comments** on specific lines
  - 🟡 **SUGGESTION** & ⚪ **NIT** → Posted as a single **aggregated PR comment**
- **Minimal & Robust**: Simple architecture with fewer failure points

## Usage

### With Gemini (Recommended)

```yaml
name: Accessibility Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  a11y-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Accessibility Review
        uses: your-org/a11y-pr-review@v4
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-backend: 'gemini'
          api-key: ${{ secrets.GEMINI_API_KEY }}
          # model: 'gemini-2.0-flash'  # optional, defaults to gemini-2.0-flash
```

### With Ollama (Self-Hosted)

```yaml
name: Accessibility Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  a11y-review:
    runs-on: self-hosted  # Requires a runner with Ollama
    steps:
      - uses: actions/checkout@v4
      
      - name: Pull Ollama Model
        run: ollama pull qwen2.5-coder:32b
      
      - name: Accessibility Review
        uses: your-org/a11y-pr-review@v4
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-backend: 'ollama'
          ollama-url: 'http://localhost:11434'
          model: 'qwen2.5-coder:32b'
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for API access | Yes | `${{ github.token }}` |
| `llm-backend` | LLM backend (`gemini` or `ollama`) | Yes | `gemini` |
| `api-key` | API key (required for Gemini) | For Gemini | - |
| `model` | Model to use | No | `gemini-2.0-flash` |
| `ollama-url` | Ollama API URL | No | `http://localhost:11434` |

## Outputs

| Output | Description |
|--------|-------------|
| `issues-found` | Total number of accessibility issues found |

## Severity Levels & Feedback

| Level | Description | Feedback Type |
|-------|-------------|---------------|
| 🔴 **CRITICAL** | Blocks screen readers/keyboard users | Inline review comment |
| 🟠 **IMPORTANT** | WCAG A/AA violations impacting usability | Inline review comment |
| 🟡 **SUGGESTION** | Recommended improvements | Aggregated PR comment |
| ⚪ **NIT** | Best practices | Aggregated PR comment |

## Setup

### 1. Build and Commit

```bash
npm install
npm run build
git add .
git commit -m "refactor: improve action with inline comments"
git push
```

### 2. Create Version Tag

```bash
git tag -a v4 -m "Add inline review comments for critical issues"
git push origin v4
```

### 3. Use in Your Workflow

Add the workflow YAML to your repository's `.github/workflows/` directory.

## Development

### Build
```bash
npm run build
```

### Project Structure
```
src/
├── index.ts           # Main entry point
├── llm/
│   ├── index.ts
│   ├── gemini-client.ts
│   └── ollama-client.ts
├── parsers/
│   ├── index.ts
│   └── diff-parser.ts
└── prompts/
    ├── index.ts
    └── a11y-prompt.ts
```

## License

MIT