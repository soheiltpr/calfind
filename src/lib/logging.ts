import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabaseClient } from "./serverSupabase";

type ActivityLogInsertPayload = {
  project_id: string;
  invitee_id: string | null;
  actor_name: string | null;
  action: ActivityAction;
  details?: ActivityDetails;
};

export type ActivityAction =
  | "project_created"
  | "availability_saved"
  | "document_uploaded"
  | "document_downloaded"
  | "document_viewed"
  | "document_signed"
  | "note_added"
  | "note_replied"
  | "login_success"
  | "login_failed";

export type ActivityDetails = {
  summary: string;
  data?: Record<string, unknown>;
};

export type LogPayload = {
  projectId: string;
  inviteeId?: string | null;
  actorName?: string | null;
  action: ActivityAction;
  details?: ActivityDetails;
};

export const logClientActivity = async (
  supabase: SupabaseClient,
  { projectId, inviteeId = null, actorName = null, action, details }: LogPayload
) => {
  try {
    const payload: ActivityLogInsertPayload = {
      project_id: projectId,
      invitee_id: inviteeId,
      actor_name: actorName,
      action,
      details,
    };
    await supabase.from("project_activity_logs").insert(payload as unknown as never);
  } catch (error) {
    console.error("logClientActivity error", error);
  }
};

export const logServerActivity = async ({
  projectId,
  inviteeId = null,
  actorName = null,
  action,
  details,
}: LogPayload) => {
  try {
    const supabase = getServiceSupabaseClient();
    const payload: ActivityLogInsertPayload = {
      project_id: projectId,
      invitee_id: inviteeId,
      actor_name: actorName,
      action,
      details,
    };
    await supabase.from("project_activity_logs").insert(payload as unknown as never);
  } catch (error) {
    console.error("logServerActivity error", error);
  }
};
