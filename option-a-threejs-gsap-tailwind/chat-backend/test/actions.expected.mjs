// Canonical action list captured from index.mjs BEFORE the refactor (git baseline).
// The merged router registry must cover EXACTLY these. Do not edit during refactor.
export const EXPECTED_ACTIONS = [
  'admin-build-detail', 'admin-builds', 'admin-chat-detail', 'admin-chats',
  'admin-client-detail', 'admin-clients', 'admin-costs-summary', 'admin-delete-chats',
  'admin-list', 'admin-login', 'admin-progress', 'admin-update',
  'aws-activity-email-report', 'aws-activity-log', 'aws-cost-daily', 'aws-cost-daily-by-project',
  'aws-cost-daily-by-service', 'aws-cost-dashboard-batch', 'aws-cost-forecast', 'aws-cost-service-detail',
  'aws-cost-storage-batch', 'aws-cost-summary', 'aws-delete-resource', 'aws-project-costs',
  'aws-project-costs-dynamic', 'aws-s3-analysis', 'aws-s3-browse', 'aws-s3-delete',
  'aws-unused-resources', 'check-duplicate', 'event-list-registrations', 'event-register',
  'forgot-password', 'get-admin-summary', 'get-tmux-projects', 'lookup-session',
  'reset-password', 'save-abandoned-form', 'save-theme', 'scheduled-re-engagement',
  'scheduled-session-expiry', 'scheduled-weekly-digest', 'send-admin-report', 'send-all-reports',
  'send-cost-reports', 'sync-state', 'update-build-status', 'update-email-preferences',
  'upload-avatar', 'user-change-password', 'user-check', 'user-costs',
  'user-dashboard', 'user-login', 'user-signup',
];
