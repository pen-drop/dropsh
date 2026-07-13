export function makeChild(opts = {}) {
  return { id: opts.id ?? "child", requiredModules: [] };
}
export default makeChild;
