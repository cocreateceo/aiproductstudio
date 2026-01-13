# MVP Builder

Autonomous MVP building system using Claude Code CLI with custom skills and agents.

## Structure

```
mvp-builder/
├── .claude/agents/           # Sub-agent definitions
│   ├── architect.md          # Designs site structure
│   ├── developer.md          # Implements the code
│   └── deployer.md           # Deploys to CloudFront
├── skills/product-builder/   # Main skill
│   ├── SKILL.md              # Skill definition
│   ├── scripts/              # Helper scripts
│   └── templates/            # Code templates
├── test-local.sh             # Local testing script
├── process-job.sh            # Job processor (EC2)
└── worker.sh                 # Job queue worker (EC2)
```

## Local Testing

### Prerequisites

1. **Install Claude Code CLI**:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. **Set API Key**:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-your-key
   ```

### Run Test

```bash
cd mvp-builder
chmod +x test-local.sh
./test-local.sh
```

This will:
1. Create a sample `test-job/input.json` with a test business idea
2. Run Claude Code to generate an MVP landing page
3. Output files to `test-job/output/`

### Custom Test

Edit `test-job/input.json` with your own business idea:

```json
{
  "business": {
    "idea": "Your product idea here...",
    "industry": "healthcare|fintech|ecommerce|education|saas|consumer|other",
    "targetCustomer": "Who is this for?",
    "marketValidation": "Any validation done?"
  }
}
```

Then run `./test-local.sh` again.

## EC2 Deployment

### Deploy Updated Code to EC2

```bash
# From project root
scp -r mvp-builder/* ubuntu@65.1.106.211:/home/ubuntu/ai-product-studio/
```

### Start Worker Service

```bash
ssh ubuntu@65.1.106.211
export ANTHROPIC_API_KEY=sk-ant-your-key
echo 'export ANTHROPIC_API_KEY=sk-ant-your-key' >> ~/.bashrc

# Start as service
sudo systemctl enable ai-product-studio-worker
sudo systemctl start ai-product-studio-worker

# Or run manually for debugging
./worker.sh
```

## How It Works

### Workflow

1. **Admin approves application** → Lambda creates job in S3 `jobs/` folder
2. **EC2 worker** polls S3, picks up job
3. **Claude Code** runs with product-builder skill:
   - Architect agent designs structure
   - Developer agent builds the site
   - Deployer agent uploads to S3 + CloudFront
4. **Progress** updated in S3 `progress/` folder
5. **MVP URL** returned to admin portal

### Agent Roles

| Agent | Purpose | Output |
|-------|---------|--------|
| Architect | Design site structure, plan 3D/animations | `architecture.json` |
| Developer | Write HTML, Three.js, GSAP code | `output/index.html`, `output/js/*` |
| Deployer | Create S3 bucket, CloudFront distribution | `deployed.json` with URL |

## Debugging

### View Worker Logs

```bash
ssh ubuntu@65.1.106.211
tail -f /home/ubuntu/ai-product-studio/logs/*.log
```

### Check Job Progress

```bash
aws s3 cp s3://ai-product-studio-applications/progress/JOB_ID.json - | jq
```

### Manual Job Processing

```bash
ssh ubuntu@65.1.106.211
cd /home/ubuntu/ai-product-studio
./process-job.sh JOB_ID
```
