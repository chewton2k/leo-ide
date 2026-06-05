import { persistedString, persistedNumber } from '../session/persisted';

/** IndexedDB id of the active background image; '' means none. */
export const bgImageId = persistedString('leo-bg-image-id', '');
/** Background overlay strength, 0..50 (percent). Kept integer for persistedNumber. */
export const bgOpacity = persistedNumber('leo-bg-opacity', 15);
/** Background blur in px, 0..40 (static images only). */
export const bgBlur = persistedNumber('leo-bg-blur', 0);

export const BG_OPACITY_MAX = 50;
export const BG_BLUR_MAX = 40;
