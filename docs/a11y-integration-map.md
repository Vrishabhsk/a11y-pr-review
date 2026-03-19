# a11y-pr-review-action Integration Document

**Document Version:** 1.0
**Repository:** `a11y-pr-review-action`
**Last Updated:** 2026-03-19

---

## 1. Network Architecture

### 1.1 System Integration Map

```
┌────────────────────────────────────────────────────────────────────────┐
│                         GitHub Runner (ubuntu-latest)                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      a11y-pr-review-action                       │  │
│  │                        (Node.js 20 Runtime)                      │  │
│  │                                                                  │  │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐   │  │
│  │  │   GitHub    │    │    LLM      │    │    GitHub API       │   │  │
│  │  │   Client    │    │   Clients   │    │    (Results)        │   │  │
│  │  │             │───▶│  Gemini or  │    │                     │   │  │
│  │  │             │    │  Ollama     │    │                     │   │  │
│  │  └─────────────┘    └──────┬──────┘    └──────────┬──────────┘   │  │
│  │                            │                     │               │  │
│  └────────────────────────────┼─────────────────────┼───────────────┘  │
│                               │                     │                  │
└───────────────────────────────┼─────────────────────┼──────────────────┘
                                │                     │
                                ▼                     ▼
                    ┌───────────────────┐    ┌─────────────────────┐
                    │  Gemini API       │    │  GitHub API         │
                    │  (generativeai    │    │  (api.github.com)   │
                    │   .google.com)    │    │                     │
                    └───────────────────┘    └─────────────────────┘
                                ▲
                    ┌────────────────────┐
                    │  Ollama Cloud      │
                    │  (ollama.com)      │
                    │  OR                │
                    │  Local Ollama      │
                    │  (localhost:11434) │
                    └────────────────────┘
```

### 1.2 Localhost Lifecycle (Self-Hosted Runners Only)

When using `llm-backend: ollama` with a local Ollama instance:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Self-Hosted Runner Environment                      │
│                                                                         │
│   ┌─────────────────┐         ┌─────────────────┐                       │
│   │  GitHub Runner   │         │  Ollama Server  │                      │
│   │  (localhost)     │────────▶│  (localhost:    │                      │
│   │                  │ HTTP    │   11434)         │                     │
│   └─────────────────┘         └─────────────────┘                       │
│                                                                         │
│   Security Note: Ollama on localhost has no authentication by default.  │
│   Use network isolation or reverse proxy with auth for production.      │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 External API Calls

| Provider | Endpoint | Purpose | Auth |
|----------|----------|---------|------|
| **GitHub REST API** | `api.github.com` | PR data, file diffs, reviews | `github-token` (automatic) |
| **Google Gemini** | `generativeai.googleapis.com` | LLM analysis | `api-key` input |
| **Ollama Cloud** | `ollama.com` | LLM analysis (alternative) | `OLLAMA_API_KEY` |
| **Local Ollama** | `localhost:11434` | LLM (self-hosted) | Optional Bearer token |

---

## 2. Data Sanitization

### 2.1 What Data is Sent to LLM

| Data | Sent? | Format |
|------|-------|--------|
| PR diff content | ✅ Yes | Full diff with `[N]` position markers |
| File paths | ✅ Yes | e.g., `src/components/Button.tsx` |
| Added/modified code | ✅ Yes | Lines with `+` prefix |
| Context lines | ✅ Yes | Lines with space prefix |
| Hunk headers | ✅ Yes | `@@ -a,b +c,d @@` |
| PR title/description | ❌ No | Not collected |
| Author information | ❌ No | Not collected |
| Comments/review history | ❌ No | Not collected |
| GitHub token | ❌ No | Handled by GitHub runtime |

### 2.2 PII/Secrets Handling

**⚠️ WARNING: No sanitization is performed on diff content.**

Any PII present in the PR code (e.g., hardcoded emails, names in strings, API keys in code) **will be sent to the LLM**.

**Recommendations:**
- Do not include real credentials in PR code
- Use environment variables for secrets, not hardcoded values
- Review LLM provider's data retention policies

### 2.3 Code Flow for Data Sending

```
src/llm/batch.ts (lines 41-60)
        │
        ▼
Format diff with position markers:
  "=== filename.js ==="
  "[1] +added line"
  "[2]   context line"

        │
        ▼
src/llm/gemini-client.ts OR src/llm/ollama-client.ts
        │
        ▼
Full prompt = systemPrompt + userPrompt + diffContent
        │
        ▼
HTTPS POST to LLM provider
```

---

## 3. Resource & Infrastructure Specs

### 3.1 Action Runtime

| Spec | Value |
|------|-------|
| Runtime | Node.js 20 |
| Type | JavaScript Action (compiled with ncc) |
| Entry | `dist/index.js` |
| Timeout | GitHub default (360 min max) |

### 3.2 No Container/Browser Required

**This action does NOT use headless browsers.** It is a pure LLM-based analysis tool.

| Component | Required? | Reason |
|-----------|-----------|--------|
| Headless Chromium | ❌ No | LLM-based analysis only |
| Playwright/Puppeteer | ❌ No | No DOM rendering |
| Docker Container | ❌ No | Runs in GitHub hosted runners |

### 3.3 Resource Usage

| Operation | CPU | Memory |
|----------|-----|--------|
| GitHub API calls | Low | ~50MB |
| LLM API calls | Low | ~100MB |
| Batch processing | Low | ~150MB peak |

### 3.4 Cleanup Strategy

N/A - No persistent processes or browser instances.

---

## 4. WCAG 2.2 Coverage

### 4.1 Active Automated Rules

The LLM is instructed to check for these WCAG criteria:

| Criterion | Description | Severity |
|-----------|-------------|----------|
| **1.1.1** | Non-text Content (alt text) | VIOLATION |
| **1.3.1** | Info & Relationships (semantic HTML) | VIOLATION |
| **1.4.3** | Contrast (4.5:1 normal, 3:1 large) | VIOLATION |
| **1.4.11** | Non-text Contrast (UI components) | VIOLATION |
| **2.1.1** | Keyboard Accessibility | VIOLATION |
| **2.1.2** | No Keyboard Traps | VIOLATION |
| **2.4.3** | Focus Order | VIOLATION |
| **2.4.4** | Link Purpose | VIOLATION |
| **2.4.6** | Headings & Labels | VIOLATION |
| **2.4.7** | Focus Visible | VIOLATION |
| **2.5.8** | Target Size (24x24 min) | VIOLATION |
| **3.1.1** | Language of Page | VIOLATION |
| **3.3.1** | Error Identification | VIOLATION |
| **3.3.2** | Labels or Instructions | VIOLATION |
| **4.1.1** | Parsing (no duplicate IDs) | VIOLATION |
| **4.1.2** | Name, Role, Value (ARIA) | VIOLATION |

### 4.2 Issue Classification

| Level | Description | Action |
|-------|-------------|--------|
| **VIOLATION** | WCAG 2.2 failure - MUST fix | Inline comment + check failure if `fail-on-issues=true` |
| **GOOD_PRACTICE** | Recommended improvement | PR summary comment only |

### 4.3 Style vs Code Issue Handling

| Issue Type | Example | Comment Type |
|------------|---------|--------------|
| **Code issues** | Missing `aria-label`, wrong tag | Inline suggestion block |
| **Style issues** | Color contrast, padding, outline | Plain text comment |

---

## 5. Audit Trail

### 5.1 Logging Mechanisms

| Method | Where | Retention |
|--------|-------|----------|
| `core.info()` | Action logs | GitHub UI (90 days) |
| `core.warning()` | Action logs | GitHub UI (90 days) |
| `core.setFailed()` | Action logs + Check run | GitHub UI (90 days) |
| PR Inline Comments | PR diff | Permanent in PR |
| PR Summary Comment | PR conversation | Permanent in PR |

### 5.2 Action Outputs (for DevOps)

| Output | Description |
|--------|-------------|
| `issues-found` | Total count |
| `violations` | VIOLATION count |
| `good-practices` | GOOD_PRACTICE count |

### 5.3 Quarterly Health Report Data

To generate quarterly reports, extract from GitHub API:

```bash
# Get all PR reviews from a time period
gh api repos/{owner}/{repo}/pulls/{pull_number}/reviews

# Get check run status for a11y reviews
gh api repos/{owner}/{repo}/commits/{sha}/check-runs

# Filter for failed checks (violations found)
gh api repos/{owner}/{repo}/check-runs --jq '.check_runs[] | select(.name == "a11y-pr-review") | {status: .status, conclusion: .conclusion, violations: .output.summary}'
```

---

## 6. Troubleshooting Guide

### 6.1 Pipeline Hangs

**Symptom:** Action runs indefinitely without completing.

**Common Causes:**
1. LLM API timeout (default 2 min per batch)
2. Network connectivity issues to LLM provider
3. Ollama server not responding (for local Ollama)
4. Rate limiting on LLM API

**Resolution:**
```yaml
- uses: Vrishabhsk/a11y-pr-review@v12.2
  timeout-minutes: 10  # Add explicit timeout
```

### 6.2 "No issues found" Despite Known Issues

**Symptom:** Action reports 0 issues on code with obvious accessibility problems.

**Causes:**
1. Missing `GEMINI_API_KEY` or incorrect `llm-backend`
2. System prompt not being sent (pre-fix versions)
3. LLM not detecting issues (try different model)
4. API key lacks permissions/quota

**Resolution:**
```yaml
- uses: Vrishabhsk/a11y-pr-review@v12.2
  with:
    llm-backend: gemini
    api-key: ${{ secrets.GEMINI_API_KEY }}
    model: gemini-2.0-flash  # Try larger model for better detection
```

### 6.3 Line Numbers Incorrect

**Symptom:** Inline comments on wrong lines.

**Cause:** Position marker format changed in v12.x.

**Resolution:** Ensure using latest version. Check `dist/index.js` includes `[N]` position markers.

### 6.4 Inline Suggestion on Wrong Line

**Symptom:** Suggestion block appears on wrong line than described issue.

**Cause:** LLM miscalculates position from diff format.

**Resolution:** Style-related issues (contrast, padding) are now posted as plain comments without suggestion blocks to avoid confusion.

### 6.5 API Key Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `api-key is required for Gemini` | Missing `api-key` input | Add `api-key: ${{ secrets.GEMINI_API_KEY }}` |
| `401 Unauthorized` (Ollama) | Wrong API key | Verify `OLLAMA_API_KEY` at ollama.com/settings/keys |
| `401 Unauthorized` (Gemini) | Invalid/expired key | Regenerate at Google AI Studio |
| `429 Rate Limited` | Too many requests | Add delay between batches (handled automatically) |

### 6.6 Ollama Connection Refused

**Symptom:** `ECONNREFUSED` when using local Ollama.

**Causes:**
1. Ollama server not running
2. Wrong port (default 11434)
3. Firewall blocking localhost

**Resolution:**
```bash
# Start Ollama server
ollama serve

# Verify it's running
curl http://localhost:11434/api/tags
```

---

## 7. Security Checklist

| Item | Status | Notes |
|------|--------|-------|
| API keys stored as GitHub Secrets | ☐ | Never hardcode |
| No PII in PR code sent to LLM | ☐ | User responsibility |
| Local Ollama uses network isolation | ☐ | Use firewall/VPN |
| LLM provider data retention reviewed | ☐ | User responsibility |
| GitHub token has minimal permissions | ☐ | Only `repo` scope needed |

---

## 8. Architecture Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | | | |
| Architect | | | |
| DevOps Manager | | | |

---

## Appendix A: Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-19 | Initial document creation |

---

*Document maintained by: DevOps Team*
