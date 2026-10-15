import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";

export async function deleteCurrentAccount(
  db:D1DatabaseLike,
  scope:UserScope,
):Promise<void>{
  await db.batch([
    db.prepare("DELETE FROM accounts WHERE userId=?").bind(scope.userId),
    db.prepare("DELETE FROM sessions WHERE userId=?").bind(scope.userId),
    db.prepare("DELETE FROM users WHERE id=?").bind(scope.userId),
  ]);
}
