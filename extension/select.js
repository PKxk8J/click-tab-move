import {
  DEFAULT_FOCUS,
  DEFAULT_NOTIFICATION,
  KEY_CANCEL,
  KEY_DESTINATION,
  KEY_GROUP_ID,
  KEY_MOVE,
  KEY_NEW_GROUP,
  KEY_NEW_WINDOW,
  KEY_PRESERVE_FULL_GROUPS,
  KEY_PRESERVE_GROUP_IDS,
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

const GROUP_STATE_NONE = 'none'
const GROUP_STATE_GROUP = 'group'
const GROUP_STATE_TABS = 'tabs'

let currentMoveRequest
let optionRecords = new Map()
let groupRecords = new Map()
let selectedOptionIds = new Set()

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

function appendUnitTabIds (unit, tabIds, knownTabIds) {
  for (const tab of unit.tabs) {
    if (knownTabIds.has(tab.id)) {
      continue
    }
    knownTabIds.add(tab.id)
    tabIds.push(tab.id)
  }
}

function getSelectedMoveTargets () {
  const tabIds = []
  const preserveGroupIds = []
  const knownTabIds = new Set()

  for (const checkbox of getTabCheckboxes()) {
    const option = optionRecords.get(checkbox.id)
    if (!option) {
      continue
    }

    if (option.type === 'unit') {
      if (selectedOptionIds.has(option.id)) {
        appendUnitTabIds(option.unit, tabIds, knownTabIds)
      }
      continue
    }

    const group = groupRecords.get(option.groupId)
    if (!group) {
      continue
    }

    if (option.type === 'group') {
      if (group.state === GROUP_STATE_GROUP) {
        preserveGroupIds.push(group.groupId)
        appendUnitTabIds(group.unit, tabIds, knownTabIds)
      }
      continue
    }

    if (group.state === GROUP_STATE_TABS &&
        group.selectedChildIds.has(option.id)) {
      appendUnitTabIds(option.unit, tabIds, knownTabIds)
    }
  }

  return { tabIds, preserveGroupIds }
}

function updateMoveButtonState () {
  const moveButton = document.getElementById(KEY_MOVE)
  moveButton.disabled = !currentMoveRequest ||
    getSelectedMoveTargets().tabIds.length <= 0
}

function sendResult () {
  const { tabIds, preserveGroupIds } = getSelectedMoveTargets()
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
    [KEY_PRESERVE_FULL_GROUPS]: false,
    [KEY_PRESERVE_GROUP_IDS]: preserveGroupIds,
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

async function getHighlightedTabIdSet (fromWindowId, targetScope, groupId) {
  const highlightedTabs = await tabs.query({
    windowId: fromWindowId,
    highlighted: true,
  })
  const targetTabs = targetScope === KEY_TARGET_GROUP
    ? highlightedTabs.filter((tab) => tab.groupId === groupId)
    : highlightedTabs

  return targetTabs.length > 1
    ? new Set(targetTabs.map((tab) => tab.id))
    : new Set()
}

function createTabOption (unit, groupInfos, checkboxId, classNames = []) {
  const label = document.createElement('label')
  label.className = ['tab-option', ...classNames].join(' ')
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

function hasSelectedTab (unit, selectedTabIds) {
  return unit.tabs.some((tab) => selectedTabIds.has(tab.id))
}

function createOptionId (index) {
  return 'tab-option-' + index
}

function addUnitOption (unit, groupInfos, options, selectedTabIds, index) {
  const checkboxId = createOptionId(index)
  optionRecords.set(checkboxId, {
    id: checkboxId,
    type: 'unit',
    unit,
  })
  if (hasSelectedTab(unit, selectedTabIds)) {
    selectedOptionIds.add(checkboxId)
  }
  options.push(createTabOption(unit, groupInfos, checkboxId))
}

function addGroupOption (unit, groupInfos, options, selectedTabIds, index) {
  const groupCheckboxId = createOptionId(index.next++)
  const childIds = []
  const selectedChildIds = new Set()

  optionRecords.set(groupCheckboxId, {
    id: groupCheckboxId,
    type: 'group',
    groupId: unit.groupId,
    unit,
  })
  options.push(createTabOption(unit, groupInfos, groupCheckboxId,
    ['group-option']))

  for (const childUnit of unit.units) {
    const childCheckboxId = createOptionId(index.next++)
    childIds.push(childCheckboxId)
    optionRecords.set(childCheckboxId, {
      id: childCheckboxId,
      type: 'groupChild',
      groupId: unit.groupId,
      unit: childUnit,
    })
    if (hasSelectedTab(childUnit, selectedTabIds)) {
      selectedChildIds.add(childCheckboxId)
    }
    options.push(createTabOption(childUnit, groupInfos, childCheckboxId,
      ['tab-option-child']))
  }

  groupRecords.set(unit.groupId, {
    id: groupCheckboxId,
    groupId: unit.groupId,
    unit,
    childIds,
    selectedChildIds,
    state: selectedChildIds.size > 0
      ? GROUP_STATE_TABS
      : GROUP_STATE_NONE,
  })
}

function setCheckboxState (checkbox, state) {
  const checked = state === 'checked'
  const mixed = state === 'mixed'
  checkbox.checked = checked
  checkbox.indeterminate = mixed
  checkbox.setAttribute('aria-checked', mixed
    ? 'mixed'
    : String(checked))

  checkbox.closest('.tab-option')?.
    setAttribute('aria-selected', String(checked || mixed))
}

function renderSelectionState () {
  for (const [optionId, option] of optionRecords) {
    const checkbox = document.getElementById(optionId)
    if (!checkbox) {
      continue
    }

    if (option.type === 'unit') {
      setCheckboxState(checkbox,
        selectedOptionIds.has(optionId) ? 'checked' : 'unchecked')
      continue
    }

    const group = groupRecords.get(option.groupId)
    if (!group) {
      setCheckboxState(checkbox, 'unchecked')
      continue
    }

    if (option.type === 'group') {
      if (group.state === GROUP_STATE_GROUP) {
        setCheckboxState(checkbox, 'checked')
      } else if (group.state === GROUP_STATE_TABS) {
        setCheckboxState(checkbox, 'mixed')
      } else {
        setCheckboxState(checkbox, 'unchecked')
      }
      continue
    }

    if (group.state === GROUP_STATE_GROUP) {
      setCheckboxState(checkbox, 'mixed')
    } else if (group.state === GROUP_STATE_TABS &&
        group.selectedChildIds.has(optionId)) {
      setCheckboxState(checkbox, 'checked')
    } else {
      setCheckboxState(checkbox, 'unchecked')
    }
  }

  updateMoveButtonState()
}

function replaceTabOptions (units, groupInfos, selectedTabIds) {
  optionRecords = new Map()
  groupRecords = new Map()
  selectedOptionIds = new Set()

  const options = []
  const index = { next: 0 }
  for (const unit of units) {
    if (unit.type === 'group') {
      addGroupOption(unit, groupInfos, options, selectedTabIds, index)
    } else {
      addUnitOption(unit, groupInfos, options, selectedTabIds, index.next++)
    }
  }

  document.getElementById(KEY_SELECT).replaceChildren(...options)
  renderSelectionState()
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

function updateGroupAfterChildSelection (group) {
  group.state = group.selectedChildIds.size > 0
    ? GROUP_STATE_TABS
    : GROUP_STATE_NONE
}

function handleGroupClick (group) {
  if (group.state === GROUP_STATE_NONE) {
    group.state = GROUP_STATE_GROUP
    group.selectedChildIds.clear()
    return
  }

  if (group.state === GROUP_STATE_GROUP) {
    group.state = GROUP_STATE_TABS
    group.selectedChildIds = new Set(group.childIds)
    return
  }

  group.state = GROUP_STATE_NONE
  group.selectedChildIds.clear()
}

function handleGroupChildClick (group, optionId) {
  if (group.state === GROUP_STATE_GROUP) {
    group.state = GROUP_STATE_TABS
    group.selectedChildIds = new Set(group.childIds)
    group.selectedChildIds.delete(optionId)
    updateGroupAfterChildSelection(group)
    return
  }

  if (group.selectedChildIds.has(optionId)) {
    group.selectedChildIds.delete(optionId)
  } else {
    group.selectedChildIds.add(optionId)
  }
  updateGroupAfterChildSelection(group)
}

function handleUnitClick (optionId) {
  if (selectedOptionIds.has(optionId)) {
    selectedOptionIds.delete(optionId)
  } else {
    selectedOptionIds.add(optionId)
  }
}

function handleTabListClick (event) {
  const target = event.target
  if (!target || target.localName !== 'input' ||
      target.type !== 'checkbox') {
    return
  }

  const option = optionRecords.get(target.id)
  if (!option) {
    renderSelectionState()
    return
  }

  if (option.type === 'unit') {
    handleUnitClick(option.id)
  } else {
    const group = groupRecords.get(option.groupId)
    if (group && option.type === 'group') {
      handleGroupClick(group)
    } else if (group) {
      handleGroupChildClick(group, option.id)
    }
  }

  renderSelectionState()
}

async function reset (
  { fromWindowId, groupId, targetScope, destination, notification, focus }) {
  currentMoveRequest = undefined
  optionRecords = new Map()
  groupRecords = new Map()
  selectedOptionIds = new Set()
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
  const highlightedTabIds = await getHighlightedTabIdSet(fromWindowId,
    targetScope, groupId)

  replaceTabOptions(units, groupInfos, highlightedTabIds)

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
    addEventListener('click', handleTabListClick)
  updateMoveButtonState()

  runtime.onMessage.addListener((message) => {
    return handleMessage(message).catch(onError)
  })
}

init().catch(onError)
