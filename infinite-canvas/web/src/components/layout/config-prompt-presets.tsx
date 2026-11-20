import { useEffect, useState } from "react";
import { App, Button, Input, Modal, Segmented, Switch, Tag } from "antd";
import { Copy, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { createPromptPreset, promptPresetSummary, type PromptPreset, type PromptPresetCategory } from "@/services/api/prompt-presets";
import { usePromptPresetStore } from "@/stores/use-prompt-preset-store";

export function ConfigPromptPresets() {
    const { modal, message } = App.useApp();
    const { t } = useTranslation();
    const presets = usePromptPresetStore((state) => state.presets);
    const savePreset = usePromptPresetStore((state) => state.savePreset);
    const removePreset = usePromptPresetStore((state) => state.removePreset);
    const togglePreset = usePromptPresetStore((state) => state.togglePreset);
    const resetPreset = usePromptPresetStore((state) => state.resetPreset);
    const [category, setCategory] = useState<PromptPresetCategory>("lens");
    const [editing, setEditing] = useState<PromptPreset | null>(null);
    const visible = presets.filter((preset) => preset.category === category);

    const duplicate = (preset: PromptPreset) => {
        savePreset(createPromptPreset({ ...preset, id: "", name: `${preset.name} 副本`, builtIn: false }));
        message.success("已复制为自定义预设");
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented
                    value={category}
                    onChange={(value) => setCategory(value as PromptPresetCategory)}
                    options={[
                        { value: "lens", label: "镜头预设" },
                        { value: "lighting", label: "光照预设" },
                    ]}
                />
                <span className="text-xs text-stone-500">预设提示词仅在生成时内部应用，不写入节点提示词。</span>
            </div>
            <div className="space-y-2">
                {visible.map((preset) => (
                    <div key={preset.id} className="rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                        <div className="flex flex-wrap items-center gap-3">
                            <Switch size="small" checked={preset.enabled} onChange={(enabled) => togglePreset(preset.id, enabled)} />
                            <div className="min-w-[220px] flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold">{preset.name}</span>
                                    <Tag className="m-0 text-[10px]">{preset.builtIn ? "内置" : "自定义"}</Tag>
                                </div>
                                <div className="mt-1 text-xs text-stone-500">{promptPresetSummary(preset)}</div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(preset)}>
                                    {t("config.promptSources.edit")}
                                </Button>
                                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => duplicate(preset)}>
                                    {t("common.copy")}
                                </Button>
                                {preset.builtIn ? (
                                    <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => resetPreset(preset.id)}>
                                        恢复默认
                                    </Button>
                                ) : (
                                    <Button
                                        size="small"
                                        danger
                                        icon={<Trash2 className="size-3.5" />}
                                        onClick={() =>
                                            modal.confirm({
                                                title: `删除预设“${preset.name}”？`,
                                                okButtonProps: { danger: true },
                                                onOk: () => removePreset(preset.id),
                                            })
                                        }
                                    >
                                        {t("common.delete")}
                                    </Button>
                                )}
                            </div>
                        </div>
                        <details className="mt-3 text-xs">
                            <summary className="cursor-pointer text-stone-500">查看隐藏提示词模板</summary>
                            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-stone-100 p-3 text-[11px] leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{preset.prompt}</pre>
                        </details>
                    </div>
                ))}
            </div>
            <PromptPresetEditor
                preset={editing}
                onSave={(next) => {
                    savePreset(next);
                    setEditing(null);
                }}
                onClose={() => setEditing(null)}
            />
        </div>
    );
}

function PromptPresetEditor({ preset, onSave, onClose }: { preset: PromptPreset | null; onSave: (preset: PromptPreset) => void; onClose: () => void }) {
    const [name, setName] = useState("");
    const [prompt, setPrompt] = useState("");

    useEffect(() => {
        if (!preset) return;
        setName(preset.name);
        setPrompt(preset.prompt);
    }, [preset]);

    return (
        <Modal
            title="编辑提示词预设"
            open={Boolean(preset)}
            onCancel={onClose}
            onOk={() => {
                if (!preset || !name.trim()) return;
                onSave({ ...preset, name: name.trim(), prompt: prompt.trim() || preset.prompt });
            }}
            okText="保存"
            cancelText="取消"
            destroyOnHidden
        >
            <div className="space-y-3 pt-2">
                <div>
                    <div className="mb-1.5 text-sm font-medium">预设名称</div>
                    <Input value={name} onChange={(event) => setName(event.target.value)} />
                </div>
                <div>
                    <div className="mb-1.5 text-sm font-medium">隐藏提示词模板</div>
                    <Input.TextArea rows={8} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
                </div>
            </div>
        </Modal>
    );
}
