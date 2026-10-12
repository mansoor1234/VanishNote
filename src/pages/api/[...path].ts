import type { APIRoute } from 'astro';
import { requestCtx } from '../../server/deps';
import { handleApi } from '../../server/router';

export const prerender = false;

/** Account, request, file and dev endpoints. See src/server/router.ts for the route table. */
export const ALL: APIRoute = ({ request, locals }) => handleApi(requestCtx(locals, request));
