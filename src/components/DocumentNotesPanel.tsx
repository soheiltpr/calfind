"use client";

import { useMemo, useState } from "react";
import { formatJalaliDate } from "@/lib/format";
import type { DocumentSignatureNote, ProjectInvitee } from "@/types";

type NoteNode = Omit<DocumentSignatureNote, "replies"> & { replies: NoteNode[] };

type Props = {
  documentId: string;
  currentVersion: number;
  notes: DocumentSignatureNote[];
  inviteeNameMap: Record<string, string>;
  inviteeOptions: ProjectInvitee[];
  currentInviteeId: string;
  onCreateNote: (input: {
    documentId: string;
    version: number;
    body: string;
    visibleTo: string[] | null;
    allowReplies: boolean;
    parentNoteId?: string;
  }) => Promise<void>;
};

const isVisibleForInvitee = (
  note: DocumentSignatureNote,
  inviteeId: string
) => {
  if (!note.visibleTo || note.visibleTo.length === 0) return true;
  if (note.authorInviteeId === inviteeId) return true;
  return note.visibleTo.includes(inviteeId);
};

const buildTree = (
  notes: DocumentSignatureNote[],
  viewerId: string
): NoteNode[] => {
  const filtered = notes.filter((note) => isVisibleForInvitee(note, viewerId));
  const map = new Map<string, NoteNode>();
  filtered.forEach((note) => {
    map.set(note.id, { ...note, replies: [] as NoteNode[] });
  });
  const roots: NoteNode[] = [];
  filtered.forEach((note) => {
    const node = map.get(note.id);
    if (!node) return;
    if (note.parentNoteId && map.has(note.parentNoteId)) {
      map.get(note.parentNoteId)!.replies.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortNodes = (arr: NoteNode[]) =>
    arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  sortNodes(roots);
  roots.forEach((root) => sortNodes(root.replies));
  return roots;
};

export const DocumentNotesPanel = ({
  documentId,
  currentVersion,
  notes,
  inviteeNameMap,
  inviteeOptions,
  currentInviteeId,
  onCreateNote,
}: Props) => {
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState("");
  const [visibilityMode, setVisibilityMode] = useState<"ALL" | "CUSTOM">("ALL");
  const [selectedInvitees, setSelectedInvitees] = useState<string[]>([]);
  const [allowReplies, setAllowReplies] = useState(true);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tree = useMemo(
    () => buildTree(notes, currentInviteeId),
    [notes, currentInviteeId]
  );

  const handleSubmit = async () => {
    if (!body.trim()) {
      setError("متن یادداشت را بنویسید.");
      return;
    }
    if (visibilityMode === "CUSTOM" && selectedInvitees.length === 0) {
      setError("حداقل یک مخاطب انتخاب کنید.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onCreateNote({
        documentId,
        version: currentVersion,
        body: body.trim(),
        visibleTo:
          visibilityMode === "ALL" ? null : selectedInvitees.map((id) => id),
        allowReplies,
      });
      setBody("");
      setSelectedInvitees([]);
      setAllowReplies(true);
      setVisibilityMode("ALL");
    } catch (err) {
      console.error(err);
      setError("ثبت یادداشت انجام نشد.");
    } finally {
      setPending(false);
    }
  };

  const handleReplySubmit = async (parent: NoteNode) => {
    const replyBody = replyDrafts[parent.id]?.trim();
    if (!replyBody) return;
    setPending(true);
    try {
      await onCreateNote({
        documentId,
        version: parent.version ?? currentVersion,
        body: replyBody,
        visibleTo: parent.visibleTo ?? null,
        allowReplies: true,
        parentNoteId: parent.id,
      });
      setReplyDrafts((prev) => ({ ...prev, [parent.id]: "" }));
    } catch (err) {
      console.error(err);
      setError("ثبت پاسخ انجام نشد.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? "پنهان کردن یادداشت‌ها" : "مشاهده یادداشت‌ها"}
      </button>
      {expanded ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-inner">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">
              یادداشت جدید
            </label>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="متن یادداشت..."
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-sky-400 focus:outline-none"
              rows={3}
            />
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`visibility-${documentId}`}
                  checked={visibilityMode === "ALL"}
                  onChange={() => setVisibilityMode("ALL")}
                />
                برای همه
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`visibility-${documentId}`}
                  checked={visibilityMode === "CUSTOM"}
                  onChange={() => setVisibilityMode("CUSTOM")}
                />
                انتخاب مخاطب
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allowReplies}
                  onChange={(event) => setAllowReplies(event.target.checked)}
                />
                امکان پاسخ
              </label>
            </div>
            {visibilityMode === "CUSTOM" ? (
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                {inviteeOptions.map((invitee) => (
                  <label key={invitee.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      value={invitee.id}
                      checked={selectedInvitees.includes(invitee.id)}
                      onChange={(event) => {
                        const { checked } = event.target;
                        setSelectedInvitees((prev) => {
                          if (checked) {
                            return [...prev, invitee.id];
                          }
                          return prev.filter((id) => id !== invitee.id);
                        });
                      }}
                    />
                    {invitee.name}
                  </label>
                ))}
              </div>
            ) : null}
            {error ? (
              <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">
                {error}
              </div>
            ) : null}
            <button
              type="button"
              className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleSubmit}
              disabled={pending}
            >
              ثبت یادداشت
            </button>
          </div>

          <div className="space-y-3">
            {tree.length === 0 ? (
              <p className="text-xs text-slate-500">
                هنوز یادداشتی برای این سند ثبت نشده است.
              </p>
            ) : (
              tree.map((note) => (
                <div key={note.id} className="space-y-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  <header className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-700">
                      {note.authorInviteeId ? inviteeNameMap[note.authorInviteeId] ?? note.authorInviteeId : "-"}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {formatJalaliDate(note.createdAt)}
                    </span>
                  </header>
                  <p className="leading-6 text-slate-600">{note.content}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                      <span>👥</span>
                      <span>
                        {note.visibleTo && note.visibleTo.length
                          ? note.visibleTo
                              .map((id) => inviteeNameMap[id] ?? "-")
                              .join("، ")
                          : "نمایش برای همه"}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                      <span>{note.allowReplies ? "💬" : "🚫"}</span>
                      <span>{note.allowReplies ? "امکان پاسخ" : "بدون پاسخ"}</span>
                    </span>
                  </div>
                  {note.allowReplies ? (
                    <div className="space-y-2 rounded-xl bg-slate-50/70 px-3 py-2">
                      {note.replies.map((reply) => (
                        <div key={reply.id} className="space-y-1 rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <header className="flex items-center justify-between text-[11px] text-slate-500">
                            <span>{reply.authorInviteeId ? inviteeNameMap[reply.authorInviteeId] ?? reply.authorInviteeId : "-"}</span>
                            <span>{formatJalaliDate(reply.createdAt)}</span>
                          </header>
                          <p className="text-slate-600">{reply.content}</p>
                        </div>
                      ))}
                      <div className="space-y-2">
                        <textarea
                          value={replyDrafts[note.id] ?? ""}
                          onChange={(event) =>
                            setReplyDrafts((prev) => ({
                              ...prev,
                              [note.id]: event.target.value,
                            }))
                          }
                          placeholder="پاسخ خود را بنویسید..."
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-sky-400 focus:outline-none"
                          rows={2}
                        />
                        <button
                          type="button"
                          className="rounded-full bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => handleReplySubmit(note)}
                          disabled={pending}
                        >
                          ثبت پاسخ
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
