import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import type { CanvasExportFile } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { TeamProject } from "@/types/team-project";

export async function importCanvasArchive(
    file: File,
    importProject: (project: Partial<CanvasProject>, teamProject?: Pick<TeamProject, "id" | "title">) => string,
    teamProject?: Pick<TeamProject, "id" | "title">,
) {
    const zip = await readZip(file);
    const projectFile = zip.get("projects.json");
    if (!projectFile) throw new Error("missing projects.json");
    const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
    await Promise.all(
        data.projects.flatMap((project) =>
            project.files.map(async (item) => {
                const blob = zip.get(item.path);
                if (!blob) return;
                const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                const options = teamProject ? { teamProjectId: teamProject.id } : undefined;
                await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob, options) : setMediaBlob(item.storageKey, typedBlob, options));
            }),
        ),
    );
    data.projects.forEach((item) => importProject(item.project, teamProject));
    return { count: data.projects.length, projectIds: data.projects.map((item) => item.project.id) };
}
