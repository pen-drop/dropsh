// A factory that returns an ARRAY of plugins (as composePlugins would): dropsh
// must flatten a factory-returned array into separate plugin entries, so an
// aggregator presents N children without hand-merging their hooks.
export function makeGroup() {
  return [
    { id: "g-one", requiredModules: [] },
    { id: "g-two", requiredModules: [] },
  ];
}
export default makeGroup;
