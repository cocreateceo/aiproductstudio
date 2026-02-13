#!/bin/bash
# Create DynamoDB table for CoCreate Projects
# Run this script with AWS CLI configured

TABLE_NAME="cocreate-projects"
REGION="us-east-1"

echo "Creating DynamoDB table: $TABLE_NAME"

aws dynamodb create-table \
    --table-name $TABLE_NAME \
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
    --region $REGION

echo "Waiting for table to be active..."
aws dynamodb wait table-exists --table-name $TABLE_NAME --region $REGION

echo "Table created successfully!"

# Add TTL for automatic cleanup of terminated projects (optional)
# aws dynamodb update-time-to-live \
#     --table-name $TABLE_NAME \
#     --time-to-live-specification "Enabled=true,AttributeName=ttl" \
#     --region $REGION
