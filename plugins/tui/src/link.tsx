import { Text } from "ink";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { LinkDescriptor } from "./types.js";

interface FocusRegistry {
  register(target: LinkDescriptor): number;
  count(): number;
  focusedIndex: number;
  targetAt(i: number): LinkDescriptor | undefined;
}

const Ctx = createContext<FocusRegistry | null>(null);

export function useFocusRegistry(): FocusRegistry {
  const reg = useContext(Ctx);
  if (!reg) throw new Error("useFocusRegistry must be used within FocusRegistryProvider");
  return reg;
}

export function FocusRegistryProvider({
  focusedIndex = 0,
  children,
}: {
  focusedIndex?: number;
  children: React.ReactNode;
}): React.ReactElement {
  const targets = useRef<LinkDescriptor[]>([]);
  const [, force] = useState(0);
  targets.current = [];
  const reg: FocusRegistry = {
    register(target) {
      targets.current.push(target);
      return targets.current.length - 1;
    },
    count: () => targets.current.length,
    focusedIndex,
    targetAt: (i) => targets.current[i],
  };
  // Expose the live target list for the host via context; re-render on mount settle.
  useEffect(() => {
    force((n) => n + 1);
  }, []);
  return <Ctx.Provider value={reg}>{children}</Ctx.Provider>;
}

export function TuiLink({
  target,
  children,
}: {
  target: LinkDescriptor;
  children: React.ReactNode;
}): React.ReactElement {
  const reg = useFocusRegistry();
  const index = reg.register(target);
  const isFocused = index === reg.focusedIndex;
  return <Text inverse={isFocused}>{children}</Text>;
}
