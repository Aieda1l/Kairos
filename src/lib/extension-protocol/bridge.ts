import { z } from "zod";
import {
  canvasBridgeRequestV1Schema,
  canvasBridgeResponseV1Schema,
} from "./submission-status";
import {
  gradescopeBridgeRequestV1Schema,
  gradescopeBridgeResponseV1Schema,
} from "./gradescope";

export const kairosBridgeRequestV1Schema=z.union([
  canvasBridgeRequestV1Schema,
  gradescopeBridgeRequestV1Schema,
]);

export const kairosBridgeResponseV1Schema=z.union([
  canvasBridgeResponseV1Schema,
  gradescopeBridgeResponseV1Schema,
]);

export type KairosBridgeRequestV1=z.infer<typeof kairosBridgeRequestV1Schema>;
export type KairosBridgeResponseV1=z.infer<typeof kairosBridgeResponseV1Schema>;
