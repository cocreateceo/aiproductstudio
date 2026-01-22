#!/bin/bash
# Job Queue Worker - Polls S3 for new jobs and processes them

JOBS_PREFIX="jobs/"
PROCESSED_PREFIX="processed/"
BUCKET="ai-product-studio-applications"
WORK_DIR="/home/ubuntu/ai-product-studio"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "Starting worker..."

while true; do
    # List pending jobs
    JOBS=$(aws s3 ls s3://$BUCKET/$JOBS_PREFIX 2>/dev/null | grep ".json" | awk '{print $4}')

    for JOB_FILE in $JOBS; do
        if [ -n "$JOB_FILE" ]; then
            JOB_ID=$(basename $JOB_FILE .json)
            
            log "Found job: $JOB_ID"
            
            # Create job directory
            mkdir -p $WORK_DIR/jobs/$JOB_ID/output
            
            # Download job file
            aws s3 cp s3://$BUCKET/$JOBS_PREFIX$JOB_FILE $WORK_DIR/jobs/$JOB_ID/input.json
            
            # Process with Claude Code
            log "Processing job: $JOB_ID"
            $WORK_DIR/process-job.sh $JOB_ID
            
            # Move to processed
            aws s3 mv s3://$BUCKET/$JOBS_PREFIX$JOB_FILE s3://$BUCKET/$PROCESSED_PREFIX$JOB_FILE
            
            log "Completed job: $JOB_ID"
        fi
    done

    # Poll interval - 30 seconds
    sleep 30
done
