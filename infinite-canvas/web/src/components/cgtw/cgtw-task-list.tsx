import { useEffect, useState } from "react";
import { Button, Empty, Input, Segmented, Select, Spin } from "antd";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, RefreshCw } from "lucide-react";

import { CgtwStatusTag } from "@/components/cgtw/cgtw-status-tag";
import { CGTW_SESSION_KEY } from "@/components/cgtw/cgtw-connect";
import { cn } from "@/lib/utils";
import { fetchCgtwFacets, fetchCgtwProjects, fetchCgtwTasks, logoutCgtw, type CgtwSession, type CgtwTask } from "@/services/api/cgtw";
import { useCgtwStore } from "@/stores/use-cgtw-store";

const toOptions = (values: string[] = []) => values.map((value) => ({ value, label: value }));

export function CgtwTaskList({ session }: { session: CgtwSession }) {
    const queryClient = useQueryClient();
    const { db, filters, selectedTask, setDb, setFilters, selectTask, setStatusColors } = useCgtwStore();
    const [keyword, setKeyword] = useState(filters.q);

    const projects = useQuery({ queryKey: ["cgtw", "projects"], queryFn: fetchCgtwProjects, staleTime: 5 * 60_000 });
    const facets = useQuery({ queryKey: ["cgtw", "facets", db], queryFn: () => fetchCgtwFacets(db), enabled: !!db, staleTime: 5 * 60_000 });
    const tasks = useInfiniteQuery({
        queryKey: ["cgtw", "tasks", db, filters],
        queryFn: ({ pageParam }) => fetchCgtwTasks(db, filters, pageParam),
        initialPageParam: 0,
        getNextPageParam: (last, pages) => {
            const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
            return loaded < last.total ? loaded : undefined;
        },
        enabled: !!db,
        staleTime: 30_000,
    });

    useEffect(() => {
        if (!db && projects.data?.length) setDb((projects.data.find((project) => project.status === "Active") || projects.data[0]).db);
    }, [db, projects.data, setDb]);
    useEffect(() => setStatusColors(facets.data?.colors || {}), [facets.data, setStatusColors]);
    useEffect(() => {
        const timer = setTimeout(() => keyword !== filters.q && setFilters({ q: keyword.trim() }), 300);
        return () => clearTimeout(timer);
    }, [keyword, filters.q, setFilters]);

    const items = tasks.data?.pages.flatMap((page) => page.items) || [];
    const total = tasks.data?.pages[0]?.total ?? 0;
    const projectOptions = (projects.data || []).filter((project) => project.status === "Active" || project.db === db).map((project) => ({ value: project.db, label: `${project.code} ${project.name}` }));

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-stone-200 px-3 py-2 text-xs text-stone-500 dark:border-stone-800">
                <span className="size-2 rounded-full bg-green-500" />
                <span className="min-w-0 flex-1 truncate">{session.mode === "desktop" ? "本机客户端" : "账号登录"} · {session.name}</span>
                <Button type="text" size="small" title="刷新" icon={<RefreshCw className="size-3.5" />} onClick={() => queryClient.invalidateQueries({ queryKey: ["cgtw"], predicate: (query) => query.queryKey[1] !== "session" })} />
                <Button
                    type="text"
                    size="small"
                    title="退出 CGTW"
                    icon={<LogOut className="size-3.5" />}
                    onClick={async () => {
                        await logoutCgtw();
                        queryClient.clear();
                        queryClient.invalidateQueries({ queryKey: CGTW_SESSION_KEY });
                    }}
                />
            </div>
            <div className="grid grid-cols-2 gap-2 border-b border-stone-200 p-3 dark:border-stone-800">
                <Select className="col-span-2" showSearch optionFilterProp="label" loading={projects.isLoading} value={db || undefined} options={projectOptions} placeholder="选择项目" onChange={setDb} />
                <Select allowClear placeholder="全部集" value={filters.eps || undefined} options={toOptions(facets.data?.eps)} onChange={(value) => setFilters({ eps: value || "" })} />
                <Select allowClear placeholder="全部环节" value={filters.pipeline || undefined} options={toOptions(facets.data?.pipelines)} onChange={(value) => setFilters({ pipeline: value || "" })} />
                <Select className="col-span-2" allowClear showSearch placeholder="全部状态" value={filters.status || undefined} options={toOptions(facets.data?.statuses)} onChange={(value) => setFilters({ status: value || "" })} />
                <Input className="col-span-2" allowClear placeholder="搜索镜头 / 制作人" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                <Segmented className="col-span-2" block value={filters.mine ? "mine" : "all"} options={[{ value: "mine", label: "我的任务" }, { value: "all", label: "全部任务" }]} onChange={(value) => setFilters({ mine: value === "mine" })} />
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
                {tasks.isLoading ? (
                    <div className="flex justify-center p-8"><Spin /></div>
                ) : tasks.isError ? (
                    <div className="p-4 text-center text-sm text-red-500">{tasks.error.message}</div>
                ) : items.length ? (
                    <>
                        <div className="px-2 pb-1 text-[11px] text-stone-400">共 {total} 条，已加载 {items.length} 条 · 点击任务查看批注</div>
                        {items.map((task) => (
                            <TaskRow key={task.id} task={task} selected={selectedTask?.id === task.id} onSelect={() => selectTask(task)} />
                        ))}
                        {tasks.hasNextPage ? (
                            <Button block type="text" loading={tasks.isFetchingNextPage} onClick={() => tasks.fetchNextPage()}>加载更多</Button>
                        ) : null}
                    </>
                ) : (
                    <Empty className="mt-10" description="没有符合条件的任务" />
                )}
            </div>
        </div>
    );
}

function TaskRow({ task, selected, onSelect }: { task: CgtwTask; selected: boolean; onSelect: () => void }) {
    return (
        <div onClick={onSelect} className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/10", selected && "bg-black/5 dark:bg-white/10")}>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{task.eps} / {task.shot}</div>
                <div className="truncate text-xs text-stone-500">{task.pipeline} · {task.artist || "未分配"}</div>
            </div>
            <CgtwStatusTag status={task.status} />
        </div>
    );
}
