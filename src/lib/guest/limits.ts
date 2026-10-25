// Portable values shared by browser contracts, storage and server transports.
export const GUEST_MAX_REQUEST_BYTES = 16_384;
export const GUEST_MAX_SECRET_CHARACTERS = 4096;
export const GUEST_MAX_DECIMAL_ID_CHARACTERS = 32;
export const GUEST_SOURCE_DEADLINE_MS = 15_000;
export const GUEST_MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
export const GUEST_CANVAS_MAX_EVENT_BLOCKS = 5000;
export const GUEST_CANVAS_MAX_ASSIGNMENTS = 2000;
export const GUEST_CANVAS_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const GUEST_ED_MAX_COURSES = 500;
export const GUEST_ED_COURSES_MAX_OUTPUT_BYTES = 512 * 1024;
export const GUEST_ED_MAX_RAW_LESSONS = 2000;
export const GUEST_ED_MAX_VISIBLE_LESSONS = 1000;
export const GUEST_ED_LESSONS_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const GUEST_MAX_ASSIGNMENTS = 10_000;
export const GUEST_MAX_STATUSES = 10_000;
export const GUEST_MAX_COURSES = 1000;
export const GUEST_MAX_DATASET_BYTES = 8 * 1024 * 1024;
export const GUEST_MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const GUEST_LEASE_MS = 30_000;
export const GUEST_LEASE_RENEW_MS = 5000;
export const GUEST_RUN_DEADLINE_MS = 180_000;
export const GUEST_MAX_DISPATCHED_OPERATIONS = 100;
export const GUEST_MAX_REGISTERED_REQUESTS = GUEST_MAX_DISPATCHED_OPERATIONS + 4;
export const GUEST_CANVAS_BATCH_SIZE = 25;
export const GUEST_GRADESCOPE_BATCH_SIZE = 1;
export const GUEST_EXTENSION_WAIT_MS = 30_000;
export const GUEST_CAPABILITY_MS = 30 * 60 * 1000;
export const GUEST_BUDGET_WINDOW_SECONDS = 600;
export const GUEST_BOOTSTRAP_NETWORK_BUDGET = 10;
export const GUEST_READ_SESSION_BUDGET = 30;
export const GUEST_READ_NETWORK_BUDGET = 60;
export const GUEST_READ_GLOBAL_BUDGET = 60;

export const GUEST_MAX_EXTERNAL_ID_CHARACTERS = 2048;
export const GUEST_MAX_URL_CHARACTERS = 2048;
export const GUEST_MAX_TITLE_CHARACTERS = 500;
export const GUEST_MAX_COURSE_NAME_CHARACTERS = 240;
export const GUEST_MAX_SHORT_NAME_CHARACTERS = 160;
export const GUEST_MAX_TERM_CHARACTERS = 80;
export const GUEST_MAX_YEAR_CHARACTERS = 16;
export const GUEST_MAX_STATUS_TEXT_CHARACTERS = 500;
export const GUEST_MAX_GRADE_CHARACTERS = 200;
export const GUEST_MAX_GRADE_VALUE_CHARACTERS = 128;
export const GUEST_MAX_EXTRACTOR_VERSION_CHARACTERS = 80;
export const GUEST_MAX_SEARCH_CHARACTERS = 500;

/** JSON UTF-8 size, without depending on Node or browser storage globals. */
export function guestJsonBytes(value:unknown):number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
