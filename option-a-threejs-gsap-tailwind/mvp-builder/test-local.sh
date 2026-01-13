#!/bin/bash
# Local test script for MVP builder
# Run this to test the Claude Code workflow locally before deploying to EC2

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_JOB_DIR="$SCRIPT_DIR/test-job"

echo "=== MVP Builder Local Test ==="
echo ""

# Load .env file if it exists
if [ -f "$SCRIPT_DIR/.env" ]; then
    echo "Loading environment from .env..."
    export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
fi

# Check if Claude Code is installed
if ! command -v claude &> /dev/null; then
    echo "ERROR: Claude Code CLI is not installed."
    echo "Install it with: npm install -g @anthropic-ai/claude-code"
    exit 1
fi

# Check if ANTHROPIC_API_KEY is set
if [ -z "$ANTHROPIC_API_KEY" ] || [ "$ANTHROPIC_API_KEY" = "sk-ant-your-key-here" ]; then
    echo "ERROR: ANTHROPIC_API_KEY is not set or still has placeholder value."
    echo "Edit .env file and add your API key."
    exit 1
fi

echo "✓ Claude Code CLI found: $(claude --version)"
echo "✓ ANTHROPIC_API_KEY is set"
echo ""

# Create test job directory
mkdir -p "$TEST_JOB_DIR/output"

# Create sample input.json if it doesn't exist
if [ ! -f "$TEST_JOB_DIR/input.json" ]; then
    echo "Creating sample input.json..."
    cat > "$TEST_JOB_DIR/input.json" << 'EOF'
{
  "jobId": "test-local-001",
  "createdAt": "2026-01-02T00:00:00Z",
  "status": "pending",
  "client": {
    "name": "Test Client",
    "email": "test@example.com"
  },
  "business": {
    "idea": "An AI-powered fitness coaching app that creates personalized workout plans based on user goals, available equipment, and fitness level. The app uses computer vision to analyze exercise form and provides real-time feedback.",
    "industry": "healthcare",
    "stage": "idea",
    "targetCustomer": "Busy professionals aged 25-45 who want to stay fit but don't have time for a gym",
    "marketValidation": "Surveyed 50 potential users, 80% said they would pay for personalized AI coaching",
    "background": "Former personal trainer with 5 years experience"
  },
  "preferences": {
    "timeline": "asap",
    "techStack": "threejs-gsap-tailwind",
    "deployment": "cloudfront"
  }
}
EOF
    echo "✓ Created sample input.json"
    echo ""
    echo "You can edit $TEST_JOB_DIR/input.json to test with different business ideas."
    echo ""
fi

echo "=== Starting MVP Build Test ==="
echo "Working directory: $TEST_JOB_DIR"
echo ""

cd "$TEST_JOB_DIR"

# Run Claude Code with the product builder prompt
claude -p "You are building an MVP landing page. Follow these steps:

1. First, read input.json to understand the business requirements.

2. Act as the ARCHITECT agent:
   - Analyze the business idea
   - Design the site structure (hero, features, CTA sections)
   - Plan Three.js 3D elements and GSAP animations
   - Create architecture.json with your design

3. Act as the DEVELOPER agent:
   - Generate HTML structure with Tailwind CSS
   - Implement Three.js scenes
   - Add GSAP animations
   - Create these files in the output/ directory:
     - index.html (main landing page)
     - js/main.js (Three.js scenes)
     - js/animations.js (GSAP animations)

4. For local testing, skip the DEPLOYER phase (no S3/CloudFront needed).

Reference the agent definitions in $SCRIPT_DIR/.claude/agents/ for detailed instructions.
Reference the skill definition in $SCRIPT_DIR/skills/product-builder/SKILL.md for workflow.

Be autonomous. Make design decisions confidently. Build a beautiful, functional MVP landing page." \
--allowedTools "Read,Write,Edit,Bash,Glob,Grep"

echo ""
echo "=== Test Complete ==="
echo ""

# Check results
if [ -f "$TEST_JOB_DIR/output/index.html" ]; then
    echo "✓ MVP generated successfully!"
    echo ""
    echo "Output files:"
    find "$TEST_JOB_DIR/output" -type f | while read f; do
        size=$(wc -c < "$f")
        echo "  - ${f#$TEST_JOB_DIR/} ($size bytes)"
    done
    echo ""
    echo "To preview the MVP, open:"
    echo "  $TEST_JOB_DIR/output/index.html"
else
    echo "✗ MVP generation may have failed. Check the output above."
fi
