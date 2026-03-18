# A11y PR Review Action

A GitHub Action that automatically reviews pull requests for accessibility (WCAG 2.1/2.2) issues using LLM analysis (Gemini or Ollama).

## Features

- **WCAG Compliance**: Analyzes code for WCAG 2.1 and WCAG 2.2 Level A/AA violations
- **Dual LLM Backend**: Supports both Google Gemini API and self-hosted Ollama
- **Smart Feedback**:
  - CRITICAL/IMPORTANT issues → Inline code suggestions
  - SUGGESTION/NIT issues → Aggregated PR comment
- **State Persistence**: Tracks reported issues across commits for deduplication
- **Incremental Reviews**: Only analyzes new changes on subsequent commits
- **TypeScript**: Native GitHub Action, fast execution, no runtime dependencies to install

## Usage

### Basic Workflow

```yaml
name: Accessibility Review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  a11y-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Accessibility Review
        uses: your-org/a11y-pr-review@v1
        with:
          llm-backend: 'gemini'
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Using Ollama (Self-Hosted)

```yaml
jobs:
  a11y-review:
    runs-on: ubuntu-latest
    services:
      ollama:
        image: ollama/ollama:latest
        ports:
          - 11434:11434

    steps:
      - uses: actions/checkout@v4

      - name: Pull Ollama Model
        run: ollama pull qwen2.5-coder:32b

      - name: Accessibility Review
        uses: your-org/a11y-pr-review@v1
        with:
          llm-backend: 'ollama'
          ollama-api-url: 'http://localhost:11434'
          ollama-model: 'qwen2.5-coder:32b'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `llm-backend` | LLM backend (`gemini` or `ollama`) | Yes | `gemini` |
| `gemini-api-key` | Google Gemini API key | For Gemini | - |
| `gemini-model` | Gemini model to use | No | `gemini-2.0-flash` |
| `ollama-api-url` | Ollama API URL | No | `http://localhost:11434` |
| `ollama-model` | Ollama model to use | No | `qwen2.5-coder:32b` |
| `github-token` | GitHub token for API access | Yes | - |
| `severity-threshold` | Min severity to report | No | `SUGGESTION` |
| `max-issues` | Max issues per review | No | `50` |

## Outputs

| Output | Description |
|--------|-------------|
| `issues-found` | Total issues found |
| `critical-count` | Critical issues |
| `important-count` | Important issues |

## Severity Levels

| Level | Description |
|-------|-------------|
| 🔴 **CRITICAL** | Blocks screen readers/keyboard users |
| 🟠 **IMPORTANT** | WCAG A/AA violations impacting usability |
| 🟡 **SUGGESTION** | Recommended improvements |
| ⚪ **NIT** | Best practices |

## Development

### Setup

```bash
git clone https://github.com/your-org/a11y-pr-review-action.git
cd a11y-pr-review-action
npm install
```

### Build

```bash
npm run build
```

### Test Locally

```bash
# Set environment variables
export INPUT_LLM_BACKEND=gemini
export INPUT_GEMINI_API_KEY=your-api-key
export INPUT_GITHUB_TOKEN=your-token
export GITHUB_REPOSITORY=owner/repo
export GITHUB_EVENT_NAME=pull_request

# Run
node dist/index.js
```

## Project Structure

```
src/
├── index.ts          # Main entry point
├── types.ts          # TypeScript type definitions
├── llm/
│   ├── index.ts      # LLM client factory
│   ├── base.ts       # Interface definition
│   ├── gemini-client.ts
│   └── ollama-client.ts
├── github/
│   ├── index.ts
│   ├── client.ts     # GitHub API client
│   ├── suggestions.ts # Inline suggestions
│   └── comments.ts   # PR comments
├── prompts/
│   ├── index.ts
│   ├── a11y-prompt.ts # WCAG prompts
│   └── severity.ts    # Severity classification
├── state/
│   ├── index.ts
│   ├── manager.ts     # State persistence
│   └── deduplication.ts
└── parsers/
    ├── index.ts
    └── diff-parser.ts
```

## License

MIT