'use strict'

// identity.js related

export const IDENTITY_PASSWORD_MIN_CHARS = 7
export const IDENTITY_USERNAME_MAX_CHARS = 80

// group.js related

export const INVITE_INITIAL_CREATOR = 'invite-initial-creator'
export const PROFILE_STATUS = {
  ACTIVE: 'active', // confirmed group join
  PENDING: 'pending', // shortly after being approved to join the group
  REMOVED: 'removed'
}

export const PROPOSAL_RESULT = 'proposal-result'
export const PROPOSAL_INVITE_MEMBER = 'invite-member'
export const PROPOSAL_REMOVE_MEMBER = 'remove-member'
export const PROPOSAL_GROUP_SETTING_CHANGE = 'group-setting-change'
export const PROPOSAL_PROPOSAL_SETTING_CHANGE = 'proposal-setting-change'
export const PROPOSAL_GENERIC = 'generic'

export const PROPOSAL_ARCHIVED = 'proposal-archived'
export const MAX_ARCHIVED_PROPOSALS = 100
export const PAYMENTS_ARCHIVED = 'payments-archived'
export const MAX_ARCHIVED_PERIODS = 100
export const MAX_SAVED_PERIODS = 2
export const MAX_HISTORY_PERIODS = 6

export const STATUS_OPEN = 'open'
export const STATUS_PASSED = 'passed'
export const STATUS_FAILED = 'failed'
export const STATUS_EXPIRED = 'expired'
export const STATUS_CANCELLED = 'cancelled'

export const STREAK_ON_TIME_PAYMENTS = 1
export const STREAK_MISSED_PAYMENTS = 2
export const STREAK_MISSED_PROPSAL_VOTE = 2
export const STREAK_NOT_LOGGED_IN_DAYS = 14

// chatroom.js related

export const CHATROOM_GENERAL_NAME = 'General'
export const CHATROOM_NAME_LIMITS_IN_CHARS = 50
export const CHATROOM_DESCRIPTION_LIMITS_IN_CHARS = 280
export const CHATROOM_ACTIONS_PER_PAGE = 40
export const CHATROOM_MAX_ARCHIVE_ACTION_PAGES = 2 // 2 pages of actions

// chatroom events
export const CHATROOM_MESSAGE_ACTION = 'chatroom-message-action'
export const MESSAGE_RECEIVE = 'message-receive'
export const MESSAGE_SEND = 'message-send'

export const CHATROOM_TYPES = {
  INDIVIDUAL: 'individual',
  GROUP: 'group'
}

export const CHATROOM_PRIVACY_LEVEL = {
  GROUP: 'group',
  PRIVATE: 'private',
  PUBLIC: 'public'
}

export const MESSAGE_TYPES = {
  POLL: 'poll',
  TEXT: 'text',
  INTERACTIVE: 'interactive',
  NOTIFICATION: 'notification'
}

export const INVITE_EXPIRES_IN_DAYS = {
  ON_BOARDING: 30,
  PROPOSAL: 7
}

export const MESSAGE_NOTIFICATIONS = {
  ADD_MEMBER: 'add-member',
  JOIN_MEMBER: 'join-member',
  LEAVE_MEMBER: 'leave-member',
  KICK_MEMBER: 'kick-member',
  UPDATE_DESCRIPTION: 'update-description',
  UPDATE_NAME: 'update-name',
  DELETE_CHANNEL: 'delete-channel',
  VOTE: 'vote'
}

export const MESSAGE_VARIANTS = {
  PENDING: 'pending',
  SENT: 'sent',
  RECEIVED: 'received',
  FAILED: 'failed'
}

export const PROPOSAL_VARIANTS = {
  CREATED: 'created',
  EXPIRING: 'expiring',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  EXPIRED: 'expired'
}

export const MESSAGE_NOTIFY_SETTINGS = {
  ALL_MESSAGES: 'all-messages',
  DIRECT_MESSAGES: 'direct-messages',
  NOTHING: 'nothing'
}

export const POLL_TYPES = {
  SINGLE_CHOICE: 'single-vote', // allows only 1 choice per member
  MULTIPLE_CHOICES: 'multiple-votes' // allows multiple choices on the poll
}

export const POLL_STATUS = {
  ACTIVE: 'active', // the poll is open
  CLOSED: 'closed', // everyone has voted on the poll
  EXPIRED: 'expired' // not everyone has voted on the poll but it has expired
}
