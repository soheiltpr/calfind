import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import "./globals.css";

const vazirmatn = Vazirmatn({
  subsets: ["arabic"],
  variable: "--font-vazirmatn",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "کال‌فایند | زمان حضور جمعی",
  description: "یافتن زمان مناسب برای گروه‌ها با استفاده از تقویم شمسی",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl">
      <body className={`${vazirmatn.variable} font-sans antialiased bg-slate-50 text-slate-800`}>
        <div className="flex min-h-screen flex-col">
          <main className="flex-1">{children}</main>
          <footer className="bg-slate-900/95 py-6 text-center text-xs font-medium text-slate-100">
            تمامی حقوق برای سهیل توکل پور محفوظ است.
          </footer>
        </div>
      </body>
    </html>
  );
}
