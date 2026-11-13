import { Fragment, useEffect, useRef, useState } from "react";
import { App, Button, Input, Segmented, Select, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { Copy, KeyRound, Link2, PlugZap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { fetchAgentJson } from "@/services/api/canvas-agent";
import { useAgentStore, type AgentModel } from "@/stores/use-agent-store";
import { useConfigStore, type ModelChannel } from "@/stores/use-config-store";

const AGENT_PLUGIN_REMOVE_COMMAND = "codex plugin remove infinite-canvas";
const AGENT_MCP_REMOVE_COMMAND = "codex mcp remove infinite-canvas";

type DshConfig = { provider: string; model: string; hasApiKey: boolean; available?: boolean; runtime: "dsh" | "ark" | "canvas" };

function absoluteChannelBaseUrl(value: string) {
    const trimmed = value.trim();
    try {
        return new URL(trimmed, window.location.origin).toString().replace(/\/+$/, "");
    } catch {
        return trimmed;
    }
}

export function AgentConnectView({
    theme,
    url,
    token,
    enabled,
    connected,
    activity,
    connectError,
    onUrlChange,
    onTokenChange,
    onToggleEnabled,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    url: string;
    token: string;
    enabled: boolean;
    connected: boolean;
    activity: string;
    connectError: string;
    onUrlChange: (value: string) => void;
    onTokenChange: (value: string) => void;
    onToggleEnabled: () => void;
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [dshConfig, setDshConfig] = useState<DshConfig | null>(null);
    const [dshApiKey, setDshApiKey] = useState("");
    const [savingDshConfig, setSavingDshConfig] = useState(false);
    const [changingRuntime, setChangingRuntime] = useState(false);
    const [canvasChannelId, setCanvasChannelId] = useState("");
    const [canvasModel, setCanvasModel] = useState("");
    const [savingCanvasChannel, setSavingCanvasChannel] = useState(false);
    const autoAppliedCanvasChannelRef = useRef("");
    const channels = useConfigStore((state) => state.config.channels);
    const canvasChannels = channels.filter((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.some((model) => model.capability === "text"));
    const selectedCanvasChannel = canvasChannels.find((channel) => channel.id === canvasChannelId) || null;
    const selectedCanvasChannelBaseUrl = selectedCanvasChannel ? absoluteChannelBaseUrl(selectedCanvasChannel.baseUrl) : "";
    useEffect(() => {
        if (!connected || !url.trim() || !token.trim()) return;
        let cancelled = false;
        void fetchAgentJson<{ ok?: boolean } & DshConfig>(url.trim().replace(/\/$/, ""), token.trim(), "/agent/dsh/config")
            .then((data) => {
                if (!cancelled && data.provider) setDshConfig(data);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [connected, token, url]);
    useEffect(() => {
        if (dshConfig?.runtime !== "canvas" || canvasChannelId || !canvasChannels.length) return;
        const savedChannelId = localStorage.getItem("canvas-agent-canvas-channel-id") || "";
        const channel = canvasChannels.find((item) => item.id === savedChannelId) || canvasChannels[0];
        const textModels = channel.models.filter((model) => model.capability === "text");
        const savedModel = localStorage.getItem("canvas-agent-canvas-model") || "";
        setCanvasChannelId(channel.id);
        setCanvasModel(textModels.some((model) => model.name === savedModel) ? savedModel : textModels[0]?.name || "");
    }, [canvasChannelId, canvasChannels, dshConfig?.runtime]);
    const steps = [{ title: t("agent.connect.pluginTitle"), text: t("agent.connect.pluginText") }, { title: t("agent.connect.directTitle"), text: t("agent.connect.directText"), command: "npx -y @basketikun/canvas-agent@latest" }];
    const statusText = connectError ? t("agent.status.failed") : connected ? activity : enabled ? t("agent.status.connecting") : t("agent.status.disconnected");
    const statusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;
    const copyCommand = (command: string) => {
        copyToClipboard(command);
        message.success(t("agent.connect.commandCopied"));
    };
    const saveDshApiKey = async () => {
        if (!dshApiKey.trim() || savingDshConfig) return;
        setSavingDshConfig(true);
        try {
            const saved = await fetchAgentJson<{ ok?: boolean } & DshConfig>(url.trim().replace(/\/$/, ""), token.trim(), "/agent/dsh/config", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ apiKey: dshApiKey.trim() }),
            });
            setDshConfig(saved);
            setDshApiKey("");
            message.success(t("agent.connect.dshKeySaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("agent.connect.dshKeySaveFailed"));
        } finally {
            setSavingDshConfig(false);
        }
    };
    const loadRuntimeModels = async () => {
        const { data = [] } = await fetchAgentJson<{ data?: AgentModel[] }>(url.trim().replace(/\/$/, ""), token.trim(), "/agent/codex/models");
        const models = data.filter((item) => item.supportedReasoningEfforts.length);
        if (!models.length) {
            useAgentStore.getState().setAgentState({ models: [], model: "", reasoningEffort: "" });
            return;
        }
        const current = models.find((item) => item.isDefault) || models[0];
        const effort = current.defaultReasoningEffort || current.supportedReasoningEfforts[0].reasoningEffort;
        localStorage.setItem("canvas-agent-model", current.model);
        localStorage.setItem("canvas-agent-reasoning-effort", effort);
        useAgentStore.getState().setAgentState({ models, model: current.model, reasoningEffort: effort });
    };
    const changeRuntime = async (runtime: "dsh" | "ark" | "canvas") => {
        if (!dshConfig || runtime === dshConfig.runtime || changingRuntime) return;
        setChangingRuntime(true);
        try {
            await fetchAgentJson(url.trim().replace(/\/$/, ""), token.trim(), "/agent/runtime", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ runtime }),
            });
            setDshConfig({ ...dshConfig, runtime });
            await loadRuntimeModels();
            message.success(t("agent.connect.dshRuntimeChanged"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("agent.connect.dshRuntimeChangeFailed"));
        } finally {
            setChangingRuntime(false);
        }
    };
    const rememberCanvasChannel = (channel: ModelChannel, model: string) => {
        localStorage.setItem("canvas-agent-canvas-channel-id", channel.id);
        localStorage.setItem("canvas-agent-canvas-model", model);
        useAgentStore.getState().setAgentState({
            models: [{
                id: model,
                model,
                displayName: `${model} · ${channel.name}`,
                defaultReasoningEffort: "high",
                supportedReasoningEfforts: [
                    { reasoningEffort: "low" },
                    { reasoningEffort: "high" },
                    { reasoningEffort: "max" },
                ],
                isDefault: true,
            }],
            model,
            reasoningEffort: "high",
        });
    };
    const applyCanvasChannel = async (channel: ModelChannel, model: string) => {
        await fetchAgentJson(url.trim().replace(/\/$/, ""), token.trim(), "/agent/canvas-channel", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                channelId: channel.id,
                channelName: channel.name,
                baseUrl: absoluteChannelBaseUrl(channel.baseUrl),
                apiKey: channel.apiKey,
                model,
            }),
        });
        rememberCanvasChannel(channel, model);
    };
    const saveCanvasChannel = async () => {
        if (!selectedCanvasChannel || !canvasModel || savingCanvasChannel) return;
        setSavingCanvasChannel(true);
        try {
            await applyCanvasChannel(selectedCanvasChannel, canvasModel);
            message.success(t("agent.connect.dshCanvasSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("agent.connect.dshCanvasSaveFailed"));
        } finally {
            setSavingCanvasChannel(false);
        }
    };
    useEffect(() => {
        if (!connected || dshConfig?.runtime !== "canvas" || !selectedCanvasChannel || !canvasModel) {
            autoAppliedCanvasChannelRef.current = "";
            return;
        }
        const channel = selectedCanvasChannel;
        const baseUrl = absoluteChannelBaseUrl(channel.baseUrl);
        const key = `${channel.id}\0${canvasModel}\0${baseUrl}`;
        if (autoAppliedCanvasChannelRef.current === key) return;
        autoAppliedCanvasChannelRef.current = key;
        let active = true;
        void (async () => {
            try {
                const current = await fetchAgentJson<{ channel?: { channelId?: string; baseUrl?: string; model?: string } }>(url.trim().replace(/\/$/, ""), token.trim(), "/agent/canvas-channel");
                if (!active) return;
                if (current.channel?.channelId === channel.id && current.channel.baseUrl === baseUrl && current.channel.model === canvasModel) {
                    rememberCanvasChannel(channel, canvasModel);
                    return;
                }
                await applyCanvasChannel(channel, canvasModel);
            } catch {
                if (active) autoAppliedCanvasChannelRef.current = "";
            }
        })();
        return () => {
            active = false;
            if (autoAppliedCanvasChannelRef.current === key) autoAppliedCanvasChannelRef.current = "";
        };
    }, [canvasModel, connected, dshConfig?.runtime, selectedCanvasChannel, token, url]);
    const codexPluginReminder = (
        <div className="rounded-lg border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
            <div className="font-medium" style={{ color: theme.node.text }}>
                {t("agent.connect.pluginReminder")}
            </div>
            <div className="mt-1">{t("agent.connect.pluginReminderText")}</div>
            <div className="mt-2 grid gap-1.5">
                {[
                    [t("agent.connect.removePlugin"), AGENT_PLUGIN_REMOVE_COMMAND],
                    [t("agent.connect.removeMcp"), AGENT_MCP_REMOVE_COMMAND],
                ].map(([label, command]) => (
                    <div key={command} className="flex items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                        <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
                            {label}
                        </span>
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{command}</code>
                        <Tooltip title={t("agent.connect.copyCommand")}>
                            <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} />
                        </Tooltip>
                    </div>
                ))}
            </div>
        </div>
    );
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">{t("agent.connect.title")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("agent.connect.description")}
                    </div>
                </div>
                <div className="space-y-2">
                    {steps.map((step, index) => {
                        const command = "command" in step ? step.command : "";
                        return (
                            <Fragment key={step.title}>
                                <div className="rounded-lg px-3 py-2.5">
                                    <div className="text-sm font-medium leading-5">{step.title}</div>
                                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                        {step.text}
                                    </div>
                                    {command ? (
                                        <div className="mt-2 flex items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                                            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{command}</code>
                                            <Tooltip title={t("agent.connect.copyCommand")}>
                                                <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} />
                                            </Tooltip>
                                        </div>
                                    ) : null}
                                </div>
                                {index === 0 ? codexPluginReminder : null}
                            </Fragment>
                        );
                    })}
                </div>
                {dshConfig ? (
                    <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                        <Segmented
                            block
                            size="small"
                            className="mb-3"
                            value={dshConfig.runtime}
                            loading={changingRuntime}
                            onChange={(value) => void changeRuntime(value as "dsh" | "ark" | "canvas")}
                            options={[
                                { label: t("agent.connect.dshNative"), value: "ark" },
                                { label: t("agent.connect.dshHarness"), value: "dsh", disabled: dshConfig.available === false },
                                { label: t("agent.connect.dshCanvas"), value: "canvas" },
                            ]}
                        />
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-sm font-medium leading-5">{t("agent.connect.dshTitle")}</div>
                                <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                    {t(dshConfig.runtime === "canvas" ? "agent.connect.dshCanvasText" : dshConfig.runtime === "ark" ? "agent.connect.dshNativeText" : "agent.connect.dshText", { provider: dshConfig.provider, model: dshConfig.model })}
                                </div>
                            </div>
                            <span className="shrink-0 text-[11px]" style={{ color: dshConfig.hasApiKey || dshConfig.runtime === "canvas" ? "#16a34a" : theme.node.muted }}>
                                {t(dshConfig.runtime === "canvas" ? "agent.connect.dshCanvasLabel" : dshConfig.hasApiKey ? "agent.connect.dshKeyReady" : "agent.connect.dshKeyMissing")}
                            </span>
                        </div>
                        {dshConfig.runtime === "canvas" ? (
                            <div className="mt-3 space-y-2">
                                <Select
                                    className="w-full"
                                    value={canvasChannelId || undefined}
                                    placeholder={t("agent.connect.dshCanvasChannel")}
                                    options={canvasChannels.map((channel) => ({ label: `${channel.name} · ${channel.baseUrl}`, value: channel.id }))}
                                    onChange={(value) => {
                                        const channel = canvasChannels.find((item) => item.id === value);
                                        const textModels = channel?.models.filter((model) => model.capability === "text") || [];
                                        setCanvasChannelId(value);
                                        setCanvasModel(textModels[0]?.name || "");
                                    }}
                                />
                                <div className="flex items-center gap-2">
                                    <Select
                                        className="min-w-0 flex-1"
                                        value={canvasModel || undefined}
                                        placeholder={t("agent.connect.dshCanvasModel")}
                                        options={selectedCanvasChannel?.models.filter((model) => model.capability === "text").map((model) => ({ label: model.name, value: model.name })) || []}
                                        onChange={setCanvasModel}
                                    />
                                    <Button className="!h-8 !shrink-0 !px-3" type="primary" loading={savingCanvasChannel} disabled={!selectedCanvasChannel || !canvasModel} onClick={() => void saveCanvasChannel()}>
                                        {t("agent.connect.dshCanvasSave")}
                                    </Button>
                                </div>
                                {selectedCanvasChannel ? (
                                    <div className="truncate text-[11px] leading-5" style={{ color: theme.node.muted }} title={selectedCanvasChannelBaseUrl}>
                                        Base URL: {selectedCanvasChannelBaseUrl}
                                    </div>
                                ) : null}
                                {!canvasChannels.length ? (
                                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                        {t("agent.connect.dshCanvasMissing")}
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <div className="mt-3 flex items-center gap-2">
                                <Input.Password
                                    value={dshApiKey}
                                    onChange={(event) => setDshApiKey(event.target.value)}
                                    prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />}
                                    placeholder={t("agent.connect.dshApiKey")}
                                    onPressEnter={() => void saveDshApiKey()}
                                />
                                <Button className="!h-8 !shrink-0 !px-3" type="primary" loading={savingDshConfig} disabled={!dshApiKey.trim()} onClick={() => void saveDshApiKey()}>
                                    {t("agent.connect.dshSave")}
                                </Button>
                            </div>
                        )}
                    </div>
                ) : null}
                <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-sm font-medium leading-5">{t("agent.connect.webConnection")}</span>
                                <span
                                    className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4"
                                    style={{ borderColor: connected || enabled || connectError ? statusColor : theme.node.stroke, color: statusColor }}
                                >
                                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
                                    <span className="truncate">{statusText}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                {t("agent.connect.autoDiscover")}
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>
                            {t(enabled ? "agent.connect.disconnect" : "agent.connect.connect")}
                        </Button>
                    </div>
                    <div className="mt-3 grid gap-2.5">
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <Link2 className="size-3.5" />
                                {t("agent.connect.localAddress")}
                                <span className="font-normal opacity-70">Local URL</span>
                            </span>
                            <Input size="large" prefix={<Link2 className="mr-1 size-4" style={{ color: theme.node.faint }} />} value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder={t("agent.connect.urlPlaceholder")} />
                        </label>
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <KeyRound className="size-3.5" />
                                {t("agent.connect.token")}
                                <span className="font-normal opacity-70">Connect token</span>
                            </span>
                            <Input.Password
                                size="large"
                                prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />}
                                value={token}
                                onChange={(event) => onTokenChange(event.target.value)}
                                placeholder={t("agent.connect.tokenPlaceholder")}
                            />
                        </label>
                        {connectError ? (
                            <div className="rounded-md border px-2.5 py-2 text-xs leading-5" style={{ borderColor: "rgba(220,38,38,.35)", color: "#dc2626" }}>
                                {connectError}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
