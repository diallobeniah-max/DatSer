# Live Service QA Checklist

Use this short checklist before, during, and after church service. Supabase is the source of truth; local/offline cache is only a safety net.

## Before service
- Sign in and confirm the correct workspace, month, and Sunday date are selected.
- Open Data Management and confirm Connection Mode is `Auto` or `Online`.
- Confirm `Sync status` is up to date, or tap `Refresh data` once as a fallback.
- Search one known member and confirm the member list and Member Code load quickly.
- Add a temporary test member, mark Present, switch to Absent, then Clear. Confirm the Marked list/count changes each time.
- Refresh the browser and confirm the test member and final cleared attendance state remain correct.
- Run a quick two-device check: mark the test member Present on Device A and confirm Device B updates without Refresh; repeat with Absent and Clear.
- Confirm Team & Sharing loads the expected collaborator count and that the workspace override can be enabled and disabled once.

## During service
- Tapping `Present` or `Absent` should change the button/card state immediately.
- A notification should appear immediately with the member name, action, and time.
- If the network is slow, keep marking attendance; queued saves should sync automatically.
- If a save fails, do not re-enter the whole list. Retry that member/action after the error or use `Refresh data`.
- Avoid using bulk actions unless the selected date is confirmed.

## If internet is slow or offline
- Keep Connection Mode on `Auto` so local changes can queue.
- Watch for pending-sync messages; they mean the action is saved locally and will retry.
- Do not clear cache while pending changes exist.
- When internet returns, use `Sync Now` or wait for automatic sync, then verify the pending count returns to zero.
- If the same member is changed more than once while offline, the latest visible choice is the one that should sync.

## If a save fails
- Read the notification/error first.
- Retry the same button once after a few seconds.
- If it still fails, use Data Management → `Refresh data`, then retry.
- Do not assume “Saved” unless the UI says it saved or queued for retry.
- A red failure notification means the server did not confirm the change. The previous saved state should return; retry that one action.

## Emergency Refresh/Sync fallback
- Keep the member list open so cached data remains visible.
- Open Data Management and tap `Sync Now` first when pending changes are shown.
- After the pending count reaches zero, tap `Refresh data` once to pull the confirmed server state.
- If pending changes remain, do not clear cache or reinstall the app. Continue on the same device and record the affected member names for follow-up.

## After service
- Refresh the page and confirm the selected Sunday counts still match the marked list.
- Log out and back in, then confirm the same Sunday still shows the saved attendance.
- If another device is available, sign in there and confirm the latest attendance appears without manual data repair.
- Export only after the marked counts/list look correct.
- On a second device, verify one newly added member, one edited member, and the final Present/Absent/Clear result from the service.
