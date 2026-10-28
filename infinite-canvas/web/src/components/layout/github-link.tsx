import { cn } from "@/lib/utils";

type GitHubLinkProps = {
    className?: string;
    style?: React.CSSProperties;
};

export function GitHubLink({ className, style }: GitHubLinkProps) {
    return (
        <a
            className={cn(
                "inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] border border-stone-400 px-3 text-base leading-none text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-950 dark:border-stone-500 dark:text-stone-200 dark:hover:bg-stone-800 dark:hover:text-white",
                className,
            )}
            style={style}
            href="https://github.com/basketikun/infinite-canvas/fork"
            target="_blank"
            rel="noreferrer"
        >
            Fork this repository
        </a>
    );
}
