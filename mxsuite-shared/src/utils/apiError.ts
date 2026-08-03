/**
 * Extracts a human-readable message from an API error.
 *
 * The shared ApiClient interceptor already transforms Axios errors into
 * ApiError objects ({ status, message, timestamp }), so `err.message`
 * is sufficient in most cases. This helper is defensive — it also handles
 * raw Axios errors and plain Error objects.
 */
export function getApiError(err: unknown, fallback = 'An unexpected error occurred'): string {
    if (!err || typeof err !== 'object') return fallback;
    const e = err as Record<string, unknown>;

    // Already-transformed ApiError (standard path via our interceptor)
    if (typeof e.message === 'string' && e.message.trim()) return e.message;

    // Raw Axios error that bypassed the interceptor (edge case)
    if (e.response && typeof e.response === 'object') {
        const data = (e.response as Record<string, unknown>).data;
        if (data && typeof data === 'object') {
            const msg = (data as Record<string, unknown>).message;
            if (typeof msg === 'string' && msg.trim()) return msg;
        }
    }

    return fallback;
}
