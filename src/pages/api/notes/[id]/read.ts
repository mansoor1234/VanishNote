import type { APIRoute } from 'astro';
import { handleReadNote } from '../../../../server/api';
import { apiDeps } from '../../../../server/deps';

export const prerender = false;

export const POST: APIRoute = ({ request, params, locals }) =>
  handleReadNote(request, params.id ?? '', apiDeps(locals, request));
