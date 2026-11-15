# Vendored components

Components in this directory are vendored from two MIT-licensed registries rather
than installed as packages, so they can be adapted in place:

- **shadcn-svelte** — https://github.com/huntabyte/shadcn-svelte (MIT)
  Copyright (c) Huntabyte and contributors.
- **shadcn-svelte-extras** — https://github.com/ieedan/shadcn-svelte-extras (MIT)
  Copyright (c) Aidan Bleser and contributors.

Components sourced from shadcn-svelte-extras: `confirm-delete-dialog`,
`copy-button`, `file-drop-zone`, `modal`, `nlp-date-input` (if present),
`phone-input`, `split-button`, plus their shared helpers (`components/button.svelte`,
`hooks/use-clipboard.svelte.ts`). Everything else here is shadcn-svelte core,
including the chat/AI components (`message`, `bubble`, `attachment`, `marker`,
`message-scroller`, `trace`, `code-block`, plus `src/lib/highlighter.ts` and
`src/lib/hooks/use-highlighted-code.svelte.ts`, which depend on
`@shadcn-svelte/primitives` and `shiki`).

The MIT License requires the copyright and permission notices to be included
with substantial portions of the software. Both licenses permit use,
modification, and redistribution under the same permissive terms:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
