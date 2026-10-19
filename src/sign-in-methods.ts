// Ways to sign in besides passkeys that this installation offers (GET /api/auth/methods). E-mail codes only
// appear once an admin has set up sending, SMS codes only with the SMS module and a provider.
import { useQuery } from "./store";

export interface SignInMethods {
  email: boolean;
  sms: boolean;
  /** Fresh installation without an admin: the app opens the setup. */
  setupPending: boolean;
}

/** null while loading: show no code options until it is clear they work. */
export function useSignInMethods(): SignInMethods | null {
  return useQuery<SignInMethods>("/auth/methods").data ?? null;
}
