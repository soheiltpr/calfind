import { getServiceSupabaseClient } from "@/lib/serverSupabase";
import type { ProjectDocumentWithRelations } from "@/types";
import { randomUUID } from "crypto";

const bucket =
  process.env.SUPABASE_STORAGE_BUCKET ?? "project-documents";

export type DocumentUploadPayload = {
  projectId: string;
  file: File;
  fileType: "pdf" | "image";
  sharedWithAll: boolean;
  permissions: Array<{
    inviteeId: string;
    canView: boolean;
    canEdit: boolean;
  }>;
  uploadedBy?: string | null;
};

export const buildDocumentPath = (
  projectId: string,
  documentId: string,
  filename: string
) => {
  const cleanName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${projectId}/${documentId}/original/${cleanName}`;
};

export const buildMergedPath = (
  projectId: string,
  documentId: string,
  version: number,
  extension: string
) => `${projectId}/${documentId}/merged/v${version}.${extension}`;

export const buildOverlayPath = (
  projectId: string,
  documentId: string,
  inviteeId: string
) => `${projectId}/${documentId}/overlays/${inviteeId}-${randomUUID()}.png`;

export const uploadDocumentFile = async (
  path: string,
  file: File | Blob | Buffer,
  contentType?: string
) => {
  const supabase = getServiceSupabaseClient();
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType,
  });
  if (error) {
    throw error;
  }
  return path;
};

export const removeDocumentFolder = async (
  projectId: string,
  documentId: string
) => {
  const supabase = getServiceSupabaseClient();
  await supabase.storage
    .from(bucket)
    .remove([`${projectId}/${documentId}`])
    .catch(() => undefined);
};



export type DocumentNoteReplyRow = {
  id: string;
  note_id: string;
  invitee_id: string | null;
  content: string;
  created_at: string;
};

export type DocumentNoteRow = {
  id: string;
  document_id: string;
  invitee_id: string | null;
  content: string;
  visible_to: string[] | null;
  allow_replies: boolean;
  created_at: string;
  document_note_replies?: DocumentNoteReplyRow[];
};

export type DocumentQueryRow = {
  id: string;
  project_id: string;
  file_path: string;
  file_type: string;
  total_pages: number | null;
  current_version: number;
  uploaded_by?: string | null;
  shared_with_all: boolean;
  created_at: string;
  document_permissions?: Array<{
    document_id: string;
    invitee_id: string;
    can_view: boolean;
    can_edit: boolean;
    created_at: string;
  }>;
  document_versions?: Array<{
    id: string;
    document_id: string;
    version: number;
    merged_file_path: string;
    created_at: string;
  }>;
  document_signatures?: Array<{
    id: string;
    document_id: string;
    invitee_id: string;
    version: number;
    strokes_json: unknown;
    typed_text: string | null;
    typed_font: string | null;
    typed_color: string | null;
    uploaded_signature_path: string | null;
    overlay_image_path: string | null;
    signed_at: string | null;
    created_at: string;
  }>;
  document_notes?: DocumentNoteRow[];
};

export const mapDocumentQueryRow = (
  item: DocumentQueryRow
): ProjectDocumentWithRelations => ({
  id: item.id,
  projectId: item.project_id,
  filePath: item.file_path,
  fileType: item.file_type,
  totalPages: item.total_pages ?? undefined,
  currentVersion: item.current_version,
  uploadedBy: item.uploaded_by ?? undefined,
  sharedWithAll: item.shared_with_all,
  createdAt: item.created_at,
  permissions:
    item.document_permissions?.map((permission) => ({
      documentId: permission.document_id,
      inviteeId: permission.invitee_id,
      canView: permission.can_view,
      canEdit: permission.can_edit,
      createdAt: permission.created_at,
    })) ?? [],
  versions:
    item.document_versions?.map((version) => ({
      id: version.id,
      documentId: version.document_id,
      version: version.version,
      mergedFilePath: version.merged_file_path,
      createdAt: version.created_at,
    })) ?? [],
  signatures:
    item.document_signatures?.map((signature) => ({
      id: signature.id,
      documentId: signature.document_id,
      inviteeId: signature.invitee_id,
      version: signature.version,
      strokesJson: signature.strokes_json,
      typedText: signature.typed_text,
      typedFont: signature.typed_font,
      typedColor: signature.typed_color,
      uploadedSignaturePath: signature.uploaded_signature_path,
      overlayImagePath: signature.overlay_image_path,
      signedAt: signature.signed_at ?? undefined,
      createdAt: signature.created_at,
    })) ?? [],
  notes:
    item.document_notes?.map((note) => ({
      id: note.id,
      documentId: note.document_id,
      inviteeId: note.invitee_id ?? undefined,
      authorInviteeId: note.invitee_id ?? undefined,
      content: note.content,
      visibleTo: note.visible_to ?? undefined,
      allowReplies: note.allow_replies,
      createdAt: note.created_at,
      replies:
        note.document_note_replies?.map((reply) => ({
          id: reply.id,
          noteId: reply.note_id,
          inviteeId: reply.invitee_id ?? undefined,
          authorInviteeId: reply.invitee_id ?? undefined,
          content: reply.content,
          createdAt: reply.created_at,
        })) ?? [],
    })) ?? [],
});

export const filterDocumentsForInvitee = (
  rows: DocumentQueryRow[],
  inviteeId?: string | null,
  includeAll = false
): ProjectDocumentWithRelations[] => {
  return rows
    .filter((row) => {
      if (includeAll) return true;
      if (row.shared_with_all) return true;
      if (!inviteeId) return false;
      return row.document_permissions?.some(
        (permission) =>
          permission.invitee_id === inviteeId && permission.can_view
      );
    })
    .map(mapDocumentQueryRow);
};
