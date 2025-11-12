import { notFound } from "next/navigation";
import { ProjectClient } from "@/components/ProjectClient";
import { getServiceSupabaseClient } from "@/lib/serverSupabase";
import { mapDocumentQueryRow, type DocumentQueryRow } from "@/lib/documents";
import type {
  AvailabilitySlot,
  ParticipantAvailability,
  ProjectDocumentWithRelations,
  ProjectInvitee,
} from "@/types";

type PageProps = {
  params: Promise<{ projectId: string }>;
};

type ProjectRow = {
  id: string;
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
};

type InviteeRow = {
  id: string;
  project_id: string;
  name: string;
  password: string | null;
  created_at: string;
};

type ResponseRow = {
  id: string;
  project_id: string;
  invitee_id: string | null;
  name: string;
  slots: unknown;
  created_at: string;
};

export const revalidate = 0;

export default async function ProjectPage({ params }: PageProps) {
  const { projectId } = await params;
  const supabase = getServiceSupabaseClient();

  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, title, description, start_date, end_date, start_time, end_time, created_at"
    )
    .eq("id", projectId)
    .single();

  if (error || !data) {
    notFound();
  }

  const projectRow = data as ProjectRow;

  const { data: inviteesData } = await supabase
    .from("project_invitees")
    .select("id, project_id, name, password, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  const invitees: ProjectInvitee[] =
    (inviteesData as InviteeRow[] | null)?.map((item) => ({
      id: item.id,
      projectId: item.project_id,
      name: item.name,
      password: item.password,
      createdAt: item.created_at,
    })) ?? [];

  const { data: responsesData } = await supabase
    .from("availability_responses")
    .select("id, project_id, invitee_id, name, slots, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  const initialResponses: ParticipantAvailability[] =
    (responsesData as ResponseRow[] | null)?.map((item) => ({
      id: item.id,
      projectId: item.project_id,
      inviteeId: item.invitee_id,
      name: item.name,
      slots: Array.isArray(item.slots)
        ? (item.slots as AvailabilitySlot[])
        : [],
      createdAt: item.created_at,
    })) ?? [];

  const { data: documentsData } = await supabase
    .from("project_documents")
    .select(
      "id, project_id, file_path, file_type, total_pages, current_version, uploaded_by, shared_with_all, created_at, document_permissions(document_id, invitee_id, can_view, can_edit, created_at), document_versions(id, document_id, version, merged_file_path, created_at), document_signatures(id, document_id, invitee_id, version, strokes_json, typed_text, typed_font, typed_color, uploaded_signature_path, overlay_image_path, signed_at, created_at), document_notes(id, document_id, invitee_id, content, visible_to, allow_replies, created_at, document_note_replies(id, note_id, invitee_id, content, created_at))"
    )
    .eq("project_id", projectId);

  const documents: ProjectDocumentWithRelations[] =
    (documentsData as DocumentQueryRow[] | null)?.map(mapDocumentQueryRow) ?? [];

  return (
    <main className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <ProjectClient
          project={{
            id: projectRow.id,
            title: projectRow.title,
            description: projectRow.description,
            startDate: projectRow.start_date,
            endDate: projectRow.end_date,
            startTime: projectRow.start_time,
            endTime: projectRow.end_time,
            createdAt: projectRow.created_at,
          }}
          invitees={invitees}
          initialResponses={initialResponses}
          documents={documents}
        />
      </div>
    </main>
  );
}


