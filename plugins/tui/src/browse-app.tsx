import { Box, Text, useInput } from "ink";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { FocusRegistryProvider, useFocusRegistry } from "./link.js";
import type { Router } from "./router.js";

export interface BrowseProps {
  router: Router;
  onExit: () => void;
}

// Inner component: has access to the focus registry so Enter can read the
// focused link target and ask the router to navigate to it.
function Keys({
  router,
  onExit,
  focusedIndex,
  setFocusedIndex,
  bump,
  setError,
  setNavSeq,
}: {
  router: Router;
  onExit: () => void;
  focusedIndex: number;
  setFocusedIndex: (fn: (i: number) => number) => void;
  bump: () => void;
  setError: (msg: string | null) => void;
  setNavSeq: (fn: (n: number) => number) => void;
}): null {
  const reg = useFocusRegistry();
  // Guards against a second Enter landing while a navigation is still pending,
  // which would push a duplicate screen onto the router stack.
  const navigating = useRef(false);
  useInput((input, key) => {
    if (input === "q" || key.escape) {
      const hasMore = router.back();
      if (!hasMore) onExit();
      else {
        setFocusedIndex(() => 0);
        setError(null);
        setNavSeq((n) => n + 1);
        bump();
      }
      return;
    }
    if (key.upArrow) setFocusedIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) setFocusedIndex((i) => Math.min(Math.max(0, reg.count() - 1), i + 1));
    if (key.return) {
      if (navigating.current) return;
      const target = reg.targetAt(focusedIndex);
      if (target) {
        navigating.current = true;
        void router
          .navigate(target.route, target.params)
          .then(() => {
            setFocusedIndex(() => 0);
            setError(null);
            setNavSeq((n) => n + 1);
            bump();
          })
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : String(err));
            bump();
          })
          .finally(() => {
            navigating.current = false;
          });
      }
    }
  });
  return null;
}

export function Browse({ router, onExit }: BrowseProps): React.ReactElement {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [, setNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [navSeq, setNavSeq] = useState(0);
  const bump = () => setNonce((n) => n + 1);
  // Surface controller-initiated (fire-and-forget) navigation errors on the
  // same red error line as host-level ones.
  useEffect(() => {
    router.setErrorHandler((msg) => {
      setError(msg);
      setNonce((n) => n + 1);
    });
  }, [router]);
  const element = router.current();
  return (
    <FocusRegistryProvider focusedIndex={focusedIndex}>
      <Box flexDirection="column">
        <Box key={navSeq} flexDirection="column">
          {element}
        </Box>
        {error !== null ? <Text color="red">Error: {error}</Text> : null}
        <Text dimColor>(↑/↓: move, enter: open, q/esc: back)</Text>
      </Box>
      <Keys
        router={router}
        onExit={onExit}
        focusedIndex={focusedIndex}
        setFocusedIndex={setFocusedIndex}
        bump={bump}
        setError={setError}
        setNavSeq={setNavSeq}
      />
    </FocusRegistryProvider>
  );
}
