/**
 * Concept2 PM5 BLE UUIDs, from the "PM5 Bluetooth Smart Communications
 * Interface Definition". Base UUID is CE06xxxx-43E5-11E4-916C-0800200C9A66;
 * Web Bluetooth requires full lowercase 128-bit strings.
 */
const base = (shortId) => `ce06${shortId}-43e5-11e4-916c-0800200c9a66`;

export const PM5_DEVICE_INFO_SERVICE = base('0010');
export const PM5_CONTROL_SERVICE = base('0020');
export const PM5_ROWING_SERVICE = base('0030');

export const CHAR_GENERAL_STATUS = base('0031');
export const CHAR_ADDITIONAL_STATUS_1 = base('0032');
export const CHAR_ADDITIONAL_STATUS_2 = base('0033');
export const CHAR_SAMPLE_RATE = base('0034');
export const CHAR_STROKE_DATA = base('0035');

export const CHAR_FIRMWARE_REVISION = base('0014');

/** Values written to CHAR_SAMPLE_RATE. */
export const SAMPLE_RATE = {
  ONE_SEC: 0,
  HALF_SEC: 1, // PM5 default
  QUARTER_SEC: 2,
  TENTH_SEC: 3,
};

/** Stroke state enum, byte 10 of the general status characteristic. */
export const STROKE_STATES = [
  'waitingForMinSpeed',
  'waitingToAccelerate',
  'driving',
  'dwellingAfterDrive',
  'recovery',
];

/** Rowing state enum, byte 9 of the general status characteristic. */
export const ROWING_STATES = ['inactive', 'active'];
