import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabaseClient } from "@/lib/serverSupabase";
import {
  buildDocumentPath,
  uploadDocumentFile,
} from "@/lib/documents";
import { logServerActivity } from "@/lib/logging";
import { randomUUID } from "crypto";

const bucket =
  process.env.SUPABASE_STORAGE_BUCKET ?? "project-documents";

type DocumentInsertPayload = {
  id: string;
  project_id: string;
  file_path: string;
  file_type: string;
  total_pages: number | null;
  current_version: number;
  uploaded_by: string | null;
  shared_with_all: boolean;
};

type PermissionInsertPayload = {
  document_id: string;
  invitee_id: string;
  can_view: boolean;
  can_edit: boolean;
};

type DocumentVersionInsertPayload = {
  document_id: string;
  version: number;
  merged_file_path: string;
};

type DocumentRowOut = {
  id: string;
  project_id: string;
  file_path: string;
  file_type: string;
  total_pages: number | null;
  current_version: number;
  uploaded_by: string | null;
  shared_with_all: boolean;
  created_at: string;
};

type DocumentVersionRowOut = {
  id: string;
  document_id: string;
  version: number;
  merged_file_path: string;
  created_at: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const supabase = getServiceSupabaseClient();

  const formData = await request.formData();
  const metadataRaw = formData.get("metadata");
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing file upload." },
      { status: 400 }
    );
  }

  if (!metadataRaw || typeof metadataRaw !== "string") {
    return NextResponse.json(
      { error: "Missing metadata payload." },
      { status: 400 }
    );
  }

  let metadata: {
    sharedWithAll: boolean;
    permissions: Array<{
      inviteeId: string;
      canView: boolean;
      canEdit: boolean;
    }>;
    uploadedBy?: string | null;
  };

  try {
    metadata = JSON.parse(metadataRaw);
  } catch {
    return NextResponse.json(
      { error: "Invalid metadata JSON." },
      { status: 400 }
    );
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  const mimeType = file.type;
  const isPdf =
    mimeType === "application/pdf" || extension === "pdf";
  const isImage = mimeType.startsWith("image/") || ["png", "jpg", "jpeg"].includes(extension ?? "");

  if (!isPdf && !isImage) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload PDF or image." },
      { status: 400 }
    );
  }

  const documentId = randomUUID();
  const storagePath = buildDocumentPath(projectId, documentId, file.name);

  try {
    await uploadDocumentFile(storagePath, file);
  } catch (error) {
    console.error("Upload error", error);
    return NextResponse.json(
      { error: "Failed to upload document." },
      { status: 500 }
    );
  }

  const fileType = isPdf ? "pdf" : "image";

  const documentPayload: DocumentInsertPayload = {
    id: documentId,
    project_id: projectId,
    file_path: storagePath,
    file_type: fileType,
    total_pages: null,
    current_version: 1,
    uploaded_by: metadata.uploadedBy ?? null,
    shared_with_all: metadata.sharedWithAll ?? true,
  };

  const { data: documentRow, error: insertError } = await supabase
    .from("project_documents")
    .insert(documentPayload as unknown as never)
    .select("*")
    .single();

  if (insertError || !documentRow) {
    console.error("Document insert error", insertError);
    await supabase.storage.from(bucket).remove([storagePath]).catch(() => undefined);
    return NextResponse.json(
      { error: "Failed to record document." },
      { status: 500 }
    );
  }

  if (!metadata.sharedWithAll && metadata.permissions?.length) {
    const permissionPayload = metadata.permissions.map((permission) => ({
      document_id: documentId,
      invitee_id: permission.inviteeId,
      can_view: permission.canView,
      can_edit: permission.canEdit,
    })) as PermissionInsertPayload[];

    const { error: permissionError } = await supabase
      .from("document_permissions")
      .insert(permissionPayload as unknown as never);

    if (permissionError) {
      return NextResponse.json(
        { error: "Failed to store document permissions." },
        { status: 500 }
      );
    }
  }

  const versionPayload: DocumentVersionInsertPayload = {
    document_id: documentId,
    version: 1,
    merged_file_path: storagePath,
  };

  const { error: versionError, data: versionRow } = await supabase
    .from("document_versions")
    .insert(versionPayload as unknown as never)
    .select("*")
    .single();

  if (versionError || !versionRow) {
    console.error("Version insert error", versionError);
    return NextResponse.json(
      { error: "Failed to create document version record." },
      { status: 500 }
    );
  }

  const typedDoc = documentRow as unknown as DocumentRowOut;
  const typedVersion = versionRow as unknown as DocumentVersionRowOut;

  await logServerActivity({
    projectId,
    inviteeId: metadata.uploadedBy ?? null,
    actorName: metadata.uploadedBy ?? "organizer",
    action: "document_uploaded",
    details: {
      summary: "فایل جدید بارگذاری شد",
      data: { documentId, fileName: file.name },
    },
  });

  return NextResponse.json(
    {
      document: {
        id: typedDoc.id,
        projectId: typedDoc.project_id,
        filePath: typedDoc.file_path,
        fileType: typedDoc.file_type,
        currentVersion: typedDoc.current_version,
        sharedWithAll: typedDoc.shared_with_all,
        createdAt: typedDoc.created_at,
      },
      version: {
        id: typedVersion.id,
        documentId: typedVersion.document_id,
        version: typedVersion.version,
        mergedFilePath: typedVersion.merged_file_path,
        createdAt: typedVersion.created_at,
      },
    },
    { status: 201 }
  );
}


