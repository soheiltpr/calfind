import { NextRequest, NextResponse } from "next/server";
import { logServerActivity } from "@/lib/logging";
import { getServiceSupabaseClient } from "@/lib/serverSupabase";

type DocumentNoteReplyInsertPayload = {
  note_id: string;
  invitee_id: string;
  content: string;
};

type DocumentNoteReplyRowOut = {
  id: string;
  note_id: string;
  invitee_id: string | null;
  content: string;
  created_at: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; documentId: string; noteId: string }> }
) {
  try {
    const { projectId, noteId } = await context.params;
    const supabase = getServiceSupabaseClient();
    const body = await request.json();
    const { inviteeId, actorName, content } = body ?? {};

    if (!inviteeId || !content) {
      return NextResponse.json(
        { error: "اطلاعات پاسخ ناقص است." },
        { status: 400 }
      );
    }

    const payload: DocumentNoteReplyInsertPayload = {
      note_id: noteId,
      invitee_id: inviteeId,
      content,
    };

    const { data, error } = await supabase
      .from("document_note_replies")
      .insert(payload as unknown as never)
      .select("id, created_at")
      .single();

    if (error || !data) {
      console.error("note reply insert error", error);
      return NextResponse.json(
        { error: "ثبت پاسخ با خطا مواجه شد." },
        { status: 500 }
      );
    }

    const typedReply = data as unknown as DocumentNoteReplyRowOut;

    await logServerActivity({
      projectId,
      inviteeId,
      actorName,
      action: "note_replied",
      details: {
        summary: "پاسخ به یادداشت ثبت شد",
        data: { noteId, replyId: typedReply.id },
      },
    });

    return NextResponse.json({ replyId: typedReply.id, createdAt: typedReply.created_at });
  } catch (error) {
    console.error("document note reply api error", error);
    return NextResponse.json(
      { error: "ثبت پاسخ با خطا مواجه شد." },
      { status: 500 }
    );
  }
}
