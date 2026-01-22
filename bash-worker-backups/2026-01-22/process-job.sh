#!/bin/bash
JOB_ID=$1
JOB_DIR="/home/ubuntu/ai-product-studio/jobs/$JOB_ID"
LOG_FILE="/home/ubuntu/ai-product-studio/logs/$JOB_ID.log"
SCRIPTS_DIR="/home/ubuntu/ai-product-studio/skills/product-builder/scripts"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a $LOG_FILE
}

cd $JOB_DIR

log "Starting job processing: $JOB_ID"

# Update progress: Starting
$SCRIPTS_DIR/update-progress.sh $JOB_ID "architect" "in_progress" "Analyzing business requirements"

# Run Claude Code with product-builder skill
claude -p "You are building an MVP landing page. Follow these steps:

1. First, read input.json to understand the business requirements.
2. Act as the ARCHITECT agent: Design the site structure and create architecture.json
3. Act as the DEVELOPER agent: Build the complete site in the output/ directory
4. Act as the DEPLOYER agent: Deploy to S3 and create CloudFront distribution

Reference the agent definitions in /home/ubuntu/ai-product-studio/.claude/agents/ for detailed instructions.
Reference the skill definition in /home/ubuntu/ai-product-studio/skills/product-builder/SKILL.md for workflow.

After each phase, update progress using: /home/ubuntu/ai-product-studio/skills/product-builder/scripts/update-progress.sh JOB_ID PHASE STATUS MESSAGE

Current job ID: $JOB_ID
Working directory: $JOB_DIR

Be autonomous. Make decisions confidently. Build a beautiful, functional MVP." \
--allowedTools "Read,Write,Edit,Bash,Glob,Grep" \
2>&1 | tee -a $LOG_FILE

# Check if deployment was successful
if [ -f "$JOB_DIR/output/deployed.json" ]; then
    log "Job completed successfully"
    $SCRIPTS_DIR/update-progress.sh $JOB_ID "deployer" "completed" "MVP deployed successfully"
else
    log "Job may have failed - checking for partial completion"
    if [ -f "$JOB_DIR/output/index.html" ]; then
        log "Site files exist but deployment may have failed"
        $SCRIPTS_DIR/update-progress.sh $JOB_ID "deployer" "partial" "Site built but deployment may need review"
    else
        log "Job failed - no output generated"
        $SCRIPTS_DIR/update-progress.sh $JOB_ID "architect" "failed" "Failed to generate MVP"
    fi
fi
