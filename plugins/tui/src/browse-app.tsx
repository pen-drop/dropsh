import { Box, Text, useInput } from "ink";
import type React from "react";
import { useState } from "react";
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
}: {
  router: Router;
  onExit: () => void;
  focusedIndex: number;
  setFocusedIndex: (fn: (i: number) => number) => void;
  bump: () => void;
}): null {
  const reg = useFocusRegistry();
  useInput((input, key) => {
    if (input === "q" || key.escape) {
      const hasMore = router.back();
      if (!hasMore) onExit();
      else {
        setFocusedIndex(() => 0);
        bump();
      }
      return;
    }
    if (key.upArrow) setFocusedIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) setFocusedIndex((i) => Math.min(Math.max(0, reg.count() - 1), i + 1));
    if (key.return) {
      const target = reg.targetAt(focusedIndex);
      if (target) {
        void router.navigate(target.route, target.params).then(() => {
          setFocusedIndex(() => 0);
          bump();
        });
      }
    }
  });
  return null;
}

export function Browse({ router, onExit }: BrowseProps): React.ReactElement {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [, setNonce] = useState(0);
  const bump = () => setNonce((n) => n + 1);
  const element = router.current();
  return (
    <FocusRegistryProvider focusedIndex={focusedIndex}>
      <Box flexDirection="column">
        {element}
        <Text dimColor>(↑/↓: move, enter: open, q/esc: back)</Text>
      </Box>
      <Keys
        router={router}
        onExit={onExit}
        focusedIndex={focusedIndex}
        setFocusedIndex={setFocusedIndex}
        bump={bump}
      />
    </FocusRegistryProvider>
  );
}
