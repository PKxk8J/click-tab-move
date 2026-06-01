const {
  i18n,
  storage,
} = browser

export const KEY_DEBUG = 'debug'
export const KEY_NAME = 'name'

export const KEY_TAB = 'tab'
export const KEY_ALL = 'all'

export const KEY_ONE = 'one'
export const KEY_RIGHT = 'right'
export const KEY_THIS_AND_RIGHT = 'thisAndRight'
export const KEY_LEFT = 'left'
export const KEY_THIS_AND_LEFT = 'thisAndLeft'
export const KEY_SELECT = 'select'
export const KEY_RAW = 'raw'
export const KEY_TARGET_GLOBAL = 'global'
export const KEY_TARGET_GROUP = 'group'

export const KEY_MOVE = 'move'
export const KEY_MOVE_X = 'moveX'
export const KEY_MOVE_TO_X = 'moveToX'
export const KEY_NEW_WINDOW = 'newWindow'
export const KEY_NEW_GROUP = 'newGroup'
export const KEY_CANCEL = 'cancel'
export const KEY_TO_WINDOW_ID = 'toWindowId'
export const KEY_DESTINATION = 'destination'
export const KEY_TARGET_SCOPE = 'targetScope'
export const KEY_GROUP_ID = 'groupId'
export const KEY_REQUEST_ID = 'requestId'

export const KEY_CONTEXTS = 'contexts'
export const KEY_MENU_ITEMS = 'menuItems'
export const KEY_SELECT_SIZE = 'selectSize'
export const KEY_WIDTH = 'width'
export const KEY_HEIGHT = 'height'
export const KEY_SELECT_SAVE = 'selectSave'
export const KEY_NOTIFICATION = 'notification'
export const KEY_FOCUS = 'focus'
export const KEY_PINNED_GROUP_ACTION = 'pinnedGroupAction'
export const KEY_SETTINGS = 'settings'
export const KEY_FEEDBACK = 'feedback'
export const KEY_BEHAVIOR = 'behavior'
export const KEY_SAVE_STATUS_FAILED = 'saveStatusFailed'
export const KEY_SAVE_STATUS_SAVED = 'saveStatusSaved'
export const KEY_SAVE_STATUS_SAVING = 'saveStatusSaving'

export const KEY_MOVING = 'moving'
export const KEY_PROGRESS = 'progress'
export const KEY_SUCCESS_MESSAGE = 'successMessage'
export const KEY_FAILURE_MESSAGE = 'failureMessage'
export const KEY_RESET = 'reset'
export const KEY_PINNED_GROUP_DECISION = 'pinnedGroupDecision'
export const KEY_PINNED_GROUP_ASK = 'ask'
export const KEY_PINNED_GROUP_SKIP = 'skipPinned'
export const KEY_PINNED_GROUP_UNPIN = 'unpinPinned'
export const KEY_PINNED_GROUP_CANCEL = 'cancelPinned'

export const ALL_CONTEXTS = [KEY_TAB, KEY_ALL]
export const DEFAULT_CONTEXTS = [KEY_TAB]
export const ALL_MENU_ITEMS = [
  KEY_ONE,
  KEY_RIGHT,
  KEY_THIS_AND_RIGHT,
  KEY_LEFT,
  KEY_THIS_AND_LEFT,
  KEY_ALL,
  KEY_SELECT,
]
export const GLOBAL_MENU_ITEMS = [
  KEY_ONE,
  KEY_RIGHT,
  KEY_THIS_AND_RIGHT,
  KEY_LEFT,
  KEY_THIS_AND_LEFT,
  KEY_ALL,
  KEY_SELECT,
]
export const GROUP_MENU_ITEMS = [
  KEY_ONE,
  KEY_RIGHT,
  KEY_THIS_AND_RIGHT,
  KEY_LEFT,
  KEY_THIS_AND_LEFT,
  KEY_SELECT,
]
export const ALL_MENU_SCOPES = [KEY_TARGET_GLOBAL, KEY_TARGET_GROUP]
export const MENU_ITEMS_BY_SCOPE = {
  [KEY_TARGET_GLOBAL]: GLOBAL_MENU_ITEMS,
  [KEY_TARGET_GROUP]: GROUP_MENU_ITEMS,
}
export const DEFAULT_MENU_ITEMS = {
  [KEY_ONE]: [KEY_TARGET_GLOBAL],
  [KEY_RIGHT]: [KEY_TARGET_GLOBAL],
  [KEY_ALL]: [KEY_TARGET_GLOBAL],
}
export const DEFAULT_SELECT_SIZE = [640, 480]
export const DEFAULT_SELECT_SAVE = true
export const DEFAULT_NOTIFICATION = false
export const DEFAULT_FOCUS = false
export const DEFAULT_PINNED_GROUP_ACTION = KEY_PINNED_GROUP_ASK
export const ALL_PINNED_GROUP_ACTIONS = [
  KEY_PINNED_GROUP_ASK,
  KEY_PINNED_GROUP_SKIP,
  KEY_PINNED_GROUP_UNPIN,
]

export const NOTIFICATION_PERMISSION = {
  permissions: ['notifications'],
}
export const NOTIFICATION_ID = i18n.getMessage(KEY_NAME)
export const NOTIFICATION_INTERVAL = 10 * 1000
export const POLLING_INTERVAL = 300
export const BULK_SIZE = 5
export const DEBUG = (i18n.getMessage(KEY_DEBUG) === 'debug')

export const storageArea = storage.sync

export function debug (message) {
  if (DEBUG) {
    console.log(message)
  }
}

export function onError (error) {
  console.error(error)
}

export async function asleep (msec) {
  return new Promise(resolve => setTimeout(resolve, msec))
}

export async function getValue (key, defaultValue) {
  const {
    [key]: value = defaultValue,
  } = await storageArea.get(key)
  return value
}

function cloneKeys (keys) {
  return [...keys]
}

function cloneMenuItems (menuItems) {
  const normalized = {}
  for (const key of ALL_MENU_ITEMS) {
    const scopes = menuItems[key]
    if (Array.isArray(scopes) && scopes.length > 0) {
      normalized[key] = [...scopes]
    }
  }
  return normalized
}

export function normalizeContexts (contexts) {
  if (contexts === undefined) {
    return cloneKeys(DEFAULT_CONTEXTS)
  }

  if (!Array.isArray(contexts)) {
    return []
  }

  return ALL_CONTEXTS.filter((key) => contexts.includes(key))
}

export function normalizeMenuItems (menuItems) {
  if (menuItems === undefined) {
    return cloneMenuItems(DEFAULT_MENU_ITEMS)
  }

  if (Array.isArray(menuItems)) {
    const normalized = {}
    for (const key of ALL_MENU_ITEMS) {
      if (menuItems.includes(key)) {
        normalized[key] = [KEY_TARGET_GLOBAL]
      }
    }
    return normalized
  }

  if (!menuItems || typeof menuItems !== 'object') {
    return {}
  }

  const normalized = {}
  for (const key of ALL_MENU_ITEMS) {
    const scopes = menuItems[key]
    if (!Array.isArray(scopes)) {
      continue
    }

    const normalizedScopes = ALL_MENU_SCOPES.
      filter((scope) => scopes.includes(scope)).
      filter((scope) => MENU_ITEMS_BY_SCOPE[scope].includes(key))
    if (normalizedScopes.length > 0) {
      normalized[key] = normalizedScopes
    }
  }
  return normalized
}

function normalizeBoolean (value, defaultValue) {
  if (value === undefined) {
    return defaultValue
  }
  return value === true
}

export function normalizeSelectSave (selectSave) {
  return normalizeBoolean(selectSave, DEFAULT_SELECT_SAVE)
}

export function normalizeNotification (notification) {
  return normalizeBoolean(notification, DEFAULT_NOTIFICATION)
}

export function normalizeFocus (focus) {
  return normalizeBoolean(focus, DEFAULT_FOCUS)
}

export function normalizePinnedGroupAction (action) {
  if (ALL_PINNED_GROUP_ACTIONS.includes(action)) {
    return action
  }
  return DEFAULT_PINNED_GROUP_ACTION
}

export function normalizeSelectSize (selectSize) {
  if (!Array.isArray(selectSize) || selectSize.length < 2) {
    return cloneKeys(DEFAULT_SELECT_SIZE)
  }

  const width = Number(selectSize[0])
  const height = Number(selectSize[1])
  if (!Number.isFinite(width) || !Number.isFinite(height) ||
      width <= 0 || height <= 0) {
    return cloneKeys(DEFAULT_SELECT_SIZE)
  }

  return [Math.round(width), Math.round(height)]
}

export function toContextLabelKey (key) {
  return 'context' + key.charAt(0).toUpperCase() + key.slice(1)
}
