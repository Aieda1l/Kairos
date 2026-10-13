import type {D1DatabaseLike} from '@/lib/db/d1/types';
import type {UserScope} from '@/lib/auth/user-scope';
import 'server-only';
export type AccountSummary={name:string|null;email:string|null;identityProvider:'google'|'microsoft'|'unknown'};
export async function getAccountSummary(db:D1DatabaseLike,scope:UserScope):Promise<AccountSummary>{
  // The projection excludes all account identifiers, credentials and session rows.
  const row=await db.prepare(`SELECT u.name,u.email,
    (SELECT a.provider FROM accounts a WHERE a.userId=u.id
      AND a.provider IN ('google','microsoft-entra-id') ORDER BY a.provider LIMIT 1) AS provider
    FROM users u WHERE u.id=?`).bind(scope.userId).first<{name:string|null;email:string|null;provider:string|null}>();
  return {name:row?.name??null,email:row?.email??null,
    identityProvider:row?.provider==='google'?'google':row?.provider==='microsoft-entra-id'?'microsoft':'unknown'};
}
