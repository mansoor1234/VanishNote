/**
 * Pages that are never indexed (noindex, no-store) and never listed in the sitemap: notes,
 * downloads, requests, the API, the dashboard, and the token links sent by email.
 * Shared by the server headers and the sitemap filter in astro.config.mjs.
 */
export const PRIVATE_PATH = /^\/(n|d|r|api|app|verify|reset|join|forgot)(\/|$)/;
