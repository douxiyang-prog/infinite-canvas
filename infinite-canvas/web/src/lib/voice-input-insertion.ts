export function normalizeVoiceText(text: string) {
    return text.replace(/\s+/g, " ").trim();
}

export function captureContentEditableRange(editor: HTMLElement) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return editor.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
}

export function insertTextIntoContentEditable(editor: HTMLElement, text: string, preferredRange?: Range | null) {
    const value = normalizeVoiceText(text);
    if (!value) return false;

    const selection = window.getSelection();
    const currentRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const range = currentRange && editor.contains(currentRange.commonAncestorContainer) ? currentRange : preferredRange && editor.contains(preferredRange.commonAncestorContainer) ? preferredRange : document.createRange();
    if (!editor.contains(range.commonAncestorContainer)) {
        range.selectNodeContents(editor);
        range.collapse(false);
    }

    editor.focus();
    range.deleteContents();
    const textNode = document.createTextNode(value);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
}
