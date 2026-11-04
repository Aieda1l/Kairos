import {guestSafeMessage,type GuestApiErrorCode} from "../errors";

/** Only a fixed public code and fixed safe copy may cross the guest boundary. */
export class GuestSourceError extends Error {
  constructor(readonly code:GuestApiErrorCode){super(guestSafeMessage(code));this.name="GuestSourceError";}
}
