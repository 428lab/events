import type { User } from "@eventer/shared";
import type { Principal } from "./auth/session.js";

export interface AppEnv {
  Variables: {
    user: User;
    /** 認証の主体 (#581)。currentUser が解いたときに入る */
    principal: Principal;
  };
}
