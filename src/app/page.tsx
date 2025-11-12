import { CreateProjectForm } from "@/components/CreateProjectForm";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 via-white to-emerald-50">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-16 sm:px-6 lg:px-8">
        <header className="space-y-4 rounded-3xl border border-white/60 bg-white/80 p-8 text-slate-700 shadow-sm backdrop-blur sm:p-12">
          <p className="text-sm font-semibold text-sky-600">کال‌فایند</p>
          <h1 className="text-3xl font-extrabold text-slate-900 sm:text-4xl">
            پیدا کردن سادهٔ زمان مشترک برای گروه‌ها
          </h1>
          <p className="text-base leading-8 text-slate-600">
            لینک اختصاصی بسازید، آن را با اعضای گروه به اشتراک بگذارید و در لحظه
            ببینید چه بازه‌هایی برای همه مناسب است. همه چیز به زبان فارسی و بر
            اساس تقویم شمسی طراحی شده است.
          </p>
        </header>

        <section className="grid gap-8 lg:grid-cols-[1.4fr,1fr]">
          <div className="space-y-6 rounded-3xl border border-white/80 bg-white/90 p-8 shadow-sm backdrop-blur">
            <h2 className="text-lg font-semibold text-slate-800">
              پروژه جدید بسازید
            </h2>
            <p className="text-sm leading-7 text-slate-600">
              پس از ساخت پروژه، یک لینک دریافت می‌کنید. هر کس وارد لینک شود،
              زمان‌های آزاد خود را انتخاب می‌کند و نتیجه برای همه بلافاصله
              همگام‌سازی می‌شود.
            </p>
            <div className="h-1 w-16 rounded-full bg-gradient-to-l from-sky-400 to-emerald-400" />
            <CreateProjectForm />
          </div>

          <aside className="space-y-4 rounded-3xl border border-white/60 bg-white/90 p-8 text-sm text-slate-600 shadow-sm backdrop-blur">
            <h3 className="text-base font-semibold text-slate-800">
              چرا کال‌فایند؟
            </h3>
            <ul className="space-y-3">
              <li>• پشتیبانی کامل از تقویم شمسی و زبان فارسی</li>
              <li>• ثبت و همگام‌سازی لحظه‌ای در میان اعضا</li>
              <li>• نمایش رنگی بازه‌های محبوب و تعداد افراد</li>
              <li>• مناسب برای تیم‌ها، کلاس‌ها و قرارهای خانوادگی</li>
            </ul>
          </aside>
        </section>
      </div>
    </main>
  );
}
