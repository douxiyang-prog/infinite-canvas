import { Folder, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { useState } from "react";
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { createAdminTeamProject, deleteAdminTeamProject, fetchAdminTeamProjects, replaceAdminTeamProjectMembers, updateAdminTeamProject } from "@/services/api/team-projects";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import type { TeamProject } from "@/types/team-project";
import type { AuthUser } from "@/types/user";

type ProjectFormValues = {
    title: string;
    description?: string;
    userIds: number[];
};

export function AdminProjectManagement({ users }: { users: AuthUser[] }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const currentUser = useUserStore((state) => state.user);
    const [form] = Form.useForm<ProjectFormValues>();
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingProject, setEditingProject] = useState<TeamProject | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const { data: projects = [], isLoading } = useQuery({ queryKey: ["admin-team-projects"], queryFn: fetchAdminTeamProjects });
    const userOptions = users.map((user) => ({
        value: user.id,
        label: `${user.displayName}（@${user.username}）${user.status === "active" ? "" : " · 已停用"}`,
    }));

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["admin-team-projects"] });
        await useCanvasStore.getState().refreshProjects().catch(() => undefined);
    };
    const openCreate = () => {
        setEditingProject(null);
        form.setFieldsValue({ title: "", description: "", userIds: currentUser ? [currentUser.id] : [] });
        setEditorOpen(true);
    };
    const openEdit = (project: TeamProject) => {
        setEditingProject(project);
        form.setFieldsValue({
            title: project.title,
            description: project.description,
            userIds: project.members.map((member) => member.userId),
        });
        setEditorOpen(true);
    };
    const submit = async (values: ProjectFormValues) => {
        setSubmitting(true);
        try {
            if (editingProject) {
                await updateAdminTeamProject(editingProject.id, { title: values.title, description: values.description || "" });
                await replaceAdminTeamProjectMembers(editingProject.id, values.userIds);
                message.success("项目已更新");
            } else {
                await createAdminTeamProject({
                    title: values.title,
                    description: values.description,
                    userIds: values.userIds,
                });
                message.success("项目已创建");
            }
            setEditorOpen(false);
            form.resetFields();
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : editingProject ? "更新项目失败" : "创建项目失败");
        } finally {
            setSubmitting(false);
        }
    };
    const remove = async (project: TeamProject) => {
        try {
            await deleteAdminTeamProject(project.id);
            message.success("项目已删除");
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除项目失败");
        }
    };

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-950 dark:text-stone-100">
                        <Folder className="size-5" />
                        项目管理
                    </h2>
                    <p className="mt-1 text-sm text-stone-500">创建协作项目并分配成员。只有项目成员可以使用项目画布，个人画布不会向项目成员共享。</p>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                    新建项目
                </Button>
            </div>

            <div className="overflow-hidden rounded-xl border border-stone-200 bg-background dark:border-stone-800">
                <Table<TeamProject>
                    rowKey="id"
                    loading={isLoading}
                    dataSource={projects}
                    pagination={false}
                    scroll={{ x: 850 }}
                    locale={{ emptyText: "还没有项目。创建项目并分配成员后，用户即可使用项目画布。" }}
                    columns={[
                        {
                            title: "项目",
                            key: "project",
                            width: 260,
                            render: (_, project) => (
                                <div className="min-w-0">
                                    <div className="truncate font-medium">{project.title}</div>
                                    <div className="mt-1 truncate text-xs text-stone-500">{project.description || "暂无描述"}</div>
                                </div>
                            ),
                        },
                        {
                            title: "成员",
                            key: "members",
                            render: (_, project) => (
                                <Space size={[4, 4]} wrap>
                                    {project.members.length ? project.members.map((member) => <Tag key={member.userId}>{member.displayName}</Tag>) : <span className="text-sm text-stone-400">未分配成员</span>}
                                </Space>
                            ),
                        },
                        {
                            title: "项目画布",
                            dataIndex: "canvasCount",
                            width: 110,
                            render: (count: number) => <span>{count} 张</span>,
                        },
                        {
                            title: "更新时间",
                            dataIndex: "updatedAt",
                            width: 180,
                            render: (value: string) => new Date(value).toLocaleString(),
                        },
                        {
                            title: "操作",
                            key: "actions",
                            width: 160,
                            render: (_, project) => (
                                <Space size={4}>
                                    <Button type="link" size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEdit(project)}>
                                        编辑
                                    </Button>
                                    <Popconfirm title={`删除项目“${project.title}”？`} description="项目中的画布将同时从用户列表中移除。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => void remove(project)}>
                                        <Button type="link" size="small" danger icon={<Trash2 className="size-3.5" />}>
                                            删除
                                        </Button>
                                    </Popconfirm>
                                </Space>
                            ),
                        },
                    ]}
                />
            </div>

            <Modal
                open={editorOpen}
                title={editingProject ? "编辑项目" : "新建项目"}
                okText={editingProject ? "保存" : "创建"}
                cancelText="取消"
                confirmLoading={submitting}
                onOk={() => form.submit()}
                onCancel={() => {
                    setEditorOpen(false);
                    form.resetFields();
                }}
            >
                <Form<ProjectFormValues> form={form} layout="vertical" requiredMark={false} onFinish={(values) => void submit(values)}>
                    <Form.Item label="项目名称" name="title" rules={[{ required: true, message: "请输入项目名称" }]}>
                        <Input maxLength={200} placeholder="例如：秋季品牌 Campaign" />
                    </Form.Item>
                    <Form.Item label="项目描述" name="description">
                        <Input.TextArea maxLength={500} rows={3} placeholder="说明项目用途，方便成员识别" />
                    </Form.Item>
                    <Form.Item label="项目成员" name="userIds">
                        <Select mode="multiple" allowClear showSearch optionFilterProp="label" options={userOptions} placeholder="选择可以使用项目画布的用户" suffixIcon={<UsersRound className="size-4" />} />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
