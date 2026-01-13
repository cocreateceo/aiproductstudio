#!/bin/bash
# Usage: update-progress.sh JOB_ID PHASE STATUS MESSAGE

JOB_ID=$1
PHASE=$2
STATUS=$3
MESSAGE=$4
BUCKET="ai-product-studio-applications"
PROGRESS_FILE="/tmp/progress-$JOB_ID.json"

# Get current time in EST
TIMESTAMP=$(TZ=America/New_York date -Iseconds)

# Download existing progress or create new
aws s3 cp s3://$BUCKET/progress/$JOB_ID.json $PROGRESS_FILE 2>/dev/null || echo '{}' > $PROGRESS_FILE

# Update progress using jq
cat $PROGRESS_FILE | jq --arg phase "$PHASE" --arg status "$STATUS" --arg msg "$MESSAGE" --arg ts "$TIMESTAMP" '
  .jobId = "'$JOB_ID'" |
  .currentPhase = $phase |
  .status = (if $status == "completed" and $phase == "deployer" then "completed" elif $status == "failed" then "failed" else "in_progress" end) |
  .phases[$phase] = {
    status: $status,
    message: $msg,
    updatedAt: $ts
  } |
  .updatedAt = $ts |
  .logs += [{timestamp: $ts, phase: $phase, status: $status, message: $msg}]
' > /tmp/progress-$JOB_ID-new.json

mv /tmp/progress-$JOB_ID-new.json $PROGRESS_FILE

# Upload to S3
aws s3 cp $PROGRESS_FILE s3://$BUCKET/progress/$JOB_ID.json

echo "Progress updated: $PHASE - $STATUS - $MESSAGE"
