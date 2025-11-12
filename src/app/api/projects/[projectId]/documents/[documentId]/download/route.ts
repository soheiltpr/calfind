import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabaseClient } from "@/lib/serverSupabase";

type DocumentWithVersions = {
  file_path: string;
  file_type: string;
  current_version: number;
  document_versions?: Array<{ merged_file_path: string; version: number }>;
};

const bucket =
  process.env.SUPABASE_STORAGE_BUCKET ?? "project-documents";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; documentId: string }> }
) {
  const { projectId, documentId } = await context.params;
  const supabase = getServiceSupabaseClient();

  const { data: document, error } = await supabase
    .from("project_documents")
    .select(
      "file_path, file_type, current_version, document_versions(merged_file_path, version)"
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

  const typedDocument = document as DocumentWithVersions;

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

  return NextResponse.json({ url: signedUrlData.signedUrl });
}


