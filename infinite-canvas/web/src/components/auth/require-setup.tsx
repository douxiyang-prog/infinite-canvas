import { useEffect, useState, type ReactNode } from "react";
import { Button, Result, Spin } from "antd";
import { Navigate } from "react-router-dom";

import { fetchSetupStatus, type SetupStatus } from "@/services/api/setup";

export function RequireSetup({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<SetupStatus | null>(null);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        let active = true;
        setError("");
        fetchSetupStatus()
            .then((next) => {
                if (active) setStatus(next);
            })
            .catch((reason) => {
                if (active) setError(reason instanceof Error ? reason.message : "无法读取初始化状态");
            });
        return () => {
            active = false;
        };
    }, [revision]);

    if (error) {
        return (
            <Result
                status="error"
                title="无法读取系统初始化状态"
                subTitle={error}
                extra={<Button onClick={() => setRevision((value) => value + 1)}>重试</Button>}
            />
        );
    }
    if (!status) {
        return (
            <div className="flex h-dvh items-center justify-center bg-background">
                <Spin size="large" />
            </div>
        );
    }
    if (status.setupRequired) return <Navigate to="/setup" replace />;
    return children;
}
