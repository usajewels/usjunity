package com.mxsuite.model.enums;

/**
 * Coach/platform-user availability status — displayed to members in the chat header.
 * Stored in-memory only (PresenceService); not persisted to the database.
 */
public enum AvailabilityStatus {
    ONLINE,
    BUSY,
    DO_NOT_DISTURB,
    BE_RIGHT_BACK,
    AWAY,
    APPEAR_OFFLINE
}
