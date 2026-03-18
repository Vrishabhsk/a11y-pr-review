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
        uses: your-org/a11y-pr-review-action@v1
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
        options: >-
          --health-cmd "ollama list"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Pull Ollama Model
        run: ollama pull qwen2.5-coder:32b

      - name: Accessibility Review
        uses: your-org/a11y-pr-review-action@v1
        with:
          llm-backend: 'ollama'
          ollama-api-url: 'http://localhost:11434'
          ollama-model: 'qwen2.5-coder:32b'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `llm-backend` | LLM backend to use (`gemini` or `ollama`) | Yes | `gemini` |
| `gemini-api-key` | Google Gemini API key (required for Gemini) | No | - |
| `gemini-model` | Gemini model to use | No | `gemini-2.0-flash` |
| `ollama-api-url` | Ollama API URL (required for Ollama) | No | `http://localhost:11434` |
| `ollama-model` | Ollama model to use | No | `qwen2.5-coder:32b` |
| `github-token` | GitHub token for API access | Yes | - |
| `severity-threshold` | Minimum severity to report (`CRITICAL`, `IMPORTANT`, `SUGGESTION`, `NIT`) | No | `SUGGESTION` |
| `max-issues` | Maximum number of issues to report per review | No | `50` |

## Outputs

| Output | Description |
|--------|-------------|
| `issues-found` | Total number of accessibility issues found |
| `critical-count` | Number of critical issues found |
| `important-count` | Number of important issues found |

## Severity Levels

### CRITICAL
Issues that block users with disabilities from accessing content:
- Missing alt text on informative images
- Keyboard traps
- Unlabeled form inputs
- Invalid ARIA roles/attributes

### IMPORTANT
WCAG Level A/AA violations that significantly impact usability:
- Low color contrast
- Missing focus indicators
- Vague link text
- Improper heading structure

### SUGGESTION
Recommended improvements for better accessibility:
- Missing landmark regions
- Missing page language
- Non-semantic HTML

### NIT
Minor improvements and best practices:
- Missing skip links
- Non-optimal ARIA usage
- Missing autocomplete attributes

## State Persistence

The action uses GitHub Artifacts to persist review state:
- State is stored with 30-day retention
- Tracks which commits have been reviewed
- Records hashes of reported issues for deduplication
- First PR → full review of accessibility-relevant files
- Subsequent commits → only new changes

## WCAG Coverage

The action checks for violations of:

### Perceivable
- **1.1.1** Non-text Content (alt text)
- **1.3.1** Info and Relationships (semantic HTML)
- **1.4.3** Contrast (Minimum)
- **1.4.11** Non-text Contrast

### Operable
- **2.1.1** Keyboard Accessible
- **2.1.2** No Keyboard Trap
- **2.4.4** Link Purpose
- **2.4.7** Focus Visible

### Understandable
- **3.1.1** Language of Page
- **3.3.1** Error Identification
- **3.3.2** Labels or Instructions

### Robust
- **4.1.1** Parsing
- **4.1.2** Name, Role, Value (ARIA)

## Example Output

### Inline Suggestion (CRITICAL)

```markdown
🔴 **Image missing alt text**

**WCAG 1.1.1** (Level A)
**Severity:** CRITICAL

This informative image has no alt attribute, making it inaccessible to screen reader users.

```suggestion
<img src="chart.png" alt="Sales increased 25% in Q4 2024" />
```
```

### Aggregated Comment (SUGGESTION/NIT)

```markdown
## ♿ Accessibility Suggestions

### 📄 `src/components/Button.tsx`

**🟡 Line 15: Missing button type**
- WCAG 2.1.1 (Level AA)
- Consider adding type="button" for clarity
```

## Customization

### Custom Severity Threshold

To only report CRITICAL and IMPORTANT issues:

```yaml
- name: Accessibility Review
  uses: your-org/a11y-pr-review-action@v1
  with:
    severity-threshold: 'IMPORTANT'
```

### Different Models

For larger diffs or more detailed analysis:

```yaml
# Gemini Pro
- name: Accessibility Review
  uses: your-org/a11y-pr-review-action@v1
  with:
    gemini-model: 'gemini-2.0-pro'

# Ollama with different model
- name: Accessibility Review
  uses: your-org/a11y-pr-review-action@v1
  with:
    ollama-model: 'llama3.1:70b'
```

## Development

### Setup

```bash
git clone https://github.com/your-org/a11y-pr-review-action.git
cd a11y-pr-review-action
pip install -r requirements.txt
```

### Testing Locally

```bash
# Set environment variables
export LLM_BACKEND=gemini
export GEMINI_API_KEY=your-api-key
export GITHUB_TOKEN=your-token
export GITHUB_REPOSITORY=owner/repo
export GITHUB_PR_NUMBER=123
export GITHUB_SHA=abc123

# Run
python src/a11y_review.py
```

## License

MIT License - See [LICENSE](LICENSE) for details.

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.