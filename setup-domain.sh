#!/bin/bash
# =============================================================================
# Domain Setup Script: cocreateidea.com → CloudFront
# =============================================================================
# This script automates the complete domain migration for AI Product Studio
#
# Prerequisites:
#   - AWS CLI installed and configured
#   - sunwaretech profile with appropriate permissions
#   - Domain registered in Route 53
#
# Usage: ./setup-domain.sh
# =============================================================================

set -e

# Configuration
DOMAIN="cocreateidea.com"
CLOUDFRONT_ID="E85ZBHF63VW9W"
AWS_PROFILE="sunwaretech"
ACM_REGION="us-east-1"  # Required for CloudFront

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}  Domain Setup: ${DOMAIN}${NC}"
echo -e "${BLUE}=============================================${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Get Route 53 Hosted Zone
# -----------------------------------------------------------------------------
echo -e "${YELLOW}Step 1: Finding Route 53 Hosted Zone...${NC}"

HOSTED_ZONES=$(aws route53 list-hosted-zones \
  --profile $AWS_PROFILE \
  --query 'HostedZones[*].[Name,Id]' \
  --output text)

echo "Available hosted zones:"
echo "$HOSTED_ZONES"
echo ""

# Try to find the zone automatically
ZONE_ID=$(aws route53 list-hosted-zones \
  --profile $AWS_PROFILE \
  --query "HostedZones[?Name=='${DOMAIN}.'].Id" \
  --output text | sed 's|/hostedzone/||')

if [ -z "$ZONE_ID" ]; then
  echo -e "${YELLOW}Could not find hosted zone for ${DOMAIN}${NC}"
  read -p "Enter your Hosted Zone ID (without /hostedzone/ prefix): " ZONE_ID
fi

echo -e "${GREEN}Using Hosted Zone: ${ZONE_ID}${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 2: Request ACM Certificate
# -----------------------------------------------------------------------------
echo -e "${YELLOW}Step 2: Requesting ACM Certificate...${NC}"

# Check if certificate already exists
EXISTING_CERT=$(aws acm list-certificates \
  --region $ACM_REGION \
  --profile $AWS_PROFILE \
  --query "CertificateSummaryList[?DomainName=='${DOMAIN}'].CertificateArn" \
  --output text)

if [ -n "$EXISTING_CERT" ]; then
  echo -e "${GREEN}Certificate already exists: ${EXISTING_CERT}${NC}"
  CERT_ARN=$EXISTING_CERT
else
  CERT_ARN=$(aws acm request-certificate \
    --domain-name $DOMAIN \
    --subject-alternative-names "*.${DOMAIN}" \
    --validation-method DNS \
    --region $ACM_REGION \
    --profile $AWS_PROFILE \
    --query 'CertificateArn' \
    --output text)

  echo -e "${GREEN}Certificate requested: ${CERT_ARN}${NC}"

  # Wait for certificate details to be available
  echo "Waiting for certificate details..."
  sleep 10
fi

echo ""

# -----------------------------------------------------------------------------
# Step 3: Get DNS Validation Records
# -----------------------------------------------------------------------------
echo -e "${YELLOW}Step 3: Getting DNS Validation Records...${NC}"

# Get validation options
VALIDATION_OPTIONS=$(aws acm describe-certificate \
  --certificate-arn $CERT_ARN \
  --region $ACM_REGION \
  --profile $AWS_PROFILE \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord')

VALIDATION_NAME=$(echo $VALIDATION_OPTIONS | jq -r '.Name')
VALIDATION_VALUE=$(echo $VALIDATION_OPTIONS | jq -r '.Value')

echo "Validation CNAME:"
echo "  Name:  $VALIDATION_NAME"
echo "  Value: $VALIDATION_VALUE"
echo ""

# -----------------------------------------------------------------------------
# Step 4: Create DNS Validation Record in Route 53
# -----------------------------------------------------------------------------
echo -e "${YELLOW}Step 4: Creating DNS Validation Record...${NC}"

aws route53 change-resource-record-sets \
  --hosted-zone-id $ZONE_ID \
  --profile $AWS_PROFILE \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"UPSERT\",
      \"ResourceRecordSet\": {
        \"Name\": \"${VALIDATION_NAME}\",
        \"Type\": \"CNAME\",
        \"TTL\": 300,
        \"ResourceRecords\": [{\"Value\": \"${VALIDATION_VALUE}\"}]
      }
    }]
  }" > /dev/null

echo -e "${GREEN}Validation record created${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 5: Wait for Certificate Validation
# -----------------------------------------------------------------------------
echo -e "${YELLOW}Step 5: Waiting for Certificate Validation...${NC}"
echo "This may take 5-30 minutes. Checking every 30 seconds..."

while true; do
  STATUS=$(aws acm describe-certificate \
    --certificate-arn $CERT_ARN \
    --region $ACM_REGION \
    --profile $AWS_PROFILE \
    --query 'Certificate.Status' \
    --output text)

  echo -n "  Status: $STATUS"

  if [ "$STATUS" == "ISSUED" ]; then
    echo -e " ${GREEN}✓${NC}"
    break
  elif [ "$STATUS" == "FAILED" ]; then
    echo -e " ${RED}✗${NC}"
    echo -e "${RED}Certificate validation failed!${NC}"
    exit 1
  else
    echo " (waiting...)"
    sleep 30
  fi
done

echo ""

# -----------------------------------------------------------------------------
# Step 6: Update CloudFront Distribution
# -----------------------------------------------------------------------------
echo -e "${YELLOW}Step 6: Updating CloudFront Distribution...${NC}"

# Get current distribution config
aws cloudfront get-distribution-config \
  --id $CLOUDFRONT_ID \
  --profile $AWS_PROFILE > /tmp/cf-config-full.json

ETAG=$(jq -r '.ETag' /tmp/cf-config-full.json)
echo "Current ETag: $ETAG"

# Extract and modify the distribution config
jq '.DistributionConfig' /tmp/cf-config-full.json > /tmp/cf-config.json

# Update the config with new domain and certificate
jq --arg domain "$DOMAIN" --arg cert "$CERT_ARN" '
  .Aliases = {
    "Quantity": 1,
    "Items": [$domain]
  } |
  .ViewerCertificate = {
    "ACMCertificateArn": $cert,
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021",
    "Certificate": $cert,
    "CertificateSource": "acm"
  }
' /tmp/cf-config.json > /tmp/cf-config-updated.json

# Update the distribution
aws cloudfront update-distribution \
  --id $CLOUDFRONT_ID \
  --if-match $ETAG \
  --distribution-config file:///tmp/cf-config-updated.json \
  --profile $AWS_PROFILE > /dev/null

echo -e "${GREEN}CloudFront distribution updated${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 7: Create Route 53 Alias Record
# -----------------------------------------------------------------------------
echo -e "${YELLOW}Step 7: Creating Route 53 Alias Record...${NC}"

# Get CloudFront domain name
CF_DOMAIN=$(aws cloudfront get-distribution \
  --id $CLOUDFRONT_ID \
  --profile $AWS_PROFILE \
  --query 'Distribution.DomainName' \
  --output text)

echo "CloudFront Domain: $CF_DOMAIN"

# Create A record alias for root domain
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

# Create A record alias for www subdomain
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

echo -e "${GREEN}DNS records created for ${DOMAIN} and www.${DOMAIN}${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 8: Wait for CloudFront Deployment
# -----------------------------------------------------------------------------
echo -e "${YELLOW}Step 8: Waiting for CloudFront Deployment...${NC}"
echo "This typically takes 10-15 minutes..."

while true; do
  CF_STATUS=$(aws cloudfront get-distribution \
    --id $CLOUDFRONT_ID \
    --profile $AWS_PROFILE \
    --query 'Distribution.Status' \
    --output text)

  echo -n "  Status: $CF_STATUS"

  if [ "$CF_STATUS" == "Deployed" ]; then
    echo -e " ${GREEN}✓${NC}"
    break
  else
    echo " (waiting...)"
    sleep 30
  fi
done

echo ""

# -----------------------------------------------------------------------------
# Complete!
# -----------------------------------------------------------------------------
echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN}=============================================${NC}"
echo ""
echo "Your site is now available at:"
echo -e "  ${BLUE}https://${DOMAIN}${NC}"
echo -e "  ${BLUE}https://www.${DOMAIN}${NC}"
echo ""
echo "DNS propagation may take a few more minutes."
echo "Test your site with: curl -I https://${DOMAIN}"
echo ""

# Cleanup temp files
rm -f /tmp/cf-config-full.json /tmp/cf-config.json /tmp/cf-config-updated.json
