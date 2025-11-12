import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabaseClient } from "@/lib/serverSupabase";
import { buildMergedPath, buildOverlayPath, uploadDocumentFile } from "@/lib/documents";
import { dataUrlToBuffer } from "@/lib/files";
import { logServerActivity } from "@/lib/logging";

type DocumentRow = {
  file_type: string;
  current_version: number | null;
};

type SignatureMetaPayload = {
  mode?: "draw" | "typed" | "upload";
  opacity?: number;
  penColor?: string;
  penWidth?: number;
  typedText?: string;
  typedFont?: string;
  typedColor?: string;
  typedSize?: number;
  uploadedFileName?: string | null;
};

type PlacementPayload = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DocumentVersionInsert = {
  document_id: string;
  version: number;
  merged_file_path: string;
};

type DocumentUpdatePayload = {
  current_version: number;
};

type SignatureUpsertPayload = {
  document_id: string;
  invitee_id: string;
  version: number;
  overlay_image_path: string | null;
  strokes_json: PlacementPayload | null;
  typed_text: string | null;
  typed_font: string | null;
  typed_color: string | null;
  signed_at: string;
};

const handleStorageError = (error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message, error.stack);
  } else {
    console.error(error);
  }
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; documentId: string }> }
) {
  const { projectId, documentId } = await context.params;
  const supabase = getServiceSupabaseClient();

  let payload: {
    inviteeId: string;
    actorName?: string;
    overlayDataUrl?: string;
    mergedDataUrl: string;
    placement?: PlacementPayload;
    meta?: SignatureMetaPayload;
  };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!payload.inviteeId || !payload.mergedDataUrl) {
    return NextResponse.json(
      { error: "Missing invitee or signature payload." },
      { status: 400 }
    );
  }

  const meta = payload.meta ?? {};
  const mode = meta.mode ?? "draw";
  const opacity = meta.opacity ?? 1;

  const { data: documentRow, error: documentError } = await supabase
    .from("project_documents")
    .select("file_type, current_version")
    .eq("id", documentId)
    .eq("project_id", projectId)
    .single();

  if (documentError || !documentRow) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const typedDocument = documentRow as DocumentRow;

  if (typedDocument.file_type !== "image") {
    return NextResponse.json(
      { error: "امضای مستقیم برای اسناد PDF هنوز پشتیبانی نمی‌شود." },
      { status: 400 }
    );
  }

  let overlayPath: string | null = null;
  if (payload.overlayDataUrl) {
    try {
      const overlayBuffer = dataUrlToBuffer(payload.overlayDataUrl);
      overlayPath = buildOverlayPath(projectId, documentId, payload.inviteeId);
      await uploadDocumentFile(overlayPath, overlayBuffer, "image/png");
    } catch (error: unknown) {
      handleStorageError(error);
      return NextResponse.json(
        { error: "Failed to store signature overlay." },
        { status: 500 }
      );
    }
  }

  const mergedBuffer = (() => {
    try {
      return dataUrlToBuffer(payload.mergedDataUrl);
    } catch (error) {
      console.error("merged parse error", error);
      return null;
    }
  })();

  if (!mergedBuffer) {
    return NextResponse.json(
      { error: "Invalid merged image data." },
      { status: 400 }
    );
  }

  const nextVersion = (typedDocument.current_version ?? 1) + 1;
  const mergedPath = buildMergedPath(projectId, documentId, nextVersion, "png");

  try {
    await uploadDocumentFile(mergedPath, mergedBuffer, "image/png");
  } catch (mergeUploadError: unknown) {
    handleStorageError(mergeUploadError);
    return NextResponse.json(
      { error: "Failed to store merged document." },
      { status: 500 }
    );
  }

  const versionPayload: DocumentVersionInsert = {
    document_id: documentId,
    version: nextVersion,
    merged_file_path: mergedPath,
  };

  const { error: versionInsertError } = await supabase
    .from("document_versions")
    .insert(versionPayload as unknown as never);

  if (versionInsertError) {
    console.error("version insert error", versionInsertError);
    return NextResponse.json(
      { error: "Failed to store document version." },
      { status: 500 }
    );
  }

  const updatePayload: DocumentUpdatePayload = {
    current_version: nextVersion,
  };

  const { error: docUpdateError } = await supabase
    .from("project_documents")
    .update(updatePayload as unknown as never)
    .eq("id", documentId);

  if (docUpdateError) {
    console.error("document update error", docUpdateError);
    return NextResponse.json(
      { error: "Failed to update document state." },
      { status: 500 }
    );
  }

  const placementPayload = payload.placement
    ? {
        ...payload.placement,
        opacity,
        mode,
        penColor: meta.penColor ?? null,
        penWidth: meta.penWidth ?? null,
        typedSize: meta.typedSize ?? null,
        uploadedFileName: meta.uploadedFileName ?? null,
      }
    : null;

  const typedText = mode === "typed" ? meta.typedText ?? null : null;
  const typedFont = mode === "typed" ? meta.typedFont ?? null : null;
  const typedColor = mode === "typed" ? meta.typedColor ?? null : null;

  const signaturePayload: SignatureUpsertPayload = {
    document_id: documentId,
    invitee_id: payload.inviteeId,
    version: nextVersion,
    overlay_image_path: overlayPath,
    strokes_json: placementPayload,
    typed_text: typedText,
    typed_font: typedFont,
    typed_color: typedColor,
    signed_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase
    .from("document_signatures")
    .upsert(signaturePayload as unknown as never, { onConflict: "document_id,invitee_id" });

  if (upsertError) {
    console.error("signature upsert error", upsertError);
    return NextResponse.json(
      { error: "Failed to record signature." },
      { status: 500 }
    );
  }

  await logServerActivity({
    projectId,
    inviteeId: payload.inviteeId,
    actorName: payload.actorName ?? null,
    action: "document_signed",
    details: {
      summary: "سند امضا شد",
      data: { documentId, version: nextVersion },
    },
  });

  return NextResponse.json({ success: true, version: nextVersion });
}


