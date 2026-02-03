#!/bin/bash
# Create CloudFront Distribution for Tmux Builder in CoCreate Account
# This will route traffic to EC2 at 18.211.207.2

set -e

AWS_PROFILE="cocreate"
EC2_IP="18.211.207.2"
TIMESTAMP=$(date +%s)

echo "=== Creating CloudFront Distribution for Tmux Builder ==="
echo "Profile: $AWS_PROFILE"
echo "Origin: $EC2_IP"
echo ""

# Create CloudFront distribution config
cat > /tmp/cf-tmux-builder-config.json << EOF
{
    "CallerReference": "tmux-builder-cocreate-${TIMESTAMP}",
    "Comment": "Tmux Builder - CoCreate Account",
    "Enabled": true,
    "Origins": {
        "Quantity": 1,
        "Items": [
            {
                "Id": "tmux-builder-ec2-origin",
                "DomainName": "${EC2_IP}",
                "CustomOriginConfig": {
                    "HTTPPort": 80,
                    "HTTPSPort": 443,
                    "OriginProtocolPolicy": "http-only",
                    "OriginSslProtocols": {
                        "Quantity": 1,
                        "Items": ["TLSv1.2"]
                    },
                    "OriginReadTimeout": 60,
                    "OriginKeepaliveTimeout": 5
                }
            }
        ]
    },
    "DefaultCacheBehavior": {
        "TargetOriginId": "tmux-builder-ec2-origin",
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
    "CacheBehaviors": {
        "Quantity": 2,
        "Items": [
            {
                "PathPattern": "/api/*",
                "TargetOriginId": "tmux-builder-ec2-origin",
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
            {
                "PathPattern": "/ws/*",
                "TargetOriginId": "tmux-builder-ec2-origin",
                "ViewerProtocolPolicy": "https-only",
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
                "Compress": false
            }
        ]
    },
    "CustomErrorResponses": {
        "Quantity": 1,
        "Items": [
            {
                "ErrorCode": 404,
                "ResponsePagePath": "/index.html",
                "ResponseCode": "200",
                "ErrorCachingMinTTL": 0
            }
        ]
    },
    "PriceClass": "PriceClass_100",
    "ViewerCertificate": {
        "CloudFrontDefaultCertificate": true,
        "MinimumProtocolVersion": "TLSv1.2_2021"
    },
    "HttpVersion": "http2and3",
    "IsIPV6Enabled": true
}
EOF

echo "Creating CloudFront distribution..."
CF_OUTPUT=$(aws cloudfront create-distribution \
    --distribution-config file:///tmp/cf-tmux-builder-config.json \
    --profile $AWS_PROFILE \
    --output json)

# Extract distribution details
CF_ID=$(echo $CF_OUTPUT | jq -r '.Distribution.Id')
CF_DOMAIN=$(echo $CF_OUTPUT | jq -r '.Distribution.DomainName')
CF_ARN=$(echo $CF_OUTPUT | jq -r '.Distribution.ARN')
CF_STATUS=$(echo $CF_OUTPUT | jq -r '.Distribution.Status')

echo ""
echo "=== CloudFront Distribution Created ==="
echo "Distribution ID: $CF_ID"
echo "Domain Name: $CF_DOMAIN"
echo "ARN: $CF_ARN"
echo "Status: $CF_STATUS"
echo ""
echo "=== IMPORTANT: Update these files with new CloudFront domain ==="
echo ""
echo "1. projects/ai-chat-widget/backend/index.mjs"
echo "   Line 3078: const EXTERNAL_BUILD_API = 'https://${CF_DOMAIN}/api/admin/sessions';"
echo "   Line 4533: fetch(\`https://${CF_DOMAIN}/api/admin/sessions/\${guid}\`)"
echo ""
echo "2. Full URL for Tmux Builder:"
echo "   https://${CF_DOMAIN}/client?guid=YOUR_GUID"
echo ""
echo "=== Wait for deployment ==="
echo "CloudFront deployment takes 5-15 minutes."
echo "Check status: aws cloudfront get-distribution --id $CF_ID --profile $AWS_PROFILE --query 'Distribution.Status'"
echo ""

# Save output for reference
cat > /tmp/cf-tmux-builder-output.json << EOF
{
    "distributionId": "$CF_ID",
    "domainName": "$CF_DOMAIN",
    "arn": "$CF_ARN",
    "status": "$CF_STATUS",
    "createdAt": "$(date -Iseconds)",
    "originIp": "$EC2_IP",
    "profile": "$AWS_PROFILE"
}
EOF

echo "Output saved to /tmp/cf-tmux-builder-output.json"
