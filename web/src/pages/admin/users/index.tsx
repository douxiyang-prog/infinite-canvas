import { KeyRound, Plus, Shield, UserRound } from "lucide-react";
import { useState } from "react";
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router-dom";

import { createManagedUser, fetchUsers, updateManagedUser } from "@/services/api/users";
import { useUserStore } from "@/stores/use-user-store";
import type { AuthUser, UserRole } from "@/types/user";

type CreateValues = {
    username: string;
    displayName: string;
    password: string;
    role: UserRole;
};

type PasswordValues = {
    password: string;
};

export default function AdminUsersPage() {
    const currentUser = useUserStore((state) => state.user);
    if (!currentUser || currentUser.role !== "admin") return <Navigate to="/" replace />;
    return <AdminUsers />;
}

function AdminUsers() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const currentUser = useUserStore((state) => state.user);
    const clearSession = useUserStore((state) => state.clearSession);
    const [createForm] = Form.useForm<CreateValues>();
    const [passwordForm] = Form.useForm<PasswordValues>();
    const [createOpen, setCreateOpen] = useState(false);
    const [createSubmitting, setCreateSubmitting] = useState(false);
    const [passwordSubmitting, setPasswordSubmitting] = useState(false);
    const [passwordUser, setPasswordUser] = useState<AuthUser | null>(null);
    const { data: users = [], isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: fetchUsers });

    const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-users"] });

    const create = async (values: CreateValues) => {
        setCreateSubmitting(true);
        try {
            await createManagedUser(values);
            message.success("用户已创建");
            setCreateOpen(false);
            createForm.resetFields();
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建用户失败");
        } finally {
            setCreateSubmitting(false);
        }
    };

    const toggleStatus = async (user: AuthUser) => {
        try {
            await updateManagedUser(user.id, { status: user.status === "active" ? "disabled" : "active" });
            message.success(user.status === "active" ? "用户已停用" : "用户已启用");
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新用户失败");
        }
    };

    const changeRole = async (user: AuthUser, role: UserRole) => {
        try {
            await updateManagedUser(user.id, { role });
            message.success("用户角色已更新");
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新角色失败");
        }
    };

    const resetPassword = async (values: PasswordValues) => {
        if (!passwordUser) return;
        setPasswordSubmitting(true);
        try {
            await updateManagedUser(passwordUser.id, { password: values.password });
            message.success("密码已重置");
            if (passwordUser.id === currentUser?.id) {
                clearSession();
                navigate("/login", { replace: true });
                return;
            }
            setPasswordUser(null);
            passwordForm.resetFields();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重置密码失败");
        } finally {
            setPasswordSubmitting(false);
        }
    };

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-6xl px-6 py-7">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-semibold text-stone-950 dark:text-stone-100">
                            <Shield className="size-5" />
                            用户管理
                        </h1>
                        <p className="mt-1 text-sm text-stone-500">管理可登录无限画布的账号、角色和状态。</p>
                    </div>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                        新增用户
                    </Button>
                </div>

                <div className="overflow-hidden rounded-xl border border-stone-200 bg-background dark:border-stone-800">
                    <Table<AuthUser>
                        rowKey="id"
                        loading={isLoading}
                        dataSource={users}
                        pagination={false}
                        scroll={{ x: 860 }}
                        columns={[
                            {
                                title: "用户",
                                key: "user",
                                width: 210,
                                render: (_, user) => (
                                    <div className="flex items-center gap-3">
                                        <span className="grid size-8 place-items-center rounded-full bg-stone-100 text-xs font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-200">{user.displayName.slice(0, 1).toUpperCase()}</span>
                                        <div className="min-w-0">
                                            <div className="truncate font-medium">{user.displayName}</div>
                                            <div className="truncate text-xs text-stone-500">@{user.username}</div>
                                        </div>
                                    </div>
                                ),
                            },
                            {
                                title: "角色",
                                dataIndex: "role",
                                width: 130,
                                render: (role: UserRole, user) => (
                                    <Select<UserRole>
                                        size="small"
                                        value={role}
                                        disabled={user.id === currentUser?.id}
                                        className="w-24"
                                        options={[
                                            { value: "user", label: "用户" },
                                            { value: "admin", label: "管理员" },
                                        ]}
                                        onChange={(value) => void changeRole(user, value)}
                                    />
                                ),
                            },
                            {
                                title: "状态",
                                dataIndex: "status",
                                width: 100,
                                render: (status: AuthUser["status"]) => <Tag color={status === "active" ? "green" : "default"}>{status === "active" ? "启用" : "停用"}</Tag>,
                            },
                            {
                                title: "最近登录",
                                dataIndex: "lastLoginAt",
                                width: 180,
                                render: (value: string | null) => (value ? new Date(value).toLocaleString() : "从未登录"),
                            },
                            {
                                title: "创建时间",
                                dataIndex: "createdAt",
                                width: 180,
                                render: (value: string) => new Date(value).toLocaleString(),
                            },
                            {
                                title: "操作",
                                key: "actions",
                                width: 180,
                                render: (_, user) => (
                                    <Space size={4}>
                                        <Button type="link" size="small" icon={<KeyRound className="size-3.5" />} onClick={() => setPasswordUser(user)}>
                                            重置密码
                                        </Button>
                                        <Popconfirm
                                            title={user.status === "active" ? "停用这个账号？" : "启用这个账号？"}
                                            description={user.status === "active" ? "该用户现有登录会话会立即失效。" : undefined}
                                            onConfirm={() => void toggleStatus(user)}
                                            disabled={user.id === currentUser?.id}
                                        >
                                            <Button type="link" size="small" danger={user.status === "active"} disabled={user.id === currentUser?.id}>
                                                {user.status === "active" ? "停用" : "启用"}
                                            </Button>
                                        </Popconfirm>
                                    </Space>
                                ),
                            },
                        ]}
                    />
                </div>
            </div>

            <Modal
                open={createOpen}
                title="新增用户"
                okText="创建"
                cancelText="取消"
                confirmLoading={createSubmitting}
                onOk={() => createForm.submit()}
                onCancel={() => {
                    setCreateOpen(false);
                    createForm.resetFields();
                }}
            >
                <Form<CreateValues> form={createForm} layout="vertical" initialValues={{ role: "user" }} requiredMark={false} onFinish={(values) => void create(values)}>
                    <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
                        <Input prefix={<UserRound className="size-4 text-stone-400" />} autoComplete="off" />
                    </Form.Item>
                    <Form.Item label="显示名称" name="displayName" rules={[{ required: true, message: "请输入显示名称" }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item
                        label="初始密码"
                        name="password"
                        rules={[
                            { required: true, message: "请输入初始密码" },
                            { min: 10, message: "密码至少 10 个字符" },
                        ]}
                    >
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item label="角色" name="role" rules={[{ required: true }]}>
                        <Select
                            options={[
                                { value: "user", label: "普通用户" },
                                { value: "admin", label: "管理员" },
                            ]}
                        />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                open={Boolean(passwordUser)}
                title={passwordUser ? `重置 ${passwordUser.displayName} 的密码` : "重置密码"}
                okText="重置"
                cancelText="取消"
                confirmLoading={passwordSubmitting}
                onOk={() => passwordForm.submit()}
                onCancel={() => {
                    setPasswordUser(null);
                    passwordForm.resetFields();
                }}
            >
                <Form<PasswordValues> form={passwordForm} layout="vertical" requiredMark={false} onFinish={(values) => void resetPassword(values)}>
                    <Form.Item
                        label="新密码"
                        name="password"
                        rules={[
                            { required: true, message: "请输入新密码" },
                            { min: 10, message: "密码至少 10 个字符" },
                        ]}
                    >
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                </Form>
            </Modal>
        </main>
    );
}
