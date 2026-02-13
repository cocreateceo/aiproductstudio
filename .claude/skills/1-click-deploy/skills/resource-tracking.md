# AWS Resource Tracking

## Purpose
Track all AWS resources created during 1-click-deploy to enable:
- Resource inventory and monitoring
- Cost tracking per project
- Clean rollback on failure
- Resource lifecycle management

## DynamoDB Table Schema

### Table: `cocreate-projects`

```
Primary Key: userId (String) - Cognito sub/GUID
Sort Key: projectId (String) - Tmux session GUID
```

### Core Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `projectName` | String | Human-readable project name |
| `projectType` | String | "frontend" or "fullstack" |
| `resourcePrefix` | String | AWS resource naming prefix |
| `status` | String | Project deployment status |
| `createdAt` | String | ISO timestamp |
| `updatedAt` | String | ISO timestamp |
| `deploymentUrl` | String | Final CloudFront URL |

### Status Values

| Status | Description |
|--------|-------------|
| `pending` | Project created, not yet deployed |
| `building` | Deployment in progress |
| `deployed` | Successfully deployed and live |
| `failed` | Deployment failed (may have partial resources) |
| `terminated` | Soft-deleted, resources may be cleaned up |

### AWS Resources Map

```json
{
  "awsResources": {
    "s3Bucket": {
      "name": "cocreate-a1b2c3-my-app",
      "arn": "arn:aws:s3:::cocreate-a1b2c3-my-app",
      "region": "us-east-1",
      "status": "active",
      "createdAt": "2024-01-15T10:30:00Z"
    },
    "cloudfront": {
      "distributionId": "EDFDVBD6EXAMPLE",
      "domainName": "d111111abcdef8.cloudfront.net",
      "status": "deployed",
      "createdAt": "2024-01-15T10:35:00Z"
    },
    "lambda": [
      {
        "functionName": "cocreate-a1b2c3-my-app-api",
        "arn": "arn:aws:lambda:us-east-1:123456789:function:...",
        "status": "active"
      }
    ],
    "apiGateway": {
      "apiId": "abc123def",
      "endpoint": "https://abc123def.execute-api.us-east-1.amazonaws.com",
      "stage": "prod",
      "status": "active"
    }
  }
}
```

### Build Output

```json
{
  "buildOutput": {
    "prototypeUrl": "http://localhost:5173",
    "screenshotUrl": "s3://cocreate-screenshots/...",
    "logs": [
      {"timestamp": "...", "level": "info", "message": "Build started"},
      {"timestamp": "...", "level": "info", "message": "Dependencies installed"},
      {"timestamp": "...", "level": "info", "message": "Build completed"}
    ]
  }
}
```

## Global Secondary Indexes

### GSI1: Status + CreatedAt
- **Purpose**: Query projects by status (e.g., all failed deployments)
- **Partition Key**: `status`
- **Sort Key**: `createdAt`

### GSI2: Resource Prefix
- **Purpose**: Look up project by AWS resource name
- **Partition Key**: `resourcePrefix`

## Resource Naming Convention

All AWS resources follow the pattern:
```
cocreate-{user_id_short}-{project_slug}
```

Where:
- `user_id_short`: First 6 characters of Cognito user ID (lowercase)
- `project_slug`: Project name, lowercase, non-alphanumeric replaced with hyphens, max 30 chars

Examples:
- User: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
- Project: "My Awesome App"
- Result: `cocreate-a1b2c3-my-awesome-app`

## API Endpoints

### Create Project
```
POST /api
{
  "action": "create-project",
  "userId": "cognito-user-guid",
  "projectId": "tmux-session-guid",
  "projectName": "My App",
  "projectType": "frontend"
}
```

### Get User Projects
```
POST /api
{
  "action": "get-user-projects",
  "userId": "cognito-user-guid",
  "statusFilter": "deployed"  // optional
}
```

### Get Single Project
```
POST /api
{
  "action": "get-project",
  "userId": "cognito-user-guid",
  "projectId": "tmux-session-guid"
}
```

### Update Project Status
```
POST /api
{
  "action": "update-project-status",
  "userId": "cognito-user-guid",
  "projectId": "tmux-session-guid",
  "status": "deployed",
  "deploymentUrl": "https://d111111abcdef8.cloudfront.net"
}
```

### Add Project Resource
```
POST /api
{
  "action": "add-project-resource",
  "userId": "cognito-user-guid",
  "projectId": "tmux-session-guid",
  "resourceType": "s3Bucket",
  "resourceData": {
    "name": "cocreate-a1b2c3-my-app",
    "arn": "arn:aws:s3:::cocreate-a1b2c3-my-app",
    "region": "us-east-1"
  }
}
```

### Update Project Resource
```
POST /api
{
  "action": "update-project-resource",
  "userId": "cognito-user-guid",
  "projectId": "tmux-session-guid",
  "resourceType": "cloudfront",
  "resourceUpdate": {
    "status": "deployed"
  }
}
```

### Delete Project (Soft Delete)
```
POST /api
{
  "action": "delete-project",
  "userId": "cognito-user-guid",
  "projectId": "tmux-session-guid"
}
```

## Deployment Workflow Integration

### Phase Tracking

1. **Build Complete** (from Tmux Builder)
   - Call `create-project` with status "pending"

2. **Deployment Started**
   - Call `update-project-status` with status "building"

3. **S3 Bucket Created**
   - Call `add-project-resource` with type "s3Bucket"

4. **CloudFront Created**
   - Call `add-project-resource` with type "cloudfront"

5. **Deployment Complete**
   - Call `update-project-status` with status "deployed" and deploymentUrl

6. **Deployment Failed**
   - Call `update-project-status` with status "failed"
   - Trigger rollback

## Rollback Process

On deployment failure:

1. Query project to get all resources
2. Delete resources in reverse creation order:
   - CloudFront distribution (disable first, then delete)
   - API Gateway
   - Lambda functions
   - S3 bucket (empty first, then delete)
3. Update each resource status to "deleted"
4. Update project status to "failed"

## Cost Optimization

### DynamoDB
- Use on-demand capacity for pay-per-request billing
- Enable TTL on terminated projects for automatic cleanup

### CloudFront
- Use PriceClass_100 (US, Canada, Europe only) for lower costs
- Enable compression

### S3
- Enable versioning for rollback support
- Set lifecycle policies to delete old versions after 30 days

## Verification Checklist

- [ ] DynamoDB table created with correct schema
- [ ] GSIs created and active
- [ ] IAM permissions updated for Lambda role
- [ ] API endpoints return correct responses
- [ ] Resource creation tracked correctly
- [ ] Rollback cleans up all resources
- [ ] Status transitions work correctly
- [ ] CloudFront URL accessible after deployment
