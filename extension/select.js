import {
  DEFAULT_FOCUS,
  DEFAULT_NOTIFICATION,
  KEY_CANCEL,
  KEY_DESTINATION,
  KEY_GROUP_ID,
  KEY_MOVE,
  KEY_NEW_GROUP,
  KEY_NEW_WINDOW,
  KEY_RAW,
  KEY_RESET,
  KEY_SELECT,
  KEY_SELECT_SIZE,
  KEY_SOURCE_WINDOW_ID,
  KEY_TARGET_GLOBAL,
  KEY_TARGET_GROUP,
  KEY_TARGET_SCOPE,
  debug,
  normalizeDestination,
  normalizeFocus,
  normalizeInteger,
  normalizeNotification,
  normalizeRequiredInteger,
  normalizeTargetScope,
  onError,
} from './common.js'
import {
  buildTabUnits,
  buildTopLevelUnits,
} from './tab-units.js'

const {
  i18n,
  runtime,
  tabs,
  windows,
} = browser

let currentMoveRequest
let tabIdsByCheckboxId = new Map()

async function closeWindow () {
  const windowInfo = await windows.getCurrent()
  try {
    await runtime.sendMessage({
      type: KEY_SELECT_SIZE,
      selectSize: [windowInfo.width, windowInfo.height],
    })
  } catch (error) {
    onError(error)
  }

  await windows.remove(windowInfo.id)
  debug('Select window ' + windowInfo.id + ' was closed')
}

function normalizeResetMessage (message) {
  return {
    fromWindowId: normalizeRequiredInteger(message.fromWindowId,
      'fromWindowId'),
    groupId: normalizeInteger(message[KEY_GROUP_ID]),
    targetScope: normalizeTargetScope(message[KEY_TARGET_SCOPE]),
    destination: normalizeDestination(message[KEY_DESTINATION]),
    notification: normalizeNotification(
      message.notification ?? DEFAULT_NOTIFICATION),
    focus: normalizeFocus(message.focus ?? DEFAULT_FOCUS),
  }
}

function getTabCheckboxes () {
  return [
    ...document.getElementById(KEY_SELECT).
      querySelectorAll('input[type="checkbox"]'),
  ]
}

function getSelectedTabIds () {
  return getTabCheckboxes().
    filter((checkbox) => checkbox.checked).
    flatMap((checkbox) => tabIdsByCheckboxId.get(checkbox.id) || [])
}

function updateMoveButtonState () {
  const moveButton = document.getElementById(KEY_MOVE)
  moveButton.disabled = !currentMoveRequest || getSelectedTabIds().length <= 0
}

function sendResult () {
  const tabIds = getSelectedTabIds()
  if (!currentMoveRequest || tabIds.length <= 0) {
    return false
  }

  runtime.sendMessage({
    type: KEY_MOVE,
    keyType: KEY_RAW,
    tabIds,
    [KEY_DESTINATION]: currentMoveRequest.destination,
    [KEY_TARGET_SCOPE]: currentMoveRequest.targetScope,
    [KEY_GROUP_ID]: currentMoveRequest.groupId,
    [KEY_SOURCE_WINDOW_ID]: currentMoveRequest.fromWindowId,
    notification: currentMoveRequest.notification,
    focus: currentMoveRequest.focus,
  }).catch(onError)
  return true
}

async function sendAndClose () {
  if (sendResult()) {
    await closeWindow()
  }
}

async function getGroupInfoMap () {
  const infos = new Map()
  if (typeof browser.tabGroups?.query !== 'function') {
    return infos
  }

  const groups = await browser.tabGroups.query({})
  for (const group of groups) {
    infos.set(group.id, {
      title: group.title || '',
    })
  }
  return infos
}

function getUnitTitle (unit, groupInfos) {
  if (unit.type === 'group') {
    const groupInfo = groupInfos.get(unit.groupId)
    const groupTitle = groupInfo?.title || ''
    return i18n.getMessage('groupEntry',
      [unit.tabs[0].windowId, groupTitle, unit.tabs[0].title])
  }
  if (unit.type === 'splitView') {
    return unit.tabs.map((tab) => tab.title).join(' / ')
  }
  return unit.tabs[0].title
}

async function getWindowTitle (windowId) {
  const [tab] = await tabs.query({
    windowId,
    active: true,
  })
  return i18n.getMessage('windowEntry', [windowId, tab?.title || ''])
}

async function getGroupTitle (groupId) {
  const tabList = await tabs.query({})
  const groupTab = tabList.find((tab) => tab.groupId === groupId)
  if (!groupTab) {
    return String(groupId)
  }

  let title = ''
  if (typeof browser.tabGroups?.query === 'function') {
    const groups = await browser.tabGroups.query({})
    title = groups.find((group) => group.id === groupId)?.title || title
  }
  return i18n.getMessage('groupEntry', [groupTab.windowId, title,
    groupTab.title])
}

async function getDestinationTitle (destination) {
  const normalizedDestination = normalizeDestination(destination)
  if (normalizedDestination.type === 'newWindow') {
    return i18n.getMessage(KEY_NEW_WINDOW)
  }
  if (normalizedDestination.type === 'newGroup') {
    return i18n.getMessage(KEY_NEW_GROUP)
  }
  if (normalizedDestination.type === 'group') {
    return getGroupTitle(normalizedDestination.groupId)
  }
  return getWindowTitle(normalizedDestination.windowId)
}

async function getSourceTitle (fromWindowId, groupId, targetScope) {
  if (targetScope === KEY_TARGET_GROUP && groupId !== undefined) {
    return getGroupTitle(groupId)
  }
  return getWindowTitle(fromWindowId)
}

function getTargetTitle (targetScope) {
  return i18n.getMessage(targetScope === KEY_TARGET_GROUP
    ? 'selectGroupTitle'
    : 'selectGlobalTitle')
}

function createTabOption (unit, groupInfos, checkboxId) {
  const label = document.createElement('label')
  label.className = 'tab-option'
  label.htmlFor = checkboxId
  label.setAttribute('role', 'option')
  label.setAttribute('aria-selected', 'false')

  const checkbox = document.createElement('input')
  checkbox.id = checkboxId
  checkbox.type = 'checkbox'

  const title = document.createElement('span')
  title.className = 'tab-title'
  title.textContent = getUnitTitle(unit, groupInfos)

  label.append(checkbox, title)
  return label
}

function replaceTabOptions (units, groupInfos) {
  const nextTabIdsByCheckboxId = new Map()
  const options = units.map((unit, index) => {
    const checkboxId = 'tab-option-' + index
    nextTabIdsByCheckboxId.set(checkboxId, unit.tabs.map((tab) => tab.id))
    return createTabOption(unit, groupInfos, checkboxId)
  })

  tabIdsByCheckboxId = nextTabIdsByCheckboxId
  document.getElementById(KEY_SELECT).replaceChildren(...options)
}

function handleTabListKeyDown (event) {
  const target = event.target
  if (!target || target.localName !== 'input' ||
      target.type !== 'checkbox') {
    return
  }

  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) {
    return
  }

  event.preventDefault()
  const checkboxes = getTabCheckboxes()
  const index = checkboxes.indexOf(target)
  const nextIndex = event.key === 'ArrowDown'
    ? Math.min(index + 1, checkboxes.length - 1)
    : Math.max(index - 1, 0)
  checkboxes[nextIndex]?.focus()
}

function handleTabListChange (event) {
  const target = event.target
  if (!target || target.localName !== 'input' ||
      target.type !== 'checkbox') {
    return
  }

  target.closest('.tab-option')?.
    setAttribute('aria-selected', String(target.checked))
  updateMoveButtonState()
}

async function reset (
  { fromWindowId, groupId, targetScope, destination, notification, focus }) {
  currentMoveRequest = undefined
  tabIdsByCheckboxId = new Map()
  updateMoveButtonState()

  const title = getTargetTitle(targetScope)
  document.title = title
  document.getElementById('selectionTitle').textContent = title
  document.getElementById('source').textContent = await getSourceTitle(
    fromWindowId, groupId, targetScope)
  document.getElementById('destinationDisplay').textContent =
    await getDestinationTitle(destination)

  let tabList = await tabs.query({ windowId: fromWindowId })
  if (targetScope === KEY_TARGET_GROUP) {
    tabList = tabList.filter((tab) => tab.groupId === groupId)
  }
  const units = targetScope === KEY_TARGET_GLOBAL
    ? buildTopLevelUnits(tabList)
    : buildTabUnits(tabList)
  const groupInfos = await getGroupInfoMap()

  replaceTabOptions(units, groupInfos)

  currentMoveRequest = {
    fromWindowId,
    groupId,
    targetScope,
    destination,
    notification,
    focus,
  }
  updateMoveButtonState()
  const firstCheckbox = getTabCheckboxes()[0]
  if (firstCheckbox) {
    firstCheckbox.focus()
  } else {
    document.getElementById(KEY_CANCEL).focus()
  }
  await windows.update(windows.WINDOW_ID_CURRENT, { focused: true })
}

async function handleMessage (message) {
  debug('Message ' + JSON.stringify(message) + ' was received')
  if (message.type !== KEY_RESET) {
    return
  }

  await reset(normalizeResetMessage(message))
}

function setLabelText (id, key) {
  document.getElementById(id).textContent = i18n.getMessage(key)
}

async function init () {
  setLabelText('label_moveSource', 'moveSource')
  setLabelText('label_moveDestination', 'moveDestination')
  setLabelText('label_moveTargets', 'moveTargets')
  setLabelText('label_' + KEY_MOVE, KEY_MOVE)
  setLabelText('label_' + KEY_CANCEL, KEY_CANCEL)

  document.getElementById(KEY_MOVE).addEventListener('click', () => {
    sendAndClose().catch(onError)
  })
  document.getElementById(KEY_CANCEL).addEventListener('click', () => {
    closeWindow().catch(onError)
  })
  document.getElementById(KEY_SELECT).
    addEventListener('keydown', handleTabListKeyDown)
  document.getElementById(KEY_SELECT).
    addEventListener('change', handleTabListChange)
  updateMoveButtonState()

  runtime.onMessage.addListener((message) => {
    return handleMessage(message).catch(onError)
  })
}

init().catch(onError)
