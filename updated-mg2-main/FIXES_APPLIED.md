# MG Manager fixes

## Existing Stock for Job
- Selecting **Use Existing Stock for Job** no longer automatically picks a warehouse lot.
- The flow is now **Stock Type -> Available Size**.
- Only sizes that have unused stock for the selected stock type are shown.
- Selecting a size automatically fills **Board Size**, **Receiving From**, and the available quantity.
- The normal supplier/stock-type flow remains unchanged when Existing Stock is off.

## Firebase cross-device saving
- Inventory writes now remove `undefined` fields before sending data to Firestore. Firestore rejects undefined values by default; the previous code caught that error and left the record only in browser `localStorage`, which made it appear device-specific.
- Inventory and job update/save failures are now surfaced instead of being silently treated as successful local saves.
- Real-time Firestore listeners remain enabled, so successful Firestore writes propagate to other devices using the same Firebase project.

## Important
The Firebase project/rules must be deployed and accessible to the app. This code does not use localStorage as the shared database; localStorage is only an offline/optimistic cache.
