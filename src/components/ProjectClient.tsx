"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AvailabilityForm,
  type AvailabilityFormHandle,
} from "@/components/AvailabilityForm";
import { AvailabilitySummary } from "@/components/AvailabilitySummary";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { formatJalaliDate, formatSlotLabel, toPersianDigits } from "@/lib/format";
import { logClientActivity } from "@/lib/logging";
import type {
  AvailabilitySlot,
  DocumentNote,
  ParticipantAvailability,
  Project,
  ProjectActivityLog,
  ProjectDocumentWithRelations,
  ProjectInvitee,
} from "@/types";
import { useRouter } from "next/navigation";

type Props = {
  project: Project;
  invitees: ProjectInvitee[];
  initialResponses: ParticipantAvailability[];
  documents: ProjectDocumentWithRelations[];
};

type NoteDraftState = {
  content: string;
  shareWithAll: boolean;
  selectedInvitees: string[];
  allowReplies: boolean;
  error?: string | null;
  saving?: boolean;
};

type ReplyDraftState = {
  content: string;
  error?: string | null;
  saving?: boolean;
};

type StepStatus = "done" | "current" | "pending" | "skipped";
type ProgressStep = { key: string; label: string; status: StepStatus };
type ParticipantSignatureStatus = "done" | "pending" | "not_required";

export const ProjectClient = ({
  project,
  invitees,
  initialResponses,
  documents,
}: Props) => {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const formRef = useRef<AvailabilityFormHandle>(null);
  const [responses, setResponses] =
    useState<ParticipantAvailability[]>(initialResponses);
  const [projectDocuments, setProjectDocuments] =
    useState<ProjectDocumentWithRelations[]>(documents);
  const [syncing, setSyncing] = useState(false);
  const [showResponses, setShowResponses] = useState(false);
  const [selectedInviteeId, setSelectedInviteeId] = useState<string>("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [currentParticipant, setCurrentParticipant] = useState<
    { id: string; inviteeId: string; name: string } | null
  >(null);

  const [activityLogs, setActivityLogs] = useState<ProjectActivityLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, NoteDraftState>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, ReplyDraftState>>({});

  const fetchDocuments = useCallback(
    async (options?: { inviteeId?: string; includeAll?: boolean }) => {
      try {
        const params = new URLSearchParams();
        const inviteeId = options?.inviteeId ?? currentParticipant?.inviteeId;
        const includeAll = options?.includeAll ??
          (currentParticipant?.name?.toLowerCase() === "admin");

        if (inviteeId) {
          params.set("inviteeId", inviteeId);
        }
        if (includeAll) {
          params.set("includeAll", "1");
        }

        const urlParams = params.toString();
        const response = await fetch(
          `/api/projects/${project.id}/documents/list${urlParams ? `?${urlParams}` : ""}`
        );

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          console.error("fetchDocuments failed", body);
          return;
        }

        const body = (await response.json()) as {
          documents: ProjectDocumentWithRelations[];
        };

        setProjectDocuments(body.documents);
      } catch (error) {
        console.error("fetchDocuments error", error);
      }
    },
    [project.id, currentParticipant]
  );

  const refreshResponses = useCallback(async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase
        .from("availability_responses")
        .select("id, project_id, invitee_id, name, slots, created_at")
        .eq("project_id", project.id)
        .order("created_at", { ascending: true });

      if (!error && data) {
        setResponses(
          data.map((item) => ({
            id: item.id,
            projectId: item.project_id,
            inviteeId: item.invitee_id,
            name: item.name,
            slots: Array.isArray(item.slots)
              ? (item.slots as AvailabilitySlot[])
              : [],
            createdAt: item.created_at,
          }))
        );
      }
    } finally {
      setSyncing(false);
    }
  }, [project.id, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel(`availability_responses_${project.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "availability_responses",
          filter: `project_id=eq.${project.id}`,
        },
        () => {
          refreshResponses();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [project.id, refreshResponses, supabase]);

  useEffect(() => {
    setProjectDocuments(documents);
  }, [documents]);

  useEffect(() => {
    const channel = supabase
      .channel(`project_documents_${project.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_documents",
          filter: `project_id=eq.${project.id}`,
        },
        () => {
          fetchDocuments();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "document_versions" },
        () => {
          fetchDocuments();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "document_signatures" },
        () => {
          fetchDocuments();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "document_notes" },
        () => {
          fetchDocuments();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "document_note_replies" },
        () => {
          fetchDocuments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [project.id, supabase, fetchDocuments]);

  const allowedTimes = useMemo(() => {
    const start = project.startTime ? timeToMinutes(project.startTime) : 0;
    const end = project.endTime ? timeToMinutes(project.endTime) : 24 * 60;
    return { startMinutes: start, endMinutes: end };
  }, [project.startTime, project.endTime]);

  const allowedDates = useMemo(
    () => ({ start: project.startDate, end: project.endDate }),
    [project.startDate, project.endDate]
  );

  const ownedResponse = useMemo(() => {
    if (!currentParticipant) return undefined;
    return responses.find(
      (response) => response.inviteeId === currentParticipant.inviteeId
    );
  }, [responses, currentParticipant]);

  const handleSummarySegmentSelect = (
    slot: AvailabilitySlot,
    info: { owned: boolean; participantIds: string[] }
  ) => {
    if (!currentParticipant) return;

    if (info.owned && ownedResponse) {
      formRef.current?.prefillSlot(slot, {
        message:
          "این بازه جزو زمان‌های شماست. می‌توانید آن را ویرایش کرده و دوباره ذخیره کنید.",
      });
      setShowResponses(true);
      return;
    }

    const confirmed = window.confirm(
      "این بازه متعلق به فرد دیگری است. آیا می‌خواهید آن را به زمان‌های خود اضافه کنید؟"
    );

    if (confirmed) {
      formRef.current?.addSlot(slot, {
        message: "این بازه به زمان‌های شما اضافه شد.",
      });
    }
  };

  const participantCount = responses.length;

  const currentInviteeId = currentParticipant?.inviteeId ?? null;

  const inviteeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    invitees.forEach((invitee) => map.set(invitee.id, invitee.name));
    return map;
  }, [invitees]);

  const isAdmin = currentParticipant?.name?.toLowerCase() === "admin";

  const adminInviteeId = useMemo(() => {
    const admin = invitees.find((invitee) => invitee.name?.toLowerCase() === "admin");
    return admin?.id ?? null;
  }, [invitees]);

  const ensureEssentialInvitees = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      if (currentInviteeId) {
        set.add(currentInviteeId);
      }
      if (adminInviteeId) {
        set.add(adminInviteeId);
      }
      return Array.from(set);
    },
    [adminInviteeId, currentInviteeId]
  );

  const buildDefaultNoteDraft = useCallback((): NoteDraftState => {
    return {
      content: "",
      shareWithAll: true,
      selectedInvitees: ensureEssentialInvitees([]),
      allowReplies: false,
    };
  }, [ensureEssentialInvitees]);

  const isNoteVisibleToViewer = (note: DocumentNote, viewerId?: string | null, adminView?: boolean) => {
    if (adminView) return true;
    if (!viewerId) return false;
    if (note.inviteeId === viewerId) return true;
    const targets = note.visibleTo;
    if (!targets || targets.length === 0) return true;
    return targets.includes(viewerId);
  };

  const updateNoteDraft = (documentId: string, patch: Partial<NoteDraftState>) => {
    setNoteDrafts((previous) => {
      const base = previous[documentId] ?? buildDefaultNoteDraft();
      const nextSelected =
        patch.selectedInvitees !== undefined
          ? ensureEssentialInvitees(patch.selectedInvitees)
          : base.selectedInvitees;
      return {
        ...previous,
        [documentId]: {
          ...base,
          ...patch,
          selectedInvitees: nextSelected,
        },
      };
    });
  };

  const fetchActivityLogs = useCallback(async () => {
    setLogsLoading(true);
    const { data, error } = await supabase
      .from("project_activity_logs")
      .select("id, project_id, invitee_id, actor_name, action, details, created_at")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("activity log fetch error", error);
    }

    if (!error && data) {
      setActivityLogs(
        data.map((item) => ({
          id: item.id,
          projectId: item.project_id,
          inviteeId: item.invitee_id ?? undefined,
          actorName: item.actor_name ?? undefined,
          action: item.action,
          details: item.details ?? undefined,
          createdAt: item.created_at,
        }))
      );
    }

    setLogsLoading(false);
  }, [project.id, supabase]);

  const updateReplyDraft = (noteId: string, patch: Partial<ReplyDraftState>) => {
    setReplyDrafts((previous) => {
      const base = previous[noteId] ?? { content: "" };
      return { ...previous, [noteId]: { ...base, ...patch } };
    });
  };

  useEffect(() => {
    setNoteDrafts({});
    setReplyDrafts({});
  }, [currentInviteeId, isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setActivityLogs([]);
      return;
    }

    fetchActivityLogs();

    const channel = supabase
      .channel(`project_activity_logs_${project.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_activity_logs",
          filter: `project_id=eq.${project.id}`,
        },
        () => {
          fetchActivityLogs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchActivityLogs, isAdmin, project.id, supabase]);

  const accessibleDocuments = useMemo(() => {
    if (!currentParticipant) return [];
    if (currentParticipant.name?.toLowerCase() === "admin") {
      return projectDocuments;
    }
    return projectDocuments.filter((document) => {
      if (document.sharedWithAll) {
        return true;
      }
      const permission = document.permissions.find(
        (item) => item.inviteeId === currentParticipant.inviteeId
      );
      return permission?.canView ?? false;
    });
  }, [currentParticipant, projectDocuments]);

  const submitNote = async (document: ProjectDocumentWithRelations) => {
    if (!currentParticipant) return;
    const draft = noteDrafts[document.id] ?? buildDefaultNoteDraft();
    const trimmed = draft.content.trim();

    if (!trimmed) {
      updateNoteDraft(document.id, { error: "متن یادداشت را وارد کنید." });
      return;
    }

    const visibleTo = draft.shareWithAll
      ? undefined
      : ensureEssentialInvitees(draft.selectedInvitees);

    updateNoteDraft(document.id, { saving: true, error: null });

    try {
      const payload: Record<string, unknown> = {
        inviteeId: currentParticipant.inviteeId,
        actorName: currentParticipant.name,
        content: trimmed,
        shareWithAll: draft.shareWithAll,
        allowReplies: draft.allowReplies,
      };
      if (visibleTo) {
        payload.visibleTo = visibleTo;
      }

      const response = await fetch(
        `/api/projects/${project.id}/documents/${document.id}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        updateNoteDraft(document.id, {
          error: (body as { error?: string }).error ?? "ثبت یادداشت با خطا مواجه شد.",
          saving: false,
        });
        return;
      }

      await fetchDocuments();
      setNoteDrafts((previous) => ({
        ...previous,
        [document.id]: buildDefaultNoteDraft(),
      }));
    } catch (error) {
      console.error(error);
      updateNoteDraft(document.id, {
        error: "ثبت یادداشت با خطا مواجه شد.",
        saving: false,
      });
    }
  };

  const submitReply = async (noteId: string, documentId: string) => {
    if (!currentParticipant) return;
    const draft = replyDrafts[noteId] ?? { content: "" };
    const trimmed = draft.content.trim();

    if (!trimmed) {
      updateReplyDraft(noteId, { error: "متن پاسخ را وارد کنید." });
      return;
    }

    updateReplyDraft(noteId, { saving: true, error: null });

    try {
      const response = await fetch(
        `/api/projects/${project.id}/documents/${documentId}/notes/${noteId}/replies`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inviteeId: currentParticipant.inviteeId,
            actorName: currentParticipant.name,
            content: trimmed,
          }),
        }
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        updateReplyDraft(noteId, {
          error: (body as { error?: string }).error ?? "ثبت پاسخ با خطا مواجه شد.",
          saving: false,
        });
        return;
      }

      await fetchDocuments();
      setReplyDrafts((previous) => ({
        ...previous,
        [noteId]: { content: "" },
      }));
    } catch (error) {
      console.error(error);
      updateReplyDraft(noteId, {
        error: "ثبت پاسخ با خطا مواجه شد.",
        saving: false,
      });
    }
  };

  const canEditDocument = (
    document: ProjectDocumentWithRelations,
    inviteeId: string
  ) => {
    if (document.sharedWithAll) return true;
    const permission = document.permissions.find(
      (item) => item.inviteeId === inviteeId
    );
    return permission?.canEdit ?? false;
  };

  const formatActivityAction = (action: string) => {
    switch (action) {
      case "project_created":
        return "پروژه ساخته شد";
      case "availability_saved":
        return "دسترسی زمانی ثبت شد";
      case "document_uploaded":
        return "سند جدید بارگذاری شد";
      case "document_downloaded":
        return "دانلود سند";
      case "document_viewed":
        return "مشاهده سند";
      case "document_signed":
        return "سند امضا شد";
      case "note_added":
        return "یادداشت جدید درج شد";
      case "note_replied":
        return "پاسخ به یادداشت ثبت شد";
      case "login_success":
        return "ورود موفق";
      case "login_failed":
        return "ورود ناموفق";
      default:
        return action;
    }
  };

  const formatActivitySummary = (log: ProjectActivityLog) => {
    return log.details?.summary ?? formatActivityAction(log.action);
  };

  const progressData = useMemo(() => {
    if (!currentParticipant || isAdmin) {
      return { steps: [] as ProgressStep[], progressPercent: 0, signatureSummary: "" };
    }

    const availabilityResponse = responses.find(
      (response) => response.inviteeId === currentParticipant.inviteeId
    );
    const availabilityDone = Boolean(availabilityResponse?.slots?.length);

    const editableDocs = projectDocuments.filter((document) =>
      canEditDocument(document, currentParticipant.inviteeId)
    );
    const completedSignatures = editableDocs.filter((document) =>
      document.signatures.some(
        (signature) => signature.inviteeId === currentParticipant.inviteeId
      )
    ).length;

    const totalEditableDocs = editableDocs.length;

    let signatureStatus: StepStatus;
    if (totalEditableDocs === 0) {
      signatureStatus = "skipped";
    } else if (completedSignatures === totalEditableDocs) {
      signatureStatus = "done";
    } else if (availabilityDone) {
      signatureStatus = "current";
    } else {
      signatureStatus = "pending";
    }

    const baseSteps: ProgressStep[] = [
      { key: "auth", label: "ورود", status: "done" },
      {
        key: "availability",
        label: "زمان‌های من",
        status: availabilityDone ? "done" : "pending",
      },
      { key: "signature", label: "امضا", status: signatureStatus },
    ];

    let currentAssigned = false;
    const normalizedSteps = baseSteps.map((step) => {
      if (step.status === "done" || step.status === "skipped") {
        return step;
      }
      if (!currentAssigned) {
        currentAssigned = true;
        return { ...step, status: "current" as StepStatus };
      }
      return { ...step, status: "pending" as StepStatus };
    });

    const completedSteps = normalizedSteps.filter(
      (step) => step.status === "done" || step.status === "skipped"
    ).length;

    const progressPercent =
      normalizedSteps.length === 0
        ? 0
        : Math.round((completedSteps / normalizedSteps.length) * 100);

    const signatureSummary =
      totalEditableDocs === 0
        ? "سندی برای امضای شما ثبت نشده است."
        : completedSignatures === totalEditableDocs
        ? "تمام اسناد شما امضا شده‌اند."
        : `امضا نشده: ${toPersianDigits(
            totalEditableDocs - completedSignatures
          )} از ${toPersianDigits(totalEditableDocs)}`;

    return { steps: normalizedSteps, progressPercent, signatureSummary };
  }, [currentParticipant, projectDocuments, responses, isAdmin]);

  const participantStatuses = useMemo(() => {
    return invitees
      .filter((invitee) => invitee.name?.toLowerCase() !== "admin")
      .map((invitee) => {
      const response = responses.find((item) => item.inviteeId === invitee.id);
      const hasAvailability = Boolean(response?.slots?.length);
      const editableDocs = projectDocuments.filter((document) =>
        canEditDocument(document, invitee.id)
      );
      const completedSignatures = editableDocs.filter((document) =>
        document.signatures.some(
          (signature) => signature.inviteeId === invitee.id
        )
      ).length;
      const signatureStatus: ParticipantSignatureStatus =
        editableDocs.length === 0
          ? "not_required"
          : completedSignatures === editableDocs.length
          ? "done"
          : "pending";

      return {
        invitee,
        hasAvailability,
        signatureStatus,
      };
    });
  }, [invitees, projectDocuments, responses]);

  const handleAuthenticate = async () => {
    setAuthError(null);
    const invitee = invitees.find((item) => item.id === selectedInviteeId);
    if (!invitee) {
      setAuthError("لطفاً نام خود را انتخاب کنید.");
      return;
    }

    if (invitee.password && invitee.password.trim().length > 0) {
      if (invitee.password !== passwordInput.trim()) {
        await logClientActivity(supabase, {
          projectId: project.id,
          inviteeId: invitee.id,
          actorName: invitee.name,
          action: "login_failed",
          details: {
            summary: "ورود ناموفق",
            data: { reason: "incorrect_password" },
          },
        });
        setAuthError("رمز عبور نادرست است.");
        return;
      }
    }

    setCurrentParticipant({
      id: invitee.id,
      inviteeId: invitee.id,
      name: invitee.name,
    });
    setPasswordInput("");

    await logClientActivity(supabase, {
      projectId: project.id,
      inviteeId: invitee.id,
      actorName: invitee.name,
      action: "login_success",
      details: {
        summary: "ورود موفق",
        data: { inviteeId: invitee.id, inviteeName: invitee.name },
      },
    });

    const isAdminLogin = invitee.name?.toLowerCase() === "admin";
    await fetchDocuments({ inviteeId: invitee.id, includeAll: isAdminLogin });

    if (isAdminLogin) {
      fetchActivityLogs();
    }
  };

  const handleDownload = async (documentId: string) => {
    try {
      const response = await fetch(
        `/api/projects/${project.id}/documents/${documentId}/download`
      );
      if (!response.ok) {
        throw new Error("Failed to get download link.");
      }
      const body = await response.json();
      if (body.url) {
        window.open(body.url, "_blank");
        if (currentParticipant) {
          const documentMeta = projectDocuments.find((doc) => doc.id === documentId);
          await logClientActivity(supabase, {
            projectId: project.id,
            inviteeId: currentParticipant.inviteeId,
            actorName: currentParticipant.name,
            action: "document_downloaded",
            details: {
              summary: "دانلود سند",
              data: {
                documentId,
                documentName: documentMeta?.filePath?.split('/')?.pop() ?? documentId,
              },
            },
          });
          if (currentParticipant.name?.toLowerCase() === "admin") {
            fetchActivityLogs();
          }
        }
      }
    } catch (downloadError) {
      console.error(downloadError);
      alert("دانلود سند با خطا مواجه شد.");
    }
  };

  const handleSign = (documentId: string) => {
    if (!currentParticipant) return;
    const params = new URLSearchParams({
      invitee: currentParticipant.inviteeId,
      actorName: currentParticipant.name,
    });
    router.push(
      `/project/${project.id}/document/${documentId}/sign?${params.toString()}`
    );
  };

  return (
    <div className="space-y-8">
      <header className="rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur sm:p-8">
        <div className="space-y-2">
          <p className="text-xs.font-semibold text-sky-600">لینک پروژه</p>
          <h1 className="text-2xl font-bold text-slate-800">{project.title}</h1>
          {project.description ? (
            <p className="text-sm leading-relaxed text-slate-600">
              {project.description}
            </p>
          ) : null}
        </div>
        <div className="mt-6 flex flex-wrap gap-3 text-xs text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">
            تاریخ ایجاد: {formatJalaliDate(project.createdAt)}
          </span>
          {project.startDate && project.endDate ? (
            <span className="rounded-full bg-slate-100 px-3 py-1">
              بازه تاریخ مجاز: {formatJalaliDate(project.startDate)} تا {formatJalaliDate(project.endDate)}
            </span>
          ) : null}
          {project.startTime && project.endTime ? (
            <span className="rounded-full bg-slate-100 px-3 py-1">
              بازه ساعت مجاز: {project.startTime} تا {project.endTime}
            </span>
          ) : null}
          <span className="rounded-full bg-slate-100 px-3 py-1">
            تعداد پاسخ‌ها: {toPersianDigits(participantCount)}
          </span>
        </div>
        <div className="mt-6 rounded-2xl bg-slate-50/80 p-4 text-sm leading-7 text-slate-600">
          <p>۱. نام خود را از فهرست مدعوین انتخاب کرده و در صورت نیاز رمز را وارد کنید.</p>
          <p>۲. تنها تاریخ‌ها و ساعت‌های مجاز توسط برگزارکننده قابل انتخاب هستند.</p>
          <p>۳. هر زمان بخواهید می‌توانید با همان نام و رمز، بازه‌های خود را به‌روزرسانی کنید.</p>
        </div>
      </header>

      {currentParticipant ? (
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-5 text-sm font-semibold text-emerald-700 shadow-sm">
          {currentParticipant.name} عزیز، خوش آمدید! زمان‌های خود را از بخش زیر به‌روزرسانی کنید.
        </section>
      ) : null}

      {currentParticipant && !isAdmin && progressData.steps.length ? (
        <section className="rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-700">پیشرفت شما</h2>
            {progressData.signatureSummary ? (
              <span className="text-xs text-slate-500">{progressData.signatureSummary}</span>
            ) : null}
          </div>
          <div className="mt-4 h-2 rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progressData.progressPercent}%` }}
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            {progressData.steps.map((step) => {
              const icon =
                step.status === "done"
                  ? "✅"
                  : step.status === "current"
                  ? "🟢"
                  : step.status === "pending"
                  ? "⚪️"
                  : "⏭️";
              const toneClass =
                step.status === "done"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : step.status === "current"
                  ? "border-sky-200 bg-sky-50 text-sky-700"
                  : step.status === "pending"
                  ? "border-slate-200 bg-white text-slate-500"
                  : "border-slate-200 bg-slate-100 text-slate-500";
              return (
                <div
                  key={step.key}
                  className={`flex flex-col items-center gap-1 rounded-2xl border px-3 py-2 ${toneClass}`}
                >
                  <span className="text-base">{icon}</span>
                  <span className="font-semibold">{step.label}</span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {currentParticipant ? (
        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur">
          <h2 className="text-lg font-semibold text-slate-700">مدارک در انتظار امضا</h2>
          {accessibleDocuments.length ? (
            <div className="space-y-3">
              {accessibleDocuments.map((document) => {
                const editable = canEditDocument(document, currentParticipant.inviteeId);
                const signature = document.signatures.find(
                  (item) => item.inviteeId === currentParticipant.inviteeId
                );
                const noteDraft = noteDrafts[document.id] ?? buildDefaultNoteDraft();
                const replyDraftFor = (noteId: string): ReplyDraftState =>
                  replyDrafts[noteId] ?? { content: "" };
                const visibleNotes =
                  document.notes?.filter((note) =>
                    isNoteVisibleToViewer(
                      note,
                      currentParticipant.inviteeId,
                      isAdmin
                    )
                  ) ?? [];
                const canAddNote = (isAdmin || editable) && (isAdmin || Boolean(signature?.signedAt));
                const visibilityLabel = (note: DocumentNote) => {
                  if (!note.visibleTo || note.visibleTo.length === 0) {
                    return "نمایش برای همه‌ی مدعوین";
                  }
                  const names = note.visibleTo
                    .map((id) => inviteeNameMap.get(id) ?? "نامشخص")
                    .join("، ");
                  return `نمایش برای: ${names}`;
                };

                return (
                  <div
                    key={document.id}
                    className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="font-semibold text-slate-700">
                        {document.filePath.split("/").pop()}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                        نسخه فعلی: {toPersianDigits(document.currentVersion)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {signature?.signedAt
                        ? `امضا شده در ${formatJalaliDate(signature.signedAt)}`
                        : "هنوز امضا نشده"}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600 transition hover:bg-slate-100"
                        onClick={() => handleDownload(document.id)}
                      >
                        دانلود
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-emerald-500 bg-emerald-500 px-3 py-1 font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!editable}
                        onClick={() => handleSign(document.id)}
                      >
                        امضای آنلاین
                      </button>
                    </div>
                    {!editable ? (
                      <p className="text-xs text-rose-500">
                        این سند فقط برای مشاهده شما فعال است.
                      </p>
                    ) : null}

                    {visibleNotes.length ? (
                      <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3 text-xs">
                        {visibleNotes.map((note) => {
                          const authorName =
                            note.inviteeId
                              ? inviteeNameMap.get(note.inviteeId) ?? "نامشخص"
                              : "سیستم";
                          const replyDraft = replyDraftFor(note.id);
                          const canReply =
                            note.allowReplies &&
                            isNoteVisibleToViewer(
                              note,
                              currentParticipant.inviteeId,
                              isAdmin
                            );
                          return (
                            <div
                              key={note.id}
                              className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-700">{authorName}</span>
                                <span className="text-[11px] text-slate-500">
                                  {formatJalaliDate(note.createdAt)}
                                </span>
                              </div>
                              <p className="text-slate-600">{note.content}</p>
                              <p className="text-[11px] text-slate-400">{visibilityLabel(note)}</p>
                              {note.replies.length ? (
                                <div className="space-y-2 rounded-lg bg-slate-50 px-2 py-2">
                                  {note.replies.map((reply) => {
                                    const replier =
                                      reply.inviteeId
                                        ? inviteeNameMap.get(reply.inviteeId) ?? "نامشخص"
                                        : "سیستم";
                                    return (
                                      <div
                                        key={reply.id}
                                        className="space-y-1 rounded border border-slate-200 bg-white px-2 py-1"
                                      >
                                        <div className="flex items-center justify-between text-[11px]">
                                          <span className="font-semibold text-slate-600">{replier}</span>
                                          <span className="text-slate-400">{formatJalaliDate(reply.createdAt)}</span>
                                        </div>
                                        <p className="text-slate-600">{reply.content}</p>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                              {canReply ? (
                                <div className="space-y-2">
                                  <textarea
                                    value={replyDraft.content}
                                    onChange={(event) =>
                                      updateReplyDraft(note.id, { content: event.target.value, error: null })
                                    }
                                    placeholder="پاسخ خود را بنویسید..."
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-inner focus:border-emerald-500 focus:outline-none"
                                  />
                                  {replyDraft.error ? (
                                    <p className="text-[11px] text-rose-500">{replyDraft.error}</p>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="rounded-full border border-emerald-500 bg-emerald-500 px-3 py-1 font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                                    disabled={replyDraft.saving}
                                    onClick={() => submitReply(note.id, document.id)}
                                  >
                                    {replyDraft.saving ? "در حال ارسال..." : "ارسال پاسخ"}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">یادداشتی برای این سند ثبت نشده است.</p>
                    )}

                    {canAddNote ? (
                      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3 text-xs">
                        <p className="font-semibold text-slate-700">ثبت یادداشت</p>
                        <textarea
                          value={noteDraft.content}
                          onChange={(event) =>
                            updateNoteDraft(document.id, { content: event.target.value, error: null })
                          }
                          placeholder="متن یادداشت..."
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-inner focus:border-emerald-500 focus:outline-none"
                        />
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={noteDraft.shareWithAll}
                            onChange={(event) =>
                              updateNoteDraft(document.id, {
                                shareWithAll: event.target.checked,
                                selectedInvitees: noteDraft.selectedInvitees,
                                error: null,
                              })
                            }
                            className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                          />
                          نمایش برای تمام مدعوین
                        </label>
                        {!noteDraft.shareWithAll ? (
                          <div className="space-y-1">
                            <p className="text-[11px] text-slate-500">انتخاب افراد:</p>
                            <div className="flex flex-wrap gap-2">
                              {invitees.map((invitee) => {
                                const checked = noteDraft.selectedInvitees.includes(invitee.id);
                                const isEssential =
                                  invitee.id === currentInviteeId || invitee.id === adminInviteeId;
                                return (
                                  <label
                                    key={invitee.id}
                                    className={`inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 ${isEssential ? "opacity-80" : ""}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={isEssential}
                                      onChange={(event) => {
                                        const isChecked = event.target.checked;
                                        const next = isChecked
                                          ? [...noteDraft.selectedInvitees, invitee.id]
                                          : noteDraft.selectedInvitees.filter((id) => id !== invitee.id);
                                        updateNoteDraft(document.id, {
                                          selectedInvitees: next,
                                          error: null,
                                        });
                                      }}
                                      className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                                    />
                                    <span>{invitee.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={noteDraft.allowReplies}
                            onChange={(event) =>
                              updateNoteDraft(document.id, {
                                allowReplies: event.target.checked,
                                error: null,
                              })
                            }
                            className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                          />
                          اجازه پاسخ به یادداشت داده شود
                        </label>
                        {noteDraft.error ? (
                          <p className="text-[11px] text-rose-500">{noteDraft.error}</p>
                        ) : null}
                        <button
                          type="button"
                          className="rounded-full border border-emerald-500 bg-emerald-500 px-3 py-1 font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={noteDraft.saving}
                          onClick={() => submitNote(document)}
                        >
                          {noteDraft.saving ? "در حال ثبت..." : "ثبت یادداشت"}
                        </button>
                      </div>
                    ) : editable ? (
                      <p className="text-xs text-slate-400">برای افزودن یادداشت ابتدا سند را امضا کنید.</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-500">سندی برای امضا در دسترس شما نیست.</p>
          )}
        </section>
      ) : null}

      {isAdmin ? (
        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-700">گزارش فعالیت‌ها</h2>
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
              onClick={fetchActivityLogs}
              disabled={logsLoading}
            >
              {logsLoading ? "در حال بروزرسانی..." : "به‌روزرسانی"}
            </button>
          </div>
          {logsLoading ? (
            <p className="text-sm text-slate-500">در حال بارگذاری گزارش‌ها...</p>
          ) : activityLogs.length ? (
            <ul className="space-y-3">
              {activityLogs.map((log) => {
                const actor =
                  log.actorName ??
                  (log.inviteeId ? inviteeNameMap.get(log.inviteeId) ?? "نامشخص" : "سیستم");
                return (
                  <li
                    key={log.id}
                    className="space-y-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-slate-700">{formatActivitySummary(log)}</span>
                      <span className="text-[11px] text-slate-400">{formatJalaliDate(log.createdAt)}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">اجرا توسط: {actor}</div>
                    {log.details?.data ? (
                      <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                        {JSON.stringify(log.details.data, null, 2)}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">هنوز فعالیتی ثبت نشده است.</p>
          )}
        </section>
      ) : null}

      {currentParticipant ? null : (
        <section className="rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur sm:p-8">
          <h2 className="mb-4 text-lg font-semibold text-slate-700">
            ورود مدعو
          </h2>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                نام خود را انتخاب کنید
              </label>
              <select
                value={selectedInviteeId}
                onChange={(event) => setSelectedInviteeId(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-inner transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
              >
                <option value="">انتخاب نام...</option>
                {invitees.map((invitee) => (
                  <option key={invitee.id} value={invitee.id}>
                    {invitee.name}
                  </option>
                ))}
              </select>
            </div>
            {(() => {
              const found = invitees.find((item) => item.id === selectedInviteeId);
              if (!found) return null;
              if (!found.password) return null;
              return (
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    رمز عبور
                  </label>
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(event) => setPasswordInput(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm.shadow-inner transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                    placeholder="رمز تعیین‌شده توسط برگزارکننده"
                  />
                </div>
              );
            })()}

            {authError ? (
              <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
                {authError}
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleAuthenticate}
              className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-lg.transition hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            >
              ادامه
            </button>
          </div>
        </section>
      )}

      {currentParticipant ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-slate-700">
            زمان‌های آزاد خود را ثبت کنید
          </h2>
          <AvailabilityForm
            key={currentParticipant.inviteeId}
            ref={formRef}
            projectId={project.id}
            participant={currentParticipant}
            allowedDates={allowedDates}
            allowedTimes={allowedTimes}
            initialSlots={ownedResponse?.slots}
            onSaved={refreshResponses}
          />
        </section>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur">
        <h2 className="text-lg font-semibold text-slate-700">وضعیت مشارکت‌کنندگان</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {participantStatuses.map(({ invitee, hasAvailability, signatureStatus }) => {
            const isCurrent = currentParticipant?.inviteeId === invitee.id;
            const availabilityTone = hasAvailability
              ? {
                  icon: "✅",
                  label: "زمان ثبت شده",
                  className: "border-emerald-200 bg-emerald-50 text-emerald-700",
                }
              : {
                  icon: "🕒",
                  label: "در انتظار ثبت زمان",
                  className: "border-amber-200 bg-amber-50 text-amber-700",
                };
            const signatureTone =
              signatureStatus === "done"
                ? {
                    icon: "✍️",
                    label: "امضا کامل",
                    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
                  }
                : signatureStatus === "pending"
                ? {
                    icon: "📝",
                    label: "نیاز به امضا",
                    className: "border-amber-200 bg-amber-50 text-amber-700",
                  }
                : {
                    icon: "ⓘ",
                    label: "نیاز به امضا ندارد",
                    className: "border-slate-200 bg-slate-100 text-slate-500",
                  };
            return (
              <div
                key={invitee.id}
                className={`rounded-2xl border px-4 py-3 shadow-sm ${
                  isCurrent
                    ? "border-emerald-300 bg-emerald-50/70"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-slate-700">{invitee.name}</span>
                  {isCurrent ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      شما
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 font-semibold ${availabilityTone.className}`}
                  >
                    <span>{availabilityTone.icon}</span>
                    <span>{availabilityTone.label}</span>
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 font-semibold ${signatureTone.className}`}
                  >
                    <span>{signatureTone.icon}</span>
                    <span>{signatureTone.label}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-700">
          جمع‌بندی گروه (به‌روزرسانی لحظه‌ای)
        </h2>
        <div className="space-y-3">
          {syncing ? (
            <div className="rounded-3xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-500 shadow-sm">
              در حال به‌روزرسانی...
            </div>
          ) : null}
          <AvailabilitySummary
            responses={responses}
            currentParticipantId={ownedResponse?.id}
            onSegmentSelect={handleSummarySegmentSelect}
          />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-700">پاسخ‌های ثبت‌شده</h2>
          <button
            type="button"
            onClick={() => setShowResponses((prev) => !prev)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
          >
            {showResponses ? "بستن" : "مشاهده"}
          </button>
        </div>
        {showResponses ? (
          responses.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white/60 p-6 text-sm text-slate-500 shadow-sm">
              هنوز پاسخی ثبت نشده است.
            </div>
          ) : (
            <div className="space-y-3">
              {responses.map((response) => (
                <div
                  key={response.id}
                  className="rounded-3xl border border-slate-200 bg-white/70 p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-700">
                    <span className="font-semibold text-slate-800">
                      {response.name}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                      {formatJalaliDate(response.createdAt)}
                    </span>
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-slate-600">
                    {response.slots.map((slot) => (
                      <li
                        key={`${response.id}-${slot.date}-${slot.startTime}-${slot.endTime}`}
                        className="rounded-2xl bg-slate-50 px-3 py-2"
                      >
                        {formatSlotLabel(slot.date, slot.startTime, slot.endTime)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )
        ) : null}
      </section>
    </div>
  );
};

const timeToMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};


