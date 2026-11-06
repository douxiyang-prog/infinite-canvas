import { CheckSquare, RadioTower, Save, Square, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { App, Button, Checkbox, Empty, Input, Spin, Switch, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { fetchUsers } from "@/services/api/users";
import { fetchUserChannelConfig, saveUserChannelConfig } from "@/services/api/user-channels";
import { useUserStore } from "@/stores/use-user-store";
import { cn } from "@/lib/utils";
import type { AuthUser } from "@/types/user";

export default function AdminUserChannelsPage() {
    const currentUser = useUserStore((state) => state.user);
    if (!currentUser || currentUser.role !== "admin") return <Navigate to="/" replace />;
    return <AdminUserChannels />;
}

function AdminUserChannels() {
    const { message } = App.useApp();
    const [keyword, setKeyword] = useState("");
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const [allChannels, setAllChannels] = useState(true);
    const [channelIds, setChannelIds] = useState<string[]>([]);
    const [version, setVersion] = useState(0);
    const [saving, setSaving] = useState(false);
    const usersQuery = useQuery({ queryKey: ["admin-users"], queryFn: fetchUsers });
    const users = usersQuery.data || [];
    const selectedUser = users.find((user) => user.id === selectedUserId) || null;
    const configQuery = useQuery({
        queryKey: ["admin-user-channels", selectedUserId],
        queryFn: () => fetchUserChannelConfig(selectedUserId!),
        enabled: Boolean(selectedUserId),
    });

    useEffect(() => {
        if (selectedUserId || !users.length) return;
        setSelectedUserId(users[0].id);
    }, [selectedUserId, users]);

    useEffect(() => {
        if (!configQuery.data) return;
        setAllChannels(configQuery.data.assignment.allChannels);
        setChannelIds(configQuery.data.assignment.channelIds);
        setVersion(configQuery.data.assignment.version);
    }, [configQuery.data]);

    const filteredUsers = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        if (!query) return users;
        return users.filter((user) => [user.username, user.displayName].join(" ").toLowerCase().includes(query));
    }, [keyword, users]);
    const channels = configQuery.data?.channels || [];
    const selectedChannels = new Set(channelIds);

    const save = async () => {
        if (!selectedUser) return;
        setSaving(true);
        try {
            const result = await saveUserChannelConfig(selectedUser.id, {
                allChannels,
                channelIds: allChannels ? [] : channelIds,
                expectedVersion: version,
            });
            setVersion(result.assignment.version);
            setChannelIds(result.assignment.channelIds);
            await configQuery.refetch();
            message.success(`已更新 ${selectedUser.displayName} 的渠道配置`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存用户渠道配置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-6xl px-6 py-7">
                <div className="mb-6">
                    <h1 className="flex items-center gap-2 text-xl font-semibold text-stone-950 dark:text-stone-100">
                        <RadioTower className="size-5" />
                        用户渠道配置
                    </h1>
                    <p className="mt-1 text-sm text-stone-500">渠道统一在全局管理中维护，这里只控制每个账号可以使用哪些渠道。</p>
                </div>

                <section className="grid min-h-[560px] overflow-hidden rounded-xl border border-stone-200 md:grid-cols-[280px_minmax(0,1fr)] dark:border-stone-800">
                    <aside className="border-b border-stone-200 bg-stone-50 p-3 md:border-b-0 md:border-r dark:border-stone-800 dark:bg-stone-900/40">
                        <Input allowClear placeholder="搜索用户" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                        <div className="mt-3 space-y-1">
                            {usersQuery.isLoading ? <div className="flex justify-center py-10"><Spin size="small" /></div> : null}
                            {filteredUsers.map((user) => (
                                <UserButton key={user.id} user={user} active={user.id === selectedUserId} onClick={() => setSelectedUserId(user.id)} />
                            ))}
                            {!usersQuery.isLoading && !filteredUsers.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配用户" className="py-8" /> : null}
                        </div>
                    </aside>

                    <div className="min-w-0 p-5">
                        {selectedUser ? (
                            <>
                                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 pb-5 dark:border-stone-800">
                                    <div>
                                        <h2 className="text-base font-semibold">{selectedUser.displayName}</h2>
                                        <p className="mt-1 text-xs text-stone-500">@{selectedUser.username} · {selectedUser.role === "admin" ? "管理员" : "普通用户"}</p>
                                    </div>
                                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={configQuery.isLoading} onClick={() => void save()}>
                                        保存配置
                                    </Button>
                                </div>

                                {configQuery.isLoading ? (
                                    <div className="flex min-h-80 items-center justify-center"><Spin /></div>
                                ) : configQuery.isError ? (
                                    <div className="py-16 text-center text-sm text-red-500">{configQuery.error instanceof Error ? configQuery.error.message : "读取渠道配置失败"}</div>
                                ) : (
                                    <div className="pt-5">
                                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                                            <div>
                                                <div className="text-sm font-medium">允许全部渠道</div>
                                                <div className="mt-1 text-xs text-stone-500">开启后自动包含以后新增的全局渠道。</div>
                                            </div>
                                            <Switch checked={allChannels} checkedChildren="全选" unCheckedChildren="自定义" onChange={setAllChannels} />
                                        </div>

                                        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-medium">可用渠道</div>
                                                <div className="mt-1 text-xs text-stone-500">已选择 {allChannels ? channels.length : channelIds.length} / {channels.length}</div>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={allChannels || !channels.length} onClick={() => setChannelIds(channels.map((channel) => channel.id))}>全选</Button>
                                                <Button size="small" icon={<Square className="size-3.5" />} disabled={allChannels || !channelIds.length} onClick={() => setChannelIds([])}>清空</Button>
                                            </div>
                                        </div>

                                        <div className={cn("mt-3 grid gap-3", allChannels && "opacity-55")}>
                                            {channels.length ? channels.map((channel) => (
                                                <label key={channel.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 p-4 transition hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900/50">
                                                    <Checkbox
                                                        checked={allChannels || selectedChannels.has(channel.id)}
                                                        disabled={allChannels}
                                                        onChange={(event) => setChannelIds((current) => event.target.checked ? [...new Set([...current, channel.id])] : current.filter((id) => id !== channel.id))}
                                                    />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-sm font-medium">{channel.name}</span>
                                                        <span className="mt-2 flex flex-wrap gap-1">
                                                            {Array.from(new Set(channel.models.map((model) => model.capability))).map((capability) => <Tag key={capability} className="m-0">{capability}</Tag>)}
                                                            <Tag className="m-0">{channel.models.length} 个模型</Tag>
                                                        </span>
                                                    </span>
                                                </label>
                                            )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="全局管理中还没有渠道" className="py-12" />}
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="flex min-h-80 items-center justify-center"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择用户" /></div>
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
}

function UserButton({ user, active, onClick }: { user: AuthUser; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition", active ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "hover:bg-stone-200/70 dark:hover:bg-stone-800")}
        >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 text-xs font-semibold">{user.displayName.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{user.displayName}</span>
                <span className="block truncate text-xs opacity-60">@{user.username}</span>
            </span>
            <Users className="size-3.5 shrink-0 opacity-40" />
        </button>
    );
}
