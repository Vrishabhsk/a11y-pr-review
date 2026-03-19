# a11y-pr-review-action Usage Guide

**Document Version:** 1.0
**Repository:** `a11y-pr-review-action`
**Last Updated:** 2026-03-19

---

## Overview

The `a11y-pr-review-action` supports two LLM backends:
- **Google Gemini** - Cloud-based, no local setup
- **Ollama Cloud** - Cloud-hosted models, for privacy or custom models

---

## Google Gemini Setup

### Prerequisites

1. Google AI Studio account: https://aistudio.google.com/
2. API key with Gemini API access

### Getting Your API Key

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Click **Get API Key** in the sidebar
3. Create a new API key or use an existing one
4. Copy the key (starts with `AIza...`)

### GitHub Secrets Configuration

```bash
# Settings → Secrets and variables → Actions → New repository secret

Name: GEMINI_API_KEY
Secret: <your-api-key-from-google-ai-studio>
```

### Workflow Configuration

```yaml
name: Accessibility Review

on: [pull_request]

jobs:
  a11y-review:
    runs-on: ubuntu-latest
    steps:
      - name: A11y PR Review
        uses: Vrishabhsk/a11y-pr-review@v12.2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-backend: gemini
          api-key: ${{ secrets.GEMINI_API_KEY }}
          model: gemini-2.0-flash
          fail-on-issues: true
```

### Available Gemini Models

| Model | Description | Best For |
|-------|-------------|----------|
| `gemini-2.0-flash` | **Recommended** - Fast, cost-effective | Most PRs |
| `gemini-2.5-flash-lite` | Cheapest, lower quality | Large diffs |
| `gemini-2.5-flash` | Balanced | Complex issues |
| `gemini-2.5-pro` | Highest quality, slower | Critical apps |

### Gemini-Specific Notes

- **Rate Limits**: Varies by tier (Free: 15 req/min, Paid: higher)
- **Pricing**: Pay-per-token, free tier available
- **Data Privacy**: Google processes your code for API response only
- **Timeout**: Default 2 minutes per batch

---

## Ollama Cloud Setup

### Prerequisites

1. Ollama Cloud account: https://ollama.com/
2. API key

### Getting Ollama Cloud API Key

1. Go to https://ollama.com/
2. Sign in / Sign up
3. Go to Settings → Keys
4. Create API key

### GitHub Secrets Configuration

```bash
# Settings → Secrets and variables → Actions → New repository secret

Name: OLLAMA_API_KEY
Secret: <your-ollama-cloud-api-key>
```

### Recommended Ollama Cloud Models

| Model | Description | Best For |
|-------|-------------|----------|
| `qwen2.5-coder:32b` | **Recommended** - Code-focused | Accessibility review |
| `qwen2.5-coder:14b` | Lighter version | Faster analysis |
| `llama3.1:8b` | General purpose | Simple issues |
| `mixtral:8x7b` | High quality | Complex analysis |

### Workflow Configuration

```yaml
name: Accessibility Review

on: [pull_request]

jobs:
  a11y-review:
    runs-on: ubuntu-latest
    steps:
      - name: A11y PR Review
        uses: Vrishabhsk/a11y-pr-review@v12.2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-backend: ollama
          ollama-url: https://ollama.com
          api-key: ${{ secrets.OLLAMA_API_KEY }}
          model: qwen2.5-coder:32b
          fail-on-issues: true
```

### Ollama Cloud-Specific Notes

- **Rate Limits**: No rate limits on paid plans
- **Pricing**: Pay-per-use based on model size
- **Data Privacy**: Code processed by Ollama Cloud - review their privacy policy
- **Timeout**: Default 2 minutes per batch

---

## Comparison: Gemini vs Ollama Cloud

| Aspect | Gemini | Ollama Cloud |
|--------|--------|--------------|
| **Setup** | Quick | Quick |
| **Cost** | Pay-per-use | Pay-per-use |
| **Privacy** | Code sent to Google | Code sent to Ollama |
| **Speed** | Fast | Fast |
| **Quality** | Excellent | Excellent for code |
| **Maintenance** | None | None |

### When to Use What

| Use Case | Recommended Backend |
|----------|-------------------|
| Quick setup, small teams | **Gemini** |
| Code-focused analysis | **Ollama Cloud (qwen2.5-coder)** |
| No infrastructure management | Either |

---

## Environment Variables vs Inputs

You can configure via environment variables instead of workflow inputs:

| Input Name | Environment Variable | Notes |
|------------|---------------------|-------|
| `github-token` | `GITHUB_TOKEN` | Automatic in Actions |
| `api-key` | `GEMINI_API_KEY` / `OLLAMA_API_KEY` | Preferred for keys |
| `model` | - | Must use input |
| `ollama-url` | - | Must use input |
| `llm-backend` | - | Must use input |
| `fail-on-issues` | - | Must use input |

### Using Environment Variables (Recommended for Keys)

```yaml
env:
  GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}

jobs:
  a11y-review:
    runs-on: ubuntu-latest
    steps:
      - name: A11y PR Review
        uses: Vrishabhsk/a11y-pr-review@v12.2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-backend: gemini
          # api-key: Will use GEMINI_API_KEY env var
```

---

## Troubleshooting

### Gemini Issues

**"API key not valid"**
- Verify key starts with `AIza`
- Check key is active in Google AI Studio
- Ensure billing is enabled if using paid tier

**"Quota exceeded"**
- Wait and retry
- Upgrade Google AI Studio plan
- Use smaller model

### Ollama Cloud Issues

**"401 Unauthorized"**
- Verify API key is correct
- Check key is active at ollama.com/settings/keys
- Ensure `ollama-url` is set to `https://ollama.com`

**"Connection refused"**
- Verify `ollama-url` is `https://ollama.com` (not localhost)
- Check network connectivity from runner

---

## Security Best Practices

| Practice | Gemini | Ollama Cloud |
|----------|--------|--------------|
| Store API keys in GitHub Secrets | ✅ | ✅ |
| Enable 2FA on provider account | ✅ | ✅ |
| Use minimal API key permissions | ✅ | ✅ |
| Rotate keys regularly | ✅ | ✅ |
| Audit logs in provider dashboard | ✅ | ✅ |

---

## Appendix: Full Workflow Examples

### Minimal Gemini Setup

```yaml
name: Accessibility Review
on: [pull_request]
jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: Vrishabhsk/a11y-pr-review@v12.2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-backend: gemini
          api-key: ${{ secrets.GEMINI_API_KEY }}
```

### Full Featured (Gemini)

```yaml
name: Accessibility Review
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - name: A11y PR Review
        uses: Vrishabhsk/a11y-pr-review@v12.2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-backend: gemini
          api-key: ${{ secrets.GEMINI_API_KEY }}
          model: gemini-2.0-flash
          fail-on-issues: true
```

### Ollama Cloud (Recommended)

```yaml
name: Accessibility Review
on: [pull_request]
jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: Vrishabhsk/a11y-pr-review@v12.2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-backend: ollama
          ollama-url: https://ollama.com
          api-key: ${{ secrets.OLLAMA_API_KEY }}
          model: qwen2.5-coder:32b
          fail-on-issues: true
```

---
