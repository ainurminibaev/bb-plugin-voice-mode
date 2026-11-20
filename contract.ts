import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const VoiceModelOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  vendor: z.string(),
  groupLabel: z.string().optional(),
  api: z.string().optional(),
  reasoning: z
    .object({ supported: z.boolean(), canDisable: z.boolean().optional(), efforts: z.array(z.string()) })
    .optional(),
});
export type VoiceModelOption = z.infer<typeof VoiceModelOptionSchema>;

export const VoiceModelSelectionSchema = z.object({
  realtimeModel: z.string(),
  transcribeModel: z.string(),
  delegationModel: z.string(),
});
export type VoiceModelSelection = z.infer<typeof VoiceModelSelectionSchema>;

export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";
export const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

export const MODEL_SETTINGS_CHANNEL = "voice-mode:model-settings";

export const voiceModeRpcContract = defineRpcContract({
  "models.list": {
    input: z
      .object({
        scope: z.enum(["realtime", "transcription", "delegation"]),
        refresh: z.boolean().optional(),
      })
      .strict(),
    output: z.object({
      models: z.array(VoiceModelOptionSchema),
      latestModelsOnly: z.boolean().optional(),
    }),
  },
  "modelSettings.get": {
    input: z.null(),
    output: VoiceModelSelectionSchema,
  },
  "modelSettings.set": {
    input: VoiceModelSelectionSchema.partial().strict(),
    output: VoiceModelSelectionSchema,
  },
});
