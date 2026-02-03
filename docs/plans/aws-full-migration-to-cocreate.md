# Complete AWS Migration Plan: All Resources to CoCreate Account

## Goal
Migrate ALL AWS resources from Gopi Sunware account to CoCreate account (`248825820556`) so the entire system runs from a single AWS account.

---

## Current State Inventory

### Resources in Gopi Sunware Account (TO MIGRATE)

| # | Resource | Current Value | Purpose |
|---|----------|---------------|---------|
| 1 | EC2 Instance | `18.211.207.2` (us-east-1) | Tmux Builder server |
| 2 | Elastic IP | `18.211.207.2` | Static IP for EC2 |
| 3 | CloudFront | `d3r4k77gnvpmzn.cloudfront.net` | Tmux Builder CDN |
| 4 | Route 53 Zone | `cocreate-app.com` | DNS management |
| 5 | S3 Bucket | `ai-product-studio-applications` | Old build artifacts |
| 6 | S3 Bucket | `ai-product-studio-sunware` | Old website hosting |
| 7 | API Gateway | `bx0ywfkona` (ap-south-1) | Old API (if exists) |

### Resources Already in CoCreate Account (KEEP)

| # | Resource | Value | Status |
|---|----------|-------|--------|
| 1 | S3 Bucket | `cocreate-app.com` | ✅ Active |
| 2 | S3 Bucket | `cocreate-applications-data` | ✅ Active |
| 3 | CloudFront | `d22wcw0ms5yub3.cloudfront.net` | ✅ Active |
| 4 | ACM Certificate | `arn:aws:acm:us-east-1:248825820556:certificate/...` | ✅ Active |
| 5 | CloudFront Function | `cocreateidea-url-rewrite` | ✅ Active |

### Resources to VERIFY (Unknown Account)

| # | Resource | Value | Check Required |
|---|----------|-------|----------------|
| 1 | API Gateway | `mcndu8ynsa.execute-api.us-east-1` | Which account? |
| 2 | Lambda | `ai-product-studio-chat` | Which account? |

---

## Migration Phases

## Phase 0: Verification (Run First)

### Task 0.1: Check Lambda Location
```bash
# Check in CoCreate
aws lambda get-function --function-name ai-product-studio-chat --profile cocreate --region us-east-1 2>/dev/null && echo "Lambda is in CoCreate" || echo "Lambda NOT in CoCreate"

# Check in Sunware
aws lambda get-function --function-name ai-product-studio-chat --profile sunwaretech --region us-east-1 2>/dev/null && echo "Lambda is in Sunware" || echo "Lambda NOT in Sunware"

# Also check ap-south-1
aws lambda get-function --function-name ai-product-studio-chat --profile cocreate --region ap-south-1 2>/dev/null && echo "Lambda is in CoCreate ap-south-1"
aws lambda get-function --function-name ai-product-studio-chat --profile sunwaretech --region ap-south-1 2>/dev/null && echo "Lambda is in Sunware ap-south-1"
```

### Task 0.2: Check API Gateway Location
```bash
# Check in CoCreate
aws apigateway get-rest-apis --profile cocreate --region us-east-1 --query "items[?name=='ai-product-studio-chat']"

# Check in Sunware
aws apigateway get-rest-apis --profile sunwaretech --region us-east-1 --query "items[?name=='ai-product-studio-chat']"
```

### Task 0.3: List All CloudFront Distributions
```bash
# CoCreate
aws cloudfront list-distributions --profile cocreate --query "DistributionList.Items[*].[Id,DomainName,Comment]" --output table

# Sunware
aws cloudfront list-distributions --profile sunwaretech --query "DistributionList.Items[*].[Id,DomainName,Comment]" --output table
```

### Task 0.4: List All EC2 Instances
```bash
# CoCreate us-east-1
aws ec2 describe-instances --profile cocreate --region us-east-1 --query "Reservations[*].Instances[*].[InstanceId,PublicIpAddress,Tags[?Key=='Name'].Value|[0]]" --output table

# Sunware us-east-1
aws ec2 describe-instances --profile sunwaretech --region us-east-1 --query "Reservations[*].Instances[*].[InstanceId,PublicIpAddress,Tags[?Key=='Name'].Value|[0]]" --output table
```

---

## Phase 1: Create DynamoDB Table in CoCreate

### Task 1.1: Create cocreate-projects Table
```bash
aws dynamodb create-table \
    --table-name cocreate-projects \
    --attribute-definitions \
        AttributeName=userId,AttributeType=S \
        AttributeName=projectId,AttributeType=S \
        AttributeName=status,AttributeType=S \
        AttributeName=createdAt,AttributeType=S \
        AttributeName=resourcePrefix,AttributeType=S \
    --key-schema \
        AttributeName=userId,KeyType=HASH \
        AttributeName=projectId,KeyType=RANGE \
    --global-secondary-indexes \
        "[
            {
                \"IndexName\": \"GSI1-status-createdAt\",
                \"KeySchema\": [
                    {\"AttributeName\": \"status\", \"KeyType\": \"HASH\"},
                    {\"AttributeName\": \"createdAt\", \"KeyType\": \"RANGE\"}
                ],
                \"Projection\": {\"ProjectionType\": \"ALL\"}
            },
            {
                \"IndexName\": \"GSI2-resourcePrefix\",
                \"KeySchema\": [
                    {\"AttributeName\": \"resourcePrefix\", \"KeyType\": \"HASH\"}
                ],
                \"Projection\": {\"ProjectionType\": \"ALL\"}
            }
        ]" \
    --billing-mode PAY_PER_REQUEST \
    --profile cocreate \
    --region us-east-1

# Wait for table
aws dynamodb wait table-exists --table-name cocreate-projects --profile cocreate --region us-east-1
echo "DynamoDB table created!"
```

---

## Phase 2: Create New Tmux Builder EC2 in CoCreate

### Task 2.1: Create Security Group
```bash
# Create security group
aws ec2 create-security-group \
    --group-name tmux-builder-sg \
    --description "Security group for Tmux Builder" \
    --profile cocreate \
    --region us-east-1

# Get the security group ID
SG_ID=$(aws ec2 describe-security-groups --profile cocreate --region us-east-1 --group-names tmux-builder-sg --query "SecurityGroups[0].GroupId" --output text)

# Add inbound rules
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22 --cidr 0.0.0.0/0 --profile cocreate --region us-east-1
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 80 --cidr 0.0.0.0/0 --profile cocreate --region us-east-1
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 443 --cidr 0.0.0.0/0 --profile cocreate --region us-east-1
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 8000 --cidr 0.0.0.0/0 --profile cocreate --region us-east-1
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 8082 --cidr 0.0.0.0/0 --profile cocreate --region us-east-1
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 3001 --cidr 0.0.0.0/0 --profile cocreate --region us-east-1

echo "Security Group created: $SG_ID"
```

### Task 2.2: Create Key Pair
```bash
aws ec2 create-key-pair \
    --key-name tmux-builder-key \
    --query "KeyMaterial" \
    --output text \
    --profile cocreate \
    --region us-east-1 > tmux-builder-key.pem

chmod 400 tmux-builder-key.pem
echo "Key pair saved to tmux-builder-key.pem"
```

### Task 2.3: Launch EC2 Instance
```bash
# Ubuntu 22.04 LTS AMI (us-east-1)
AMI_ID="ami-0c7217cdde317cfec"

# Launch instance
INSTANCE_ID=$(aws ec2 run-instances \
    --image-id $AMI_ID \
    --instance-type t3.medium \
    --key-name tmux-builder-key \
    --security-group-ids $SG_ID \
    --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":30,\"VolumeType\":\"gp3\"}}]" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=tmux-builder-cocreate}]" \
    --profile cocreate \
    --region us-east-1 \
    --query "Instances[0].InstanceId" \
    --output text)

echo "Instance launched: $INSTANCE_ID"

# Wait for instance to be running
aws ec2 wait instance-running --instance-ids $INSTANCE_ID --profile cocreate --region us-east-1
echo "Instance is running!"
```

### Task 2.4: Allocate and Associate Elastic IP
```bash
# Allocate Elastic IP
EIP_ALLOC=$(aws ec2 allocate-address \
    --domain vpc \
    --profile cocreate \
    --region us-east-1 \
    --query "AllocationId" \
    --output text)

# Associate with instance
aws ec2 associate-address \
    --instance-id $INSTANCE_ID \
    --allocation-id $EIP_ALLOC \
    --profile cocreate \
    --region us-east-1

# Get the public IP
NEW_ELASTIC_IP=$(aws ec2 describe-addresses --allocation-ids $EIP_ALLOC --profile cocreate --region us-east-1 --query "Addresses[0].PublicIp" --output text)

echo "New Elastic IP: $NEW_ELASTIC_IP"
echo "Save this IP! You'll need it for CloudFront and DNS."
```

### Task 2.5: Setup EC2 Instance
```bash
# SSH into instance
ssh -i tmux-builder-key.pem ubuntu@$NEW_ELASTIC_IP

# Run setup script (on EC2)
sudo bash << 'EOF'
# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install Python 3.11
apt install -y python3.11 python3.11-venv python3-pip

# Install other dependencies
apt install -y git tmux nginx

# Install PM2 globally
npm install -g pm2

# Clone repository
cd /home/ubuntu
git clone https://github.com/cocreateceo/tmux-builder.git
cd tmux-builder
git checkout wsocket_ui

# Setup Backend
cd /home/ubuntu/tmux-builder/backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Setup Frontend
cd /home/ubuntu/tmux-builder/frontend
npm install
npm run build

# Configure Nginx
cat > /etc/nginx/sites-available/tmux-builder << 'NGINX'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:8082;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/tmux-builder /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo "EC2 Setup Complete!"
EOF
```

### Task 2.6: Configure PM2 and Start Services
```bash
# On EC2, create ecosystem.config.js
cat > /home/ubuntu/tmux-builder/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'tmux-backend',
      cwd: '/home/ubuntu/tmux-builder/backend',
      script: 'venv/bin/python',
      args: 'main.py',
      env: {
        PYTHONPATH: '/home/ubuntu/tmux-builder/backend',
        ANTHROPIC_API_KEY: 'YOUR_ANTHROPIC_KEY_HERE',
        COCREATE_API_URL: 'https://mcndu8ynsa.execute-api.us-east-1.amazonaws.com/prod/'
      },
      watch: false,
      autorestart: true,
      max_restarts: 10
    },
    {
      name: 'tmux-websocket',
      cwd: '/home/ubuntu/tmux-builder/backend',
      script: 'venv/bin/python',
      args: 'ws_server.py',
      env: {
        PYTHONPATH: '/home/ubuntu/tmux-builder/backend'
      },
      watch: false,
      autorestart: true,
      max_restarts: 10
    },
    {
      name: 'tmux-frontend',
      cwd: '/home/ubuntu/tmux-builder/frontend',
      script: 'npx',
      args: 'serve -s dist -l 3001',
      watch: false,
      autorestart: true
    }
  ]
};
EOF

# Start with PM2
cd /home/ubuntu/tmux-builder
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## Phase 3: Create CloudFront for Tmux Builder in CoCreate

### Task 3.1: Create CloudFront Distribution
```bash
# Create CloudFront distribution config
cat > /tmp/cf-tmux-config.json << EOF
{
    "CallerReference": "tmux-builder-cocreate-$(date +%s)",
    "Comment": "Tmux Builder - CoCreate",
    "Enabled": true,
    "Origins": {
        "Quantity": 1,
        "Items": [
            {
                "Id": "tmux-builder-ec2",
                "DomainName": "$NEW_ELASTIC_IP",
                "CustomOriginConfig": {
                    "HTTPPort": 80,
                    "HTTPSPort": 443,
                    "OriginProtocolPolicy": "http-only",
                    "OriginSslProtocols": {
                        "Quantity": 1,
                        "Items": ["TLSv1.2"]
                    }
                }
            }
        ]
    },
    "DefaultCacheBehavior": {
        "TargetOriginId": "tmux-builder-ec2",
        "ViewerProtocolPolicy": "redirect-to-https",
        "AllowedMethods": {
            "Quantity": 7,
            "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
            "CachedMethods": {
                "Quantity": 2,
                "Items": ["GET", "HEAD"]
            }
        },
        "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
        "OriginRequestPolicyId": "216adef6-5c7f-47e4-b989-5492eafa07d3",
        "Compress": true
    },
    "PriceClass": "PriceClass_100",
    "ViewerCertificate": {
        "CloudFrontDefaultCertificate": true
    }
}
EOF

# Create distribution
CF_OUTPUT=$(aws cloudfront create-distribution \
    --distribution-config file:///tmp/cf-tmux-config.json \
    --profile cocreate \
    --output json)

NEW_CF_ID=$(echo $CF_OUTPUT | jq -r '.Distribution.Id')
NEW_CF_DOMAIN=$(echo $CF_OUTPUT | jq -r '.Distribution.DomainName')

echo "New CloudFront Distribution ID: $NEW_CF_ID"
echo "New CloudFront Domain: $NEW_CF_DOMAIN"
echo ""
echo "SAVE THIS! Update code with: https://$NEW_CF_DOMAIN"
```

---

## Phase 4: Migrate Lambda & API Gateway (if in Sunware)

### Task 4.1: If Lambda is in Sunware, Create New in CoCreate
```bash
# Create Lambda execution role
aws iam create-role \
    --role-name cocreate-lambda-role \
    --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "lambda.amazonaws.com"},
            "Action": "sts:AssumeRole"
        }]
    }' \
    --profile cocreate

# Attach policies
aws iam attach-role-policy \
    --role-name cocreate-lambda-role \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
    --profile cocreate

aws iam attach-role-policy \
    --role-name cocreate-lambda-role \
    --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess \
    --profile cocreate

aws iam attach-role-policy \
    --role-name cocreate-lambda-role \
    --policy-arn arn:aws:iam::aws:policy/AmazonSESFullAccess \
    --profile cocreate

aws iam attach-role-policy \
    --role-name cocreate-lambda-role \
    --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess \
    --profile cocreate

# Wait for role propagation
sleep 10

# Create Lambda function
cd /path/to/projects/ai-chat-widget/backend
zip -r function.zip . -x '*.git*' -x 'deploy.sh' -x '*.md' -x '*.zip'

aws lambda create-function \
    --function-name cocreate-chat-api \
    --runtime nodejs20.x \
    --role arn:aws:iam::248825820556:role/cocreate-lambda-role \
    --handler index.handler \
    --zip-file fileb://function.zip \
    --timeout 30 \
    --memory-size 512 \
    --environment Variables="{
        ANTHROPIC_API_KEY=YOUR_KEY,
        S3_BUCKET=cocreate-applications-data,
        PROJECTS_TABLE=cocreate-projects,
        NOTIFICATION_EMAIL=hello@cocreateidea.com
    }" \
    --profile cocreate \
    --region us-east-1
```

### Task 4.2: Create API Gateway in CoCreate
```bash
# Create HTTP API
API_ID=$(aws apigatewayv2 create-api \
    --name cocreate-chat-api \
    --protocol-type HTTP \
    --profile cocreate \
    --region us-east-1 \
    --query "ApiId" \
    --output text)

# Create Lambda integration
INTEGRATION_ID=$(aws apigatewayv2 create-integration \
    --api-id $API_ID \
    --integration-type AWS_PROXY \
    --integration-uri arn:aws:lambda:us-east-1:248825820556:function:cocreate-chat-api \
    --payload-format-version 2.0 \
    --profile cocreate \
    --region us-east-1 \
    --query "IntegrationId" \
    --output text)

# Create routes
aws apigatewayv2 create-route \
    --api-id $API_ID \
    --route-key "POST /" \
    --target integrations/$INTEGRATION_ID \
    --profile cocreate \
    --region us-east-1

aws apigatewayv2 create-route \
    --api-id $API_ID \
    --route-key "OPTIONS /{proxy+}" \
    --target integrations/$INTEGRATION_ID \
    --profile cocreate \
    --region us-east-1

# Create stage
aws apigatewayv2 create-stage \
    --api-id $API_ID \
    --stage-name prod \
    --auto-deploy \
    --profile cocreate \
    --region us-east-1

# Add Lambda permission
aws lambda add-permission \
    --function-name cocreate-chat-api \
    --statement-id apigateway-invoke \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:us-east-1:248825820556:$API_ID/*" \
    --profile cocreate \
    --region us-east-1

echo "New API Gateway: https://$API_ID.execute-api.us-east-1.amazonaws.com/prod/"
```

---

## Phase 5: Update Code with New Endpoints

### Task 5.1: Update Backend - index.mjs
```javascript
// File: projects/ai-chat-widget/backend/index.mjs

// Line ~3078 - Update EXTERNAL_BUILD_API
// OLD: const EXTERNAL_BUILD_API = 'https://d3r4k77gnvpmzn.cloudfront.net/api/admin/sessions';
// NEW:
const EXTERNAL_BUILD_API = 'https://NEW_CF_DOMAIN.cloudfront.net/api/admin/sessions';

// Line ~4533 - Update fetch URL
// OLD: const response = await fetch(`https://d3r4k77gnvpmzn.cloudfront.net/api/admin/sessions/${guid}`);
// NEW:
const response = await fetch(`https://NEW_CF_DOMAIN.cloudfront.net/api/admin/sessions/${guid}`);
```

### Task 5.2: Update Frontend - config.js
```javascript
// File: option-a-threejs-gsap-tailwind/site/js/config.js

// Line 33 - Update chat API (if migrated)
// OLD: chat: 'https://mcndu8ynsa.execute-api.us-east-1.amazonaws.com/prod/',
// NEW (if API Gateway was recreated):
chat: 'https://NEW_API_ID.execute-api.us-east-1.amazonaws.com/prod/',

// Line 62 - Update API Gateway ID
// OLD: apiGatewayId: 'mcndu8ynsa',
// NEW:
apiGatewayId: 'NEW_API_ID',
```

### Task 5.3: Update ecosystem.config.js
```javascript
// File: ecosystem.config.js (local copy for deployment)

// Update ANTHROPIC_API_KEY with actual key
// Update COCREATE_API_URL with new API Gateway URL
```

---

## Phase 6: Deploy Updated Code

### Task 6.1: Deploy Lambda
```bash
cd /path/to/projects/ai-chat-widget/backend
npm install
zip -r function.zip . -x '*.git*' -x 'deploy.sh' -x '*.md' -x '*.zip'

aws lambda update-function-code \
    --function-name cocreate-chat-api \
    --zip-file fileb://function.zip \
    --profile cocreate \
    --region us-east-1
```

### Task 6.2: Deploy Frontend
```bash
cd /path/to/option-a-threejs-gsap-tailwind/site
aws s3 sync . s3://cocreate-app.com/ --delete --profile cocreate
```

### Task 6.3: Deploy Tmux Builder Updates (SSH to EC2)
```bash
ssh -i tmux-builder-key.pem ubuntu@$NEW_ELASTIC_IP

cd /home/ubuntu/tmux-builder
git pull origin wsocket_ui

# Update backend
cd backend
source venv/bin/activate
pip install -r requirements.txt

# Update frontend
cd ../frontend
npm install
npm run build

# Restart services
pm2 restart all
```

---

## Phase 7: DNS Updates (Optional - Keep in Sunware pointing to CoCreate)

### Option A: Keep Route 53 in Sunware, Point to CoCreate
```bash
# No changes needed if domains already point to d22wcw0ms5yub3.cloudfront.net
# Just verify the A records are correct
```

### Option B: Transfer Route 53 Zone to CoCreate
```bash
# This is complex and requires domain transfer
# Recommend keeping DNS in Sunware for now
```

---

## Phase 8: Cleanup Old Resources (After Verification)

### Task 8.1: Disable Old CloudFront
```bash
# Get current config
aws cloudfront get-distribution-config --id d3r4k77gnvpmzn --profile sunwaretech > /tmp/old-cf.json

# Disable (set Enabled: false)
# Then delete after propagation
```

### Task 8.2: Terminate Old EC2
```bash
# Only after new EC2 is fully working
aws ec2 terminate-instances --instance-ids OLD_INSTANCE_ID --profile sunwaretech --region us-east-1
```

### Task 8.3: Release Old Elastic IP
```bash
# Release 18.211.207.2
aws ec2 release-address --allocation-id OLD_ALLOC_ID --profile sunwaretech --region us-east-1
```

---

## Verification Checklist

### After Each Phase

- [ ] **Phase 1**: DynamoDB table created and accessible
- [ ] **Phase 2**: EC2 instance running, can SSH, services responding
- [ ] **Phase 3**: CloudFront distribution deployed, returns content
- [ ] **Phase 4**: Lambda responds, API Gateway routes work
- [ ] **Phase 5**: Code updated with new endpoints
- [ ] **Phase 6**: Deployments successful
- [ ] **Phase 7**: DNS resolves correctly
- [ ] **Phase 8**: Old resources disabled/terminated

### End-to-End Tests

```bash
# Test website
curl -I https://cocreateidea.com
curl -I https://www.cocreateidea.com

# Test chat API
curl -X POST https://NEW_API.execute-api.us-east-1.amazonaws.com/prod/ \
  -H "Content-Type: application/json" \
  -d '{"action": "user-check", "email": "test@test.com"}'

# Test Tmux Builder
curl -I https://NEW_CF_DOMAIN.cloudfront.net/
curl https://NEW_CF_DOMAIN.cloudfront.net/api/health

# Test session creation
curl -X POST https://NEW_CF_DOMAIN.cloudfront.net/api/admin/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "Test", "email": "test@test.com", "initial_request": "Test project"}'
```

---

## Summary: New CoCreate Resources

After migration, all resources will be in CoCreate account:

| Resource | New Value |
|----------|-----------|
| EC2 Elastic IP | `NEW_IP` (from Phase 2.4) |
| CloudFront (Tmux) | `NEW_CF_DOMAIN` (from Phase 3.1) |
| CloudFront (Website) | `d22wcw0ms5yub3.cloudfront.net` (existing) |
| API Gateway | `NEW_API_ID` or `mcndu8ynsa` (if already in CoCreate) |
| Lambda | `cocreate-chat-api` |
| DynamoDB | `cocreate-projects` |
| S3 (Data) | `cocreate-applications-data` |
| S3 (Website) | `cocreate-app.com` |

---

## Code Files to Update

| File | Changes |
|------|---------|
| `projects/ai-chat-widget/backend/index.mjs` | Update `EXTERNAL_BUILD_API` URLs |
| `option-a-threejs-gsap-tailwind/site/js/config.js` | Update `apiGatewayId` if changed |
| `ecosystem.config.js` | Update `COCREATE_API_URL` |
| `tmux-builder-setup.sh` | Update Elastic IP reference |

---

## Estimated Timeline

| Phase | Duration |
|-------|----------|
| Phase 0: Verification | 15 minutes |
| Phase 1: DynamoDB | 5 minutes |
| Phase 2: EC2 Setup | 30-45 minutes |
| Phase 3: CloudFront | 15-30 minutes (propagation) |
| Phase 4: Lambda/API | 30 minutes |
| Phase 5: Code Updates | 15 minutes |
| Phase 6: Deployments | 15 minutes |
| Phase 7: DNS (optional) | 5 minutes |
| Phase 8: Cleanup | 15 minutes |

**Total: ~2-3 hours**
