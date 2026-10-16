/**
 * Routes for every API endpoint added with accounts (the original anonymous note endpoints live
 * in src/pages/api/notes). One table: method, path pattern, handler, and its guards.
 */
import type { Limiter } from './api';
import {
  getApiKeyUser,
  getSessionUser,
  handleForgot,
  handleLogin,
  handleLoginCode,
  handleLogout,
  handleResendVerification,
  handleReset,
  handleSignup,
  handleVerify,
} from './auth';
import {
  handleCreateAccountNote,
  handleDeleteRecord,
  handleDownload,
  handleListRecords,
  handleNoteEvent,
  handleRecordEvents,
  handleSendNote,
} from './account-notes';
import type { Ctx } from './context';
import { error, tooManyRequests } from './http';
import { handleCreateRequest, handleOpenRequest, handleRequestKey, handleRespond } from './requests';
import {
  handleChangePassword,
  handleConsent,
  handleContact,
  handleCreateApiKey,
  handleDeleteAccount,
  handleDevOutbox,
  handleForgetDevices,
  handleProfile,
  handlePushSubscribe,
  handlePushTest,
  handlePushUnsubscribe,
  handleRevokeApiKey,
  handleTwoFactor,
} from './settings';
import {
  handleAuditCsv,
  handleBranding,
  handleGetPolicy,
  handleInvite,
  handleJoin,
  handlePolicy,
  handleRemoveLogo,
  handleRemoveMember,
  handleRenameTeam,
  handleRevokeInvite,
  handleShredMember,
} from './team';

type LimiterName = 'AUTH_LIMITER' | 'CREATE_LIMITER' | 'READ_LIMITER';

interface Route {
  method: string;
  pattern: RegExp;
  handler: (ctx: Ctx, ...params: string[]) => Promise<Response>;
  auth?: boolean;
  /** Also accepts `Authorization: Bearer vn_…` (personal API key). Never on account or security settings. */
  apiKey?: boolean;
  limiter?: LimiterName;
}

const ID = '([A-Za-z0-9_-]{1,64})';

const routes: Route[] = [
  // Accounts
  { method: 'POST', pattern: /^\/api\/auth\/signup$/, handler: handleSignup, limiter: 'AUTH_LIMITER' },
  { method: 'POST', pattern: /^\/api\/auth\/verify$/, handler: handleVerify, limiter: 'AUTH_LIMITER' },
  { method: 'POST', pattern: /^\/api\/auth\/resend$/, handler: handleResendVerification, limiter: 'AUTH_LIMITER' },
  { method: 'POST', pattern: /^\/api\/auth\/login$/, handler: handleLogin, limiter: 'AUTH_LIMITER' },
  { method: 'POST', pattern: /^\/api\/auth\/login\/code$/, handler: handleLoginCode, limiter: 'AUTH_LIMITER' },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/, handler: handleLogout },
  { method: 'POST', pattern: /^\/api\/auth\/forgot$/, handler: handleForgot, limiter: 'AUTH_LIMITER' },
  { method: 'POST', pattern: /^\/api\/auth\/reset$/, handler: handleReset, limiter: 'AUTH_LIMITER' },

  // Dashboard: notes, requests, activity (also usable with an API key)
  { method: 'GET', pattern: /^\/api\/account\/records$/, handler: handleListRecords, auth: true, apiKey: true },
  { method: 'GET', pattern: new RegExp(`^/api/account/records/${ID}$`), handler: handleRecordEvents, auth: true, apiKey: true },
  { method: 'DELETE', pattern: new RegExp(`^/api/account/records/${ID}$`), handler: handleDeleteRecord, auth: true, apiKey: true },
  { method: 'POST', pattern: /^\/api\/account\/notes$/, handler: handleCreateAccountNote, auth: true, apiKey: true, limiter: 'CREATE_LIMITER' },
  { method: 'POST', pattern: new RegExp(`^/api/account/notes/${ID}/send$`), handler: handleSendNote, auth: true, apiKey: true, limiter: 'CREATE_LIMITER' },
  { method: 'POST', pattern: /^\/api\/account\/requests$/, handler: handleCreateRequest, auth: true, apiKey: true, limiter: 'CREATE_LIMITER' },
  { method: 'GET', pattern: new RegExp(`^/api/account/requests/${ID}/key$`), handler: handleRequestKey, auth: true, apiKey: true },
  { method: 'POST', pattern: new RegExp(`^/api/account/requests/${ID}/open$`), handler: handleOpenRequest, auth: true, apiKey: true },

  // Team
  { method: 'POST', pattern: /^\/api\/account\/team\/invite$/, handler: handleInvite, auth: true, limiter: 'CREATE_LIMITER' },
  { method: 'DELETE', pattern: /^\/api\/account\/team\/invite$/, handler: handleRevokeInvite, auth: true },
  { method: 'DELETE', pattern: new RegExp(`^/api/account/team/members/${ID}$`), handler: handleRemoveMember, auth: true },
  { method: 'POST', pattern: /^\/api\/account\/team\/join$/, handler: handleJoin, auth: true, limiter: 'AUTH_LIMITER' },
  { method: 'POST', pattern: /^\/api\/account\/team\/name$/, handler: handleRenameTeam, auth: true },
  { method: 'POST', pattern: /^\/api\/account\/team\/branding$/, handler: handleBranding, auth: true },
  { method: 'DELETE', pattern: /^\/api\/account\/team\/branding\/logo$/, handler: handleRemoveLogo, auth: true },
  // Team admin (owner, Standard and Business)
  { method: 'POST', pattern: /^\/api\/account\/team\/policy$/, handler: handlePolicy, auth: true },
  { method: 'POST', pattern: new RegExp(`^/api/account/team/members/${ID}/shred$`), handler: handleShredMember, auth: true },
  { method: 'GET', pattern: /^\/api\/account\/team\/audit\.csv$/, handler: handleAuditCsv, auth: true },
  // The rules notes must follow (API clients and the browser extension)
  { method: 'GET', pattern: /^\/api\/account\/policy$/, handler: handleGetPolicy, auth: true, apiKey: true },

  // Settings
  { method: 'POST', pattern: /^\/api\/account\/profile$/, handler: handleProfile, auth: true },
  { method: 'POST', pattern: /^\/api\/account\/password$/, handler: handleChangePassword, auth: true, limiter: 'AUTH_LIMITER' },
  { method: 'POST', pattern: /^\/api\/account\/delete$/, handler: handleDeleteAccount, auth: true, limiter: 'AUTH_LIMITER' },
  { method: 'POST', pattern: /^\/api\/account\/push$/, handler: handlePushSubscribe, auth: true },
  { method: 'DELETE', pattern: /^\/api\/account\/push$/, handler: handlePushUnsubscribe, auth: true },
  { method: 'POST', pattern: /^\/api\/account\/push\/test$/, handler: handlePushTest, auth: true, limiter: 'CREATE_LIMITER' },
  { method: 'POST', pattern: /^\/api\/account\/contact$/, handler: handleContact, auth: true, limiter: 'CREATE_LIMITER' },
  { method: 'POST', pattern: /^\/api\/account\/2fa$/, handler: handleTwoFactor, auth: true, limiter: 'AUTH_LIMITER' },
  { method: 'DELETE', pattern: /^\/api\/account\/2fa\/devices$/, handler: handleForgetDevices, auth: true },
  { method: 'POST', pattern: /^\/api\/account\/api-key$/, handler: handleCreateApiKey, auth: true, limiter: 'AUTH_LIMITER' },
  { method: 'DELETE', pattern: /^\/api\/account\/api-key$/, handler: handleRevokeApiKey, auth: true },
  { method: 'POST', pattern: /^\/api\/account\/consent$/, handler: handleConsent, auth: true },

  // Public (no account): responding to requests, attachment downloads, wrong-password reports
  { method: 'POST', pattern: new RegExp(`^/api/requests/${ID}/respond$`), handler: handleRespond, limiter: 'READ_LIMITER' },
  { method: 'GET', pattern: new RegExp(`^/api/files/${ID}$`), handler: handleDownload, limiter: 'READ_LIMITER' },
  { method: 'POST', pattern: new RegExp(`^/api/notes/${ID}/events$`), handler: handleNoteEvent, limiter: 'READ_LIMITER' },

  // Local development only (404 unless DEV_OUTBOX=true on localhost)
  { method: 'GET', pattern: /^\/api\/dev\/outbox$/, handler: handleDevOutbox },
];

export async function handleApi(ctx: Ctx): Promise<Response> {
  const path = ctx.url.pathname;
  let methodMismatch = false;
  for (const route of routes) {
    const match = route.pattern.exec(path);
    if (!match) continue;
    if (route.method !== ctx.request.method) {
      methodMismatch = true;
      continue;
    }
    if (route.limiter) {
      const limiter = ctx.env[route.limiter] as Limiter | undefined;
      if (limiter) {
        const { success } = await limiter.limit({ key: ctx.request.headers.get('CF-Connecting-IP') ?? 'unknown' });
        if (!success) return tooManyRequests();
      }
    }
    if (route.auth) {
      ctx.user = (await getSessionUser(ctx)) ?? (route.apiKey ? await getApiKeyUser(ctx) : undefined);
      if (!ctx.user) {
        return ctx.request.headers.has('Authorization')
          ? error(401, 'unauthorized', 'That API key is missing, revoked, or not allowed on this endpoint.')
          : error(401, 'unauthorized', 'Please log in again.');
      }
    }
    return route.handler(ctx, ...match.slice(1).map((p) => decodeURIComponent(p)));
  }
  return methodMismatch ? error(405, 'method_not_allowed', 'Method not allowed.') : error(404, 'not_found', 'Not found.');
}
