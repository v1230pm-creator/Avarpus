import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Longest edge a stored device photo keeps. Enough to read an IMEI sticker
 * when the phone fills the frame, small enough that four photos upload in a
 * few seconds on a shop connection (a raw 12–50 MP capture is 4–15 MB).
 */
export const REPAIR_PHOTO_MAX_EDGE = 2000;
/** Matches the JPEG quality the intake form has always uploaded at. */
export const REPAIR_PHOTO_JPEG_QUALITY = 0.7;

export interface RepairPhotoSource {
  /** Local image: a camera capture, a gallery `file://` / `ph://` / `content://` item. */
  uri: string;
  width?: number;
  height?: number;
}

/**
 * Normalise a captured or chosen picture into the file the intake form
 * uploads: a JPEG in the app's cache, downscaled to `REPAIR_PHOTO_MAX_EDGE`,
 * orientation baked in. Gallery originals stay untouched — the output is
 * always a new file the form owns.
 */
export async function prepareRepairPhoto(source: RepairPhotoSource): Promise<{ uri: string; width: number; height: number }> {
  const context = ImageManipulator.manipulate(source.uri);
  try {
    let width = source.width ?? 0;
    let height = source.height ?? 0;
    let rendered = null as Awaited<ReturnType<typeof context.renderAsync>> | null;
    if (!(width > 0 && height > 0)) {
      // Dimensions unknown (some providers report none): decode once to learn them.
      rendered = await context.renderAsync();
      width = rendered.width;
      height = rendered.height;
    }
    if (Math.max(width, height) > REPAIR_PHOTO_MAX_EDGE) {
      // Only the long edge is given, so the aspect ratio is preserved.
      context.resize(width >= height ? { width: REPAIR_PHOTO_MAX_EDGE } : { height: REPAIR_PHOTO_MAX_EDGE });
      rendered?.release();
      rendered = await context.renderAsync();
    } else if (!rendered) {
      rendered = await context.renderAsync();
    }
    try {
      const saved = await rendered.saveAsync({ compress: REPAIR_PHOTO_JPEG_QUALITY, format: SaveFormat.JPEG });
      return { uri: saved.uri, width: saved.width, height: saved.height };
    } finally {
      rendered.release();
    }
  } finally {
    context.release();
  }
}
