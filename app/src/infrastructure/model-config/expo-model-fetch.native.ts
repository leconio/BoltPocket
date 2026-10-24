import { fetch as expoFetch } from "expo/fetch";

/** Native model transport with a real incremental ReadableStream for SSE. */
export const expoModelFetch = expoFetch as unknown as typeof globalThis.fetch;
