#!/bin/bash
# =============================================================================
# Deploy to cocreate-app.com
# =============================================================================
# This script deploys the CoCreate AI site to S3 and sets up cocreate-app.com
#
# Prerequisites:
#   - AWS CLI installed and configured with sunwaretech profile
#   - Domain cocreate-app.com registered/available in Route 53
#
# Usage: ./deploy-cocreate-app.sh
# =============================================================================

set -e

# Configuration
DOMAIN="cocreate-app.com"
S3_BUCKET="cocreate-app.com"
AWS_PROFILE="cocreate"
AWS_REGION="ap-south-1"
ACM_REGION="us-east-1"  # Required for CloudFront
SITE_DIR="option-a-threejs-gsap-tailwind/site"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}  Deploying to: ${DOMAIN}${NC}"
echo -e "${BLUE}=============================================${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Create S3 Bucket (if not exists)
# -----------------------------------------------------------------------------
echo -e "${YELLOW}Step 1: Setting up S3 bucket...${NC}"

if aws s3 ls "s3://${S3_BUCKET}" --profile $AWS_PROFILE 2>/dev/null; then
    echo -e "${GREEN}Bucket ${S3_BUCKET} already exists${NC}"
else
    echo "Creating bucket ${S3_BUCKET}..."
    aws s3 mb "s3://${S3_BUCKET}" --profile $AWS_PROFILE --region $AWS_REGION
    echo -e "${GREEN}Bucket created${NC}"
fi

# Enable static website hosting
aws s3 website "s3://${S3_BUCKET}" \
    --index-document index.html \
    --error-document index.html \
    --profile $AWS_PROFILE

# Set bucket policy for public read
echo "Setting bucket policy..."
aws s3api put-bucket-policy \
    --bucket $S3_BUCKET \
    --profile $AWS_PROFILE \
    --policy "{
        \"Version\": \"2012-10-17\",
        \"Statement\": [{
            \"Sid\": \"PublicReadGetObject\",
            \"Effect\": \"Allow\",
            \"Principal\": \"*\",
            \"Action\": \"s3:GetObject\",
            \"Resource\": \"arn:aws:s3:::${S3_BUCKET}/*\"
        }]
    }"

echo ""

# -----------------------------------------------------------------------------
# Step 2: Sync files to S3
# -----------------------------------------------------------------------------
echo -e "${YELLOW}Step 2: Uploading files to S3...${NC}"

aws s3 sync $SITE_DIR "s3://${S3_BUCKET}" \
    --profile $AWS_PROFILE \
    --delete \
    --cache-control "max-age=86400" \
    --exclude ".DS_Store" \
    --exclude "*.map"

# Set proper content types
aws s3 cp "s3://${S3_BUCKET}" "s3://${S3_BUCKET}" \
    --profile $AWS_PROFILE \
    --recursive \
    --exclude "*" \
    --include "*.html" \
    --content-type "text/html" \
    --metadata-directive REPLACE

aws s3 cp "s3://${S3_BUCKET}" "s3://${S3_BUCKET}" \
    --profile $AWS_PROFILE \
    --recursive \
    --exclude "*" \
    --include "*.js" \
    --content-type "application/javascript" \
    --metadata-directive REPLACE

aws s3 cp "s3://${S3_BUCKET}" "s3://${S3_BUCKET}" \
    --profile $AWS_PROFILE \
    --recursive \
    --exclude "*" \
    --include "*.css" \
    --content-type "text/css" \
    --metadata-directive REPLACE

echo -e "${GREEN}Files uploaded successfully${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 3: Request ACM Certificate
# -----------------------------------------------------------------------------
echo -e "${YELLOW}Step 3: Setting up SSL Certificate...${NC}"

EXISTING_CERT=$(aws acm list-certificates \
    --region $ACM_REGION \
    --profile $AWS_PROFILE \
    --query "CertificateSummaryList[?DomainName=='${DOMAIN}'].CertificateArn" \
    --output text)

if [ -n "$EXISTING_CERT" ] && [ "$EXISTING_CERT" != "None" ]; then
    echo -e "${GREEN}Certificate already exists: ${EXISTING_CERT}${NC}"
    CERT_ARN=$EXISTING_CERT
else
    echo "Requesting new certificate..."
    CERT_ARN=$(aws acm request-certificate \
        --domain-name $DOMAIN \
        --subject-alternative-names "*.${DOMAIN}" \
        --validation-method DNS \
        --region $ACM_REGION \
        --profile $AWS_PROFILE \
        --query 'CertificateArn' \
        --output text)

    echo -e "${GREEN}Certificate requested: ${CERT_ARN}${NC}"
    echo ""
    echo -e "${YELLOW}IMPORTANT: You need to validate this certificate!${NC}"
    echo "1. Go to AWS Console > Certificate Manager (us-east-1)"
    echo "2. Click on the certificate"
    echo "3. Click 'Create records in Route 53' to add DNS validation"
    echo "4. Wait for status to become 'Issued' (5-30 minutes)"
    echo ""
    read -p "Press Enter once the certificate is issued..."
fi

echo ""

# -----------------------------------------------------------------------------
# Step 4: Create CloudFront Distribution
# -----------------------------------------------------------------------------
echo -e "${YELLOW}Step 4: Creating CloudFront Distribution...${NC}"

# Check if distribution already exists
EXISTING_CF=$(aws cloudfront list-distributions \
    --profile $AWS_PROFILE \
    --query "DistributionList.Items[?contains(Aliases.Items, '${DOMAIN}')].Id" \
    --output text)

if [ -n "$EXISTING_CF" ] && [ "$EXISTING_CF" != "None" ]; then
    echo -e "${GREEN}CloudFront distribution already exists: ${EXISTING_CF}${NC}"
    CF_ID=$EXISTING_CF
else
    echo "Creating new CloudFront distribution..."

    CF_CONFIG=$(cat <<EOF
{
    "CallerReference": "cocreate-app-$(date +%s)",
    "Origins": {
        "Quantity": 1,
        "Items": [{
            "Id": "S3-${S3_BUCKET}",
            "DomainName": "${S3_BUCKET}.s3-website.${AWS_REGION}.amazonaws.com",
            "CustomOriginConfig": {
                "HTTPPort": 80,
                "HTTPSPort": 443,
                "OriginProtocolPolicy": "http-only"
            }
        }]
    },
    "DefaultCacheBehavior": {
        "TargetOriginId": "S3-${S3_BUCKET}",
        "ViewerProtocolPolicy": "redirect-to-https",
        "AllowedMethods": {
            "Quantity": 2,
            "Items": ["GET", "HEAD"],
            "CachedMethods": {
                "Quantity": 2,
                "Items": ["GET", "HEAD"]
            }
        },
        "ForwardedValues": {
            "QueryString": false,
            "Cookies": {"Forward": "none"}
        },
        "MinTTL": 0,
        "DefaultTTL": 86400,
        "MaxTTL": 31536000,
        "Compress": true
    },
    "Enabled": true,
    "Comment": "CoCreate AI - ${DOMAIN}",
    "Aliases": {
        "Quantity": 2,
        "Items": ["${DOMAIN}", "www.${DOMAIN}"]
    },
    "ViewerCertificate": {
        "ACMCertificateArn": "${CERT_ARN}",
        "SSLSupportMethod": "sni-only",
        "MinimumProtocolVersion": "TLSv1.2_2021"
    },
    "DefaultRootObject": "index.html",
    "CustomErrorResponses": {
        "Quantity": 1,
        "Items": [{
            "ErrorCode": 404,
            "ResponsePagePath": "/index.html",
            "ResponseCode": "200",
            "ErrorCachingMinTTL": 300
        }]
    }
}
EOF
)

    echo "$CF_CONFIG" > /tmp/cf-dist-config.json

    CF_RESULT=$(aws cloudfront create-distribution \
        --distribution-config file:///tmp/cf-dist-config.json \
        --profile $AWS_PROFILE)

    CF_ID=$(echo $CF_RESULT | jq -r '.Distribution.Id')
    CF_DOMAIN=$(echo $CF_RESULT | jq -r '.Distribution.DomainName')

    echo -e "${GREEN}CloudFront distribution created: ${CF_ID}${NC}"
    echo "CloudFront domain: ${CF_DOMAIN}"
fi

# Get CloudFront domain
CF_DOMAIN=$(aws cloudfront get-distribution \
    --id $CF_ID \
    --profile $AWS_PROFILE \
    --query 'Distribution.DomainName' \
    --output text)

echo ""

# -----------------------------------------------------------------------------
# Step 5: Set up Route 53 DNS
# -----------------------------------------------------------------------------
echo -e "${YELLOW}Step 5: Setting up DNS records...${NC}"

# Get hosted zone ID
ZONE_ID=$(aws route53 list-hosted-zones \
    --profile $AWS_PROFILE \
    --query "HostedZones[?Name=='${DOMAIN}.'].Id" \
    --output text | sed 's|/hostedzone/||')

if [ -z "$ZONE_ID" ] || [ "$ZONE_ID" == "None" ]; then
    echo -e "${YELLOW}Hosted zone for ${DOMAIN} not found.${NC}"
    echo "Please create the hosted zone in Route 53 first, or update your domain's nameservers."
    echo ""
    echo "CloudFront domain to point to: ${CF_DOMAIN}"
    echo ""
else
    # Create A record for root domain
    aws route53 change-resource-record-sets \
        --hosted-zone-id $ZONE_ID \
        --profile $AWS_PROFILE \
        --change-batch "{
            \"Changes\": [{
                \"Action\": \"UPSERT\",
                \"ResourceRecordSet\": {
                    \"Name\": \"${DOMAIN}\",
                    \"Type\": \"A\",
                    \"AliasTarget\": {
                        \"HostedZoneId\": \"Z2FDTNDATAQYW2\",
                        \"DNSName\": \"${CF_DOMAIN}\",
                        \"EvaluateTargetHealth\": false
                    }
                }
            }]
        }" > /dev/null

    # Create A record for www subdomain
    aws route53 change-resource-record-sets \
        --hosted-zone-id $ZONE_ID \
        --profile $AWS_PROFILE \
        --change-batch "{
            \"Changes\": [{
                \"Action\": \"UPSERT\",
                \"ResourceRecordSet\": {
                    \"Name\": \"www.${DOMAIN}\",
                    \"Type\": \"A\",
                    \"AliasTarget\": {
                        \"HostedZoneId\": \"Z2FDTNDATAQYW2\",
                        \"DNSName\": \"${CF_DOMAIN}\",
                        \"EvaluateTargetHealth\": false
                    }
                }
            }]
        }" > /dev/null

    echo -e "${GREEN}DNS records created${NC}"
fi

echo ""

# -----------------------------------------------------------------------------
# Complete!
# -----------------------------------------------------------------------------
echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}=============================================${NC}"
echo ""
echo "Your site will be available at:"
echo -e "  ${BLUE}https://${DOMAIN}${NC}"
echo -e "  ${BLUE}https://www.${DOMAIN}${NC}"
echo ""
echo "CloudFront Distribution ID: ${CF_ID}"
echo "CloudFront Domain: ${CF_DOMAIN}"
echo ""
echo -e "${YELLOW}Note: CloudFront deployment takes 10-15 minutes.${NC}"
echo -e "${YELLOW}DNS propagation may take a few more minutes.${NC}"
echo ""

# Cleanup
rm -f /tmp/cf-dist-config.json
