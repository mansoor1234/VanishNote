import type { APIRoute } from 'astro';
import { handleDeleteNote } from '../../../../server/api';
import { apiDeps } from '../../../../server/deps';

export const prerender = false;

export const DELETE: APIRoute = ({ request, params, locals }) =>
  handleDeleteNote(request, params.id ?? '', apiDeps(locals));
