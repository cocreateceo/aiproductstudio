/**
 * MVP Builder Agent using Claude Agent SDK
 *
 * Replaces CLI spawning with direct API calls for:
 * - Real-time streaming output
 * - Tool use (Read, Write, Edit, Bash)
 * - Progress callbacks
 * - Better error handling
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Tool definitions for the agent
const TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the specified path',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The path to the file to read'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file at the specified path. Creates directories if needed. For LARGE files (>15KB), use write_file_chunked instead.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The path to the file to write'
        },
        content: {
          type: 'string',
          description: 'The content to write to the file'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'write_file_chunked',
    description: 'Write large files in chunks. Use mode="start" for first chunk (creates/overwrites file), mode="append" for subsequent chunks, mode="end" for final chunk. This prevents token limit issues with large HTML files.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The path to the file to write'
        },
        content: {
          type: 'string',
          description: 'The chunk of content to write'
        },
        mode: {
          type: 'string',
          enum: ['start', 'append', 'end'],
          description: 'start=create new file, append=add to existing, end=final chunk'
        }
      },
      required: ['file_path', 'content', 'mode']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories at the specified path',
    input_schema: {
      type: 'object',
      properties: {
        dir_path: {
          type: 'string',
          description: 'The directory path to list'
        }
      },
      required: ['dir_path']
    }
  },
  {
    name: 'run_command',
    description: 'Run a shell command and return the output',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to run'
        }
      },
      required: ['command']
    }
  }
];

// Execute a tool call
function executeTool(toolName, toolInput, workingDir) {
  try {
    switch (toolName) {
      case 'read_file': {
        const filePath = path.isAbsolute(toolInput.file_path)
          ? toolInput.file_path
          : path.join(workingDir, toolInput.file_path);

        if (!fs.existsSync(filePath)) {
          return { error: `File not found: ${filePath}` };
        }
        const content = fs.readFileSync(filePath, 'utf8');
        return { content, size: content.length };
      }

      case 'write_file': {
        const filePath = path.isAbsolute(toolInput.file_path)
          ? toolInput.file_path
          : path.join(workingDir, toolInput.file_path);

        // Validate content parameter
        if (toolInput.content === undefined || toolInput.content === null) {
          return { error: 'Missing required parameter: content. Use write_file_chunked for large files.' };
        }

        // Create directory if it doesn't exist
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, toolInput.content);
        return { success: true, path: filePath, size: toolInput.content.length };
      }

      case 'write_file_chunked': {
        const filePath = path.isAbsolute(toolInput.file_path)
          ? toolInput.file_path
          : path.join(workingDir, toolInput.file_path);

        // Validate content parameter
        if (toolInput.content === undefined || toolInput.content === null) {
          return { error: 'Missing required parameter: content' };
        }

        // Create directory if it doesn't exist
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const mode = toolInput.mode || 'start';

        if (mode === 'start') {
          // Create new file (overwrite if exists)
          fs.writeFileSync(filePath, toolInput.content);
          return { success: true, path: filePath, mode: 'start', chunkSize: toolInput.content.length, message: 'File created. Use mode="append" for more chunks, mode="end" for final chunk.' };
        } else if (mode === 'append' || mode === 'end') {
          // Append to existing file
          fs.appendFileSync(filePath, toolInput.content);
          const totalSize = fs.statSync(filePath).size;
          return { success: true, path: filePath, mode, chunkSize: toolInput.content.length, totalSize, message: mode === 'end' ? 'File complete!' : 'Chunk appended. Continue with more chunks.' };
        } else {
          return { error: `Invalid mode: ${mode}. Use start, append, or end.` };
        }
      }

      case 'list_directory': {
        const dirPath = path.isAbsolute(toolInput.dir_path)
          ? toolInput.dir_path
          : path.join(workingDir, toolInput.dir_path);

        if (!fs.existsSync(dirPath)) {
          return { error: `Directory not found: ${dirPath}` };
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        return {
          entries: entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file'
          }))
        };
      }

      case 'run_command': {
        try {
          const timeout = parseInt(process.env.COMMAND_TIMEOUT) || 30000;
          const output = execSync(toolInput.command, {
            cwd: workingDir,
            encoding: 'utf8',
            timeout: timeout,
            maxBuffer: 1024 * 1024 // 1MB buffer
          });
          return { output: output.substring(0, 5000) }; // Limit output size
        } catch (error) {
          return { error: error.message, stderr: error.stderr?.substring(0, 2000) };
        }
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * MVP Builder Agent
 */
export class MVPBuilderAgent {
  constructor(options = {}) {
    this.client = new Anthropic({
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY
    });
    this.model = options.model || process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
    this.maxTokens = options.maxTokens || parseInt(process.env.MAX_TOKENS) || 8192;
    this.workingDir = options.workingDir || process.cwd();

    // Callbacks for progress updates
    this.onProgress = options.onProgress || (() => {});
    this.onThinking = options.onThinking || (() => {});
    this.onToolUse = options.onToolUse || (() => {});
    this.onMessage = options.onMessage || (() => {});
    this.onError = options.onError || (() => {});

    // Cancellation callback - returns true if build should stop
    this.shouldCancel = options.shouldCancel || (() => false);

    // State
    this.messages = [];
    this.filesCreated = [];
    this.currentPhase = 'initializing';
    this.totalTokens = { input: 0, output: 0 };
    this.cancelled = false;
  }

  /**
   * Build an MVP from the job data
   */
  async build(jobData) {
    const startTime = Date.now();

    try {
      this.onProgress({
        phase: 'starting',
        message: 'Initializing MVP build...',
        percent: 0
      });

      // Create the system prompt
      const systemPrompt = this.createSystemPrompt(jobData);

      // Create initial user message
      const userMessage = this.createUserMessage(jobData);

      this.messages = [{ role: 'user', content: userMessage }];

      // Run the agent loop
      let iteration = 0;
      const maxIterations = 50; // Prevent infinite loops

      while (iteration < maxIterations) {
        iteration++;

        // Check for cancellation at start of each iteration
        if (this.shouldCancel()) {
          this.cancelled = true;
          throw new Error('Build cancelled by user');
        }

        this.onProgress({
          phase: this.currentPhase,
          message: `Agent iteration ${iteration}...`,
          percent: Math.min(10 + iteration * 2, 90),
          iteration
        });

        // Call Claude with streaming
        const response = await this.callClaudeWithTools(systemPrompt);

        // Check for cancellation after API call
        if (this.shouldCancel()) {
          this.cancelled = true;
          throw new Error('Build cancelled by user');
        }

        // Check if we're done (no more tool calls)
        if (response.stopReason === 'end_turn' && !response.hasToolUse) {
          this.onProgress({
            phase: 'completed',
            message: 'MVP build completed!',
            percent: 100
          });
          break;
        }

        // If max iterations reached
        if (iteration >= maxIterations) {
          this.onError({ message: 'Max iterations reached' });
          break;
        }
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        filesCreated: this.filesCreated,
        duration,
        iterations: iteration,
        tokens: this.totalTokens
      };

    } catch (error) {
      this.onError({ message: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Call Claude API with tool use and streaming
   */
  async callClaudeWithTools(systemPrompt) {
    let assistantContent = [];
    let hasToolUse = false;
    let stopReason = '';
    let thinkingContent = '';

    // Use streaming for real-time updates
    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      tools: TOOLS,
      messages: this.messages
    });

    // Process streaming events
    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'thinking') {
          thinkingContent = '';
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'thinking_delta') {
          thinkingContent += event.delta.thinking;
          this.onThinking({ content: event.delta.thinking, full: thinkingContent });
        } else if (event.delta.type === 'text_delta') {
          this.onMessage({ type: 'text', content: event.delta.text });
        }
      } else if (event.type === 'message_delta') {
        stopReason = event.delta.stop_reason;
      }
    }

    // Get the final message
    const finalMessage = await stream.finalMessage();

    // Update token counts
    this.totalTokens.input += finalMessage.usage.input_tokens;
    this.totalTokens.output += finalMessage.usage.output_tokens;

    // Process the response content
    assistantContent = finalMessage.content;

    // Add assistant message to history
    this.messages.push({ role: 'assistant', content: assistantContent });

    // Process tool calls
    const toolResults = [];
    for (const block of assistantContent) {
      if (block.type === 'tool_use') {
        hasToolUse = true;

        this.onToolUse({
          tool: block.name,
          input: block.input,
          id: block.id
        });

        // Detect phase from tool use
        this.detectPhase(block.name, block.input);

        // Execute the tool
        const result = executeTool(block.name, block.input, this.workingDir);

        // Track created files
        if ((block.name === 'write_file' || block.name === 'write_file_chunked') && result.success) {
          // Only add to list once per file (chunked writes add multiple times otherwise)
          if (!this.filesCreated.includes(block.input.file_path)) {
            this.filesCreated.push(block.input.file_path);
          }
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result)
        });
      }
    }

    // If there were tool calls, add results and continue
    if (toolResults.length > 0) {
      this.messages.push({ role: 'user', content: toolResults });
    }

    return {
      stopReason,
      hasToolUse,
      content: assistantContent
    };
  }

  /**
   * Detect current phase based on tool usage
   */
  detectPhase(toolName, toolInput) {
    if (toolName === 'read_file' && toolInput.file_path?.includes('input.json')) {
      this.currentPhase = 'architect';
      this.onProgress({ phase: 'architect', message: 'Analyzing requirements...' });
    } else if (toolName === 'write_file' || toolName === 'write_file_chunked') {
      const filePath = toolInput.file_path || '';
      const mode = toolInput.mode || '';
      if (filePath.includes('architecture.json')) {
        this.currentPhase = 'architect';
        this.onProgress({ phase: 'architect', message: 'Creating architecture...' });
      } else if (filePath.includes('index.html')) {
        this.currentPhase = 'developer';
        const chunkMsg = mode ? ` (${mode})` : '';
        this.onProgress({ phase: 'developer', message: `Building HTML structure${chunkMsg}...` });
      } else if (filePath.includes('.js')) {
        this.currentPhase = 'developer';
        this.onProgress({ phase: 'developer', message: `Creating ${path.basename(filePath)}...` });
      } else if (filePath.includes('.css')) {
        this.currentPhase = 'developer';
        this.onProgress({ phase: 'developer', message: 'Adding styles...' });
      }
    }
  }

  /**
   * Create the system prompt for the MVP builder
   */
  createSystemPrompt(jobData) {
    return `You are an expert MVP builder agent. Your task is to create a COMPLETE, content-rich landing page MVP that could actually convert visitors to customers.

CAPABILITIES:
- read_file: Read files from the filesystem
- write_file: Create/update small files (<15KB)
- write_file_chunked: Write large files in chunks (USE THIS FOR index.html!)
- list_directory: List directory contents
- run_command: Execute shell commands

WORKING DIRECTORY: ${this.workingDir}

CRITICAL - CHUNKED WRITING FOR LARGE FILES:
For index.html and any file >10KB, you MUST use write_file_chunked to avoid token limits:

1. First chunk (mode="start"): Write <!DOCTYPE html> through </head> and opening <body>
2. Middle chunks (mode="append"): Write each major section (hero, features, pricing, etc.)
3. Final chunk (mode="end"): Write closing </body></html>

Example flow for index.html:
- write_file_chunked(path="output/index.html", mode="start", content="<!DOCTYPE html>...<body>")
- write_file_chunked(path="output/index.html", mode="append", content="<!-- Hero Section -->...")
- write_file_chunked(path="output/index.html", mode="append", content="<!-- Features Section -->...")
- write_file_chunked(path="output/index.html", mode="append", content="<!-- Pricing Section -->...")
- write_file_chunked(path="output/index.html", mode="end", content="<!-- Footer --></body></html>")

YOUR TASK:
1. ARCHITECT PHASE:
   - Read input.json CAREFULLY to understand the business
   - Extract: product idea, target customer, industry, unique value proposition
   - Design site with ALL required sections (see below)
   - Create architecture.json with content plan for EACH section

2. DEVELOPER PHASE:
   - Build ALL sections with REAL content (not placeholder text)
   - Use Tailwind CSS (CDN), Three.js (CDN), GSAP (CDN)
   - Create files in output/ directory

REQUIRED SECTIONS (ALL MUST BE INCLUDED):
1. HERO: Compelling headline, subheadline explaining the product, primary CTA button
2. PROBLEM: What problem does this solve? Pain points of target customer
3. SOLUTION: How does the product solve it? Key benefits (3-4 bullet points)
4. FEATURES: 3-6 specific features with icons, titles, and descriptions
5. HOW IT WORKS: 3-4 step process explaining the user journey
6. SOCIAL PROOF: Testimonials or trust indicators (can be sample/placeholder names)
7. PRICING: 2-3 pricing tiers with features list (suggest reasonable prices for the industry)
8. FAQ: 4-6 common questions and answers about the product
9. CTA: Final call-to-action section with email capture or signup button
10. FOOTER: Links, copyright, social media icons

CONTENT GUIDELINES:
- Write persuasive, benefit-focused copy (not generic marketing speak)
- Use the TARGET CUSTOMER to inform tone and language
- Include specific numbers/stats where relevant (even estimates)
- Every section must have REAL content, not "Lorem ipsum" or "[Your text here]"
- CTAs should be action-oriented: "Start Free Trial", "Get Early Access", etc.

TECHNICAL REQUIREMENTS:
- Single index.html file with embedded CSS/JS OR separate files
- Use CDN links for all libraries
- Mobile-responsive design
- Page must work when opened directly in browser
- Add ONE subtle 3D element or animation (don't overdo it)

STYLE:
- Clean, modern design with good whitespace
- Consistent color scheme matching the industry
- Professional typography (Google Fonts via CDN)
- Subtle animations on scroll (GSAP ScrollTrigger)

CRITICAL: A landing page with only a hero section is NOT acceptable. You MUST create ALL sections listed above with real, relevant content based on the business idea.`;
  }

  /**
   * Create the initial user message
   */
  createUserMessage(jobData) {
    return `Build a COMPLETE MVP landing page for this business:

=== BUSINESS DETAILS ===
CLIENT: ${jobData.client?.name || 'Unknown'}
BUSINESS IDEA: ${jobData.business?.idea || 'No idea provided'}
INDUSTRY: ${jobData.business?.industry || 'general'}
TARGET CUSTOMER: ${jobData.business?.targetCustomer || 'General audience'}

=== INSTRUCTIONS ===
1. First, read input.json to get ALL the details about this business
2. Create architecture.json with your content plan for EACH section
3. Build the COMPLETE landing page with ALL 10 required sections
4. Every section must have REAL, relevant content - no placeholders!

=== WHAT I EXPECT ===
- A professional landing page that looks like a real startup's website
- Compelling copy that speaks to the target customer's pain points
- Clear value proposition and call-to-action
- Pricing section with realistic tiers for this industry
- FAQ section with questions a real customer might ask

Remember: A hero-only page is NOT acceptable. Build ALL sections.

Create all output files in the output/ directory.`;
  }
}

export default MVPBuilderAgent;
