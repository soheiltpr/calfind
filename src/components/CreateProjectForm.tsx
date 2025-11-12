"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { DateObject } from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import dayjs from "dayjs";
import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { TimeRangeSelector } from "@/components/TimeRangeSelector";
import { logClientActivity } from "@/lib/logging";

type InviteePermission = {
  inviteeName: string;
  canView: boolean;
  canEdit: boolean;
};

type PendingDocument = {
  id: string;
  file: File;
  sharedWithAll: boolean;
  permissions: InviteePermission[];
  error?: string | null;
};

const DatePicker = dynamic(() => import("react-multi-date-picker"), {
  ssr: false,
});

const formSchema = z.object({
  title: z.string().min(3, "عنوان باید حداقل سه نویسه باشد"),
  description: z.string().optional(),
});

const minutesToTime = (minutes: number) => {
  const clamped = Math.max(0, Math.min(minutes, 24 * 60));
  const hours = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const mins = (clamped % 60).toString().padStart(2, "0");
  return `${hours}:${mins}`;
};

const toIsoDate = (dateObject: DateObject | null) => {
  if (!dateObject) return null;
  return dayjs(dateObject.toDate()).format("YYYY-MM-DD");
};

export const CreateProjectForm = () => {
  const supabase = getSupabaseClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dateRange, setDateRange] = useState<DateObject[]>([]);
  const [allowedTimeRange, setAllowedTimeRange] = useState<[number, number]>([
    9 * 60,
    18 * 60,
  ]);
  const [invitees, setInvitees] = useState<Array<{ name: string; password: string }>>([]);
  const [inviteeName, setInviteeName] = useState("");
  const [inviteePassword, setInviteePassword] = useState("");
  const [documents, setDocuments] = useState<PendingDocument[]>([]);
  const [adminCredentials, setAdminCredentials] = useState<{ username: string; password: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  useEffect(() => {
    setDocuments((prev) =>
      prev.map((doc) => {
        const inviteeIds = invitees.map((invitee) => invitee.name.trim());
        const filtered = doc.permissions.filter((permission) =>
          inviteeIds.includes(permission.inviteeName)
        );
        const missing = inviteeIds.filter(
          (id) => !filtered.some((permission) => permission.inviteeName === id)
        );
        const appended = missing.map((id) => ({
          inviteeName: id,
          canView: true,
          canEdit: true,
        }));
        return {
          ...doc,
          permissions: [...filtered, ...appended],
        };
      })
    );
  }, [invitees]);

  const startDate = useMemo(() => toIsoDate(dateRange[0] ?? null), [dateRange]);
  const endDate = useMemo(() => toIsoDate(dateRange[1] ?? dateRange[0] ?? null), [
    dateRange,
  ]);

  const handleAddInvitee = () => {
    setError(null);
    if (!inviteeName.trim()) {
      setError("لطفاً نام مدعو را وارد کنید.");
      return;
    }

    if (inviteeName.trim().toLowerCase() === "admin") {
      setError('نام "admin" رزرو شده است.');
      return;
    }

    const exists = invitees.some(
      (invitee) => invitee.name.trim() === inviteeName.trim()
    );

    if (exists) {
      setError("این نام قبلاً اضافه شده است.");
      return;
    }

    setInvitees((prev) => [
      ...prev,
      { name: inviteeName.trim(), password: inviteePassword.trim() },
    ]);
    setInviteeName("");
    setInviteePassword("");
  };

  const handleRemoveInvitee = (name: string) => {
    setInvitees((prev) => prev.filter((invitee) => invitee.name !== name));
  };

  const handleAddDocuments = (files: FileList | null) => {
    if (!files || !files.length) return;
    setDocuments((prev) => {
      const inviteeIds = invitees.map((invitee) => invitee.name.trim());
      const newDocs: PendingDocument[] = Array.from(files).map((file) => ({
        id: crypto.randomUUID(),
        file,
        sharedWithAll: true,
        permissions: inviteeIds.map((id) => ({
          inviteeName: id,
          canView: true,
          canEdit: true,
        })),
      }));
      return [...prev, ...newDocs];
    });
  };

  const handleToggleSharedWithAll = (documentId: string, shared: boolean) => {
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === documentId
          ? {
              ...doc,
              sharedWithAll: shared,
            }
          : doc
      )
    );
  };

  const handlePermissionToggle = (
    documentId: string,
    inviteeName: string,
    key: "canView" | "canEdit",
    value: boolean
  ) => {
    setDocuments((prev) =>
      prev.map((doc) => {
        if (doc.id !== documentId) return doc;
        return {
          ...doc,
          permissions: doc.permissions.map((permission) =>
            permission.inviteeName === inviteeName
              ? { ...permission, [key]: value }
              : permission
          ),
        };
      })
    );
  };

  const handleRemoveDocument = (documentId: string) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setShareUrl(null);
    setAdminCredentials(null);

    const parsed = formSchema.safeParse({ title, description });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "ورودی نامعتبر است");
      return;
    }

    if (!startDate || !endDate) {
      setError("لطفاً بازهٔ تاریخ مجاز را انتخاب کنید.");
      return;
    }

    if (invitees.length === 0) {
      setError("حداقل یک مدعو باید تعریف شود.");
      return;
    }

    setLoading(true);

    try {
      const { data, error: insertError } = await supabase
        .from("projects")
        .insert({
          title: parsed.data.title,
          description: parsed.data.description,
          start_date: startDate,
          end_date: endDate,
          start_time: minutesToTime(allowedTimeRange[0]),
          end_time: minutesToTime(allowedTimeRange[1]),
        })
        .select("id")
        .single();

      if (insertError || !data) {
        throw insertError ?? new Error("عدم دریافت شناسه پروژه");
      }

      const adminPasscode = Math.floor(1000 + Math.random() * 9000)
        .toString();
      const adminInvitee = {
        project_id: data.id,
        name: "admin",
        password: adminPasscode,
      };

      const inviteeRecords = [
        ...invitees.map((invitee) => ({
          project_id: data.id,
          name: invitee.name,
          password: invitee.password ? invitee.password : null,
        })),
        adminInvitee,
      ];

      const { error: inviteeError } = await supabase
        .from("project_invitees")
        .insert(inviteeRecords);

      if (inviteeError) {
        throw inviteeError;
      }

      setAdminCredentials({ username: "admin", password: adminPasscode });

      await logClientActivity(supabase, {
        projectId: data.id,
        action: "project_created",
        actorName: "organizer",
        details: { summary: "پروژه جدید ساخته شد" },
      });

      const { data: inviteeRows } = await supabase
        .from("project_invitees")
        .select("id, name")
        .eq("project_id", data.id);
      const inviteeMap = new Map(
        (inviteeRows ?? []).map((row) => [row.name, row.id])
      );
      const adminInviteeRowId = inviteeMap.get("admin") ?? null;

      for (const doc of documents) {
        const formPayload = new FormData();
        formPayload.append("file", doc.file);
        formPayload.append(
          "metadata",
          JSON.stringify({
            sharedWithAll: doc.sharedWithAll,
            permissions: doc.sharedWithAll
              ? []
              : doc.permissions
                  .map((permission) => {
                    const inviteeId = inviteeMap.get(permission.inviteeName);
                    if (!inviteeId) return null;
                    return {
                      inviteeId,
                      canView: permission.canView,
                      canEdit: permission.canEdit,
                    };
                  })
                  .filter(
                    (permission): permission is { inviteeId: string; canView: boolean; canEdit: boolean } =>
                      Boolean(permission)
                  ),
            uploadedBy: adminInviteeRowId,
          })
        );

        const response = await fetch(`/api/projects/${data.id}/documents`, {
          method: "POST",
          body: formPayload,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          console.error("Document upload failed", body);
          throw new Error(body?.error ?? "Failed to upload document");
        }
      }

      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      setShareUrl(`${origin}/project/${data.id}`);
      setTitle("");
      setDescription("");
      setDateRange([]);
      setAllowedTimeRange([9 * 60, 18 * 60]);
      setInvitees([]);
      setDocuments([]);
    } catch (submitError) {
      console.error(submitError);
      setError("خطایی رخ داد. لطفاً دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).catch(() => {
      setError("امکان کپی خودکار فراهم نشد. لطفاً دستی کپی کنید.");
    });
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur sm:p-8">
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">
            عنوان پروژه
          </label>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="مثلاً «جلسه برنامه‌ریزی تیم محتوا»"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-inner transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">
            توضیحات (اختیاری)
          </label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="جزئیات جلسه یا یادداشت‌های تکمیلی را بنویسید."
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-inner transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
            rows={3}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              بازه تاریخ مجاز (شمسی)
            </label>
            <DatePicker
              range
              value={dateRange}
              onChange={(value) => setDateRange((value as DateObject[]) ?? [])}
              calendar={persian}
              locale={persian_fa}
              calendarPosition="bottom-right"
              className="w-full rounded-2xl border border-slate-200 bg-white text-sm shadow-inner"
              inputClass="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none"
              placeholder="از چه تاریخی تا چه تاریخی؟"
            />
            <p className="text-xs text-slate-500">
              فقط در این بازه زمانی امکان ثبت حضور وجود خواهد داشت.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              بازه ساعت مجاز
            </label>
            <TimeRangeSelector
              value={allowedTimeRange}
              onChange={setAllowedTimeRange}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-inner">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                نام مدعو
              </label>
              <input
                type="text"
                value={inviteeName}
                onChange={(event) => setInviteeName(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-inner transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                placeholder="مثلاً «سارا ناصری»"
              />
            </div>
            <div className="flex-1">
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                رمز عبور (اختیاری)
              </label>
              <input
                type="text"
                value={inviteePassword}
                onChange={(event) => setInviteePassword(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-inner transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                placeholder="در صورت نیاز به حفاظت"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={handleAddInvitee}
            className="mt-3 w-full rounded-2xl border border-dashed border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700 transition hover:border-sky-400 hover:bg-sky-100"
          >
            افزودن مدعو
          </button>

          {invitees.length ? (
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              {invitees.map((invitee) => (
                <li
                  key={invitee.name}
                  className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"
                >
                  <span>
                    {invitee.name}
                    {invitee.password ? " • رمز دارد" : " • بدون رمز"}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveInvitee(invitee.name)}
                    className="text-xs font-semibold text-rose-500 transition hover:text-rose-600"
                  >
                    حذف
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-inner">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">
                مدارک نیازمند امضا
              </h3>
              <p className="text-xs text-slate-500">
                فایل‌های PDF یا تصویر را بارگذاری کنید و مشخص کنید چه کسانی به آن‌ها دسترسی دارند.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center rounded-2xl border border-dashed border-sky-300 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-700 transition hover:border-sky-400 hover:bg-sky-100">
              انتخاب فایل
              <input
                type="file"
                accept="application/pdf,image/*"
                multiple
                className="hidden"
                onChange={(event) => handleAddDocuments(event.target.files)}
              />
            </label>
          </div>

          {documents.length ? (
            <div className="space-y-4">
              {documents.map((document) => (
                <div
                  key={document.id}
                  className="space-y-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                >
                  <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
                    <span>{document.file.name}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveDocument(document.id)}
                      className="text-xs font-semibold text-rose-500 transition hover:text-rose-600"
                    >
                      حذف
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span>
                      حجم فایل: {(document.file.size / 1024 / 1024).toFixed(2)} مگابایت
                    </span>
                    <span>نوع: {document.file.type || "نامشخص"}</span>
                  </div>
                  <div className="space-y-2 rounded-xl bg-slate-50 px-3 py-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={document.sharedWithAll}
                        onChange={(event) =>
                          handleToggleSharedWithAll(document.id, event.target.checked)
                        }
                      />
                      اشتراک‌گذاری با تمام مدعوین
                    </label>
                    {!document.sharedWithAll ? (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-500">
                          تعیین دسترسی برای هر مدعو:
                        </p>
                        <div className="space-y-2">
                        {document.permissions.map((permission) => (
                            <div
                            key={permission.inviteeName}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs text-slate-600"
                            >
                            <span>{permission.inviteeName}</span>
                              <div className="flex items-center gap-4">
                                <label className="flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={permission.canView}
                                    onChange={(event) =>
                                      handlePermissionToggle(
                                        document.id,
                                      permission.inviteeName,
                                        "canView",
                                        event.target.checked
                                      )
                                    }
                                  />
                                  مشاهده
                                </label>
                                <label className="flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={permission.canEdit}
                                    onChange={(event) =>
                                      handlePermissionToggle(
                                        document.id,
                                      permission.inviteeName,
                                        "canEdit",
                                        event.target.checked
                                      )
                                    }
                                  />
                                  امضا / ویرایش
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">
                        همه‌ی مدعوین می‌توانند این سند را مشاهده و امضا کنند.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              هنوز فایلی اضافه نشده است.
            </p>
          )}
        </div>

        {error ? (
          <p className="text-sm font-medium text-red-500">{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading ? "در حال ساخت لینک..." : "ساخت لینک دعوت"}
        </button>
      </form>

      {shareUrl ? (
        <div className="mt-6 space-y-3 rounded-2xl bg-sky-50/70 p-4 text-sm text-slate-700">
          <p className="font-semibold text-sky-800">لینک دعوت آماده است:</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <code className="flex-1 rounded-xl bg-white px-3 py-2 text-xs text-slate-600 shadow-inner">
              {shareUrl}
            </code>
            <button
              onClick={handleCopy}
              className="rounded-xl bg-sky-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-600"
            >
              کپی لینک
            </button>
          </div>
          <p className="text-xs text-slate-500">
            لینک را فقط برای مدعوین تعریف‌شده ارسال کنید. هر شخص با نام خود وارد می‌شود.
          </p>
          {adminCredentials ? (
            <div className="space-y-2 rounded-xl bg-white/80 p-3 text-xs text-slate-600 shadow-inner">
              <p className="font-semibold text-slate-700">اطلاعات ورود مدیر:</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1">نام کاربری: admin</span>
                <span className="rounded-full bg-slate-100 px-3 py-1">رمز عبور: {adminCredentials.password}</span>
              </div>
              <p className="text-[11px] text-slate-500">این اطلاعات را فقط برای برگزارکننده نگه دارید.</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};




