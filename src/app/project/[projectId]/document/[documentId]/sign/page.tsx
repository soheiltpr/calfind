/* eslint-disable @next/next/no-img-element */
"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { logClientActivity } from "@/lib/logging";

type DocumentResponse = {
  document: {
    id: string;
    projectId: string;
    fileType: string;
    signedUrl: string;
  };
};

type SignatureMode = "draw" | "typed" | "upload";

type SignatureMeta = {
  mode: SignatureMode;
  opacity: number;
  penColor?: string;
  penWidth?: number;
  typedText?: string;
  typedFont?: string;
  typedColor?: string;
  typedSize?: number;
  uploadedFileName?: string | null;
};

const fontOptions = [
  { value: "Vazirmatn", label: "وزیرمتن" },
  { value: "Sahel", label: "ساحل" },
  { value: "Tanha", label: "تنهــا" },
  { value: "Lalezar", label: "لاله‌زار" },
  { value: "Arial", label: "Arial" },
];

const modeOptions: Array<{ value: SignatureMode; label: string }> = [
  { value: "draw", label: "رسم دستی" },
  { value: "typed", label: "متن تایپی" },
  { value: "upload", label: "آپلود تصویر امضا" },
];

export default function DocumentSignPage({
  params,
}: {
  params: Promise<{ projectId: string; documentId: string }>;
}) {
  const [resolvedParams, setResolvedParams] = useState<{
    projectId: string;
    documentId: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentType, setDocumentType] = useState<"image" | "pdf">("image");
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [signatureImage, setSignatureImage] = useState<HTMLImageElement | null>(null);
  const [signatureMeta, setSignatureMeta] = useState<SignatureMeta | null>(null);

  const supabase = useMemo(() => getSupabaseClient(), []);
  const hasLoggedView = useRef(false);

  const [mode, setMode] = useState<SignatureMode>("draw");
  const [penColor, setPenColor] = useState("#0ea5e9");
  const [penWidth, setPenWidth] = useState(3);
  const [opacity, setOpacity] = useState(1);
  const [typedText, setTypedText] = useState("سهیل توکل پور");
  const [typedFont, setTypedFont] = useState("Vazirmatn");
  const [typedSize, setTypedSize] = useState(36);
  const [typedColor, setTypedColor] = useState("#0ea5e9");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [signatureBox, setSignatureBox] = useState({
    x: 100,
    y: 80,
    width: 220,
    height: 90,
  });

  const searchParams = useSearchParams();
  const router = useRouter();
  const signatureRef = useRef<SignatureCanvas | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    params.then(setResolvedParams);
  }, [params]);

  useEffect(() => {
    const loadDocument = async () => {
      if (!resolvedParams) return;
      const inviteeId = searchParams.get("invitee");
      if (!inviteeId) {
        setError("ابتدا باید از طریق لینک دعوت وارد شوید.");
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(
          `/api/projects/${resolvedParams.projectId}/documents/${resolvedParams.documentId}?inviteeId=${inviteeId}`
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body?.error ?? "دریافت سند با خطا مواجه شد.");
        }
        const body = (await response.json()) as DocumentResponse;
        const fileType = body.document.fileType === "pdf" ? "pdf" : "image";
        setDocumentType(fileType);
        let derivedUrl = body.document.signedUrl;

        if (fileType === "pdf") {
          try {
            const pdfjsLib = await import("pdfjs-dist");
            pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
            const loadingTask = pdfjsLib.getDocument({ url: body.document.signedUrl });
            const pdf = await loadingTask.promise;
            if (pdf.numPages < 1) {
              throw new Error("PDF has no pages");
            }
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            if (!context) {
              throw new Error("Failed to get canvas context");
            }
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: context, viewport, canvas }).promise;
            derivedUrl = canvas.toDataURL("image/png");
          } catch (pdfError) {
            console.error("PDF render error", pdfError);
            setError("امکان نمایش فایل PDF وجود ندارد.");
            setLoading(false);
            return;
          }
        }

        setDocumentUrl(derivedUrl);
        const actorName = searchParams.get("actorName");
        if (!hasLoggedView.current) {
          await logClientActivity(supabase, {
            projectId: resolvedParams.projectId,
            inviteeId,
            actorName: actorName ?? null,
            action: "document_viewed",
            details: {
              summary: "مشاهده سند",
              data: { documentId: resolvedParams.documentId },
            },
          });
          hasLoggedView.current = true;
        }
      } catch (fetchError) {
        console.error(fetchError);
        setError(
          fetchError instanceof Error ? fetchError.message : "خطای ناشناخته رخ داد."
        );
      } finally {
        setLoading(false);
      }
    };

    loadDocument();
  }, [resolvedParams, searchParams, supabase]);

  useEffect(() => {
    if (!documentUrl) return;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      setBaseImage(image);
      const aspect = image.width / image.height || 1;
      const width = Math.min(image.width, 800);
      setCanvasSize({ width, height: width / aspect });
    };
    image.src = documentUrl;
  }, [documentUrl]);

  useEffect(() => {
    signatureRef.current?.clear();
    setSignatureImage(null);
    setSignatureMeta(null);
  }, [mode]);

  const applySignaturePreview = (dataUrl: string, meta: SignatureMeta) => {
    const image = new Image();
    image.onload = () => {
      setSignatureImage(image);
      const maxWidth = canvasSize.width * 0.6;
      const maxHeight = canvasSize.height * 0.4;
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
      const width = image.width * scale;
      const height = image.height * scale;
      setSignatureBox({
        x: (canvasSize.width - width) / 2,
        y: (canvasSize.height - height) / 2,
        width,
        height,
      });
      setSignatureMeta(meta);
    };
    image.src = dataUrl;
  };

  const createSignaturePreview = async () => {
    if (!baseImage) {
      alert("تا بارگذاری کامل سند صبر کنید.");
      return;
    }

    if (mode === "draw") {
      if (!signatureRef.current || signatureRef.current.isEmpty()) {
        alert("ابتدا امضای خود را رسم کنید.");
        return;
      }
      const trimmed = signatureRef.current.getTrimmedCanvas();
      const canvas = document.createElement("canvas");
      canvas.width = trimmed.width;
      canvas.height = trimmed.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = opacity;
      ctx.drawImage(trimmed, 0, 0);
      applySignaturePreview(canvas.toDataURL("image/png"), {
        mode: "draw",
        opacity,
        penColor,
        penWidth,
      });
    } else if (mode === "typed") {
      if (!typedText.trim()) {
        alert("متن امضا را وارد کنید.");
        return;
      }
      const tempCanvas = document.createElement("canvas");
      const tempCtx = tempCanvas.getContext("2d");
      if (!tempCtx) return;
      const fontSpec = `${typedSize}px ${typedFont}`;
      tempCtx.font = fontSpec;
      const textWidth = tempCtx.measureText(typedText).width + typedSize * 0.5;
      const textHeight = typedSize * 1.6;
      tempCanvas.width = Math.max(textWidth, 10);
      tempCanvas.height = Math.max(textHeight, 10);
      const ctx = tempCanvas.getContext("2d");
      if (!ctx) return;
      ctx.font = fontSpec;
      ctx.fillStyle = typedColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = opacity;
      ctx.fillText(typedText, tempCanvas.width / 2, tempCanvas.height / 2);
      applySignaturePreview(tempCanvas.toDataURL("image/png"), {
        mode: "typed",
        opacity,
        typedText,
        typedFont,
        typedColor,
        typedSize,
      });
    } else if (mode === "upload") {
      if (!uploadedDataUrl) {
        alert("فایلی برای امضا انتخاب نشده است.");
        return;
      }
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.globalAlpha = opacity;
        ctx.drawImage(image, 0, 0);
        applySignaturePreview(canvas.toDataURL("image/png"), {
          mode: "upload",
          opacity,
          uploadedFileName,
        });
      };
      image.src = uploadedDataUrl;
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const preview = previewRef.current;
    if (!preview) return;
    preview.setPointerCapture(event.pointerId);
    const rect = preview.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    if ((event.target as HTMLElement).dataset.handle === "resize") {
      setIsResizing(true);
    } else {
      setIsDragging(true);
      setDragOffset({
        x: pointerX - signatureBox.x,
        y: pointerY - signatureBox.y,
      });
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging && !isResizing) return;
    const preview = previewRef.current;
    if (!preview) return;
    const rect = preview.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    if (isDragging) {
      const newX = pointerX - dragOffset.x;
      const newY = pointerY - dragOffset.y;
      setSignatureBox((prev) => ({
        ...prev,
        x: Math.min(Math.max(newX, 0), rect.width - prev.width),
        y: Math.min(Math.max(newY, 0), rect.height - prev.height),
      }));
    } else if (isResizing) {
      const newWidth = Math.max(pointerX - signatureBox.x, 50);
      const newHeight = Math.max(pointerY - signatureBox.y, 40);
      setSignatureBox((prev) => ({
        ...prev,
        width: Math.min(newWidth, rect.width - prev.x),
        height: Math.min(newHeight, rect.height - prev.y),
      }));
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    setIsResizing(false);
    try {
      previewRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const saveMergedSignature = async () => {
    if (!resolvedParams || !baseImage || !signatureImage || !signatureMeta) {
      alert("ابتدا امضا را ساخته و روی سند قرار دهید.");
      return;
    }
    const inviteeId = searchParams.get("invitee");
    const actorName = searchParams.get("actorName");
    if (!inviteeId) return;

    const canvas = document.createElement("canvas");
    canvas.width = baseImage.width;
    canvas.height = baseImage.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);

    const scaleX = baseImage.width / canvasSize.width;
    const scaleY = baseImage.height / canvasSize.height;
    ctx.globalAlpha = signatureMeta.opacity;
    ctx.drawImage(
      signatureImage,
      signatureBox.x * scaleX,
      signatureBox.y * scaleY,
      signatureBox.width * scaleX,
      signatureBox.height * scaleY
    );

    const mergedDataUrl = canvas.toDataURL("image/png");

    try {
      const response = await fetch(
        `/api/projects/${resolvedParams.projectId}/documents/${resolvedParams.documentId}/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inviteeId,
            actorName: actorName ?? undefined,
            overlayDataUrl: signatureImage.src,
            mergedDataUrl,
            placement: {
              x: signatureBox.x / canvasSize.width,
              y: signatureBox.y / canvasSize.height,
              width: signatureBox.width / canvasSize.width,
              height: signatureBox.height / canvasSize.height,
            },
            meta: signatureMeta,
          }),
        }
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error ?? "ذخیره نسخه امضا شده با خطا مواجه شد.");
      }

      alert("نسخه امضا شده ذخیره شد.");
      router.back();
    } catch (saveError) {
      console.error(saveError);
      alert(
        saveError instanceof Error
          ? saveError.message
          : "ذخیره نسخه امضا شده انجام نشد."
      );
    }
  };

  const handleUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setUploadedFileName(file?.name ?? null);
    if (!file) {
      setUploadedDataUrl(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedDataUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">
        در حال آماده‌سازی سند...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-rose-500">
        {error}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur">
          <h1 className="text-lg font-semibold text-slate-700">امضای سند</h1>
          <p className="mt-2 text-sm text-slate-500">
            سند زیر را بررسی کنید و سپس امضای خود را در بخش پایین ثبت نمایید.
          </p>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-white/80 p-4 shadow-sm">
          {documentUrl ? (
            <img
              src={documentUrl}
              alt="سند برای امضا"
              className="mx-auto max-h-[480px] w-auto rounded-2xl border border-slate-200 object-contain"
            />
          ) : (
            <p className="text-sm text-slate-500">
              پیش‌نمایش سند برای این نوع فایل در حال حاضر پشتیبانی نمی‌شود. لطفاً همچنان امضای خود را ثبت کنید.
            </p>
          )}
        </section>

        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white/80 p-4 shadow-sm">
          <div className="flex flex-wrap gap-3">
            {modeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                  mode === option.value
                    ? "bg-emerald-500 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
                onClick={() => setMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {mode === "draw" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-3 text-xs text-slate-600">
                رنگ قلم
                <input
                  type="color"
                  value={penColor}
                  onChange={(event) => setPenColor(event.target.value)}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-xs text-slate-600">
                ضخامت قلم
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={penWidth}
                  onChange={(event) => setPenWidth(Number(event.target.value))}
                />
              </label>
            </div>
          ) : null}

          {mode === "typed" ? (
            <div className="space-y-3 text-xs text-slate-600">
              <label className="flex flex-col gap-2">
                متن امضا
                <input
                  type="text"
                  value={typedText}
                  onChange={(event) => setTypedText(event.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-200"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3">
                  رنگ متن
                  <input
                    type="color"
                    value={typedColor}
                    onChange={(event) => setTypedColor(event.target.value)}
                  />
                </label>
                <label className="flex items-center justify-between gap-3">
                  اندازه فونت
                  <input
                    type="range"
                    min={24}
                    max={96}
                    value={typedSize}
                    onChange={(event) => setTypedSize(Number(event.target.value))}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-2">
                نوع فونت
                <select
                  value={typedFont}
                  onChange={(event) => setTypedFont(event.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-200"
                >
                  {fontOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {mode === "upload" ? (
            <div className="space-y-3 text-xs text-slate-600">
              <label className="flex flex-col gap-2">
                انتخاب تصویر امضا (PNG ترجیح داده می‌شود)
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadChange}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-200"
                />
              </label>
              {uploadedFileName ? (
                <p className="text-xs text-slate-500">فایل انتخابی: {uploadedFileName}</p>
              ) : null}
            </div>
          ) : null}

          <label className="flex items-center justify-between gap-3 text-xs text-slate-600">
            شفافیت / شدت نمایش امضا
            <input
              type="range"
              min={20}
              max={100}
              value={opacity * 100}
              onChange={(event) => setOpacity(Number(event.target.value) / 100)}
            />
          </label>

          {mode === "draw" ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <SignatureCanvas
                ref={signatureRef}
                penColor={penColor}
                minWidth={penWidth / 2}
                maxWidth={penWidth}
                backgroundColor="rgba(255,255,255,0)"
                canvasProps={{ className: "w-full h-64" }}
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
              {mode === "typed"
                ? "پس از تنظیم متن و گزینه‌ها، روی «ساخت پیش‌نمایش امضا» کلیک کنید."
                : "پس از انتخاب تصویر، برای جایگذاری روی سند پیش‌نمایش بسازید."}
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-xs">
            {mode === "draw" ? (
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-600 transition hover:bg-slate-100"
                onClick={() => signatureRef.current?.clear()}
              >
                پاک‌سازی نقاشی
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-full border border-emerald-500 bg-emerald-500 px-4 py-2 font-semibold text-white transition hover:bg-emerald-600"
              onClick={createSignaturePreview}
            >
              ساخت پیش‌نمایش امضا
            </button>
          </div>
        </section>

        {signatureImage ? (
          <section className="space-y-4 rounded-3xl border border-slate-200 bg-white/80 p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">
              جایگذاری امضا روی سند
            </h2>
            {documentType === "pdf" ? (
              <p className="text-xs text-slate-500">صفحه نخست فایل PDF برای امضا نمایش داده شده است.</p>
            ) : null}
            <div
              ref={previewRef}
              className="relative mx-auto max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
              style={{ width: canvasSize.width, height: canvasSize.height, touchAction: "none" }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              {documentUrl ? (
                <img
                  src={documentUrl}
                  alt="سند برای امضا"
                  className="h-full w-full object-contain"
                />
              ) : null}
              <div
                className="absolute cursor-grab rounded-2xl border-2 border-emerald-500 bg-white/80 shadow-lg transition active:cursor-grabbing"
                style={{
                  left: signatureBox.x,
                  top: signatureBox.y,
                  width: signatureBox.width,
                  height: signatureBox.height,
                  touchAction: "none",
                }}
                onPointerDown={handlePointerDown}
              >
                <img
                  src={signatureImage.src}
                  alt="پیش‌نمایش امضا"
                  className="h-full w-full object-contain"
                  draggable={false}
                />
                <span
                  role="presentation"
                  data-handle="resize"
                  className="absolute bottom-1 right-1 h-4 w-4 cursor-se-resize rounded-full bg-emerald-500"
                  style={{ touchAction: "none" }}
                  onPointerDown={handlePointerDown}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-600 transition hover:bg-slate-100"
                onClick={() => {
                  signatureRef.current?.clear();
                  setSignatureImage(null);
                  setSignatureMeta(null);
                }}
              >
                بازگشت به ساخت امضا
              </button>
              <button
                type="button"
                className="rounded-full border border-emerald-500 bg-emerald-500 px-4 py-2 font-semibold text-white transition hover:bg-emerald-600"
                onClick={saveMergedSignature}
              >
                ذخیره نسخه امضا شده
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

