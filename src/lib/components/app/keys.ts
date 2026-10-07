export function isTypingTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
		!!target.closest('[role="dialog"]')
	);
}
