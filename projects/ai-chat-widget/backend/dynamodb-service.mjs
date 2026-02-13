/**
 * DynamoDB Service for CoCreate Projects
 * Tracks user projects and their AWS resources through the deployment lifecycle
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand
} from '@aws-sdk/lib-dynamodb';

// Configuration
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const PROJECTS_TABLE = process.env.PROJECTS_TABLE || 'cocreate-projects';

// Initialize DynamoDB client
const ddbClient = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

/**
 * Generate a resource prefix for AWS resources
 * Format: cocreate-{user-short}-{project-slug}
 */
export function generateResourcePrefix(userId, projectName) {
  const userIdShort = userId.substring(0, 6).toLowerCase();
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
  return `cocreate-${userIdShort}-${slug}`;
}

/**
 * Project statuses
 */
export const ProjectStatus = {
  PENDING: 'pending',
  BUILDING: 'building',
  DEPLOYED: 'deployed',
  FAILED: 'failed',
  TERMINATED: 'terminated'
};

/**
 * Resource statuses
 */
export const ResourceStatus = {
  CREATING: 'creating',
  ACTIVE: 'active',
  UPDATING: 'updating',
  DELETING: 'deleting',
  DELETED: 'deleted',
  FAILED: 'failed'
};

/**
 * Create a new project record
 */
export async function createProject({ userId, projectId, projectName, projectType = 'frontend' }) {
  const now = new Date().toISOString();
  const resourcePrefix = generateResourcePrefix(userId, projectName);

  const project = {
    userId,
    projectId,
    projectName,
    projectType,
    resourcePrefix,
    status: ProjectStatus.PENDING,
    createdAt: now,
    updatedAt: now,
    awsResources: {
      s3Bucket: null,
      cloudfront: null,
      lambda: [],
      apiGateway: null
    },
    deploymentUrl: null,
    buildOutput: {
      prototypeUrl: null,
      screenshotUrl: null,
      logs: []
    }
  };

  await docClient.send(new PutCommand({
    TableName: PROJECTS_TABLE,
    Item: project,
    ConditionExpression: 'attribute_not_exists(userId) AND attribute_not_exists(projectId)'
  }));

  return project;
}

/**
 * Get all projects for a user
 */
export async function getUserProjects(userId, statusFilter = null) {
  const params = {
    TableName: PROJECTS_TABLE,
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId
    }
  };

  // Filter by status if provided
  if (statusFilter) {
    params.FilterExpression = '#status = :status';
    params.ExpressionAttributeNames = { '#status': 'status' };
    params.ExpressionAttributeValues[':status'] = statusFilter;
  }

  const result = await docClient.send(new QueryCommand(params));
  return result.Items || [];
}

/**
 * Get a single project by userId and projectId
 */
export async function getProject(userId, projectId) {
  const result = await docClient.send(new GetCommand({
    TableName: PROJECTS_TABLE,
    Key: { userId, projectId }
  }));

  return result.Item || null;
}

/**
 * Get a project by resource prefix (using GSI2)
 */
export async function getProjectByResourcePrefix(resourcePrefix) {
  const result = await docClient.send(new QueryCommand({
    TableName: PROJECTS_TABLE,
    IndexName: 'GSI2-resourcePrefix',
    KeyConditionExpression: 'resourcePrefix = :prefix',
    ExpressionAttributeValues: {
      ':prefix': resourcePrefix
    }
  }));

  return result.Items?.[0] || null;
}

/**
 * Update project status
 */
export async function updateProjectStatus(userId, projectId, status, deploymentUrl = null) {
  const now = new Date().toISOString();

  const updateExpr = ['#status = :status', 'updatedAt = :updatedAt'];
  const exprAttrNames = { '#status': 'status' };
  const exprAttrValues = {
    ':status': status,
    ':updatedAt': now
  };

  if (deploymentUrl) {
    updateExpr.push('deploymentUrl = :deploymentUrl');
    exprAttrValues[':deploymentUrl'] = deploymentUrl;
  }

  const result = await docClient.send(new UpdateCommand({
    TableName: PROJECTS_TABLE,
    Key: { userId, projectId },
    UpdateExpression: `SET ${updateExpr.join(', ')}`,
    ExpressionAttributeNames: exprAttrNames,
    ExpressionAttributeValues: exprAttrValues,
    ReturnValues: 'ALL_NEW'
  }));

  return result.Attributes;
}

/**
 * Add or update an AWS resource for a project
 */
export async function addProjectResource(userId, projectId, resourceType, resourceData) {
  const now = new Date().toISOString();

  // Handle lambda array separately
  if (resourceType === 'lambda') {
    const result = await docClient.send(new UpdateCommand({
      TableName: PROJECTS_TABLE,
      Key: { userId, projectId },
      UpdateExpression: 'SET awsResources.#resType = list_append(if_not_exists(awsResources.#resType, :emptyList), :resourceData), updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#resType': resourceType },
      ExpressionAttributeValues: {
        ':resourceData': [{ ...resourceData, createdAt: now, status: ResourceStatus.CREATING }],
        ':emptyList': [],
        ':updatedAt': now
      },
      ReturnValues: 'ALL_NEW'
    }));
    return result.Attributes;
  }

  // Handle single resources (s3Bucket, cloudfront, apiGateway)
  const result = await docClient.send(new UpdateCommand({
    TableName: PROJECTS_TABLE,
    Key: { userId, projectId },
    UpdateExpression: 'SET awsResources.#resType = :resourceData, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#resType': resourceType },
    ExpressionAttributeValues: {
      ':resourceData': { ...resourceData, createdAt: now, status: ResourceStatus.CREATING },
      ':updatedAt': now
    },
    ReturnValues: 'ALL_NEW'
  }));

  return result.Attributes;
}

/**
 * Update an existing AWS resource status
 */
export async function updateProjectResource(userId, projectId, resourceType, resourceUpdate) {
  const now = new Date().toISOString();

  // For lambda functions, we need to find and update by functionName
  if (resourceType === 'lambda' && resourceUpdate.functionName) {
    // Get current project to find lambda index
    const project = await getProject(userId, projectId);
    if (!project) throw new Error('Project not found');

    const lambdaIndex = project.awsResources.lambda.findIndex(
      l => l.functionName === resourceUpdate.functionName
    );
    if (lambdaIndex === -1) throw new Error('Lambda function not found');

    const result = await docClient.send(new UpdateCommand({
      TableName: PROJECTS_TABLE,
      Key: { userId, projectId },
      UpdateExpression: `SET awsResources.#resType[${lambdaIndex}].#status = :status, awsResources.#resType[${lambdaIndex}].updatedAt = :updatedAt, updatedAt = :projectUpdatedAt`,
      ExpressionAttributeNames: {
        '#resType': resourceType,
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': resourceUpdate.status,
        ':updatedAt': now,
        ':projectUpdatedAt': now
      },
      ReturnValues: 'ALL_NEW'
    }));
    return result.Attributes;
  }

  // For single resources, merge the update
  const result = await docClient.send(new UpdateCommand({
    TableName: PROJECTS_TABLE,
    Key: { userId, projectId },
    UpdateExpression: 'SET awsResources.#resType.#status = :status, awsResources.#resType.updatedAt = :updatedAt, updatedAt = :projectUpdatedAt',
    ExpressionAttributeNames: {
      '#resType': resourceType,
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': resourceUpdate.status,
      ':updatedAt': now,
      ':projectUpdatedAt': now
    },
    ReturnValues: 'ALL_NEW'
  }));

  return result.Attributes;
}

/**
 * Update build output (prototype URL, screenshots, logs)
 */
export async function updateBuildOutput(userId, projectId, buildOutput) {
  const now = new Date().toISOString();

  const result = await docClient.send(new UpdateCommand({
    TableName: PROJECTS_TABLE,
    Key: { userId, projectId },
    UpdateExpression: 'SET buildOutput = :buildOutput, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':buildOutput': buildOutput,
      ':updatedAt': now
    },
    ReturnValues: 'ALL_NEW'
  }));

  return result.Attributes;
}

/**
 * Append a log entry to build output
 */
export async function appendBuildLog(userId, projectId, logEntry) {
  const now = new Date().toISOString();

  const result = await docClient.send(new UpdateCommand({
    TableName: PROJECTS_TABLE,
    Key: { userId, projectId },
    UpdateExpression: 'SET buildOutput.logs = list_append(if_not_exists(buildOutput.logs, :emptyList), :logEntry), updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':logEntry': [{ timestamp: now, ...logEntry }],
      ':emptyList': [],
      ':updatedAt': now
    },
    ReturnValues: 'ALL_NEW'
  }));

  return result.Attributes;
}

/**
 * Soft delete a project (set status to terminated)
 */
export async function deleteProject(userId, projectId) {
  return updateProjectStatus(userId, projectId, ProjectStatus.TERMINATED);
}

/**
 * Hard delete a project (actually remove from database)
 * Use with caution - prefer soft delete
 */
export async function hardDeleteProject(userId, projectId) {
  await docClient.send(new DeleteCommand({
    TableName: PROJECTS_TABLE,
    Key: { userId, projectId }
  }));

  return { deleted: true, userId, projectId };
}

/**
 * Get projects by status (using GSI1)
 */
export async function getProjectsByStatus(status, limit = 50) {
  const result = await docClient.send(new QueryCommand({
    TableName: PROJECTS_TABLE,
    IndexName: 'GSI1-status-createdAt',
    KeyConditionExpression: '#status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': status },
    Limit: limit,
    ScanIndexForward: false // newest first
  }));

  return result.Items || [];
}

/**
 * Get all AWS resources for a project (flattened list)
 */
export async function getProjectResources(userId, projectId) {
  const project = await getProject(userId, projectId);
  if (!project) return null;

  const resources = [];
  const { awsResources } = project;

  if (awsResources.s3Bucket) {
    resources.push({ type: 's3Bucket', ...awsResources.s3Bucket });
  }
  if (awsResources.cloudfront) {
    resources.push({ type: 'cloudfront', ...awsResources.cloudfront });
  }
  if (awsResources.apiGateway) {
    resources.push({ type: 'apiGateway', ...awsResources.apiGateway });
  }
  if (awsResources.lambda && awsResources.lambda.length > 0) {
    awsResources.lambda.forEach(fn => {
      resources.push({ type: 'lambda', ...fn });
    });
  }

  return resources;
}

export default {
  generateResourcePrefix,
  ProjectStatus,
  ResourceStatus,
  createProject,
  getUserProjects,
  getProject,
  getProjectByResourcePrefix,
  updateProjectStatus,
  addProjectResource,
  updateProjectResource,
  updateBuildOutput,
  appendBuildLog,
  deleteProject,
  hardDeleteProject,
  getProjectsByStatus,
  getProjectResources
};
