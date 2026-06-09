## Summary

Move tabs to another window from the right-click menu.

## Description

ClickTabMove moves tabs and tab groups from Firefox's right-click menu.

Choose a destination directly from the menu:

- A new window
- Another existing window
- A new tab group
- Another existing tab group

You can move:

- The clicked tab or the clicked tab group
- Tabs and groups to the right or left of the clicked item
- The clicked item and everything to the right or left
- All tabs and groups in the window
- Tabs selected in the tab bar from the "Selected Tabs" menu item
- Tabs and groups checked in the selection window from the "Choose Tabs and Groups" menu item
- Tabs inside the clicked group checked in the selection window from the "Choose Tabs in This Group" menu item

Moving all tabs from one window to another window can merge the two windows.
Moving a whole tab group to another window keeps it grouped.
Selecting a whole tab group is different from selecting every tab inside that group.
In the selection window, a group checkbox can mean "move the group", "move all tabs inside the group", or "move neither".
Tabs selected in the tab bar are moved as individual tabs, even if every tab in a group is selected.
Moving tabs into an existing group merges them into that group.

Pinned tabs remain pinned when they are moved to a window.
When pinned tabs are moved to a group, ClickTabMove can ask each time, move only unpinned tabs, or unpin the pinned tabs before moving them.

The settings page lets you choose where the right-click menu appears, which move targets are shown, the selection window size, focus behavior, pinned-tab handling, and notifications.
Optional notifications can show progress and completion.
The notification permission is requested only when notifications are enabled in settings.
