# Claude Skills & Sub-Agents: Complete Guide

> A comprehensive reference for implementing Claude Skills and Sub-Agents in Claude Code

---

## Table of Contents

1. [Claude Skills](#claude-skills)
   - [What Are Skills?](#what-are-skills)
   - [Skill Structure](#skill-structure)
   - [Creating Skills](#creating-skills)
   - [Installing & Using Skills](#installing--using-skills)
   - [Example Skills](#example-skills)
2. [Claude Sub-Agents](#claude-sub-agents)
   - [What Are Sub-Agents?](#what-are-sub-agents)
   - [Built-in Sub-Agents](#built-in-sub-agents)
   - [Creating Custom Sub-Agents](#creating-custom-sub-agents)
   - [Configuration Reference](#configuration-reference)
   - [Example Sub-Agents](#example-sub-agents)
3. [Best Practices](#best-practices)
4. [Resources](#resources)

---

## Claude Skills

### What Are Skills?

Skills are **folders of instructions, scripts, and resources** that Claude loads dynamically to improve performance on specialized tasks. They teach Claude how to complete specific tasks in a repeatable way.

**Use Cases:**
- Creating documents with company brand guidelines
- Analyzing data using organization-specific workflows
- Automating personal tasks
- Creative applications (art, music, design)
- Technical tasks (testing web apps, MCP server generation)
- Enterprise workflows (communications, branding)

### Skill Structure

Skills are simple to create - just a folder with a `SKILL.md` file containing YAML frontmatter and instructions:

```
my-skill/
├── SKILL.md          # Required: Main skill definition
├── templates/        # Optional: Template files
├── scripts/          # Optional: Helper scripts
└── resources/        # Optional: Additional resources
```

#### SKILL.md Format

```markdown
---
name: my-skill-name
description: A clear description of what this skill does and when to use it
---

# My Skill Name

[Add your instructions here that Claude will follow when this skill is active]

## Examples
- Example usage 1
- Example usage 2

## Guidelines
- Guideline 1
- Guideline 2
```

#### Required Frontmatter Fields

| Field | Description |
|-------|-------------|
| `name` | Unique identifier (lowercase, hyphens for spaces) |
| `description` | Complete description of what the skill does and when to use it |

### Creating Skills

#### Method 1: Using Claude Code Templates (Easiest)

```bash
# Go to https://aitmpl.com/skills
# Copy the skill-creator command
# Run it in your terminal
# Tell Claude what skill you want
```

#### Method 2: Manual Creation

1. Create a directory for your skill
2. Add a `SKILL.md` file with proper frontmatter
3. Add any supporting files (templates, scripts, resources)

#### Method 3: Using the anthropics/skills Repository

```bash
# Register the repository as a marketplace
/plugin marketplace add anthropics/skills

# Or directly install specific skills
/plugin install document-skills@anthropic-agent-skills
/plugin install example-skills@anthropic-agent-skills
```

### Installing & Using Skills

#### In Claude Code

```bash
# Install from marketplace
/plugin install skill-name@marketplace-name

# Or copy skill folder to:
# Project: .claude/skills/
# User: ~/.claude/skills/
```

#### In Claude.ai

- Available to paid plans
- Upload custom skills via the UI
- See: [Using skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude)

#### In Claude API

```python
# Use Anthropic's pre-built skills or upload custom skills via API
# See: Skills API Quickstart
```

#### Organization-Wide Sharing (Claude Desktop)

1. Go to Admin Settings
2. Navigate to Capabilities > Organization Skills library
3. Upload `.skill` or `.zip` files with `SKILL.md` and documentation/scripts

### Example Skills

#### Document Generation Skill

```markdown
---
name: brand-document-creator
description: Creates documents following company brand guidelines with proper formatting, colors, and tone
---

# Brand Document Creator

Create documents that adhere to our brand guidelines.

## Brand Colors
- Primary: #0066CC
- Secondary: #00AA55
- Accent: #FF6600

## Tone Guidelines
- Professional but approachable
- Clear and concise
- Action-oriented

## Document Types
- Marketing materials
- Internal communications
- Customer-facing documentation

## Templates
Use the templates in the /templates folder for consistent formatting.
```

#### Code Review Skill

```markdown
---
name: code-review-skill
description: Performs thorough code reviews focusing on security, performance, and maintainability
---

# Code Review Skill

## Review Checklist

### Security
- [ ] No hardcoded secrets
- [ ] Input validation implemented
- [ ] SQL injection prevention
- [ ] XSS prevention

### Performance
- [ ] No N+1 queries
- [ ] Proper caching strategy
- [ ] Optimized algorithms

### Maintainability
- [ ] Clear naming conventions
- [ ] Adequate documentation
- [ ] Test coverage
```

---

## Claude Sub-Agents

### What Are Sub-Agents?

Sub-agents are **pre-configured AI personalities** that Claude Code can delegate tasks to. Each sub-agent:

- Has a specific purpose and expertise area
- Uses its own separate context window
- Can be configured with specific tools
- Includes a custom system prompt
- Operates independently and returns results

**Benefits:**
- **Context Preservation**: Each subagent operates in its own context
- **Specialized Expertise**: Fine-tuned with detailed instructions
- **Reusability**: Use across different projects and share with team
- **Flexible Permissions**: Different tool access levels per subagent

### Built-in Sub-Agents

Claude Code provides three built-in subagents:

#### 1. General-Purpose Subagent

| Property | Value |
|----------|-------|
| Model | Sonnet |
| Tools | All tools |
| Mode | Read & Write |
| Purpose | Complex research, multi-step operations, code modifications |

**When used:**
- Task requires both exploration and modification
- Complex reasoning needed
- Multiple strategies may be needed
- Task has multiple interdependent steps

#### 2. Plan Subagent

| Property | Value |
|----------|-------|
| Model | Sonnet |
| Tools | Read, Glob, Grep, Bash (exploration only) |
| Mode | Read-only |
| Purpose | Research codebase for planning |

**When used:**
- In plan mode
- Needs to understand codebase structure
- Creating implementation plans

#### 3. Explore Subagent

| Property | Value |
|----------|-------|
| Model | Haiku (fast) |
| Tools | Glob, Grep, Read, Bash (read-only) |
| Mode | Strictly read-only |
| Purpose | Fast codebase searches and analysis |

**Thoroughness Levels:**
- `quick` - Fast searches with minimal exploration
- `medium` - Balances speed and thoroughness
- `very thorough` - Comprehensive analysis

### Creating Custom Sub-Agents

#### Method 1: Using `/agents` Command (Recommended)

```bash
/agents
```

This opens an interactive menu to:
- View all available subagents
- Create new subagents with guided setup
- Edit existing subagents and tool access
- Delete custom subagents
- Manage tool permissions

#### Method 2: File-Based Configuration

**Storage Locations:**

| Type | Location | Scope | Priority |
|------|----------|-------|----------|
| Project | `.claude/agents/` | Current project | Highest |
| User | `~/.claude/agents/` | All projects | Lower |

**File Format:**

```markdown
---
name: your-sub-agent-name
description: Description of when this subagent should be invoked
tools: tool1, tool2, tool3
model: sonnet
permissionMode: default
skills: skill1, skill2
---

Your subagent's system prompt goes here. This can be multiple paragraphs
and should clearly define the subagent's role, capabilities, and approach.

Include specific instructions, best practices, and any constraints.
```

#### Method 3: CLI-Based Configuration

```bash
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer. Use proactively after code changes.",
    "prompt": "You are a senior code reviewer. Focus on code quality, security, and best practices.",
    "tools": ["Read", "Grep", "Glob", "Bash"],
    "model": "sonnet"
  }
}'
```

### Configuration Reference

#### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier (lowercase, hyphens) |
| `description` | Yes | When to invoke this subagent |
| `tools` | No | Comma-separated tools. Inherits all if omitted |
| `model` | No | `sonnet`, `opus`, `haiku`, or `'inherit'` |
| `permissionMode` | No | `default`, `acceptEdits`, `bypassPermissions`, `plan`, `ignore` |
| `skills` | No | Skills to auto-load (subagents don't inherit parent skills) |

#### Model Selection

| Option | Description | Use Case |
|--------|-------------|----------|
| `sonnet` | Default, balanced | Most use cases |
| `opus` | Most capable, slower | Complex reasoning |
| `haiku` | Fast, lightweight | Quick searches |
| `'inherit'` | Uses main conversation's model | Consistency |

#### Available Tools

Common tools to grant:
- `Read` - Read files
- `Write` - Write files
- `Edit` - Edit files
- `Glob` - Find files by pattern
- `Grep` - Search file contents
- `Bash` - Execute commands
- `WebFetch` - Fetch web content
- `WebSearch` - Search the web

### Example Sub-Agents

#### Code Reviewer

```markdown
---
name: code-reviewer
description: Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code.
tools: Read, Grep, Glob, Bash
model: inherit
---

You are a senior code reviewer ensuring high standards of code quality and security.

When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Begin review immediately

Review checklist:
- Code is clear and readable
- Functions and variables are well-named
- No duplicated code
- Proper error handling
- No exposed secrets or API keys
- Input validation implemented
- Good test coverage
- Performance considerations addressed

Provide feedback organized by priority:
- Critical issues (must fix)
- Warnings (should fix)
- Suggestions (consider improving)

Include specific examples of how to fix issues.
```

#### Debugger

```markdown
---
name: debugger
description: Debugging specialist for errors, test failures, and unexpected behavior. Use proactively when encountering any issues.
tools: Read, Edit, Bash, Grep, Glob
---

You are an expert debugger specializing in root cause analysis.

When invoked:
1. Capture error message and stack trace
2. Identify reproduction steps
3. Isolate the failure location
4. Implement minimal fix
5. Verify solution works

Debugging process:
- Analyze error messages and logs
- Check recent code changes
- Form and test hypotheses
- Add strategic debug logging
- Inspect variable states

For each issue, provide:
- Root cause explanation
- Evidence supporting the diagnosis
- Specific code fix
- Testing approach
- Prevention recommendations

Focus on fixing the underlying issue, not the symptoms.
```

#### Security Auditor

```markdown
---
name: security-auditor
description: Security expert for code security analysis and vulnerability detection. Use proactively before deployment.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You are a security auditor specializing in code security analysis.

When invoked, perform comprehensive security audit:

1. Code Review for Security Issues
   - Injection vulnerabilities (SQL, command, template)
   - Insecure authentication/authorization patterns
   - Hardcoded secrets and credentials
   - Cryptographic implementations
   - Insecure deserialization

2. Dependency Analysis
   - Known vulnerable dependencies
   - Outdated libraries with security patches

3. API Security
   - Exposed sensitive data in APIs
   - Authentication mechanisms
   - Input validation practices

Report Format:
- Critical (Must fix immediately)
- High (Fix before deployment)
- Medium (Should fix soon)
- Low (Consider for future)

For each finding:
- Location in code
- Detailed explanation
- Specific fix recommendation
- Severity level
```

#### Test Runner

```markdown
---
name: test-runner
description: Use proactively to run tests and fix failures
tools: Read, Edit, Bash, Grep, Glob
---

You are a test automation expert. When you see code changes, proactively run the appropriate tests. If tests fail, analyze the failures and fix them while preserving the original test intent.

Testing workflow:
1. Identify all test files relevant to changes
2. Run appropriate test suites
3. Analyze failures
4. Fix implementation or tests
5. Verify all tests pass

Best practices:
- Run full test suite for confidence
- Preserve original test intent
- Don't skip or delete failing tests
- Add missing test coverage
- Provide testing summary
```

### Using Sub-Agents

#### Automatic Delegation

Claude automatically delegates based on:
- Task description in your request
- `description` field in subagent configurations
- Current context and available tools

**Tip:** Include "use PROACTIVELY" in your `description` field.

#### Explicit Invocation

```
> Use the code-reviewer subagent to check my recent changes
> Have the debugger subagent investigate this error
> Ask the security-auditor to review before deployment
```

#### Chaining Sub-Agents

```
> First use the code-analyzer subagent to find issues,
> then use the code-reviewer subagent to suggest fixes
```

#### Resuming Sub-Agents

```
# Initial invocation returns agentId
> Use the code-analyzer agent to review authentication

# Resume with previous context
> Resume agent abc123 and now analyze authorization
```

---

## Best Practices

### For Skills

1. **Keep skills focused** - One skill per specialized task
2. **Include examples** - Show expected inputs and outputs
3. **Document guidelines** - Clear rules for Claude to follow
4. **Add templates** - Reusable formats and structures
5. **Version control** - Track changes and share with team

### For Sub-Agents

1. **Start with Claude-generated agents** - Generate initial version, then customize
2. **Design focused subagents** - Single, clear responsibilities
3. **Write detailed prompts** - Include instructions, examples, constraints
4. **Limit tool access** - Only grant necessary tools
5. **Version control** - Check into repo for team use
6. **Use descriptive names** - Make purpose immediately clear

### General Tips

- **Skills vs Sub-Agents:**
  - Skills = Instructions and resources for specific task types
  - Sub-Agents = Specialized AI personalities with their own context and tools

- **When to use each:**
  - Skills: Repeatable tasks with specific formats/guidelines
  - Sub-Agents: Complex tasks requiring specialized expertise and tool usage

---

## Resources

### Official Documentation

- [What are skills?](https://support.claude.com/en/articles/12512176-what-are-skills)
- [Using skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude)
- [Creating custom skills](https://support.claude.com/en/articles/12512198-creating-custom-skills)
- [Agent Skills Standard](http://agentskills.io)
- [Skills API Quickstart](https://docs.claude.com/en/api/skills-guide)

### GitHub Repositories

- [anthropics/skills](https://github.com/anthropics/skills) - Official Anthropic skills repository
- [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) - Community templates and tools

### Community Resources

- [Claude Code Templates](https://aitmpl.com) - Easy skill and agent installation
- [Skills Creator](https://aitmpl.com/skills) - Tool to create skills easily

### Tutorials (by @dani_avila7)

- [Claude Code Global Agents Tutorial](https://x.com/dani_avila7/status/1958938124618547702)
- [Claude Code Skills Tutorial](https://x.com/dani_avila7/status/1980796957841928620)
- [Claude Code Hooks Guide](https://x.com/dani_avila7/status/1992271570891387051)
- [Organization Skills Sharing](https://x.com/dani_avila7/status/2001755850692534593)

---

*Document created: January 2026*
*Sources: GitHub anthropics/skills, Claude Code documentation, @dani_avila7 tutorials*
