// 0.2.1 leaf-preset replacement for the removed toolFilter field. The original
// deny list is retained and enforced by the host's monotonic tools.guard API.
export const name = 'dsh-purge-leaf-policy';
export const inject = ['tools'];
export const LEAF_DENY = Object.freeze(['subagent', 'subagent_fork', 'workflow', 'ralph']);
export function leafDenial(exec, denied = LEAF_DENY) {
  return denied.includes(exec?.name) ? '红队执行子代理为叶子节点，不允许继续委派' : undefined;
}
export function apply(ctx, config = {}) {
  if (typeof ctx.tools?.guard !== 'function') throw new Error('宿主缺少 tools.guard；拒绝加载无约束的执行子代理');
  const denied = [...new Set([...LEAF_DENY, ...(config.deny || [])])];
  ctx.effect(() => ctx.tools.guard((exec) => leafDenial(exec, denied)));
}

export function compatiblePresetDefinitions(definition) {
  const workerId = 'redteam-leaf';
  const denies = new Set(LEAF_DENY);
  const mapRows = (rows, leaf) => rows.map((row) => {
    const out = { ...row };
    if (out.group && Array.isArray(out.config)) out.config = mapRows(out.config, leaf);
    else if (out.name === '@deepseek-ai/dsh-tool-subagent') {
      if (leaf) out.disabled = true;
      else if (out.config?.toolFilter) {
        const { toolFilter, ...config } = out.config;
        if (toolFilter.allow || !Array.isArray(toolFilter.deny)) throw new Error('无法安全迁移自定义 toolFilter，保留原文件并停止加载');
        for (const item of toolFilter.deny) denies.add(item);
        out.config = { ...config, maxDepth: 1, agentPreset: workerId, allowedAgentPresets: [workerId] };
      }
    } else if (leaf && LEAF_DENY.includes(out.config?.toolName || out.id?.replace(/^tool-/, ''))) out.disabled = true;
    if (out.name === '@deepseek-ai/dsh-persona' && out.config) {
      out.config = { ...out.config };
      for (const key of ['prefix', 'suffix']) if (typeof out.config[key] === 'string') {
        out.config[key] = out.config[key].replace(/\{\{cwd\}\}/g, '[working directory from runtime context]');
      }
    }
    return out;
  });
  const parent = { ...definition, plugins: mapRows(definition.plugins, false) };
  const worker = { ...definition, id: workerId, name: '红队执行子代理（禁止再委派）', order: 1000,
    plugins: [...mapRows(definition.plugins, true), {
      id: 'dsh-purge-leaf-policy', name: new URL('./leaf-policy.js', import.meta.url).href,
      config: { deny: [...denies] },
    }],
  };
  return { parent, worker };
}
