// A release build defines these globals (bun build --define); plain Node runs get dev values.
export const VERSION = globalThis.LINKROT_VERSION ?? '0.0.0-dev';
export const BUILD_DATE = globalThis.LINKROT_BUILD_DATE ?? null;
