import { NextRequest, NextResponse } from "next/server";
import { logServerActivity } from "@/lib/logging";
import { getServiceSupabaseClient } from "@/lib/serverSupabase";

type DocumentNoteInsertPayload = {
  document_id: string;
  invitee_id: string;
  content: string;
  visible_to: string[] | null;
  allow_replies: boolean;
};

type DocumentNoteRowOut = {
  id: string;
  document_id: string;
  invitee_id: string | null;
  content: string;
  visible_to: string[] | null;
  allow_replies: boolean;
  created_at: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; documentId: string }> }
) {
  try {
    const { projectId, documentId } = await context.params;
    const supabase = getServiceSupabaseClient();
    const body = await request.json();
    const {
      inviteeId,
      actorName,
      content,
      visibleTo,
      shareWithAll,
      allowReplies,
    } = body ?? {};

    if (!inviteeId || !content) {
      return NextResponse.json(
        { error: "اطلاعات یادداشت ناقص است." },
        { status: 400 }
      );
    }

    const payload: DocumentNoteInsertPayload = {
      document_id: documentId,
      invitee_id: inviteeId,
      content,
      visible_to: shareWithAll ? null : (visibleTo ?? []),
      allow_replies: Boolean(allowReplies),
    };

    const { data, error } = await supabase
      .from("document_notes")
      .insert(payload as unknown as never)
      .select("id, created_at")
      .single();

    if (error || !data) {
      console.error("note insert error", error);
      return NextResponse.json(
        { error: "ثبت یادداشت با خطا مواجه شد." },
        { status: 500 }
      );
    }

    const typedNote = data as unknown as DocumentNoteRowOut;

    await logServerActivity({
      projectId,
      inviteeId,
      actorName,
      action: "note_added",
      details: {
        summary: "یادداشت جدید اضافه شد",
        data: {
          documentId,
          noteId: typedNote.id,
        },
      },
    });

    return NextResponse.json({ noteId: typedNote.id, createdAt: typedNote.created_at });
  } catch (error) {
    console.error("document note api error", error);
    return NextResponse.json(
      { error: "ثبت یادداشت با خطا مواجه شد." },
      { status: 500 }
    );
  }
}
