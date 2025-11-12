import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabaseClient } from "@/lib/serverSupabase";

type DocumentPermissionRow = {
  document_id: string;
  invitee_id: string;
  can_view: boolean;
  can_edit: boolean;
};

type DocumentSignatureRow = {
  invitee_id: string;
  overlay_image_path: string | null;
  signed_at: string | null;
};

type DocumentVersionRow = {
  merged_file_path: string;
  version: number;
};

type DocumentWithRelations = {
  id: string;
  project_id: string;
  file_path: string;
  file_type: string;
  current_version: number;
  shared_with_all: boolean;
  document_permissions?: DocumentPermissionRow[];
  document_signatures?: DocumentSignatureRow[];
  document_versions?: DocumentVersionRow[];
};

const bucket =
  process.env.SUPABASE_STORAGE_BUCKET ?? "project-documents";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; documentId: string }> }
) {
  const { projectId, documentId } = await context.params;
  const supabase = getServiceSupabaseClient();
  const searchParams = new URL(request.url).searchParams;
  const inviteeId = searchParams.get("inviteeId");

  const { data: document, error } = await supabase
    .from("project_documents")
    .select(
      "id, project_id, file_path, file_type, current_version, shared_with_all, document_permissions(document_id, invitee_id, can_view, can_edit), document_signatures(invitee_id, overlay_image_path, signed_at), document_versions(merged_file_path, version)"
    )
    .eq("id", documentId)
    .eq("project_id", projectId)
    .single();

  if (error || !document) {
    return NextResponse.json(
      { error: "Document not found." },
      { status: 404 }
    );
  }

  const typedDocument = document as DocumentWithRelations;

  if (!typedDocument.shared_with_all) {
    const hasPermission = typedDocument.document_permissions?.some(
      (permission) => permission.invitee_id === inviteeId && permission.can_view
    );
    if (!hasPermission) {
      return NextResponse.json(
        { error: "Access denied." },
        { status: 403 }
      );
    }
  }

  const latestVersionPath = typedDocument.document_versions?.find(
    (version) => version.version === typedDocument.current_version
  )?.merged_file_path;

  const filePath = latestVersionPath ?? typedDocument.file_path;

  const { data: signedUrlData, error: signedUrlError } = await supabase
    .storage.from(bucket)
    .createSignedUrl(filePath, 60 * 10);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return NextResponse.json(
      { error: "Failed to create signed URL." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    document: {
      id: typedDocument.id,
      projectId: typedDocument.project_id,
      fileType: typedDocument.file_type,
      signedUrl: signedUrlData.signedUrl,
    },
  });
}


