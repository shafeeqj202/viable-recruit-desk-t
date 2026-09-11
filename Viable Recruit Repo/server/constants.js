// Shared domain constants — mirrored in public/app.js for the client.

const JOB_STATUSES = ['Open', 'On Hold', 'Closed'];
const JOB_PRIORITIES = ['Low', 'Medium', 'High', 'Very High'];
const WORK_RIGHTS_OPTIONS = [
  'Citizen', 'Permanent Resident', 'Work Visa (no sponsorship needed)',
  'Requires Sponsorship', 'Any / Unspecified',
];
const ENGAGEMENT_TYPES = ['Contract', 'Permanent'];
const LOCATION_TYPES = ['Onshore', 'Offshore'];
const RESUME_MAX_BYTES = 3 * 1024 * 1024;

const CANDIDATE_STATUS_KEYS = [
  'Shortlisted', 'Screened', 'Screen Reject', 'L1 Select', 'L1 Reject',
  'L2 Select', 'L2 Reject', 'Client Interview Scheduled', 'Client Select',
  'Client Reject', 'Selected', 'Offered', 'Onboarded',
];

const STATUS_FLOW = {
  'Shortlisted': ['Screened', 'Screen Reject'],
  'Screened': ['L1 Select', 'L1 Reject'],
  'Screen Reject': [],
  'L1 Select': ['L2 Select', 'L2 Reject'],
  'L1 Reject': [],
  'L2 Select': ['Client Interview Scheduled'],
  'L2 Reject': [],
  'Client Interview Scheduled': ['Client Select', 'Client Reject'],
  'Client Select': ['Selected'],
  'Client Reject': [],
  'Selected': ['Offered'],
  'Offered': ['Onboarded'],
  'Onboarded': [],
};

const TERMINAL_STATUSES = {
  'Screen Reject': 1, 'L1 Reject': 1, 'L2 Reject': 1, 'Client Reject': 1, 'Onboarded': 1,
};

module.exports = {
  JOB_STATUSES, JOB_PRIORITIES, WORK_RIGHTS_OPTIONS, ENGAGEMENT_TYPES, LOCATION_TYPES,
  RESUME_MAX_BYTES, CANDIDATE_STATUS_KEYS, STATUS_FLOW, TERMINAL_STATUSES,
};
