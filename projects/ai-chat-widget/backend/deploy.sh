#!/bin/bash
# Deploy CoCreate Chat Lambda

set -e

PROFILE="cocreate"
REGION="us-east-1"
FUNCTION_NAME="ai-product-studio-chat"
ROLE_NAME="ai-product-studio-chat-role"

echo "=== CoCreate Chat Lambda Deployment ==="

# Check if Lambda function exists
FUNCTION_EXISTS=$(aws lambda get-function --function-name $FUNCTION_NAME --profile $PROFILE --region $REGION 2>&1 || true)

if echo "$FUNCTION_EXISTS" | grep -q "ResourceNotFoundException"; then
    echo "Creating new Lambda function..."

    # First, check if role exists
    ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --profile $PROFILE --query 'Role.Arn' --output text 2>/dev/null || true)

    if [ -z "$ROLE_ARN" ]; then
        echo "Creating IAM role..."

        # Create trust policy
        cat > /tmp/trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

        aws iam create-role \
            --role-name $ROLE_NAME \
            --assume-role-policy-document file:///tmp/trust-policy.json \
            --profile $PROFILE

        # Attach policies
        aws iam attach-role-policy \
            --role-name $ROLE_NAME \
            --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
            --profile $PROFILE

        aws iam attach-role-policy \
            --role-name $ROLE_NAME \
            --policy-arn arn:aws:iam::aws:policy/AmazonSNSFullAccess \
            --profile $PROFILE

        echo "Waiting for role to propagate..."
        sleep 10

        ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --profile $PROFILE --query 'Role.Arn' --output text)
    fi

    echo "Role ARN: $ROLE_ARN"

    # Install dependencies and create zip
    echo "Installing dependencies..."
    npm install

    echo "Creating deployment package..."
    zip -r function.zip . -x '*.git*' -x 'deploy.sh' -x '*.md' -x 'package-lock.json'

    # Create Lambda function
    echo "Creating Lambda function..."
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime nodejs20.x \
        --role $ROLE_ARN \
        --handler index.handler \
        --zip-file fileb://function.zip \
        --timeout 30 \
        --memory-size 256 \
        --environment "Variables={ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY},OPENAI_API_KEY=${OPENAI_API_KEY},SMS_PHONE_NUMBERS=${SMS_PHONE_NUMBERS:-}}" \
        --profile $PROFILE \
        --region $REGION

    # Create Function URL
    echo "Creating Function URL..."
    aws lambda create-function-url-config \
        --function-name $FUNCTION_NAME \
        --auth-type NONE \
        --cors '{"AllowOrigins":["*"],"AllowMethods":["POST","OPTIONS"],"AllowHeaders":["Content-Type"]}' \
        --profile $PROFILE \
        --region $REGION

    # Add permission for public access
    aws lambda add-permission \
        --function-name $FUNCTION_NAME \
        --statement-id FunctionURLAllowPublicAccess \
        --action lambda:InvokeFunctionUrl \
        --principal "*" \
        --function-url-auth-type NONE \
        --profile $PROFILE \
        --region $REGION

else
    echo "Updating existing Lambda function..."

    # Install dependencies and create zip
    echo "Installing dependencies..."
    npm install

    echo "Creating deployment package..."
    zip -r function.zip . -x '*.git*' -x 'deploy.sh' -x '*.md' -x 'package-lock.json'

    # Update function code
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://function.zip \
        --profile $PROFILE \
        --region $REGION

    # Update environment variables
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --environment "Variables={ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY},OPENAI_API_KEY=${OPENAI_API_KEY},SMS_PHONE_NUMBERS=${SMS_PHONE_NUMBERS:-}}" \
        --profile $PROFILE \
        --region $REGION
fi

# Get Function URL
echo ""
echo "=== Deployment Complete ==="
FUNCTION_URL=$(aws lambda get-function-url-config --function-name $FUNCTION_NAME --profile $PROFILE --region $REGION --query 'FunctionUrl' --output text 2>/dev/null || echo "")

if [ -n "$FUNCTION_URL" ]; then
    echo "Function URL: $FUNCTION_URL"
    echo ""
    echo "Update your chat widget with this URL!"
else
    echo "Function URL not found. Creating..."
    aws lambda create-function-url-config \
        --function-name $FUNCTION_NAME \
        --auth-type NONE \
        --cors '{"AllowOrigins":["*"],"AllowMethods":["POST","OPTIONS"],"AllowHeaders":["Content-Type"]}' \
        --profile $PROFILE \
        --region $REGION

    FUNCTION_URL=$(aws lambda get-function-url-config --function-name $FUNCTION_NAME --profile $PROFILE --region $REGION --query 'FunctionUrl' --output text)
    echo "Function URL: $FUNCTION_URL"
fi

# Cleanup
rm -f function.zip
echo ""
echo "Done!"
