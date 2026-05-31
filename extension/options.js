import {
  ALL_CONTEXTS,
  ALL_MENU_ITEMS,
  ALL_MENU_SCOPES,
  DEFAULT_FOCUS,
  DEFAULT_NOTIFICATION,
  DEFAULT_SELECT_SAVE,
  DEFAULT_SELECT_SIZE,
  KEY_BEHAVIOR,
  KEY_CONTEXTS,
  KEY_FEEDBACK,
  KEY_FOCUS,
  KEY_HEIGHT,
  KEY_MENU_ITEMS,
  KEY_NAME,
  KEY_NOTIFICATION,
  KEY_SAVE_STATUS_FAILED,
  KEY_SAVE_STATUS_SAVED,
  KEY_SAVE_STATUS_SAVING,
  KEY_SELECT_SAVE,
  KEY_SELECT_SIZE,
  KEY_SETTINGS,
  KEY_WIDTH,
  MENU_ITEMS_BY_SCOPE,
  NOTIFICATION_PERMISSION,
  debug,
  normalizeContexts,
  normalizeFocus,
  normalizeMenuItems,
  normalizeNotification,
  normalizeSelectSave,
  normalizeSelectSize,
  onError,
  storageArea,
  toContextLabelKey,
} from './common.js'

const {
  i18n,
  permissions,
} = browser

const SAVE_STATUS_CLEAR_DELAY = 1800

let savePromise
let saveRequested = false
let saveStatusVersion = 0

function getContextInputId (key) {
  return KEY_CONTEXTS + '_' + key
}

function getMenuScopeInputId (scope, key) {
  return KEY_MENU_ITEMS + '_' + scope + '_' + key
}

function setLabelText (id, key) {
  document.getElementById(id).textContent = i18n.getMessage(key)
}

function setSaveStatus (key, state = '', transient = false) {
  const status = document.getElementById('saveStatus')
  const version = ++saveStatusVersion
  status.textContent = key ? i18n.getMessage(key) : ''
  status.dataset.state = state

  if (!transient) {
    return
  }

  setTimeout(() => {
    if (version === saveStatusVersion) {
      status.textContent = ''
      status.dataset.state = ''
    }
  }, SAVE_STATUS_CLEAR_DELAY)
}

async function restore () {
  const data = await storageArea.get()
  debug('Loaded ' + JSON.stringify(data))

  const contexts = normalizeContexts(data[KEY_CONTEXTS])
  const menuItems = normalizeMenuItems(data[KEY_MENU_ITEMS])
  const selectSize = normalizeSelectSize(data[KEY_SELECT_SIZE] ||
    DEFAULT_SELECT_SIZE)
  const selectSave = normalizeSelectSave(data[KEY_SELECT_SAVE] ??
    DEFAULT_SELECT_SAVE)
  const notification = normalizeNotification(data[KEY_NOTIFICATION] ??
    DEFAULT_NOTIFICATION)
  const notificationAllowed = notification &&
    await permissions.contains(NOTIFICATION_PERMISSION)
  const focus = normalizeFocus(data[KEY_FOCUS] ?? DEFAULT_FOCUS)

  const contextSet = new Set(contexts)
  ALL_CONTEXTS.forEach((key) => {
    document.getElementById(getContextInputId(key)).checked =
      contextSet.has(key)
  })

  ALL_MENU_SCOPES.forEach((scope) => {
    const scopeItems = MENU_ITEMS_BY_SCOPE[scope]
    scopeItems.forEach((key) => {
      document.getElementById(getMenuScopeInputId(scope, key)).checked =
        menuItems[key]?.includes(scope) || false
    })
  })

  document.getElementById(KEY_WIDTH).value = selectSize[0]
  document.getElementById(KEY_HEIGHT).value = selectSize[1]
  document.getElementById(KEY_SELECT_SAVE).checked = selectSave
  document.getElementById(KEY_NOTIFICATION).checked = notificationAllowed
  document.getElementById(KEY_FOCUS).checked = focus
}

async function applyNotificationPermission (notification) {
  if (notification) {
    return await permissions.request(NOTIFICATION_PERMISSION)
  }
  if (await permissions.contains(NOTIFICATION_PERMISSION)) {
    await permissions.remove(NOTIFICATION_PERMISSION)
  }
  return false
}

async function save () {
  const contexts = []
  ALL_CONTEXTS.forEach((key) => {
    if (document.getElementById(getContextInputId(key)).checked) {
      contexts.push(key)
    }
  })

  const menuItems = {}
  ALL_MENU_ITEMS.forEach((key) => {
    const scopes = []
    ALL_MENU_SCOPES.forEach((scope) => {
      if (!MENU_ITEMS_BY_SCOPE[scope].includes(key)) {
        return
      }
      if (document.getElementById(getMenuScopeInputId(scope, key)).checked) {
        scopes.push(scope)
      }
    })
    if (scopes.length > 0) {
      menuItems[key] = scopes
    }
  })

  const selectSize = normalizeSelectSize([
    Number(document.getElementById(KEY_WIDTH).value),
    Number(document.getElementById(KEY_HEIGHT).value),
  ])
  document.getElementById(KEY_WIDTH).value = selectSize[0]
  document.getElementById(KEY_HEIGHT).value = selectSize[1]

  const notificationInput = document.getElementById(KEY_NOTIFICATION)
  let notification = notificationInput.checked
  if (notification && !await permissions.contains(NOTIFICATION_PERMISSION)) {
    notification = false
    notificationInput.checked = false
  }

  const data = {
    [KEY_CONTEXTS]: contexts,
    [KEY_MENU_ITEMS]: menuItems,
    [KEY_SELECT_SIZE]: selectSize,
    [KEY_SELECT_SAVE]: document.getElementById(KEY_SELECT_SAVE).checked,
    [KEY_NOTIFICATION]: notification,
    [KEY_FOCUS]: document.getElementById(KEY_FOCUS).checked,
  }
  await storageArea.set(data)
  debug('Saved ' + JSON.stringify(data))
}

function queueSave () {
  saveRequested = true
  setSaveStatus(KEY_SAVE_STATUS_SAVING, 'saving')

  if (!savePromise) {
    savePromise = runSaveQueue()
  }
}

async function runSaveQueue () {
  try {
    while (saveRequested) {
      saveRequested = false
      await save()
    }
    setSaveStatus(KEY_SAVE_STATUS_SAVED, 'saved', true)
  } catch (error) {
    setSaveStatus(KEY_SAVE_STATUS_FAILED, 'error')
    onError(error)
  } finally {
    savePromise = undefined
    if (saveRequested) {
      queueSave()
    }
  }
}

function createSwitch (inputId) {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.id = inputId
  input.className = 'switch-input'

  const control = document.createElement('span')
  control.className = 'switch-control'
  control.setAttribute('aria-hidden', 'true')

  const switchWrapper = document.createElement('span')
  switchWrapper.className = 'switch'
  switchWrapper.appendChild(input)
  switchWrapper.appendChild(control)

  return switchWrapper
}

function createToggleLabel (labelKey, inputId, className = 'toggle-row') {
  const title = document.createElement('span')
  title.className = 'setting-title'
  title.textContent = i18n.getMessage(labelKey)

  const copy = document.createElement('span')
  copy.className = 'setting-copy'
  copy.appendChild(title)

  const label = document.createElement('label')
  label.className = className
  label.appendChild(copy)
  label.appendChild(createSwitch(inputId))

  return label
}

function addCheckboxEntry (labelKey, container, inputId) {
  container.appendChild(createToggleLabel(labelKey, inputId))
}

function addMenuItemEntry (scope, key, container) {
  addCheckboxEntry('menuItem_' + scope + '_' + key, container,
    getMenuScopeInputId(scope, key))
}

function addMenuScopeSection (scope, container) {
  const title = document.createElement('h3')
  title.textContent = i18n.getMessage(scope)

  const list = document.createElement('div')
  list.className = 'toggle-list menu-scope-list'
  MENU_ITEMS_BY_SCOPE[scope].forEach((key) => {
    addMenuItemEntry(scope, key, list)
  })

  const section = document.createElement('section')
  section.className = 'menu-scope'
  section.appendChild(title)
  section.appendChild(list)
  container.appendChild(section)
}

function createNumberField (labelKey, inputId) {
  const label = document.createElement('label')
  label.className = 'number-field'

  const title = document.createElement('span')
  title.className = 'setting-title'
  title.textContent = i18n.getMessage(labelKey)

  const input = document.createElement('input')
  input.type = 'number'
  input.min = '1'
  input.required = true
  input.id = inputId

  label.appendChild(title)
  label.appendChild(input)
  return label
}

function bindAutoSave () {
  document.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', () => {
      handleInputChange(input).catch((error) => {
        if (input.id === KEY_NOTIFICATION) {
          input.checked = false
        }
        onError(error)
        queueSave()
      })
    })
  })
}

async function handleInputChange (input) {
  if (input.id === KEY_NOTIFICATION) {
    input.checked = await applyNotificationPermission(input.checked)
  }
  queueSave()
}

async function init () {
  const contextContainer = document.getElementById(KEY_CONTEXTS)
  ALL_CONTEXTS.forEach((key) => {
    addCheckboxEntry(toContextLabelKey(key), contextContainer,
      getContextInputId(key))
  })

  const itemContainer = document.getElementById(KEY_MENU_ITEMS)
  ALL_MENU_SCOPES.forEach((scope) => {
    addMenuScopeSection(scope, itemContainer)
  })

  const selectSizeContainer = document.getElementById(KEY_SELECT_SIZE)
  selectSizeContainer.appendChild(createNumberField(KEY_WIDTH, KEY_WIDTH))
  selectSizeContainer.appendChild(createNumberField(KEY_HEIGHT, KEY_HEIGHT))

  const behaviorContainer = document.getElementById(KEY_BEHAVIOR)
  addCheckboxEntry(KEY_SELECT_SAVE, behaviorContainer, KEY_SELECT_SAVE)
  addCheckboxEntry(KEY_FOCUS, behaviorContainer, KEY_FOCUS)

  const notificationContainer = document.getElementById('notificationSetting')
  addCheckboxEntry(KEY_NOTIFICATION, notificationContainer, KEY_NOTIFICATION)

  setLabelText('label_' + KEY_NAME, KEY_NAME)
  setLabelText('label_' + KEY_SETTINGS, KEY_SETTINGS)
  setLabelText('label_' + KEY_CONTEXTS, KEY_CONTEXTS)
  setLabelText('label_' + KEY_MENU_ITEMS, KEY_MENU_ITEMS)
  setLabelText('label_' + KEY_SELECT_SIZE, KEY_SELECT_SIZE)
  setLabelText('label_' + KEY_BEHAVIOR, KEY_BEHAVIOR)
  setLabelText('label_' + KEY_FEEDBACK, KEY_FEEDBACK)

  await restore()
  bindAutoSave()
}

init().catch(onError)
