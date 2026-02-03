# AWS Deployment Checklist Reference

## Pre-Deployment (Before Any Code)

```bash
# 1. Verify AWS access
aws sts get-caller-identity --profile $PROFILE
# Expected: AccountId, UserId, Arn

# 2. Set environment
export AWS_PROFILE=your-profile
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export PROJECT_NAME=your-project
```

## Infrastructure Setup Order

**CRITICAL: Follow this exact order to avoid dependency issues**

### Step 1: Foundation
```bash
# ECR repositories (needed before Docker push)
aws ecr create-repository --repository-name $PROJECT_NAME-backend
aws ecr create-repository --repository-name $PROJECT_NAME-frontend

# S3 for Terraform state
aws s3 mb s3://$PROJECT_NAME-terraform-state-$ACCOUNT_ID

# S3 for CodeBuild source
aws s3 mb s3://$PROJECT_NAME-codebuild-source-$ACCOUNT_ID
```

### Step 2: Secrets (before ECS)
```bash
aws secretsmanager create-secret \
  --name $PROJECT_NAME/production \
  --secret-string '{"DATABASE_URL":"...","JWT_SECRET":"...","STRIPE_KEY":"..."}'
```

### Step 3: Docker Images (before ECS)
```bash
# ECR login
aws ecr get-login-password | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Build and push (or use CodeBuild)
docker build -t $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$PROJECT_NAME-backend:latest ./backend
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$PROJECT_NAME-backend:latest
```

### Step 4: Terraform Infrastructure
```bash
cd infrastructure/terraform
terraform init
terraform plan -var-file="terraform.tfvars"
terraform apply -var-file="terraform.tfvars"
```

### Step 5: CloudFront (IMMEDIATELY after ALB is up)
```bash
# Don't wait - create CloudFront right after ALB
aws cloudfront create-distribution --distribution-config file://cloudfront-config.json
```

### Step 6: Database Migrations
```bash
# Run from a task or bastion
alembic upgrade head
```

## CloudFront Configuration Template

```json
{
  "CallerReference": "unique-ref-timestamp",
  "Comment": "Production CDN",
  "DefaultCacheBehavior": {
    "TargetOriginId": "alb-origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 7,
      "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
      "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]}
    },
    "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    "OriginRequestPolicyId": "216adef6-5c7f-47e4-b989-5492eafa07d3",
    "Compress": true
  },
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "alb-origin",
      "DomainName": "YOUR-ALB-DNS.elb.amazonaws.com",
      "CustomOriginConfig": {
        "HTTPPort": 8080,
        "HTTPSPort": 443,
        "OriginProtocolPolicy": "http-only",
        "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]}
      }
    }]
  },
  "Enabled": true,
  "PriceClass": "PriceClass_100"
}
```

## CodeBuild Source Upload Pattern

```bash
# ALWAYS include buildspec.yml in the zip
zip -r source.zip backend frontend buildspec.yml

# Upload to correct bucket (include account ID!)
aws s3 cp source.zip s3://$PROJECT_NAME-codebuild-source-$ACCOUNT_ID/source.zip

# Trigger build
aws codebuild start-build --project-name $PROJECT_NAME-docker-build

# Monitor
aws codebuild batch-get-builds --ids "BUILD_ID" --query 'builds[0].buildStatus'
```

## ECS Deployment Pattern

```bash
# Force new deployment (pulls latest image)
aws ecs update-service \
  --cluster $PROJECT_NAME-production \
  --service $PROJECT_NAME-production-backend \
  --force-new-deployment

# Wait for stable
aws ecs wait services-stable \
  --cluster $PROJECT_NAME-production \
  --services $PROJECT_NAME-production-backend

# Check deployment status
aws ecs describe-services \
  --cluster $PROJECT_NAME-production \
  --services $PROJECT_NAME-production-backend \
  --query 'services[0].deployments'
```

## Health Check Verification

```bash
# Frontend
curl -s -o /dev/null -w "%{http_code}" https://$CLOUDFRONT_URL/health
# Expected: 200

# Backend API
curl -s https://$CLOUDFRONT_URL/api/v1/health
# Expected: {"status":"healthy"} or similar

# OAuth endpoints exist
curl -s https://$CLOUDFRONT_URL/api/v1/auth/oauth/providers
# Expected: {"providers":[...]}
```

## Troubleshooting Commands

```bash
# ECS task logs
aws logs tail /ecs/$PROJECT_NAME-backend --follow

# CodeBuild logs
aws logs get-log-events \
  --log-group-name /aws/codebuild/$PROJECT_NAME \
  --log-stream-name $STREAM_NAME

# Check ECS task failures
aws ecs describe-tasks \
  --cluster $PROJECT_NAME-production \
  --tasks $TASK_ARN \
  --query 'tasks[0].stoppedReason'

# ALB target health
aws elbv2 describe-target-health \
  --target-group-arn $TG_ARN
```

## Common Error → Fix Mapping

| Error | Cause | Fix |
|-------|-------|-----|
| `NoSuchBucket` | Wrong account ID in bucket name | Check `$ACCOUNT_ID` variable |
| `Exit code 1` in CodeBuild | Build failed | Check CloudWatch logs for actual error |
| `FAILED` phase: BUILD | Docker build error | Run `docker build` locally first |
| `FAILED` phase: POST_BUILD | Image push failed | Check ECR permissions |
| ECS task keeps stopping | Container crash | Check task logs for error |
| 502 Bad Gateway | Container not healthy | Check health endpoint path |
| CloudFront `InProgress` forever | Normal - takes 5-15 min | Wait or check for errors |

## Security Checklist

- [ ] Secrets in Secrets Manager, NOT env vars
- [ ] RDS not publicly accessible
- [ ] Security groups restrict access
- [ ] CloudFront enforces HTTPS
- [ ] S3 buckets not public
- [ ] IAM roles follow least privilege

---

## Pre-Deployment Verification (CRITICAL)

**Run these checks BEFORE every deployment to prevent missed implementations.**

### API Contract Verification

```bash
# Find frontend API calls
grep -rhoP "api\.(get|post|put|delete)\(['\"][^'\"]+['\"]" frontend/src/hooks/ | sort -u

# Find backend routes
grep -rhoP "@router\.(get|post|put|delete)\(['\"][^'\"]+['\"]" backend/app/api/v1/ | sort -u

# Ensure all frontend calls have backend endpoints
```

**Essential endpoints checklist:**
- [ ] `POST /auth/logout` - Server-side logout
- [ ] `POST /chatbot/message` - AI chat
- [ ] `GET /chatbot/briefing` - Daily briefing
- [ ] `POST /applications` - Create application
- [ ] `GET /jobs/search` OR frontend uses `/jobs`
- [ ] `POST /jobs/{id}/save` - Save job
- [ ] `GET /jobs/saved` - List saved jobs

### Frontend Route Verification

```bash
# Find all Link/navigate destinations
grep -rhoP "to=['\"][^'\"]+['\"]" frontend/src/ | sort -u

# Find all Route paths
grep -oP "path=['\"][^'\"]+['\"]" frontend/src/App.tsx | sort -u
```

**Essential routes checklist:**
- [ ] `/forgot-password` - Password reset
- [ ] `/terms` - Terms of Service
- [ ] `/privacy` - Privacy Policy
- [ ] `/applications` - Application list
- [ ] `/chat` - AI Coach page
- [ ] `*` - 404 catch-all

### Standard Features Verification

```bash
# Check backend has these
grep -q "logout" backend/app/api/v1/auth.py && echo "✅" || echo "❌ Logout endpoint"
grep -q "forgot" backend/app/api/v1/auth.py && echo "✅" || echo "❌ Forgot password"

# Check frontend has these pages
test -f frontend/src/pages/auth/ForgotPassword.tsx && echo "✅" || echo "❌ ForgotPassword.tsx"
test -f frontend/src/pages/legal/Terms.tsx && echo "✅" || echo "❌ Terms.tsx"
test -f frontend/src/pages/legal/Privacy.tsx && echo "✅" || echo "❌ Privacy.tsx"
```

### Schema Alignment Verification

Compare TypeScript interfaces with Pydantic schemas:

| Check | Frontend | Backend | Match |
|-------|----------|---------|-------|
| ApplicationStats | `total_applications` | `total` | ❌ |
| Resume | `file_type` | `content_type` | ❌ |

### Build Verification (Run locally BEFORE CodeBuild)

```bash
# Frontend build
cd frontend && npm run build && cd ..

# Backend tests
cd backend && python -m pytest tests/ -x && cd ..
```

---

## Post-Deployment Verification

```bash
# Full verification after deployment
./scripts/post-deploy-test.sh https://$CLOUDFRONT_URL

# Or manual checks:
curl -s https://$CLOUDFRONT_URL/health
curl -s https://$CLOUDFRONT_URL/api/v1/health
curl -s https://$CLOUDFRONT_URL/api/v1/auth/logout -X POST  # Should not 404
curl -s https://$CLOUDFRONT_URL/forgot-password  # Should not 404
curl -s https://$CLOUDFRONT_URL/terms  # Should not 404
curl -s https://$CLOUDFRONT_URL/privacy  # Should not 404
```

---

## Post-Deployment Monitoring

```bash
# Watch for 404 errors (indicates missing endpoints/routes)
aws logs filter-log-events --log-group-name /ecs/$PROJECT_NAME \
  --filter-pattern "404" --start-time $(date -d '1 hour ago' +%s000)

# Watch for 500 errors (indicates server bugs)
aws logs filter-log-events --log-group-name /ecs/$PROJECT_NAME \
  --filter-pattern "500" --start-time $(date -d '1 hour ago' +%s000)
```
