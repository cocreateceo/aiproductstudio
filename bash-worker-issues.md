# Bash Worker Job Processing - Issues & Fixes

**Date:** January 22, 2026
**EC2 Location:** us-east-1 (New EC2)
**Worker Type:** Bash scripts (worker.sh + process-job.sh)
**Jobs Processed:** 3 attempts of job-1769036140138-56bkdg

---

## Issue 1: deployed.json Not Created Locally

### Problem
After job completion, `process-job.sh` checks for `output/deployed.json` to verify successful deployment:
```bash
if [ -f "$JOB_DIR/output/deployed.json" ]; then
    log "Job completed successfully"
else
    log "Job may have failed - checking for partial completion"
fi
```

**Result:** All 3 jobs marked as "partial" even though deployment succeeded.

### Why It Occurred
- Claude creates `deployed.json` in S3 (at `builds/{jobId}/deployed.json` or `deployments/{jobId}/deployed.json`)
- Claude does NOT save `deployed.json` to the local `output/` directory
- The script checks only the local filesystem, not S3

**Claude's behavior:**
1. Creates deployment metadata in memory
2. Uploads directly to S3
3. Forgets to write local copy

### Evidence
**S3 (exists):**
```bash
s3://ai-product-studio-applications/builds/job-1769036140138-56bkdg/deployed.json
s3://ai-product-studio-applications/deployments/job-1769036140138-56bkdg/deployed.json
```

**Local (missing):**
```bash
/home/ubuntu/ai-product-studio/jobs/job-1769036140138-56bkdg/output/deployed.json
# File not found
```

### Fix Options

#### Option A: Update deployer.md to be more explicit
**File:** `.claude/agents/deployer.md`

**Change Section "Output" from:**
```markdown
## Output
Create `deployed.json`:
```

**To:**
```markdown
## Output
CRITICAL: Create `deployed.json` in the output/ directory BEFORE uploading to S3.

You MUST create this file at: output/deployed.json
The file must exist locally for the job to be marked as completed.

Steps:
1. Create deployed.json with deployment details
2. Save to output/deployed.json (local filesystem)
3. Then upload all files from output/ to S3
```

#### Option B: Modify process-job.sh to check S3
**File:** `process-job.sh`

**Add after Claude execution:**
```bash
# Post-processing: Download deployed.json from S3 if Claude uploaded it there
log "Checking for deployment artifacts..."

# Try multiple possible S3 locations
for PREFIX in "builds" "deployments"; do
  aws s3 cp s3://$BUCKET/$PREFIX/$JOB_ID/deployed.json $JOB_DIR/output/deployed.json 2>/dev/null && \
    log "Found deployed.json in S3 $PREFIX/, downloaded to local output/" && \
    break
done

# Now check for success
if [ -f "$JOB_DIR/output/deployed.json" ]; then
```

#### Option C: Hybrid (Recommended)
Implement both Option A (instructions) and Option B (fallback script) for maximum reliability.

---

## Issue 2: metadata.json Not Created At All

### Problem
Admin portal lists builds by reading `metadata.json` files from S3:
```javascript
// Lambda code (index.mjs:1012)
listResult.Contents
  .filter(obj => obj.Key.endsWith('metadata.json'))
```

**Result:** Builds don't appear in admin portal because metadata.json doesn't exist.

### Why It Occurred
- `metadata.json` is NOT mentioned anywhere in deployer.md
- Claude has no instructions to create this file
- Only the SDK version (worker.js) creates metadata.json

**Comparison:**
- **Bash worker:** Creates deployed.json only (and not even locally)
- **SDK worker:** Creates both deployed.json AND metadata.json

### Evidence
**All 3 job attempts:**
```bash
aws s3 ls s3://ai-product-studio-applications/builds/job-1769036140138-56bkdg/
aws s3 ls s3://ai-product-studio-applications/deployments/job-1769036140138-56bkdg/
# No metadata.json found
```

**Old local-dev builds (SDK version):**
```bash
aws s3 ls s3://ai-product-studio-applications/builds/job-1767372681285-new16k/
# 2026-01-02 09:14:29  1242 metadata.json  ✓ Present
```

### Fix

#### Update deployer.md to create metadata.json
**File:** `.claude/agents/deployer.md`

**Add new section before "Output":**
```markdown
### 7. Create Build Metadata for Admin Portal

CRITICAL: The admin portal requires metadata.json to display builds.

Create `builds/{JOB_ID}/metadata.json` in S3 with complete build information:

```bash
# Read input.json to get application details
INPUT_DATA=$(cat input.json)

# Create metadata.json
cat > /tmp/metadata.json << EOF
{
  "buildId": "JOB_ID_HERE",
  "applicationId": "APPLICATION_S3_KEY_FROM_INPUT",
  "client": {
    "name": "CLIENT_NAME",
    "email": "CLIENT_EMAIL",
    "phone": "CLIENT_PHONE"
  },
  "business": {
    "idea": "BUSINESS_IDEA",
    "industry": "INDUSTRY",
    "stage": "STAGE",
    "targetCustomer": "TARGET_CUSTOMER",
    "marketValidation": "MARKET_VALIDATION",
    "background": "BACKGROUND"
  },
  "status": "completed",
  "timestamps": {
    "created": "CREATED_TIMESTAMP",
    "started": "STARTED_TIMESTAMP",
    "completed": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  },
  "phases": {
    "architect": { "status": "completed" },
    "developer": { "status": "completed" },
    "deployer": { "status": "completed" }
  },
  "mvpUrl": "https://CLOUDFRONT_URL",
  "s3Bucket": "BUCKET_NAME",
  "cloudfrontId": "DISTRIBUTION_ID"
}
EOF

# Upload metadata to S3
aws s3 cp /tmp/metadata.json s3://ai-product-studio-applications/builds/$JOB_ID/metadata.json
```

This file is REQUIRED for the build to appear in the admin portal.
```

---

## Issue 3: CloudFront Access Denied (403 Error)

### Problem
**Attempts 2 & 3:** CloudFront URLs returned 403 Forbidden error
**Attempt 1:** CloudFront URL worked (different approach)

**URLs:**
- Attempt 1: https://dbfkfovbufyju.cloudfront.net ✓ Worked
- Attempt 2: https://d2wqm010e1c46g.cloudfront.net ✗ 403 Error
- Attempt 3: https://d3pa29968c9syh.cloudfront.net ✗ 403 Error (fixed manually)

### Why It Occurred

**deployer.md Section 3:**
```markdown
### 3. Set Bucket Policy for CloudFront Access
Use Origin Access Identity (OAI) for secure access.
```

**Problem:** This is just a conceptual statement with NO actual commands.

**What should happen:**
1. Create Origin Access Identity (OAI)
2. Configure CloudFront to use OAI
3. Add S3 bucket policy allowing OAI to read objects

**What Claude did:**
- Nothing. The instruction was too vague.
- CloudFront created with empty `OriginAccessIdentity: ""`
- No bucket policy created
- S3 objects remain private → CloudFront denied access

### Root Cause Analysis

**Why Attempt 1 Worked:**
Claude created a NEW dedicated bucket (`mvp-medflow-ai-1769092507`) and likely:
- Enabled S3 static website hosting, OR
- Set bucket to public-read, OR
- Properly configured OAI (luck/randomness)

**Why Attempts 2 & 3 Failed:**
Claude used EXISTING bucket (`ai-product-studio-applications`) with subfolders:
- Attempt 2: `builds/job-1769036140138-56bkdg/`
- Attempt 3: `deployments/job-1769036140138-56bkdg/`

Existing bucket is private by default, and Claude didn't configure permissions.

### Fix

#### Update deployer.md with explicit OAI commands
**File:** `.claude/agents/deployer.md`

**Replace Section 3:**
```markdown
### 3. Set Bucket Policy for CloudFront Access

CRITICAL: CloudFront needs permission to access S3 files. Follow these steps exactly:

#### Step 3a: Create Origin Access Identity (OAI)
```bash
# Create OAI
OAI_OUTPUT=$(aws cloudfront create-cloud-front-origin-access-identity \
  --cloud-front-origin-access-identity-config \
    CallerReference="mvp-$JOB_ID-$(date +%s)",Comment="OAI for MVP $JOB_ID" \
  --query 'CloudFrontOriginAccessIdentity.[Id,S3CanonicalUserId]' \
  --output json)

OAI_ID=$(echo $OAI_OUTPUT | jq -r '.[0]')
OAI_CANONICAL_USER=$(echo $OAI_OUTPUT | jq -r '.[1]')

echo "Created OAI: $OAI_ID"
```

#### Step 3b: Create S3 Bucket Policy
```bash
# Create bucket policy allowing OAI to read objects
cat > /tmp/bucket-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontOAI",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity $OAI_ID"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::$BUCKET_NAME/*"
    }
  ]
}
EOF

# Apply bucket policy
aws s3api put-bucket-policy --bucket $BUCKET_NAME --policy file:///tmp/bucket-policy.json
echo "Bucket policy applied"
```

#### Step 3c: Save OAI ID for CloudFront Configuration
```bash
# Save OAI ID for use in Step 5 (CloudFront creation)
echo $OAI_ID > /tmp/oai-id.txt
```

IMPORTANT: In Step 5, you MUST configure CloudFront to use this OAI.
```

**Update Section 5:**
```markdown
### 5. Create CloudFront Distribution

Read the OAI ID created in Step 3:
```bash
OAI_ID=$(cat /tmp/oai-id.txt)
```

When creating CloudFront distribution, configure the S3 origin with:
- `S3OriginConfig.OriginAccessIdentity`: `origin-access-identity/cloudfront/$OAI_ID`

Example AWS CLI command:
```bash
aws cloudfront create-distribution \
  --distribution-config '{
    "CallerReference": "mvp-'$JOB_ID'-'$(date +%s)'",
    "Comment": "MVP for '$CLIENT_NAME'",
    "Origins": {
      "Quantity": 1,
      "Items": [
        {
          "Id": "S3-'$BUCKET_NAME'",
          "DomainName": "'$BUCKET_NAME'.s3.ap-south-1.amazonaws.com",
          "S3OriginConfig": {
            "OriginAccessIdentity": "origin-access-identity/cloudfront/'$OAI_ID'"
          }
        }
      ]
    },
    "DefaultRootObject": "index.html",
    "Enabled": true,
    ...
  }'
```

This ensures CloudFront can access S3 objects securely.
```

---

## Issue 4: Inconsistent Bucket Strategy

### Problem
Claude uses different deployment strategies on each run, making deployments unpredictable.

**Attempt 1:**
- Created NEW bucket: `mvp-medflow-ai-1769092507`
- Site worked ✓

**Attempt 2:**
- Used EXISTING bucket: `ai-product-studio-applications`
- Subfolder: `builds/job-1769036140138-56bkdg/`
- Site failed (403) ✗

**Attempt 3:**
- Used EXISTING bucket: `ai-product-studio-applications`
- Subfolder: `deployments/job-1769036140138-56bkdg/`
- Site failed (403) ✗

### Why It Occurred
Claude is non-deterministic. The deployer.md instructions say:
```bash
BUCKET_NAME="mvp-$(echo "$CLIENT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | head -c 30)-$(date +%s)"
aws s3 mb s3://$BUCKET_NAME --region ap-south-1
```

But Claude sometimes ignores this and creates its own strategy.

### Problems with Shared Bucket Approach
1. **No isolation** - All MVPs in one bucket
2. **Complex permissions** - Need policy for each subfolder
3. **Scalability** - Could hit S3 object limits
4. **Cleanup** - Hard to delete individual client sites
5. **Billing** - Can't track per-client S3 costs

### Fix

#### Make deployer.md instructions MANDATORY
**File:** `.claude/agents/deployer.md`

**Update Section 1:**
```markdown
### 1. Create S3 Bucket

CRITICAL: You MUST create a NEW dedicated bucket for this MVP.
DO NOT use ai-product-studio-applications bucket.
DO NOT use subfolders like builds/ or deployments/.

Each MVP must have its own isolated S3 bucket for:
- Clean separation of client data
- Easy cleanup/deletion
- Per-client cost tracking
- Simplified permissions

```bash
# Extract client name from input.json
CLIENT_NAME=$(cat input.json | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4 | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | head -c 30)

# Generate unique bucket name
BUCKET_NAME="mvp-${CLIENT_NAME}-$(date +%s)"

# Create bucket
aws s3 mb s3://$BUCKET_NAME --region ap-south-1

echo "Created bucket: $BUCKET_NAME"
```

VERIFICATION: After running this command, verify the bucket was created:
```bash
aws s3 ls | grep $BUCKET_NAME
```

If this verification fails, STOP and report error.
```

---

## Issue 5: Missing jq Dependency

### Problem
First job attempt failed to update progress because `jq` was not installed.

**Error:**
```
/update-progress.sh: line 18: jq: command not found
cat: write error: Broken pipe
```

**Impact:** Progress file created as 0 bytes → Admin portal showed nothing.

### Why It Occurred
The `update-progress.sh` script requires `jq` to parse/update JSON:
```bash
cat $PROGRESS_FILE | jq --arg phase "$PHASE" --arg status "$STATUS" ...
```

`jq` was not installed during initial EC2 setup.

### Fix Applied
Installed jq on new EC2:
```bash
sudo apt-get update && sudo apt-get install -y jq
```

### Prevention
**Add to EC2 setup documentation:**

Required software packages:
- Node.js v20+
- npm
- PM2
- Claude CLI
- AWS CLI v2
- **jq** (JSON processor) ← Add this

Installation:
```bash
sudo apt-get update
sudo apt-get install -y jq
```

---

## Issue 6: Progress Tracking Corruption

### Problem
First job created 0-byte progress file due to missing `jq`, causing admin portal to show no data.

### Why It Occurred
1. `update-progress.sh` runs before `jq` installed
2. `jq` command fails
3. Empty file uploaded to S3
4. Even after installing `jq`, the corrupted file persists

### Fix
Delete corrupted progress files before reprocessing jobs:
```bash
aws s3 rm s3://ai-product-studio-applications/progress/$JOB_ID.json
```

### Prevention
Ensure `jq` is installed BEFORE starting worker service.

---

## Summary of All Issues

| Issue | Severity | Affects | Fix Complexity |
|-------|----------|---------|----------------|
| deployed.json not local | High | Job status tracking | Medium - Update MD + Script |
| metadata.json missing | Critical | Admin portal visibility | Medium - Update MD |
| CloudFront 403 errors | Critical | Site accessibility | High - Update MD with OAI commands |
| Inconsistent bucket strategy | High | Predictability, costs | Low - Strengthen MD instructions |
| Missing jq dependency | Medium | Progress tracking | Low - Install package |
| Progress file corruption | Low | First job only | Low - Delete and retry |

---

## Recommended Action Plan

### Immediate Fixes (Priority 1)
1. **Install jq** on all EC2 instances
2. **Update deployer.md** with explicit OAI/bucket policy commands
3. **Update deployer.md** to enforce dedicated bucket creation
4. **Update deployer.md** to create metadata.json

### Short-term Improvements (Priority 2)
1. **Add fallback to process-job.sh** to download deployed.json from S3
2. **Add verification steps** in deployer.md to ensure bucket created
3. **Add error handling** for failed OAI/policy creation

### Long-term Considerations (Priority 3)
1. **Evaluate SDK worker** (worker.js) which handles metadata.json correctly
2. **Add monitoring** for job success rates
3. **Implement cleanup** for failed deployments

---

## Files That Need Updates

### 1. `.claude/agents/deployer.md`
**Changes needed:**
- Section 1: Enforce dedicated bucket creation (not subfolders)
- Section 3: Add complete OAI + bucket policy commands
- Section 5: Add OAI configuration in CloudFront creation
- New Section 7: Create metadata.json for admin portal
- Output section: Emphasize local deployed.json creation

**Estimated time:** 30 minutes

### 2. `process-job.sh`
**Changes needed:**
- Add fallback: Download deployed.json from S3 if not local
- Check multiple S3 paths (builds/, deployments/)

**Estimated time:** 15 minutes

### 3. EC2 Setup Documentation
**Changes needed:**
- Add jq to required packages list
- Add verification step before starting worker

**Estimated time:** 5 minutes

---

## Testing Checklist

After implementing fixes, test with a new job:

- [ ] Job file placed in S3 jobs/ folder
- [ ] Worker picks up job within 30 seconds
- [ ] ARCHITECT phase completes
- [ ] DEVELOPER phase completes
- [ ] DEPLOYER phase completes
- [ ] New dedicated S3 bucket created (mvp-xxx-timestamp format)
- [ ] OAI created successfully
- [ ] Bucket policy applied
- [ ] CloudFront distribution created with OAI
- [ ] deployed.json exists locally at output/deployed.json
- [ ] deployed.json uploaded to S3
- [ ] metadata.json created in S3 at builds/{jobId}/metadata.json
- [ ] Progress file updated correctly (no jq errors)
- [ ] Job marked as "completed" (not "partial")
- [ ] CloudFront URL returns 200 (not 403)
- [ ] Site loads correctly in browser
- [ ] Build appears in admin portal

---

**Document Version:** 1.0
**Last Updated:** 2026-01-22
**Author:** Investigation of EC2 migration and bash worker issues
