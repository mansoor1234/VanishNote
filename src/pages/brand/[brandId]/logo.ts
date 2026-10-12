import type { APIRoute } from 'astro';
import { requestCtx } from '../../../server/deps';
import { handleLogo } from '../../../server/team';

export const prerender = false;

export const GET: APIRoute = ({ request, locals, params }) => handleLogo(requestCtx(locals, request), params.brandId ?? '');
