# A11y PR Review Action

A GitHub Action that automatically reviews pull requests for accessibility (WCAG 2.1/2.2) issues using LLM analysis (Gemini or Ollama).

## Features

- **WCAG Compliance**: Analyzes code for WCAG 2.1 and WCAG 2.2 Level A/AA violations
- **Dual LLM Backend**: Supports Google Gemini API and self-hosted Ollama
- **Incremental Analysis**: Only analyzes files changed since the last run
- **Smart Deduplication**: Won't re-report the same issue twice across commits
- **Smart Feedback**:
  - 🔴 **CRITICAL** & 🟠 **IMPORTANT** → Posted as **inline review comments** on specific lines
  - 🟡 **SUGGESTION** & ⚪ **NIT** → Posted as a single **aggregated PR comment**
- **Fails on Issues**: Configurable failure when accessibility issues are found

## How It Works

1. **First Run**: Analyzes all files in the PR
2. **Subsequent Runs**: Only analyzes files changed since the last run
3. **Deduplication**: Uses issue hashes (`file:wcag_criterion:title`) to avoid re-reporting
4. **Re-analysis**: If a file is modified again, re-analyzes it and updates issues for that file

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
  checks: write

jobs:
  a11y-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Accessibility Review
        uses: your-org/a11y-pr-review@v5
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-backend: 'gemini'
          api-key: ${{ secrets.GEMINI_API_KEY }}
          # model: 'gemini-2.0-flash'  # optional
          # fail-on-issues: 'true'     # optional, defaults to true
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
  checks: write

jobs:
  a11y-review:
    runs-on: self-hosted  # Requires a runner with Ollama
    steps:
      - uses: actions/checkout@v4
      
      - name: Pull Ollama Model
        run: ollama pull qwen2.5-coder:32b
      
      - name: Accessibility Review
        uses: your-org/a11y-pr-review@v5
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
| `fail-on-issues` | Fail action if issues found | No | `true` |

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

## State Persistence

The action uses GitHub Check Runs to persist state across runs:

- **Issue Hashes**: Stored to avoid duplicate reports
- **Analyzed Files**: Tracked to enable incremental analysis
- **Last SHA**: Used to determine what to re-analyze

State is stored in the Check Run's `output.text` field as JSON.

## Deduplication

Issues are hashed using: `file:wcag_criterion:title`

- Same issue on same file = won't re-report
- File modified = re-analyzed, old issues removed, new issues added
- Issue moved to different line = still recognized as same issue (line not in hash)

## Setup

### 1. Build and Commit

```bash
npm install
npm run build
git add .
git commit -m "feat: Add incremental analysis and deduplication"
git push
```

### 2. Create Version Tag

```bash
git tag -a v5 -m "Add incremental analysis and deduplication"
git push origin v5
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
├── state/
│   ├── index.ts       # State exports
│   ├── types.ts       # Type definitions
│   └── check-run.ts   # Check Run management
├── github/
│   ├── index.ts       # GitHub exports
│   ├── client.ts      # GitHub API client
│   └── comments.ts    # Comment management
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