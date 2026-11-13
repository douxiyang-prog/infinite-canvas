import { forwardRef, useImperativeHandle, useRef, type ChangeEvent } from "react";
import { Input, type GetRef } from "antd";

import { normalizeVoiceText } from "@/lib/voice-input-insertion";

export type VoicePromptTextAreaHandle = {
    insertText: (text: string) => void;
};

type Props = {
    value: string;
    onChange: (value: string) => void;
    rows?: number;
    placeholder?: string;
};

export const VoicePromptTextArea = forwardRef<VoicePromptTextAreaHandle, Props>(function VoicePromptTextArea({ value, onChange, rows = 7, placeholder }, ref) {
    const textAreaRef = useRef<GetRef<typeof Input.TextArea>>(null);
    const selectionRef = useRef({ start: value.length, end: value.length });

    const rememberSelection = (textarea: HTMLTextAreaElement | undefined) => {
        if (!textarea) return;
        selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
    };

    const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
        rememberSelection(event.target);
        onChange(event.target.value);
    };

    useImperativeHandle(
        ref,
        () => ({
            insertText(input) {
                const text = normalizeVoiceText(input);
                if (!text) return;
                const textarea = textAreaRef.current?.resizableTextArea?.textArea;
                const focusedTextArea = textarea && document.activeElement === textarea ? textarea : null;
                const remembered = selectionRef.current;
                const start = Math.min(focusedTextArea ? focusedTextArea.selectionStart : remembered.start, value.length);
                const end = Math.min(focusedTextArea ? focusedTextArea.selectionEnd : remembered.end, value.length);
                const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
                const caret = start + text.length;
                selectionRef.current = { start: caret, end: caret };
                onChange(next);
                requestAnimationFrame(() => {
                    const nextTextarea = textAreaRef.current?.resizableTextArea?.textArea;
                    nextTextarea?.focus();
                    nextTextarea?.setSelectionRange(caret, caret);
                });
            },
        }),
        [onChange, value],
    );

    return (
        <Input.TextArea
            ref={textAreaRef}
            value={value}
            onChange={handleChange}
            onSelect={(event) => rememberSelection(event.currentTarget)}
            onClick={(event) => rememberSelection(event.currentTarget)}
            onKeyUp={(event) => rememberSelection(event.currentTarget)}
            rows={rows}
            placeholder={placeholder}
        />
    );
});
