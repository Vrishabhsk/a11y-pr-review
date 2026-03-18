# A11y PR Review Action

A GitHub Action that automatically reviews pull requests for accessibility (WCAG 2.1/2.2) issues using LLM analysis (Gemini or Ollama).

## Features

- **WCAG Compliance**: Analyzes code for WCAG 2.1 and WCAG 2.2 Level A/AA violations
- **Dual LLM Backend**: Supports Google Gemini API and self-hosted Ollama
- **Incremental Analysis**: 
  - First run: Analyzes ALL files in PR
  - Subsequent runs: Only analyzes files changed since last run
- **Smart Deduplication**: 
  - Issues from untouched files PERSIST (not re-analyzed)
  - Re-analyzed files: Old issues replaced, new issues reported
  - Hash: `file:wcag_criterion:title` (line not included)
- **Smart Feedback**:
  - 🔴 **CRITICAL** & 🟠 **IMPORTANT** → Inline review comments
  - 🟡 **SUGGESTION** & ⚪ **NIT** → Aggregated PR comment
- **Draft PR Support**: Skips draft PRs automatically
- **Batch Processing**: Files analyzed in batches of 20 for efficiency
- **Fails on Issues**: Configurable failure when issues found

## How It Works

### First Run
```
PR opened → Analyze ALL changed files → Store state in Check Run
                                     → Post comments/reviews
                                     → Save analyzed files + issues
```

### Subsequent Runs
```
New commits pushed → Get commits since last run
                  → Find changed files
                  → For touched files: Re-analyze, replace old issues
                  → For untouched files: PERSIST old issues
                  → Post NEW issues as inline comments
                  → Update comment with ALL issues (new + persisted)
```

### State Storage
State is persisted in GitHub Check Run's `output.text` field:
```json
{
  "version": 1,
  "lastAnalyzedHeadSha": "abc123...",
  "prNumber": 42,
  "issuesByFile": {
    "src/Button.tsx": [{ "file": "...", "line": 10, ... }],
    "src/Form.tsx": [{ "file": "...", "line": 25, ... }]
  }
}
```

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
    runs-on: self-hosted
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
| 🟠 **IMPORTANT** | WCAG A/AA violations | Inline review comment |
| 🟡 **SUGGESTION** | Recommended improvements | PR comment |
| ⚪ **NIT** | Best practices | PR comment |

## Comment Format

```markdown
## ♿ Accessibility Review

Found **7 issues** (2 new since last analysis)

### 🔴 Critical Issues
- **src/Button.tsx:42** ⚡ **NEW** - Missing alt text on image
  - WCAG 1.1.1 (Level A)
  - **Fix:** alt='Product photo'

### 🟠 Important Issues
- **src/Form.tsx:15** - Missing label for email input
  - WCAG 3.3.2 (Level A)
  - **Fix:** aria-label='Email address'

<details>
<summary>📋 5 issues from previous analysis</summary>
Files not re-analyzed in this run.
</details>

---
*🤖 This review was automatically generated.*
```

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
│   └── check-run.ts   # Check Run state management
├── github/
│   ├── index.ts       # GitHub exports
│   ├── client.ts      # GitHub API client
│   └── comments.ts    # Comment formatting
├── llm/
│   ├── index.ts       # LLM exports
│   ├── gemini-client.ts
│   ├── ollama-client.ts
│   └── batch.ts       # Batch processing
├── parsers/
│   ├── index.ts
│   └── diff-parser.ts
└── prompts/
    ├── index.ts
    └── a11y-prompt.ts
```

## License

MIT