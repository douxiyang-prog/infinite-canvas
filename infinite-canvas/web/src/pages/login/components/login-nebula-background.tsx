import { useEffect, useRef } from "react";

import { useThemeStore } from "@/stores/use-theme-store";

type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    alpha: number;
    depth: number;
    phase: number;
    twinkle: number;
};

type Meteor = {
    x: number;
    y: number;
    dirX: number;
    dirY: number;
    speed: number;
    length: number;
    width: number;
    alpha: number;
    life: number;
};

const TAU = Math.PI * 2;

function createParticles(count: number): Particle[] {
    return Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.006,
        vy: (Math.random() - 0.5) * 0.004,
        radius: 0.55 + Math.random() * 1.65,
        alpha: 0.42 + Math.random() * 0.58,
        depth: 0.2 + Math.random() * 0.8,
        phase: Math.random() * TAU,
        twinkle: 0.45 + Math.random() * 1.5,
    }));
}

function desiredParticleCount(width: number, height: number) {
    return Math.min(190, Math.max(70, Math.floor((width * height) / 11000)));
}

export function LoginNebulaBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const theme = useThemeStore((state) => state.theme);
    const dark = theme === "dark";

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d", { alpha: true });
        if (!canvas || !context) return;

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        let particles = createParticles(120);
        let width = 1;
        let height = 1;
        let dpr = 1;
        let frame = 0;
        let lastTime = 0;
        let pointerX = 0;
        let pointerY = 0;
        let smoothX = 0;
        let smoothY = 0;
        let meteors: Meteor[] = [];
        let nextMeteorAt = 0;
        let initialMeteorCreated = false;

        const createMeteor = (large: boolean, initial = false): Meteor => {
            const angle = Math.PI * (0.62 + Math.random() * 0.22);
            return {
                x: initial ? width * 0.74 : width * (0.08 + Math.random() * 0.84),
                y: initial ? height * 0.18 : -height * 0.08,
                dirX: Math.cos(angle),
                dirY: Math.sin(angle),
                speed: large ? 540 + Math.random() * 170 : 380 + Math.random() * 170,
                length: large ? 280 + Math.random() * 180 : 120 + Math.random() * 110,
                width: large ? 2.4 + Math.random() * 1.5 : 1.1 + Math.random() * 0.8,
                alpha: large ? 0.9 : 0.68,
                life: large ? 4.8 : 3.4,
            };
        };

        const resize = () => {
            const rect = canvas.getBoundingClientRect();
            width = Math.max(1, rect.width);
            height = Math.max(1, rect.height);
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            const count = desiredParticleCount(width, height);
            if (!particles.length || Math.abs(particles.length - count) > 20) particles = createParticles(count);
            draw(performance.now() / 1000, 0);
        };

        const drawClouds = (time: number) => {
            const clouds = dark
                ? [
                      { x: 0.2, y: 0.28, color: "35, 102, 255", alpha: 0.2, radius: 0.46, speed: 0.1 },
                      { x: 0.8, y: 0.24, color: "146, 55, 255", alpha: 0.18, radius: 0.4, speed: 0.08 },
                      { x: 0.58, y: 0.78, color: "0, 174, 190", alpha: 0.15, radius: 0.44, speed: 0.12 },
                      { x: 0.48, y: 0.5, color: "64, 74, 210", alpha: 0.08, radius: 0.52, speed: 0.06 },
                  ]
                : [
                      { x: 0.2, y: 0.3, color: "99, 102, 241", alpha: 0.12, radius: 0.42, speed: 0.1 },
                      { x: 0.82, y: 0.24, color: "14, 165, 233", alpha: 0.1, radius: 0.38, speed: 0.08 },
                      { x: 0.64, y: 0.78, color: "192, 38, 211", alpha: 0.08, radius: 0.4, speed: 0.12 },
                  ];
            context.globalCompositeOperation = dark ? "screen" : "source-over";
            for (const [index, cloud] of clouds.entries()) {
                const driftX = Math.sin(time * cloud.speed + index * 1.7) * width * 0.025;
                const driftY = Math.cos(time * cloud.speed * 0.8 + index) * height * 0.02;
                const radius = Math.max(width, height) * cloud.radius;
                const x = width * cloud.x + driftX + smoothX * (12 + index * 4);
                const y = height * cloud.y + driftY + smoothY * (10 + index * 3);
                const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
                gradient.addColorStop(0, `rgba(${cloud.color}, ${cloud.alpha})`);
                gradient.addColorStop(0.34, `rgba(${cloud.color}, ${cloud.alpha * 0.5})`);
                gradient.addColorStop(0.7, `rgba(${cloud.color}, ${cloud.alpha * 0.16})`);
                gradient.addColorStop(1, `rgba(${cloud.color}, 0)`);
                context.fillStyle = gradient;
                context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
            }
        };

        const draw = (time: number, delta: number) => {
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            context.clearRect(0, 0, width, height);
            smoothX += (pointerX - smoothX) * Math.min(1, delta * 2.5);
            smoothY += (pointerY - smoothY) * Math.min(1, delta * 2.5);
            drawClouds(time);
            context.globalCompositeOperation = dark ? "screen" : "source-over";
            for (const particle of particles) {
                particle.x += particle.vx * delta;
                particle.y += particle.vy * delta;
                if (particle.x < -0.02) particle.x = 1.02;
                if (particle.x > 1.02) particle.x = -0.02;
                if (particle.y < -0.02) particle.y = 1.02;
                if (particle.y > 1.02) particle.y = -0.02;
                const twinkle = 0.7 + Math.sin(time * particle.twinkle + particle.phase) * 0.3;
                const x = particle.x * width + smoothX * particle.depth * 13;
                const y = particle.y * height + smoothY * particle.depth * 10;
                const alpha = particle.alpha * twinkle * (dark ? 1 : 0.58);
                context.beginPath();
                context.fillStyle = dark ? `rgba(248, 252, 255, ${alpha})` : `rgba(71, 85, 105, ${alpha})`;
                context.arc(x, y, particle.radius * particle.depth, 0, TAU);
                context.fill();
                if (particle.depth > 0.78) {
                    context.beginPath();
                    context.fillStyle = dark ? `rgba(191, 225, 255, ${alpha * 0.18})` : `rgba(99, 102, 241, ${alpha * 0.06})`;
                    context.arc(x, y, particle.radius * 5, 0, TAU);
                    context.fill();
                }
            }
            if (dark) {
                if (!initialMeteorCreated) {
                    meteors.push(createMeteor(true, true));
                    nextMeteorAt = time + 5 + Math.random() * 5;
                    initialMeteorCreated = true;
                } else if (time >= nextMeteorAt) {
                    meteors.push(createMeteor(Math.random() < 0.24));
                    nextMeteorAt = time + 6 + Math.random() * 7;
                }
                context.globalCompositeOperation = "lighter";
                meteors = meteors.filter((meteor) => meteor.life > 0);
                for (const meteor of meteors) {
                    meteor.x += meteor.dirX * meteor.speed * delta;
                    meteor.y += meteor.dirY * meteor.speed * delta;
                    meteor.life -= delta;
                    const tailX = meteor.x - meteor.dirX * meteor.length;
                    const tailY = meteor.y - meteor.dirY * meteor.length;
                    const trail = context.createLinearGradient(tailX, tailY, meteor.x, meteor.y);
                    trail.addColorStop(0, "rgba(175, 205, 255, 0)");
                    trail.addColorStop(0.58, `rgba(208, 226, 255, ${meteor.alpha * 0.16})`);
                    trail.addColorStop(0.93, `rgba(240, 247, 255, ${meteor.alpha * 0.84})`);
                    trail.addColorStop(1, `rgba(255, 255, 255, ${meteor.alpha})`);
                    context.strokeStyle = trail;
                    context.lineCap = "round";
                    context.lineWidth = meteor.width * 4;
                    context.globalAlpha = 0.1;
                    context.beginPath();
                    context.moveTo(tailX, tailY);
                    context.lineTo(meteor.x, meteor.y);
                    context.stroke();
                    context.globalAlpha = 1;
                    context.lineWidth = meteor.width;
                    context.beginPath();
                    context.moveTo(tailX, tailY);
                    context.lineTo(meteor.x, meteor.y);
                    context.stroke();
                    const head = context.createRadialGradient(meteor.x, meteor.y, 0, meteor.x, meteor.y, meteor.width * 6);
                    head.addColorStop(0, `rgba(255, 255, 255, ${meteor.alpha})`);
                    head.addColorStop(0.25, `rgba(210, 232, 255, ${meteor.alpha * 0.5})`);
                    head.addColorStop(1, "rgba(160, 205, 255, 0)");
                    context.fillStyle = head;
                    context.beginPath();
                    context.arc(meteor.x, meteor.y, meteor.width * 6, 0, TAU);
                    context.fill();
                }
            }
        };

        const animate = (now: number) => {
            if (document.hidden || reducedMotion.matches) {
                frame = 0;
                return;
            }
            const delta = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
            lastTime = now;
            draw(now / 1000, delta);
            frame = window.requestAnimationFrame(animate);
        };

        const start = () => {
            if (frame || reducedMotion.matches) return;
            lastTime = 0;
            frame = window.requestAnimationFrame(animate);
        };

        const stop = () => {
            if (!frame) return;
            window.cancelAnimationFrame(frame);
            frame = 0;
        };

        const handlePointer = (event: PointerEvent) => {
            pointerX = event.clientX / Math.max(1, window.innerWidth) - 0.5;
            pointerY = event.clientY / Math.max(1, window.innerHeight) - 0.5;
        };
        const resetPointer = () => {
            pointerX = 0;
            pointerY = 0;
        };
        const handleVisibility = () => {
            if (document.hidden) stop();
            else start();
        };
        const handleMotionPreference = () => {
            stop();
            if (reducedMotion.matches) draw(performance.now() / 1000, 0);
            else start();
        };

        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        window.addEventListener("pointermove", handlePointer, { passive: true });
        window.addEventListener("pointerleave", resetPointer);
        document.addEventListener("visibilitychange", handleVisibility);
        reducedMotion.addEventListener("change", handleMotionPreference);
        resize();
        start();

        return () => {
            stop();
            observer.disconnect();
            window.removeEventListener("pointermove", handlePointer);
            window.removeEventListener("pointerleave", resetPointer);
            document.removeEventListener("visibilitychange", handleVisibility);
            reducedMotion.removeEventListener("change", handleMotionPreference);
        };
    }, [dark]);

    return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-black bg-[radial-gradient(circle_at_18%_20%,#dbeafe_0%,transparent_34%),radial-gradient(circle_at_82%_18%,#ede9fe_0%,transparent_32%),radial-gradient(circle_at_58%_88%,#cffafe_0%,transparent_38%),linear-gradient(135deg,#f8fafc_0%,#eef2ff_52%,#f8fafc_100%)] dark:bg-[radial-gradient(circle_at_18%_20%,#0a2a63_0%,transparent_38%),radial-gradient(circle_at_82%_18%,#2a0b4e_0%,transparent_35%),radial-gradient(circle_at_58%_88%,#003d49_0%,transparent_40%),linear-gradient(#000,#000)]" />
            <canvas ref={canvasRef} className="absolute inset-0 size-full" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,rgba(248,250,252,.35)_68%,rgba(241,245,249,.72)_100%)] dark:bg-[radial-gradient(ellipse_at_center,transparent_26%,rgba(0,0,0,.24)_62%,rgba(0,0,0,.92)_100%)]" />
            <div className="absolute inset-0 opacity-[0.16] [background-image:radial-gradient(rgba(30,41,59,.45)_0.6px,transparent_0.6px)] [background-size:22px_22px] dark:opacity-[0.08] dark:[background-image:radial-gradient(rgba(255,255,255,.55)_0.6px,transparent_0.6px)]" />
        </div>
    );
}
