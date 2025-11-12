import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabaseClient } from "@/lib/serverSupabase";
import {
  filterDocumentsForInvitee,
  type DocumentQueryRow,
} from "@/lib/documents";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const supabase = getServiceSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const inviteeId = searchParams.get("inviteeId");
    const includeAllParam = searchParams.get("includeAll") ?? "";
    const includeAll = ["1", "true", "yes"].includes(
      includeAllParam.toLowerCase()
    );

    const { data, error } = await supabase
      .from("project_documents")
      .select(
        "id, project_id, file_path, file_type, total_pages, current_version, uploaded_by, shared_with_all, created_at, document_permissions(document_id, invitee_id, can_view, can_edit, created_at), document_versions(id, document_id, version, merged_file_path, created_at), document_signatures(id, document_id, invitee_id, version, strokes_json, typed_text, typed_font, typed_color, uploaded_signature_path, overlay_image_path, signed_at, created_at), document_notes(id, document_id, invitee_id, content, visible_to, allow_replies, created_at, document_note_replies(id, note_id, invitee_id, content, created_at)))"
      )
      .eq("project_id", projectId);

    if (error) {
      console.error("documents list fetch error", error);
      return NextResponse.json(
        { error: "دریافت اسناد با خطا مواجه شد." },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as DocumentQueryRow[];
    const documents = filterDocumentsForInvitee(rows, inviteeId, includeAll);

    return NextResponse.json({ documents });
  } catch (error) {
    console.error("documents list api error", error);
    return NextResponse.json(
      { error: "دریافت اسناد با خطا مواجه شد." },
      { status: 500 }
    );
  }
}
