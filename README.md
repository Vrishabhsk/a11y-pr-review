# A11y PR Review Action

A GitHub Action that automatically reviews pull requests for accessibility (WCAG 2.1/2.2) issues using LLM analysis (Gemini or Ollama).

## Features

- **WCAG Compliance**: Analyzes code for WCAG 2.1 and WCAG 2.2 Level A/AA violations
- **Dual LLM Backend**: Supports Google Gemini API and self-hosted Ollama
- **Minimal & Robust**: Simple, focused design with fewer failure points
- **GitHub Native**: Posts comments directly on PRs

## Usage

### With Gemini (Recommended)

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
        uses: your-org/a11y-pr-review@v3
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-backend: 'gemini'
          api-key: ${{ secrets.GEMINI_API_KEY }}
```

### With Ollama (Self-Hosted)

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
    runs-on: self-hosted  # Or a runner with GPU
    steps:
      - uses: actions/checkout@v4
      
      - name: Accessibility Review
        uses: your-org/a11y-pr-review@v3
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
| `api-key` | API key (Gemini required) | For Gemini | - |
| `model` | Model to use | No | `gemini-2.0-flash` |
| `ollama-url` | Ollama API URL | No | `http://localhost:11434` |

## Outputs

| Output | Description |
|--------|-------------|
| `issues-found` | Number of accessibility issues found |

## Severity Levels

| Level | Description |
|-------|-------------|
| 🔴 **CRITICAL** | Blocks screen readers/keyboard users |
| 🟠 **IMPORTANT** | WCAG A/AA violations impacting usability |
| 🟡 **SUGGESTION** | Recommended improvements |
| ⚪ **NIT** | Best practices |

## Setup After v1/v2 Tags

Since you already have v1 and v2 tags, here's the process:

### 1. Build and Commit
```bash
npm install
npm run build
git add .
git commit -m "Refactor: Simplify architecture for robustness"
git push
```

### 2. Create v3 Tag
```bash
git tag -a v3 -m "Simplified, robust architecture"
git push origin v3
```

### 3. Update Major Version Tags (Optional)
To update users on v1/v2 to use v3:
```bash
# Delete old v1/v2 tags if you want to repoint them
git tag -d v1
git push origin :refs/tags/v1

# Create new v1 pointing to v3 (for automatic updates)
git tag v1
git push origin v1
```

### 4. Test the Action
Create a test PR in a repo using this action to verify it works.

## Development

### Build
```bash
npm install
npm run build
```

### Local Testing
```bash
export INPUT_GITHUB_TOKEN="${GITHUB_TOKEN}"
export INPUT_LLM_BACKEND=gemini
export INPUT_API_KEY="${GEMINI_API_KEY}"
export GITHUB_REPOSITORY=owner/repo
export GITHUB_EVENT_NAME=pull_request
export GITHUB_EVENT_PATH=/tmp/event.json

# Create event.json with PR payload
node dist/index.js
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