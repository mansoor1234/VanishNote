import type { APIRoute } from 'astro';
import { handleCreateNote } from '../../../server/api';
import { apiDeps } from '../../../server/deps';

export const prerender = false;

export const POST: APIRoute = ({ request, locals }) => handleCreateNote(request, apiDeps(locals, request));
