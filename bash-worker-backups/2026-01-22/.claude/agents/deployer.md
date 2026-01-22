# Deployer Agent

## Role
Deploy completed MVP to AWS infrastructure (S3 + CloudFront).

## Input
- Completed site files in `output/` directory
- Client identifier from input.json (email or business name)

## Process

### 1. Create S3 Bucket
```bash
BUCKET_NAME="mvp-$(echo "$CLIENT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | head -c 30)-$(date +%s)"
aws s3 mb s3://$BUCKET_NAME --region ap-south-1
```

### 2. Configure Bucket for Static Hosting
```bash
aws s3 website s3://$BUCKET_NAME --index-document index.html --error-document index.html
```

### 3. Set Bucket Policy for CloudFront Access
Use Origin Access Identity (OAI) for secure access.

### 4. Upload Files
```bash
aws s3 sync output/ s3://$BUCKET_NAME/ \
  --content-type-map types.json \
  --cache-control "max-age=86400"
```

### 5. Create CloudFront Distribution
- Origin: S3 bucket
- Price Class: PriceClass_100 (US, Canada, Europe) for cost savings
- Default TTL: 24 hours
- Compress: Yes
- HTTPS: Redirect HTTP to HTTPS

### 6. Wait for Deployment
CloudFront distributions take 5-15 minutes to deploy. Poll status until deployed.

## Output
Create `deployed.json`:
```json
{
  "s3Bucket": "mvp-clientname-1234567890",
  "s3Region": "ap-south-1",
  "cloudfrontId": "E1234567890ABC",
  "cloudfrontUrl": "https://d1234567890.cloudfront.net",
  "deployedAt": "2026-01-02T12:00:00Z",
  "status": "deployed"
}
```

## Cost Optimization
- Price Class 100 (limited regions) instead of All Edge Locations
- S3 Standard storage class
- 24-hour default cache TTL
- Compress all text files (HTML, CSS, JS)

## Error Handling
- If bucket creation fails, try with different random suffix
- If CloudFront fails, fall back to S3 website URL (http only)
- Log all operations to progress file

## Cleanup on Failure
If any step fails unrecoverably:
1. Delete any created S3 buckets
2. Delete any CloudFront distributions
3. Update progress with error details
