---
name: Intake in-app camera
description: Rules behind the repair intake camera modal (viewfinder + gallery strip + category review) and its photo normalisation.
---
- The camera icon opens the in-app viewfinder directly (no chooser Alert); the gallery is a strip and an in-modal grid, never a system picker presented over the Modal; the category step lives inside the same Modal because sibling native Modals do not stack reliably on iOS.
**Why:** user requirement (Samsung-camera style, photo-only, gallery section) plus the existing iOS sibling-Modal workaround in the repair detail screen.
**How to apply:** new photo entry points should reuse `RepairPhotoCamera` rather than expo-image-picker's camera; web keeps the browser file picker because expo-media-library is unavailable there.

- Permission dialogs are serialised (camera first, then photo library) and both are re-read on `AppState` foreground while the modal is open; camera readiness is cleared only where the `CameraView` unmounts (close, gallery grid), never on a `facing` change, and the review overlays the still-mounted viewfinder.
**Why:** two concurrent native permission prompts misbehave on fresh installs; a Settings round-trip otherwise strands users on the denial screen; `onCameraReady` is not guaranteed to fire again after a flip, and remounting the camera per retake costs ~0.5s.

- Every captured or chosen picture goes through `prepareRepairPhoto` (expo-image-manipulator object API: resize long edge > 2000, JPEG 0.7) so the form always owns a readable `file://` cache JPEG; the form deletes those files on remove, after upload, and on unmount, and the camera deletes its raw capture after preparing or on retake.
**Why:** MediaLibrary URIs can be `ph://`/provider-backed and HEIC; raw captures are 4–15 MB against a 15 MB server cap; prepared copies otherwise accumulate in cache.
**How to apply:** keep width/height from the asset or capture when calling the util (skips a decode); release manipulator refs on every path.
