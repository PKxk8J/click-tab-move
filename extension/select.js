import {
  DEFAULT_FOCUS,
  DEFAULT_NOTIFICATION,
  KEY_CANCEL,
  KEY_DESTINATION,
  KEY_FOCUS,
  KEY_GROUP_ID,
  KEY_MOVE,
  KEY_NEW_GROUP,
  KEY_NEW_WINDOW,
  KEY_NOTIFICATION,
  KEY_RAW,
  KEY_RESET,
  KEY_SELECT,
  KEY_SELECT_SIZE,
  KEY_SOURCE_WINDOW_ID,
  KEY_TARGET_GLOBAL,
  KEY_TARGET_GROUP,
  KEY_TARGET_SCOPE,
  debug,
  onError,
} from './common.js'

const {
  i18n,
  runtime,
  tabs,
  windows,
} = browser

const ITEM_LENGTH = 96

async function closeWindow () {
  const windowInfo = await windows.getCurrent()
  runtime.sendMessage({
    type: KEY_SELECT_SIZE,
    selectSize: [windowInfo.width, windowInfo.height],
  })

  await windows.remove(windowInfo.id)
  debug('Select window ' + windowInfo.id + ' was closed')
}

function cut (text, length) {
  if (text.length <= length) {
    return text
  }
  return text.substring(0, length) + '...'
}

function getNoGroupId () {
  return browser.tabGroups?.TAB_GROUP_ID_NONE ?? -1
}

function getNoSplitViewId () {
  return tabs.SPLIT_VIEW_ID_NONE ?? -1
}

function isGroupedTab (tab) {
  return tab.groupId !== undefined && tab.groupId !== getNoGroupId()
}

function isSplitViewTab (tab) {
  return tab.splitViewId !== undefined &&
    tab.splitViewId !== getNoSplitViewId()
}

function sortTabsByIndex (tabList) {
  return [...tabList].sort((tab1, tab2) => tab1.index - tab2.index)
}

function sortTabsByWindowAndIndex (tabList) {
  return [...tabList].sort((tab1, tab2) => {
    if (tab1.windowId !== tab2.windowId) {
      return tab1.windowId - tab2.windowId
    }
    return tab1.index - tab2.index
  })
}

function makeTabUnit (tab) {
  return {
    type: 'tab',
    tabs: [tab],
  }
}

function makeSplitViewUnit (tabList, startIndex) {
  const splitViewId = tabList[startIndex].splitViewId
  const unitTabs = []
  let index = startIndex
  for (; index < tabList.length; index++) {
    if (tabList[index].splitViewId !== splitViewId) {
      break
    }
    unitTabs.push(tabList[index])
  }

  return {
    nextIndex: index,
    unit: {
      type: 'splitView',
      splitViewId,
      tabs: unitTabs,
    },
  }
}

function buildTabUnits (tabList) {
  const units = []
  const sortedTabs = sortTabsByIndex(tabList)
  for (let i = 0; i < sortedTabs.length;) {
    const tab = sortedTabs[i]
    if (isSplitViewTab(tab)) {
      const { unit, nextIndex } = makeSplitViewUnit(sortedTabs, i)
      units.push(unit)
      i = nextIndex
      continue
    }

    units.push(makeTabUnit(tab))
    i++
  }
  return units
}

function makeGroupUnit (tabList, startIndex) {
  const groupId = tabList[startIndex].groupId
  const groupTabs = []
  let index = startIndex
  for (; index < tabList.length; index++) {
    if (tabList[index].groupId !== groupId) {
      break
    }
    groupTabs.push(tabList[index])
  }

  return {
    nextIndex: index,
    unit: {
      type: 'group',
      groupId,
      tabs: groupTabs,
    },
  }
}

function buildTopLevelUnits (tabList) {
  const units = []
  const sortedTabs = sortTabsByIndex(tabList)
  for (let i = 0; i < sortedTabs.length;) {
    const tab = sortedTabs[i]
    if (isGroupedTab(tab)) {
      const { unit, nextIndex } = makeGroupUnit(sortedTabs, i)
      units.push(unit)
      i = nextIndex
      continue
    }

    if (isSplitViewTab(tab)) {
      const { unit, nextIndex } = makeSplitViewUnit(sortedTabs, i)
      units.push(unit)
      i = nextIndex
      continue
    }

    units.push(makeTabUnit(tab))
    i++
  }
  return units
}

function normalizeDestination (destination) {
  if (!destination || destination.type === 'newWindow') {
    return { type: 'newWindow' }
  }
  if (destination.type === 'window') {
    return { type: 'window', windowId: destination.windowId }
  }
  if (destination.type === 'newGroup') {
    return { type: 'newGroup' }
  }
  if (destination.type === 'group') {
    return { type: 'group', groupId: destination.groupId }
  }
  return { type: 'newWindow' }
}

function serializeDestination (destination) {
  return JSON.stringify(normalizeDestination(destination))
}

function parseDestination (value) {
  if (!value) {
    return { type: 'newWindow' }
  }
  return normalizeDestination(JSON.parse(value))
}

function sameDestination (destination1, destination2) {
  return serializeDestination(destination1) === serializeDestination(destination2)
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
    flatMap((checkbox) => checkbox.dataset.tabIds.split(',').map(Number))
}

function getDestination () {
  return parseDestination(document.getElementById(KEY_DESTINATION).value)
}

function getIntegerValue (key) {
  const value = document.getElementById(key).value
  if (value === '') {
    return undefined
  }
  const numberValue = Number(value)
  return Number.isInteger(numberValue) ? numberValue : undefined
}

function updateMoveButtonState () {
  const moveButton = document.getElementById(KEY_MOVE)
  moveButton.disabled = getSelectedTabIds().length <= 0 ||
    document.getElementById(KEY_DESTINATION).value === ''
}

function sendResult () {
  const tabIds = getSelectedTabIds()
  if (tabIds.length <= 0) {
    return false
  }

  runtime.sendMessage({
    type: KEY_MOVE,
    keyType: KEY_RAW,
    tabIds,
    [KEY_DESTINATION]: getDestination(),
    [KEY_TARGET_SCOPE]: document.getElementById(KEY_TARGET_SCOPE).value ||
      KEY_TARGET_GLOBAL,
    [KEY_GROUP_ID]: getIntegerValue(KEY_GROUP_ID),
    [KEY_SOURCE_WINDOW_ID]: getIntegerValue(KEY_SOURCE_WINDOW_ID),
    notification: document.getElementById(KEY_NOTIFICATION).value === 'true',
    focus: document.getElementById(KEY_FOCUS).value === 'true',
  })
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

function getWindowEntryTitle (tab) {
  return cut(i18n.getMessage('windowEntry', [tab.windowId, tab.title]),
    ITEM_LENGTH)
}

function getGroupEntryTitle (group) {
  const groupTitle = group.title || ''
  return cut(i18n.getMessage('groupEntry',
    [group.windowId, groupTitle, group.firstTabTitle]), ITEM_LENGTH)
}

async function getGroupEntries (selectWindowId) {
  const tabList = await tabs.query({})
  const firstTabByGroupId = new Map()
  for (const tab of sortTabsByWindowAndIndex(tabList)) {
    if (!isGroupedTab(tab) || firstTabByGroupId.has(tab.groupId)) {
      continue
    }
    firstTabByGroupId.set(tab.groupId, tab)
  }

  let groups = []
  if (typeof browser.tabGroups?.query === 'function') {
    groups = await browser.tabGroups.query({})
  } else {
    const knownGroupIds = new Set()
    for (const tab of tabList) {
      if (!isGroupedTab(tab) || knownGroupIds.has(tab.groupId)) {
        continue
      }
      knownGroupIds.add(tab.groupId)
      groups.push({
        id: tab.groupId,
        windowId: tab.windowId,
        title: '',
      })
    }
  }

  return groups.
    filter((group) => group.windowId !== selectWindowId).
    sort((group1, group2) => {
      if (group1.windowId !== group2.windowId) {
        return group1.windowId - group2.windowId
      }
      return group1.id - group2.id
    }).
    map((group) => {
      const entry = {
        type: 'group',
        groupId: group.id,
        windowId: group.windowId,
        title: group.title,
        firstTabTitle: firstTabByGroupId.get(group.id)?.title || '',
      }
      return {
        ...entry,
        title: getGroupEntryTitle(entry),
      }
    })
}

async function getDestinationEntries (selectWindowId) {
  const activeTabs = await tabs.query({ active: true })
  const windowEntries = activeTabs.
    filter((tab) => tab.windowId !== selectWindowId).
    sort((tab1, tab2) => tab1.windowId - tab2.windowId).
    map((tab) => ({
      type: 'window',
      windowId: tab.windowId,
      title: getWindowEntryTitle(tab),
    }))
  return {
    windows: windowEntries,
    groups: await getGroupEntries(selectWindowId),
  }
}

function getAllDestinations (entries) {
  return [
    { type: 'newWindow', title: i18n.getMessage(KEY_NEW_WINDOW) },
    ...entries.windows,
    { type: 'newGroup', title: i18n.getMessage(KEY_NEW_GROUP) },
    ...entries.groups,
  ]
}

function isDestinationVisible (destination, context, selectWindowId) {
  if (destination.type === 'newWindow') {
    return true
  }

  if (destination.type === 'window') {
    if (destination.windowId === selectWindowId) {
      return false
    }
    if (destination.windowId === context.fromWindowId) {
      return context.targetScope === KEY_TARGET_GROUP
    }
    return true
  }

  if (typeof tabs.group !== 'function') {
    return false
  }

  if (destination.type === 'newGroup') {
    return true
  }

  return !(context.targetScope === KEY_TARGET_GROUP &&
    destination.groupId === context.groupId)
}

async function setDestinationOptions (context, destination) {
  const windowInfo = await windows.getCurrent()
  const entries = await getDestinationEntries(windowInfo.id)
  const destinations = getAllDestinations(entries).
    filter((entry) => isDestinationVisible(entry, context, windowInfo.id))
  const destinationSelect = document.getElementById(KEY_DESTINATION)
  destinationSelect.replaceChildren()

  for (const entry of destinations) {
    const option = document.createElement('option')
    option.value = serializeDestination(entry)
    option.textContent = entry.title
    destinationSelect.appendChild(option)
  }

  const requestedDestination = destinations.
    find((entry) => sameDestination(entry, destination))
  if (requestedDestination) {
    destinationSelect.value = serializeDestination(requestedDestination)
  } else if (destinations[0]) {
    destinationSelect.value = serializeDestination(destinations[0])
  }

  updateMoveButtonState()
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

async function getSourceTitle (fromWindowId, groupId, targetScope) {
  if (targetScope === KEY_TARGET_GROUP && groupId !== undefined) {
    return getGroupTitle(groupId)
  }
  return getWindowTitle(fromWindowId)
}

function getTargetTitle (targetScope) {
  return i18n.getMessage(targetScope === KEY_TARGET_GROUP
    ? 'targetGroupSelect'
    : 'targetGlobalSelect')
}

function createTabOption (unit, groupInfos, index) {
  const checkboxId = 'tab-option-' + index
  const label = document.createElement('label')
  label.className = 'tab-option'
  label.htmlFor = checkboxId
  label.setAttribute('role', 'option')
  label.setAttribute('aria-selected', 'false')

  const checkbox = document.createElement('input')
  checkbox.id = checkboxId
  checkbox.type = 'checkbox'
  checkbox.dataset.tabIds = unit.tabs.map((tab) => tab.id).join(',')

  const title = document.createElement('span')
  title.className = 'tab-title'
  title.textContent = getUnitTitle(unit, groupInfos)

  label.append(checkbox, title)
  return label
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
  fromWindowId, groupId, targetScope, destination, notification, focus) {
  const normalizedTargetScope = targetScope || KEY_TARGET_GLOBAL
  const title = getTargetTitle(normalizedTargetScope)
  document.title = title
  document.getElementById('selectionTitle').textContent = title
  document.getElementById('source').textContent = await getSourceTitle(
    fromWindowId, groupId, normalizedTargetScope)
  document.getElementById(KEY_SOURCE_WINDOW_ID).value = String(fromWindowId)
  document.getElementById(KEY_GROUP_ID).value = groupId === undefined
    ? ''
    : String(groupId)
  document.getElementById(KEY_TARGET_SCOPE).value = normalizedTargetScope

  document.getElementById(KEY_NOTIFICATION).value = String(notification)
  document.getElementById(KEY_FOCUS).value = String(focus)

  await setDestinationOptions({
    fromWindowId,
    groupId,
    targetScope: normalizedTargetScope,
  }, destination)

  let tabList = await tabs.query({ windowId: fromWindowId })
  if (normalizedTargetScope === KEY_TARGET_GROUP) {
    tabList = tabList.filter((tab) => tab.groupId === groupId)
  }
  const units = normalizedTargetScope === KEY_TARGET_GLOBAL
    ? buildTopLevelUnits(tabList)
    : buildTabUnits(tabList)
  const groupInfos = await getGroupInfoMap()

  const select = document.getElementById(KEY_SELECT)
  select.replaceChildren()
  units.forEach((unit, index) => {
    select.appendChild(createTabOption(unit, groupInfos, index))
  })

  updateMoveButtonState()
  const firstCheckbox = getTabCheckboxes()[0]
  if (firstCheckbox) {
    firstCheckbox.focus()
  } else {
    document.getElementById(KEY_DESTINATION).focus()
  }
  await windows.update(windows.WINDOW_ID_CURRENT, { focused: true })
}

function normalizeDestinationMessage (message) {
  if (message[KEY_DESTINATION]) {
    return message[KEY_DESTINATION]
  }
  if (message.toWindowId === undefined) {
    return { type: 'newWindow' }
  }
  return { type: 'window', windowId: message.toWindowId }
}

async function handleMessage (message) {
  debug('Message ' + JSON.stringify(message) + ' was received')
  if (message.type !== KEY_RESET) {
    return
  }

  await reset(
    message.fromWindowId,
    message[KEY_GROUP_ID],
    message[KEY_TARGET_SCOPE] || KEY_TARGET_GLOBAL,
    normalizeDestinationMessage(message),
    message.notification ?? DEFAULT_NOTIFICATION,
    message.focus ?? DEFAULT_FOCUS,
  )
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
  document.getElementById(KEY_DESTINATION).addEventListener('change', () => {
    updateMoveButtonState()
  })
  document.getElementById(KEY_SELECT).
    addEventListener('keydown', handleTabListKeyDown)
  document.getElementById(KEY_SELECT).
    addEventListener('change', handleTabListChange)

  runtime.onMessage.addListener((message) => {
    return handleMessage(message).catch(onError)
  })
}

init().catch(onError)
