import {
  KEY_CANCEL,
  KEY_PINNED_GROUP_CANCEL,
  KEY_PINNED_GROUP_DECISION,
  KEY_PINNED_GROUP_SKIP,
  KEY_PINNED_GROUP_UNPIN,
  KEY_REQUEST_ID,
  debug,
  onError,
} from './common.js'

const {
  i18n,
  runtime,
  windows,
} = browser

const params = new globalThis.URLSearchParams(globalThis.location.search)
const requestId = params.get(KEY_REQUEST_ID)
const pinnedCount = Number(params.get('count') || 0)

function setText (id, key, substitutions) {
  document.getElementById(id).textContent = i18n.getMessage(key, substitutions)
}

async function closeWindow (windowId) {
  await windows.remove(windowId)
  debug('Pinned confirmation window ' + windowId + ' was closed')
}

async function sendDecision (action) {
  const windowInfo = await windows.getCurrent()
  await runtime.sendMessage({
    type: KEY_PINNED_GROUP_DECISION,
    [KEY_REQUEST_ID]: requestId,
    action,
    remember: document.getElementById('remember').checked,
  })
  await closeWindow(windowInfo.id)
}

function bindAction (id, action) {
  document.getElementById(id).addEventListener('click', () => {
    sendDecision(action).catch(onError)
  })
}

function init () {
  document.title = i18n.getMessage('pinnedGroupDialogTitle')
  setText('label_pinnedGroupAction', 'pinnedGroupAction')
  setText('dialogTitle', 'pinnedGroupDialogTitle')
  setText('dialogMessage', 'pinnedGroupDialogMessage', pinnedCount)
  setText('label_pinnedGroupRemember', 'pinnedGroupRemember')
  setText(KEY_CANCEL, KEY_CANCEL)
  setText(KEY_PINNED_GROUP_SKIP, 'pinnedGroupDialogSkip')
  setText(KEY_PINNED_GROUP_UNPIN, 'pinnedGroupDialogUnpin')

  bindAction(KEY_CANCEL, KEY_PINNED_GROUP_CANCEL)
  bindAction(KEY_PINNED_GROUP_SKIP, KEY_PINNED_GROUP_SKIP)
  bindAction(KEY_PINNED_GROUP_UNPIN, KEY_PINNED_GROUP_UNPIN)
}

init()
