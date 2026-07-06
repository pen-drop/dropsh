import { Text } from "ink";
import type React from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { LinkDescriptor } from "./types.js";

interface Entry {
  id: symbol;
  target: LinkDescriptor;
}

interface FocusRegistry {
  // register/unregister are called from TuiLink effects, never during render,
  // so a TuiLink re-rendering without a Provider re-render cannot create
  // duplicate entries. Registration order (via mount-effect order) is DOM order.
  register(id: symbol, target: LinkDescriptor): void;
  unregister(id: symbol): void;
  indexOf(id: symbol): number;
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
  const [entries, setEntries] = useState<Entry[]>([]);
  const reg = useMemo<FocusRegistry>(
    () => ({
      register(id, target) {
        setEntries((prev) => (prev.some((e) => e.id === id) ? prev : [...prev, { id, target }]));
      },
      unregister(id) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
      },
      indexOf: (id) => entries.findIndex((e) => e.id === id),
      count: () => entries.length,
      focusedIndex,
      targetAt: (i) => entries[i]?.target,
    }),
    [entries, focusedIndex],
  );
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
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) idRef.current = Symbol("tuilink");
  const id = idRef.current;
  // Register once on mount, unregister on unmount. A link's target is fixed for
  // its lifetime (derived from stable entity data), so no per-render update.
  // biome-ignore lint/correctness/useExhaustiveDependencies: register once on mount only
  useEffect(() => {
    reg.register(id, target);
    return () => reg.unregister(id);
  }, []);
  const index = reg.indexOf(id);
  const isFocused = index === reg.focusedIndex;
  return <Text inverse={isFocused}>{children}</Text>;
}
