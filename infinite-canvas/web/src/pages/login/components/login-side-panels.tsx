import { useEffect, useState } from "react";

const TIME_ZONE = "Asia/Shanghai";

function shanghaiDate(date: Date) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "numeric",
        day: "numeric",
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
    return {
        year: Number(value("year")),
        month: Number(value("month")),
        day: Number(value("day")),
    };
}

export function LoginClockPanel() {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const [hour, minute] = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    })
        .format(now)
        .split(":");

    return (
        <aside className="relative z-10 hidden w-full max-w-[280px] xl:block" aria-label="当前上海时间">
            <style>{`
                @keyframes login-flip-in {
                    0% { transform: perspective(700px) rotateX(0deg); }
                    45% { transform: perspective(700px) rotateX(-88deg); filter: brightness(.68); }
                    46% { transform: perspective(700px) rotateX(88deg); }
                    100% { transform: perspective(700px) rotateX(0deg); filter: brightness(1); }
                }
                .login-flip-card {
                    animation: login-flip-in .48s cubic-bezier(.4, 0, .2, 1);
                    backface-visibility: hidden;
                    transform-origin: center center;
                }
                @media (prefers-reduced-motion: reduce) {
                    .login-flip-card { animation: none; }
                }
            `}</style>
            <time dateTime={now.toISOString()} className="flex items-center justify-center gap-2">
                <FlipCard value={hour} flipKey={hour} />
                <FlipCard value={minute} flipKey={`${hour}-${minute}`} />
            </time>
        </aside>
    );
}

function FlipCard({ value, flipKey }: { value: string; flipKey: string }) {
    return (
        <span key={flipKey} className="login-flip-card relative block h-[142px] w-[132px] overflow-hidden rounded-[14px] bg-[#121212] shadow-[0_18px_45px_rgba(0,0,0,.38)]">
            <span
                className="absolute inset-0 z-10 flex translate-y-[0.015em] items-center justify-center text-[106px] font-normal leading-none tracking-[-0.035em] text-[#f7f7f2] tabular-nums"
                style={{ fontFamily: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif', fontWeight: 400 }}
            >
                {value}
            </span>
            <span className="pointer-events-none absolute inset-x-0 top-1/2 z-20 h-[4px] -translate-y-1/2 bg-black" />
        </span>
    );
}

export function LoginCalendarPanel() {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    const { year, month, day } = shanghaiDate(now);
    const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: TIME_ZONE, weekday: "long" }).format(now);

    return (
        <aside className="relative z-10 hidden w-full max-w-[240px] rounded-2xl border border-slate-900/10 bg-white/25 p-5 backdrop-blur-md xl:block dark:border-white/[.08] dark:bg-white/[.018]" aria-label="本月日历">
            <h2 className="text-[30px] font-light leading-none tracking-[-0.045em] text-slate-800 dark:text-white/90">
                {year}年{month}月
            </h2>
            <div className="mt-7 flex items-end gap-3">
                <span className="font-mono text-[62px] font-light leading-none tracking-[-0.07em] text-cyan-600 tabular-nums dark:text-cyan-200">
                    {String(day).padStart(2, "0")}
                </span>
                <span className="mb-1 text-sm text-slate-500 dark:text-white/45">{weekday}</span>
            </div>
        </aside>
    );
}
