import { useState } from "react";
import { Button, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { CGTW_SESSION_KEY, CgtwConnect } from "@/components/cgtw/cgtw-connect";
import { CgtwNotes } from "@/components/cgtw/cgtw-notes";
import { CgtwTaskList } from "@/components/cgtw/cgtw-task-list";
import { fetchCgtwSession } from "@/services/api/cgtw";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCgtwStore } from "@/stores/use-cgtw-store";

/** 画布左侧的 CGTW 面板：登录引导、任务检索、批注查看；可收起，给画布让出空间。 */
export function CgtwPanel() {
    const [open, setOpen] = useState(true);
    const agentUrl = useAgentStore((state) => state.url);
    const agentToken = useAgentStore((state) => state.token);
    const selectedTask = useCgtwStore((state) => state.selectedTask);
    const session = useQuery({ queryKey: [...CGTW_SESSION_KEY, agentUrl, agentToken], queryFn: fetchCgtwSession, retry: false, refetchOnWindowFocus: false });

    if (!open) {
        return (
            <div className="flex shrink-0 flex-col border-r border-stone-200 p-1 dark:border-stone-800">
                <Button type="text" title="展开 CGTW 面板" icon={<PanelLeftOpen className="size-4" />} onClick={() => setOpen(true)} />
            </div>
        );
    }
    return (
        <aside className="flex w-80 shrink-0 flex-col border-r border-stone-200 bg-background dark:border-stone-800">
            <div className="flex items-center border-b border-stone-200 px-3 py-1.5 dark:border-stone-800">
                <span className="flex-1 text-sm font-medium">CGTW</span>
                <Button type="text" size="small" title="收起" icon={<PanelLeftClose className="size-4" />} onClick={() => setOpen(false)} />
            </div>
            {session.isLoading ? (
                <div className="flex flex-1 items-center justify-center"><Spin /></div>
            ) : !session.data?.loggedIn ? (
                <CgtwConnect session={session.data} error={session.error} />
            ) : selectedTask ? (
                <CgtwNotes task={selectedTask} />
            ) : (
                <CgtwTaskList session={session.data} />
            )}
        </aside>
    );
}
