import { useStore } from "zustand";

import { cn } from "@/lib/utils";
import { useCgtwStore } from "@/stores/use-cgtw-store";

/** 状态颜色取自 CGTW 项目配置，没有配置的状态用中性灰。 */
export function CgtwStatusTag({ status, className }: { status: string; className?: string }) {
    const color = useStore(useCgtwStore, (state) => state.statusColors[status]);
    return (
        <span className={cn("inline-block max-w-28 shrink-0 truncate rounded-full px-2 text-[11px] leading-5 text-white", !color && "bg-stone-500", className)} style={color ? { background: color } : undefined}>
            {status || "无状态"}
        </span>
    );
}
